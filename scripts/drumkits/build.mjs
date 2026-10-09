#!/usr/bin/env node
// Studio Drums kit builder — `npm run drumkits`
//
// Downloads the upstream sample libraries (cached in .tools/drumkits-src, verified against
// scripts/drumkits/sources.lock.json), picks velocity layers / round robins, mixes multi-mic DrumGizmo hits
// down to stereo, trims, normalises consistently, resamples to 48 kHz and encodes 16-bit FLAC into
// resources/drumkits/<kit>/, then writes every kit.json, resources/drumkits/index.json and the UI metadata
// module src/renderer/src/plugins/studiodrums/kits.gen.ts.
//
// Options: --jobs=N (parallel encodes, default 8) · --force (re-encode everything) · --update-lock
//          (accept changed upstream files) · FFMPEG=/path/to/ffmpeg
// Requires ffmpeg (with soxr). If it's not on PATH, put a static build at .tools/ffmpeg/ffmpeg.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attackLoudness, applyGain, encodeFlac, mixdown, peakOf, pool, toMono, trim } from './lib/audio.mjs'
import { openLocalZip, openRemoteZip } from './lib/remote-zip.mjs'
import { readSf2Samples } from './lib/sf2.mjs'
import { decodeWav, parseWavHeader } from './lib/wav.mjs'
import { CATEGORIES, KITS, PAD_BANKS, PERC, SLOTS } from './kits.mjs'
import { SOURCES } from './sources.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const CACHE = join(ROOT, '.tools/drumkits-src')
const OUT = join(ROOT, 'resources/drumkits')
const GEN_TS = join(ROOT, 'src/renderer/src/plugins/studiodrums/kits.gen.ts')
const LOCK_PATH = join(HERE, 'sources.lock.json')
const STATE_PATH = join(CACHE, 'build-state.json')

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const JOBS = Number(args.jobs ?? 8)
const VEL_EXP = 1.6 // amplitude ∝ (velocity/127)^1.6 — must match the DSP

// ─── helpers ───
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d)
const lock = readJson(LOCK_PATH, { files: {} })
const state = readJson(STATE_PATH, {})
let lockDirty = false
const lockUsed = new Set()

function checkLock(key, hash) {
  lockUsed.add(key)
  const prev = lock.files[key]
  if (prev && prev !== hash) {
    if (!args['update-lock']) throw new Error(`checksum mismatch for ${key}\n  locked ${prev}\n  got    ${hash}\n(re-run with --update-lock to accept)`)
    console.warn(`! ${key}: checksum changed (lock updated)`)
  }
  if (prev !== hash) {
    lock.files[key] = hash
    lockDirty = true
  }
}

function findFfmpeg() {
  const cands = [process.env.FFMPEG, join(ROOT, '.tools/ffmpeg/ffmpeg'), 'ffmpeg'].filter(Boolean)
  for (const c of cands) {
    try {
      const v = execFileSync(c, ['-hide_banner', '-h', 'filter=aresample'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      if (!/soxr/.test(v)) console.warn(`! ${c} has no soxr support; using it anyway`)
      return c
    } catch {
      /* next */
    }
  }
  throw new Error('ffmpeg not found. Install it (apt install ffmpeg) or put a static build at .tools/ffmpeg/ffmpeg (or set FFMPEG=...)')
}

async function download(url, dest) {
  mkdirSync(dirname(dest), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(dest, buf)
      return buf
    } catch (e) {
      if (attempt >= 3) throw e
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
}

/** Cached download of a whole file, checksum-locked by URL. */
async function cachedFile(url, dest) {
  const buf = existsSync(dest) ? readFileSync(dest) : (console.log(`↓ ${url}`), await download(url, dest))
  checkLock(url, sha256(buf))
  return buf
}

// ─── source access ───
const zipCache = new Map()
async function localZip(srcId) {
  if (!zipCache.has(srcId)) {
    zipCache.set(srcId, (async () => {
      const s = SOURCES[srcId]
      const dest = join(CACHE, 'zips', s.url.split('/').pop())
      await cachedFile(s.url, dest)
      const zip = await openLocalZip(dest)
      // pans from the SFZ (drummer's / percussionist's point of view, -100..100)
      const sfzEntry = zip.find(`${s.dir}/${s.sfz}`) ?? zip.entries.find((e) => e.name.endsWith(s.sfz))
      const pans = {}
      if (sfzEntry) {
        const text = (await zip.read(sfzEntry)).toString('utf8')
        let pan = 0
        for (const line of text.split(/\r?\n/)) {
          const g = line.match(/<group>.*?pan=(-?\d+)/)
          if (line.includes('<group>')) pan = g ? Number(g[1]) / 100 : 0
          const r = line.match(/sample=([^\s]+)\.wav/)
          if (r) pans[r[1].replace(/-\d+$/, '')] = pan
          if (r) pans[r[1]] = pan
        }
      }
      return { zip, pans, dir: s.dir }
    })())
  }
  return zipCache.get(srcId)
}

async function readZipWav(srcId, file) {
  const { zip, dir } = await localZip(srcId)
  const e = zip.find(`${dir}/${file}`) ?? zip.entries.find((x) => x.name.endsWith('/' + file))
  if (!e) throw new Error(`${srcId}: ${file} not found in zip`)
  return decodeWav(await zip.read(e))
}

async function readVcsl(path) {
  const url = SOURCES.vcsl.base + path.split('/').map(encodeURIComponent).join('/')
  return decodeWav(await cachedFile(url, join(CACHE, 'vcsl', path)))
}

let sf2 = null
async function fluid() {
  if (!sf2) {
    const s = SOURCES.fluid
    let buf = null
    if (existsSync(s.local)) {
      const b = readFileSync(s.local)
      if (sha256(b) === s.sha256) buf = b
    }
    if (!buf) buf = await cachedFile(s.url, join(CACHE, 'FluidR3_GM.sf2'))
    if (sha256(buf) !== s.sha256) throw new Error('FluidR3_GM.sf2 checksum mismatch')
    checkLock(s.url, s.sha256)
    sf2 = readSf2Samples(buf)
  }
  return sf2
}

// DrumGizmo kits (remote zips)
const dgCache = new Map()
async function dgKit(srcId) {
  if (!dgCache.has(srcId)) {
    dgCache.set(srcId, (async () => {
      const s = SOURCES[srcId]
      console.log(`… reading ${s.url} central directory`)
      const zip = await openRemoteZip(s.url)
      const kitXml = await dgText(srcId, zip, `${s.root}/${s.kitXml}`)
      const channels = [...kitXml.matchAll(/<channel name="([^"]+)"/g)].map((m) => m[1])
      const instruments = {}
      for (const m of kitXml.matchAll(/<instrument name="([^"]+)"[^>]*file="([^"]+)"[^>]*>([\s\S]*?)<\/instrument>/g)) {
        const main = new Set([...m[3].matchAll(/<channelmap in="([^"]+)" out="[^"]+" main="true"/g)].map((x) => x[1]))
        instruments[m[1]] = { file: m[2], main }
      }
      return { zip, channels, instruments, src: s }
    })())
  }
  return dgCache.get(srcId)
}

async function dgText(srcId, zip, member) {
  const dest = join(CACHE, 'dg', srcId, member)
  let buf
  if (existsSync(dest)) buf = readFileSync(dest)
  else {
    const e = zip.find(member)
    if (!e) throw new Error(`${member} not in ${srcId}`)
    buf = await zip.read(e)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
  }
  checkLock(`${SOURCES[srcId].url}#${member}`, sha256(buf))
  return buf.toString('utf8')
}

/** Fetch the first `seconds` of a DrumGizmo sample (all channels). */
async function dgSample(srcId, member, seconds) {
  const kit = await dgKit(srcId)
  const nch = kit.channels.length
  const maxBytes = 8192 + Math.ceil((seconds + 0.25) * 48000 * nch * 4)
  const dest = join(CACHE, 'dg', srcId, `${member}.${maxBytes}`)
  let buf
  if (existsSync(dest)) buf = readFileSync(dest)
  else {
    const e = kit.zip.find(member)
    if (!e) throw new Error(`${member} not in ${srcId}`)
    buf = await kit.zip.read(e, maxBytes)
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
  }
  checkLock(`${SOURCES[srcId].url}#${member}@${maxBytes}`, sha256(buf))
  if (!parseWavHeader(buf)) throw new Error(`bad wav ${member}`)
  return decodeWav(buf)
}

/** Choose `layers` × `rr` samples spread evenly over the instrument's (log) power range. */
function pickDg(samples, layers, rr) {
  const sorted = [...samples].sort((a, b) => a.power - b.power)
  const lp = sorted.map((s) => Math.log(Math.max(1e-12, s.power)))
  const lo = lp[0], hi = lp[lp.length - 1]
  const used = new Set()
  const out = []
  for (let l = 0; l < layers; l++) {
    const target = layers === 1 ? hi : lo + ((hi - lo) * l) / (layers - 1)
    const cands = sorted.map((s, i) => ({ s, i, d: Math.abs(lp[i] - target) })).filter((c) => !used.has(c.i)).sort((a, b) => a.d - b.d)
    const pick = cands.slice(0, rr)
    if (!pick.length) continue
    pick.forEach((c) => used.add(c.i))
    out.push(pick.map((c) => c.s))
  }
  return out
}

// ─── piece loading: returns [[{ ch: Float32Array[], sr }, …rr] …layers] ───
async function loadPiece(piece) {
  const src = piece.src
  const cat = CATEGORIES[piece.cat]
  const maxLen = src.maxLen ?? cat.maxLen
  if (src.type === 'dg') {
    const kit = await dgKit(src.src)
    const inst = kit.instruments[src.instr]
    if (!inst) throw new Error(`instrument ${src.instr} not in ${src.src}`)
    const xml = await dgText(src.src, kit.zip, `${kit.src.root}/${inst.file}`)
    const dir = inst.file.replace(/[^/]+$/, '')
    const samples = []
    for (const m of xml.matchAll(/<sample name="([^"]+)" power="([^"]+)">([\s\S]*?)<\/sample>/g)) {
      const files = [...m[3].matchAll(/<audiofile channel="([^"]+)" file="([^"]+)" filechannel="(\d+)"/g)].map((a) => ({ channel: a[1], file: a[2], fc: Number(a[3]) - 1 }))
      samples.push({ name: m[1], power: Number(m[2]), files })
    }
    const picked = pickDg(samples, src.layers, src.rr)
    const layers = []
    for (const group of picked) {
      const rrs = []
      for (const s of group) {
        const file = s.files[0].file
        if (s.files.some((f) => f.file !== file)) throw new Error('multi-file DrumGizmo samples are not supported')
        const wav = await dgSample(src.src, `${kit.src.root}/${dir}${file}`, maxLen)
        const names = []
        for (const f of s.files) names[f.fc] = f.channel
        const ch = mixdown(wav.channels, names, kit.src.mics, inst.main, wav.sampleRate)
        rrs.push({ ch, sr: wav.sampleRate, name: s.name })
      }
      layers.push(rrs)
    }
    return { layers, pan: 0, maxLen }
  }
  if (src.type === 'zip') {
    const layers = []
    for (const l of src.layers) layers.push(await Promise.all(l.map(async (f) => { const w = await readZipWav(src.src, f); return { ch: toMono(w.channels), sr: w.sampleRate, name: f } })))
    const { pans } = await localZip(src.src)
    return { layers, pan: piece.pan ?? pans[src.sfzPrefix] ?? 0, maxLen }
  }
  if (src.type === 'vcsl') {
    const layers = []
    for (const l of src.layers) layers.push(await Promise.all(l.map(async (f) => { const w = await readVcsl(f); return { ch: toMono(w.channels), sr: w.sampleRate, name: f } })))
    return { layers, pan: piece.pan ?? 0, maxLen }
  }
  if (src.type === 'sf2') {
    const sf = await fluid()
    const layers = src.layers.map((l) => l.map(([ln, rn]) => {
      const a = sf.get(ln), b = sf.get(rn)
      const n = Math.min(a.data.length, b.data.length)
      return { ch: [a.data.subarray(0, n), b.data.subarray(0, n)], sr: a.sampleRate, name: ln }
    }))
    return { layers, pan: piece.pan ?? 0, maxLen }
  }
  throw new Error(`unknown source type ${src.type}`)
}

// ─── main ───
async function main() {
  const ffmpeg = findFfmpeg()
  mkdirSync(OUT, { recursive: true })
  const builtPieces = {} // `${kit}/${piece}` -> kit.json piece entry
  const encodeJobs = []
  let encodedCount = 0
  let totalJobs = 0
  const keepFiles = new Set()

  // 1. build all own pieces (refs resolved later)
  for (const kit of KITS) {
    mkdirSync(join(OUT, kit.id), { recursive: true })
    for (const [pid, piece] of Object.entries(kit.pieces)) {
      if (piece.src.type === 'ref') continue
      const cat = CATEGORIES[piece.cat]
      process.stdout.write(`• ${kit.id}/${pid} `)
      const { layers, pan, maxLen } = await loadPiece(piece)
      // trim + measure
      for (const l of layers) for (const s of l) s.ch = trim(s.ch, s.sr, { maxLen })
      // per-piece normalisation: loudest layer to the category's loudness target, peak capped at -0.3 dBFS
      const peak = Math.max(...layers.flat().map((s) => peakOf(s.ch))) || 1
      const loud0 = layers.map((l) => l.reduce((a, s) => a + attackLoudness(s.ch, s.sr), 0) / l.length)
      const loudMax = Math.max(...loud0) || 1
      const targetDb = piece.loudDb ?? cat.loudDb
      const gain = Math.min(Math.pow(10, targetDb / 20) / loudMax, Math.pow(10, -0.3 / 20) / peak)
      for (const l of layers) for (const s of l) applyGain(s.ch, gain)
      const info = layers.map((l, i) => ({ l, loud: loud0[i] * gain }))
      info.sort((a, b) => a.loud - b.loud)
      const maxLoud = info[info.length - 1].loud || 1
      // Velocity centres. DrumGizmo kits are power-sampled: place layers where their loudness falls on the
      // velocity curve. Libraries with designed velocity splits (AVL, VCSL, SF2) keep evenly spaced splits —
      // their layers are partly level-matched, the DSP restores the dynamics from the measured amp.
      const n = info.length
      const measured = piece.src.type === 'dg'
      let vels = info.map(({ loud }, i) => (measured ? Math.round(127 * Math.pow(loud / maxLoud, 1 / VEL_EXP)) : Math.round((127 * (i + 1)) / n)))
      vels[n - 1] = 127
      for (let i = n - 2; i >= 0; i--) vels[i] = Math.max(1, Math.min(vels[i], vels[i + 1] - 1))
      for (let i = 1; i < n; i++) vels[i] = Math.max(vels[i], vels[i - 1] + 1)
      const outLayers = []
      info.forEach(({ l, loud }, li) => {
        const files = l.map((s, ri) => {
          const rel = `${kit.id}/${pid}_v${li + 1}_r${ri + 1}.flac`
          keepFiles.add(rel)
          encodeJobs.push({ rel, s })
          return rel
        })
        outLayers.push({ vel: vels[li], amp: +(loud / maxLoud).toFixed(5), files })
      })
      const loudDb = (20 * Math.log10(maxLoud)).toFixed(1)
      // velocity ranges: midpoints between layer centres
      outLayers.forEach((L, i) => {
        L.lo = i === 0 ? 1 : Math.floor((outLayers[i - 1].vel + L.vel) / 2) + 1
        L.hi = i === outLayers.length - 1 ? 127 : Math.floor((L.vel + outLayers[i + 1].vel) / 2)
      })
      const channels = layers[0][0].ch.length
      builtPieces[`${kit.id}/${pid}`] = { name: piece.name, cat: piece.cat, channels, pan: +pan.toFixed(2), layers: outLayers.map(({ vel, lo, hi, amp, files }) => ({ vel, lo, hi, amp, files })) }
      console.log(`${outLayers.length}×${Math.max(...outLayers.map((x) => x.files.length))} ${channels === 2 ? 'stereo' : 'mono'} vel=[${outLayers.map((x) => x.vel).join(',')}] amp=[${outLayers.map((x) => x.amp.toFixed(2)).join(',')}] loud=${loudDb} dB`)
    }
    // encode this kit's files (skip unchanged ones)
    totalJobs += encodeJobs.length
    await pool(encodeJobs, JOBS, async ({ rel, s }) => {
      const out = join(OUT, rel)
      const h = createHash('sha1')
      h.update(String(s.sr))
      for (const c of s.ch) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength))
      const digest = h.digest('hex')
      if (!args.force && state[rel] === digest && existsSync(out)) return
      await encodeFlac(ffmpeg, s.ch, s.sr, out)
      state[rel] = digest
      encodedCount++
    })
    encodeJobs.length = 0
  }

  console.log(`encoded ${encodedCount} files (${totalJobs} total, unchanged ones skipped)`)


  // 3. kit.json per kit
  const index = []
  const meta = []
  for (const kit of KITS) {
    const pieces = {}
    const usePiece = (kitId, pid) => {
      const k = KITS.find((x) => x.id === kitId)
      const def = k.pieces[pid]
      if (!def) throw new Error(`${kitId}: unknown piece ${pid}`)
      if (def.src.type === 'ref') return usePiece(def.src.kit, def.src.piece)
      return builtPieces[`${kitId}/${pid}`]
    }
    const keys = {}
    const addKey = (key, spec, slot, pieceKit) => {
      const s = typeof spec === 'string' ? { piece: spec } : spec
      const local = pieceKit === kit.id ? s.piece : `${pieceKit}.${s.piece}`
      if (!pieces[local]) {
        const p = usePiece(pieceKit, s.piece)
        if (!p) throw new Error(`${kit.id}: piece ${pieceKit}/${s.piece} was not built`)
        pieces[local] = { ...p, name: pieceKit === kit.id ? kit.pieces[s.piece].name : p.name }
      }
      const { piece: _p, ...rest } = s
      keys[key] = { piece: local, ...slot, ...rest }
    }
    for (const [key, spec] of Object.entries(kit.keys)) {
      const slot = SLOTS[key]
      if (!slot) throw new Error(`${kit.id}: key ${key} has no slot definition`)
      addKey(key, spec, slot, kit.id)
    }
    for (const [key, spec] of Object.entries(PERC.keys)) {
      if (keys[key]) continue
      addKey(key, spec, PERC.slot, 'latin')
    }
    // flat key order
    const sortedKeys = Object.fromEntries(Object.entries(keys).sort((a, b) => Number(a[0]) - Number(b[0])))
    const pads = kit.id === 'latin' ? PAD_BANKS.latin : kit.id === 'brushes' ? PAD_BANKS.brushes : PAD_BANKS.drums
    const json = {
      format: 1,
      id: kit.id,
      name: kit.name,
      description: kit.description,
      sampleRate: 48000,
      velocityExponent: VEL_EXP,
      pieces,
      keys: sortedKeys,
      pads
    }
    writeFileSync(join(OUT, kit.id, 'kit.json'), JSON.stringify(json, null, 1) + '\n')
    index.push({ id: kit.id, name: kit.name, description: kit.description })
    meta.push({
      id: kit.id,
      name: kit.name,
      description: kit.description,
      keys: Object.fromEntries(Object.entries(sortedKeys).map(([k, v]) => [k, { name: v.name, group: v.group, ch: v.ch, piece: v.piece }])),
      pads
    })
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ format: 1, kits: index }, null, 1) + '\n')
  writeFileSync(
    GEN_TS,
    `// GENERATED by scripts/drumkits/build.mjs — do not edit. Kit metadata for the UI (key names, pads).\n` +
      `// The sample data itself lives in resources/drumkits/<kit>/kit.json.\n` +
      `import type { KitMeta } from './types'\n\n` +
      `export const KITS: KitMeta[] = ${JSON.stringify(meta, null, 1)}\n`
  )

  // 4. remove stale flac files from previous builds
  for (const kit of KITS) {
    const dir = join(OUT, kit.id)
    for (const f of readdirSync(dir)) if (f.endsWith('.flac') && !keepFiles.has(`${kit.id}/${f}`)) rmSync(join(dir, f))
  }

  mkdirSync(CACHE, { recursive: true })
  writeFileSync(STATE_PATH, JSON.stringify(state))
  // keep only the entries this build used (sorted, so the file diffs nicely)
  const pruned = Object.fromEntries(Object.entries(lock.files).filter(([k]) => lockUsed.has(k)).sort(([a], [b]) => a.localeCompare(b)))
  if (lockDirty || Object.keys(pruned).length !== Object.keys(lock.files).length) writeFileSync(LOCK_PATH, JSON.stringify({ files: pruned }, null, 1) + '\n')

  // size report
  let total = 0
  for (const kit of KITS) {
    let s = 0
    for (const f of readdirSync(join(OUT, kit.id))) s += statSync(join(OUT, kit.id, f)).size
    total += s
    console.log(`  ${kit.id.padEnd(8)} ${(s / 1e6).toFixed(1)} MB`)
  }
  console.log(`total ${(total / 1e6).toFixed(1)} MB in ${relative(ROOT, OUT)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
