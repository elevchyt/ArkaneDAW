#!/usr/bin/env node
// Concerto instrument builder — `npm run concerto`
//
// Downloads the upstream sample libraries (cached in .tools/concerto-src, verified against
// scripts/concerto/sources.lock.json), selects velocity layers / round robins, verifies root keys with pitch
// detection (correcting octave-naming conventions and fine tuning), trims, finds sustain loops and bakes a
// crossfade into them, normalises levels per note, resamples to 48 kHz and encodes 16-bit FLAC into
// resources/concerto/<instrument>/, then writes every instrument.json, resources/concerto/index.json,
// resources/concerto/LICENSES.md and the UI metadata module src/renderer/src/plugins/concerto/instruments.gen.ts.
//
// Options: --jobs=N (parallel decodes/encodes, default 8) · --force (re-encode everything) · --update-lock
//          (accept changed upstream files) · --only=id,id (build some instruments; others keep their JSON)
//          FFMPEG=/path/to/ffmpeg
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SR, applyGain, decodeFile, encodeFlac, envelope, mono, peakOf, pool, resample, rms, trimStart, trimTail } from './lib/audio.mjs'
import { GUARD, makeLoop } from './lib/loop.mjs'
import { detectPitch, noteToMidi } from './lib/pitch.mjs'
import { readSf2 } from './lib/sf2.mjs'
import { parseSfz } from './lib/sfz.mjs'
import { parseWavHeader } from './lib/wav.mjs'
import { ENSEMBLES, INSTRUMENTS, SECTIONS } from './instruments.mjs'
import { SOURCES, VCSL_COMMIT, VSCO_COMMIT } from './sources.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const CACHE = join(ROOT, '.tools/concerto-src')
const OUT = join(ROOT, 'resources/concerto')
const GEN_TS = join(ROOT, 'src/renderer/src/plugins/concerto/instruments.gen.ts')
const LOCK_PATH = join(HERE, 'sources.lock.json')
const STATE_PATH = join(CACHE, 'build-state.json')

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const JOBS = Number(args.jobs ?? 8)
const ONLY = typeof args.only === 'string' ? new Set(args.only.split(',')) : null
/** amplitude ∝ (velocity/127)^VEL_EXP at the layer centres — must match the DSP default */
const VEL_EXP = 1.5
/** keyswitches live on MIDI 12.. (C0..); zones never reach below this */
const KS_BASE = 12
const MIN_KEY = 17
const SUSTAIN_TARGET_DB = -19 // loop-region RMS of the loudest layer
const ONESHOT_TARGET_DB = -13 // attack RMS of the loudest layer

// ─── helpers ───
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d)
const lock = readJson(LOCK_PATH, { files: {} })
const state = readJson(STATE_PATH, {})
let lockDirty = false
let downloads = 0
const lockUsed = new Set()
const warnings = []
const warn = (m) => { warnings.push(m); console.warn(`  ! ${m}`) }

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
  for (const c of [process.env.FFMPEG, join(ROOT, '.tools/ffmpeg/ffmpeg'), 'ffmpeg'].filter(Boolean)) {
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
      if (attempt >= 4) throw e
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
    }
  }
}

/** Cached download of a whole file, checksum-locked by URL. Returns the local path. */
async function cachedFile(url, dest) {
  let buf
  if (existsSync(dest)) buf = readFileSync(dest)
  else {
    if (++downloads % 25 === 1) console.log(`  ↓ downloading… (${downloads}) ${decodeURIComponent(url.split('/').pop())}`)
    buf = await download(url, dest)
  }
  checkLock(url, sha256(buf))
  return { path: dest, buf }
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/')
const vscoFile = (path) => cachedFile(SOURCES.vsco.base + enc(path), join(CACHE, 'vsco', path))
const vcslFile = (path) => cachedFile(SOURCES.vcsl.base + enc(path), join(CACHE, 'vcsl', path))

let vcslTree = null
async function vcslList(dir) {
  if (!vcslTree) {
    const p = join(CACHE, `vcsl-tree-${VCSL_COMMIT}.json`)
    if (!existsSync(p)) {
      console.log('  ↓ VCSL file list (GitHub API)')
      const res = await fetch(`https://api.github.com/repos/sgossner/VCSL/git/trees/${VCSL_COMMIT}?recursive=1`)
      if (!res.ok) throw new Error(`VCSL tree: HTTP ${res.status}`)
      mkdirSync(CACHE, { recursive: true })
      writeFileSync(p, Buffer.from(await res.arrayBuffer()))
    }
    vcslTree = JSON.parse(readFileSync(p, 'utf8')).tree.filter((e) => e.type === 'blob').map((e) => e.path)
  }
  return vcslTree.filter((p) => p.startsWith(dir + '/') && !p.slice(dir.length + 1).includes('/')).map((p) => p.slice(dir.length + 1))
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
    if (!buf) buf = (await cachedFile(s.url, join(CACHE, 'FluidR3_GM.sf2'))).buf
    if (sha256(buf) !== s.sha256) throw new Error('FluidR3_GM.sf2 checksum mismatch')
    checkLock(s.url, s.sha256)
    sf2 = readSf2(buf)
  }
  return sf2
}

const DYN_RANK = { ppp: 0, pp: 1, p: 2, soft: 2, quiet: 2, mp: 3, medium: 4, mf: 4, f: 6, loud: 6, ff: 7, fff: 8 }

// ─── source collection: → [{ root, layerKey, rr, nominal?, load: () => Promise<{ ch, tune? }>, label, group }] ───
async function collect(src, art) {
  const list = Array.isArray(src) ? src : [src]
  const out = []
  for (const [gi, s] of list.entries()) {
    const group = `${art.id}#${gi}`
    if (s.type === 'vsco') {
      const { buf } = await vscoFile(s.sfz)
      for (const r of parseSfz(buf.toString('utf8'))) {
        const rrm = r.path.match(/_rr(\d+)/)
        out.push({
          root: Number(r.pitch_keycenter),
          layerKey: Number(r.lovel ?? 0),
          rr: Number(r.seq_position ?? (rrm ? rrm[1] : 1)),
          label: r.path,
          group,
          spec: s,
          load: async () => {
            const { path, buf: b } = await vscoFile(r.path)
            const h = parseWavHeader(b.subarray(0, Math.min(b.length, 4096)))
            return { ch: await decodeFile(FFMPEG, path, Math.min(2, h?.channels ?? 2)) }
          }
        })
      }
    } else if (s.type === 'vcsl') {
      const re = new RegExp(s.re)
      const files = await vcslList(s.dir)
      for (const f of files) {
        const m = f.match(re)
        if (!m) continue
        const nominal = noteToMidi(m.groups.note)
        if (nominal == null) continue
        const v = m.groups.vel
        out.push({
          root: nominal + 12 * (s.octave ?? 0),
          nominal,
          layerKey: v == null ? 0 : /^\d+$/.test(v) ? Number(v) : DYN_RANK[v] ?? 0,
          rr: m.groups.rr ? Number(m.groups.rr) : 1,
          label: `${s.dir}/${f}`,
          group,
          spec: s,
          load: async () => {
            const { path, buf: b } = await vcslFile(`${s.dir}/${f}`)
            const h = parseWavHeader(b.subarray(0, Math.min(b.length, 4096)))
            return { ch: await decodeFile(FFMPEG, path, Math.min(2, h?.channels ?? 2)) }
          }
        })
      }
      if (!out.some((x) => x.group === group)) throw new Error(`${s.dir}: no files match ${s.re}`)
    } else if (s.type === 'sf2') {
      const sf = await fluid()
      const zones = sf.zones(0, s.program)
      const seen = new Set()
      for (const z of zones) {
        if (z.sample.type === 2) continue // right halves are paired with their left sample
        const key = `${z.sampleIndex}:${z.key}`
        if (seen.has(key)) continue
        seen.add(key)
        const right = z.sample.type === 4 ? zones.find((q) => q.sampleIndex === z.sample.link && q.key[0] === z.key[0] && q.key[1] === z.key[1]) : null
        out.push({
          root: z.root,
          layerKey: 0,
          rr: 1,
          label: `FluidR3 ${s.program}: ${z.sample.name}`,
          group,
          spec: s,
          sf2Tune: z.tune,
          load: async () => ({ ch: await sf2Audio(sf, right ? [z, right] : [z], s, art) })
        })
      }
    } else throw new Error(`unknown source type ${s.type}`)
  }
  // per-source filters
  const res = []
  for (const s of list) {
    let items = out.filter((x) => x.spec === s)
    if (s.keys) items = items.filter((x) => x.root >= s.keys[0] && x.root <= s.keys[1])
    if (s.every > 1) {
      const roots = [...new Set(items.map((x) => x.root))].sort((a, b) => a - b)
      const keep = new Set(roots.filter((_, i) => i % s.every === 0 || i === roots.length - 1))
      items = items.filter((x) => keep.has(x.root))
    }
    res.push(...items)
  }
  return res
}

/** FluidR3 zone(s) → float channels at 48 kHz, loop unrolled (and a decay envelope baked in for `decay`). */
async function sf2Audio(sf, zones, s, art) {
  const z0 = zones[0]
  const sr = z0.sample.sampleRate
  const looped = (z0.loopMode === 1 || z0.loopMode === 3) && z0.loopEnd - z0.loopStart > 8
  const want = art.kind === 'sustain' ? 4.5 : (art.maxLen ?? 3) + 0.5
  const ch = zones.map((z) => {
    const data = sf.pcm(z.start, z.end)
    if (!looped) return data
    const ls = z.loopStart - z.start, le = z.loopEnd - z.start
    const total = Math.max(le, Math.round(want * sr))
    const o = new Float32Array(total)
    o.set(data.subarray(0, le))
    for (let i = le; i < total; i++) o[i] = data[ls + ((i - le) % (le - ls))]
    return o
  })
  if (s.decay) for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= Math.pow(10, (-3 * i) / (s.decay * sr))
  return resample(FFMPEG, ch, sr)
}

// ─── per-articulation processing ───
function pickLayers(keys, sel) {
  if (!sel) return keys
  const out = []
  for (const i of sel) {
    const k = keys[i < 0 ? keys.length + i : i]
    if (k !== undefined && !out.includes(k)) out.push(k)
  }
  return out
}

function attackLoudness(ch) {
  // loudest 50 ms RMS window in the first 400 ms
  const w = Math.round(0.05 * SR)
  let best = 0
  for (let s = 0; s < Math.min(ch[0].length, Math.round(0.4 * SR)); s += w >> 1) best = Math.max(best, rms(ch, s, s + w))
  return best
}

async function buildArticulation(inst, art) {
  const items = await collect(art.src, art)
  // group by root → layers (sorted by source layer key) → round robins
  const byRoot = new Map()
  for (const it of items) {
    if (!byRoot.has(it.root)) byRoot.set(it.root, [])
    byRoot.get(it.root).push(it)
  }
  const roots = [...byRoot.keys()].sort((a, b) => a - b)
  const plan = [] // { root, layers: [[item…rr]] }
  for (const r of roots) {
    const its = byRoot.get(r)
    const specs = new Set(its.map((x) => x.spec))
    const spec = [...specs][0]
    const keys = [...new Set(its.map((x) => x.layerKey))].sort((a, b) => a - b)
    const layers = pickLayers(keys, spec.layers).map((k) => its.filter((x) => x.layerKey === k).sort((a, b) => a.rr - b.rr).slice(0, spec.rr ?? 4))
    plan.push({ root: r, layers })
  }
  // load audio
  const flat = plan.flatMap((p) => p.layers.flat())
  await pool(flat, JOBS, async (it) => {
    it.ch = (await it.load()).ch
    if (it.spec.mono || art.mono) it.ch = [mono(it.ch)]
  })

  // root verification (pitch detection on the loudest layer, first round robin)
  const pitchOk = !art.noPitchCheck
  const groups = [...new Set(flat.map((x) => x.group))]
  for (const g of groups) {
    const gp = plan.filter((p) => p.layers.some((l) => l.some((x) => x.group === g)))
    if (!gp.length) continue
    const spec0 = gp[0].layers[0][0].spec
    if (spec0.type !== 'vcsl' || !pitchOk) continue
    const votes = new Map()
    for (const p of gp) {
      const it = p.layers[p.layers.length - 1][0]
      const d = detectPitch(mono(it.ch), { fromSec: art.kind === 'sustain' ? 0.4 : 0.08, hintHz: 0 })
      if (!d.hz) continue
      const k = Math.round((d.midi - it.root) / 12)
      votes.set(k, (votes.get(k) ?? 0) + 1)
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]
    const total = [...votes.values()].reduce((a, b) => a + b, 0)
    const shift = best ? best[0] : 0
    console.log(`    octave check ${spec0.dir.split('/').slice(-2).join('/')}: ${shift ? `roots off by ${shift} oct` : 'ok'} (${best?.[1] ?? 0}/${total} votes)`)
    if (spec0.octave != null) {
      if (shift) warn(`${inst.id}/${art.id}: configured octave ${spec0.octave} for ${spec0.dir} disagrees with pitch detection by ${shift} oct`)
      continue
    }
    if (shift) for (const p of gp) {
      p.root += 12 * shift
      for (const l of p.layers) for (const x of l) x.root = p.root
    }
  }
  plan.sort((a, b) => a.root - b.root)
  for (let i = 1; i < plan.length; i++) if (plan[i].root === plan[i - 1].root) throw new Error(`${inst.id}/${art.id}: duplicate root ${plan[i].root}`)
  // fine tuning
  for (const p of plan) {
    const it = p.layers[p.layers.length - 1][0]
    p.tune = it.sf2Tune ?? 0
    if (!pitchOk || it.sf2Tune !== undefined) continue
    const hint = 440 * Math.pow(2, (p.root - 69) / 12)
    const d = detectPitch(mono(it.ch), { fromSec: art.kind === 'sustain' ? 0.4 : 0.06, hintHz: hint, frames: 11 })
    if (!d.hz) continue
    let cents = (d.midi - p.root) * 100
    const oct = Math.round(cents / 1200)
    if (oct && Math.abs(cents - oct * 1200) < 60) cents -= oct * 1200 // YIN octave error on this sample
    if (Math.abs(cents) > 60) warn(`${inst.id}/${art.id} root ${p.root}: detected ${d.midi.toFixed(2)} (${cents.toFixed(0)} cents) — kept SFZ/name root`)
    else if (Math.abs(cents) >= 6 && Math.abs(cents) <= 25 && d.spread < 12) p.tune = -Math.round(cents)
  }

  // trim / loop / measure
  const isSus = art.kind === 'sustain'
  for (const p of plan) for (const l of p.layers) for (const it of l) {
    let ch = trimStart(it.ch, { db: isSus ? -48 : -40 })
    if (isSus) {
      const r = makeLoop(ch, { maxLen: art.maxLen ?? 3.0, minLoop: art.minLoop ?? 0.45, maxLoop: art.maxLoop ?? 1.25, xfade: 0.2 })
      it.ch = r.channels
      it.loop = r.loop
      it.ofs = r.ofs
      it.corr = r.corr
      it.loud = rms(r.channels, r.loop[0], r.loop[1])
    } else {
      it.ch = trimTail(ch, { maxLen: art.maxLen ?? 3, floorDb: -58 })
      it.loud = attackLoudness(it.ch)
    }
    it.peak = peakOf(it.ch)
  }

  // normalise: every root's loudest layer → target (correction clamped to ±8 dB around the median), layers keep
  // their natural relative levels (amp)
  const target = Math.pow(10, (isSus ? SUSTAIN_TARGET_DB : ONESHOT_TARGET_DB) / 20)
  const rootLoud = plan.map((p) => Math.max(...p.layers.map((l) => l.reduce((a, x) => a + x.loud, 0) / l.length)) || 1e-6)
  const med = [...rootLoud].sort((a, b) => a - b)[rootLoud.length >> 1]
  const zones = []
  plan.forEach((p, pi) => {
    const corr = Math.min(2.5, Math.max(0.4, med / rootLoud[pi]))
    let g = (target / med) * corr
    const peak = Math.max(...p.layers.flat().map((x) => x.peak)) || 1
    g = Math.min(g, 0.97 / peak)
    const layerLoud = p.layers.map((l) => l.reduce((a, x) => a + x.loud, 0) / l.length)
    const order = layerLoud.map((v, i) => i).sort((a, b) => layerLoud[a] - layerLoud[b])
    const maxL = Math.max(...layerLoud) || 1
    const layers = order.map((li, k) => {
      const amp = Math.max(0.02, layerLoud[li] / maxL)
      return { amp, items: p.layers[li], k }
    })
    for (const L of layers) for (const it of L.items) applyGain(it.ch, g)
    // velocity centres where the layer's natural loudness falls on the velocity curve
    const n = layers.length
    let vels = layers.map((L) => Math.round(127 * Math.pow(L.amp, 1 / VEL_EXP)))
    vels[n - 1] = 127
    for (let i = n - 2; i >= 0; i--) vels[i] = Math.max(1 + i * 8, Math.min(vels[i], vels[i + 1] - 12))
    zones.push({ root: p.root, tune: p.tune, layers: layers.map((L, i) => ({ vel: vels[i], amp: +L.amp.toFixed(4), items: L.items })) })
  })
  // key ranges: midpoints between roots, ends stretched to the instrument range
  zones.forEach((z, i) => {
    z.lo = i === 0 ? Math.max(MIN_KEY, Math.min(z.root, inst.range[0])) : Math.floor((zones[i - 1].root + z.root) / 2) + 1
    z.hi = i === zones.length - 1 ? Math.max(z.root, inst.range[1]) : Math.floor((z.root + zones[i + 1].root) / 2)
    if (z.root - z.lo > 9 || z.hi - z.root > 12) warn(`${inst.id}/${art.id}: root ${z.root} stretched to ${z.lo}-${z.hi}`)
  })
  // velocity ranges
  for (const z of zones) z.layers.forEach((L, i) => {
    L.lo = i === 0 ? 1 : Math.floor((z.layers[i - 1].vel + L.vel) / 2) + 1
    L.hi = i === z.layers.length - 1 ? 127 : Math.floor((L.vel + z.layers[i + 1].vel) / 2)
  })
  // files
  const jobs = []
  const outZones = zones.map((z) => ({
    root: z.root,
    lo: z.lo,
    hi: z.hi,
    ...(z.tune ? { tune: z.tune } : {}),
    layers: z.layers.map((L, li) => ({
      vel: L.vel,
      lo: L.lo,
      hi: L.hi,
      amp: L.amp,
      files: L.items.map((it, ri) => {
        const f = `${inst.id}/${art.id}_${z.root}_v${li + 1}_r${ri + 1}.flac`
        jobs.push({ rel: f, ch: it.ch })
        const e = { f }
        if (it.loop) Object.assign(e, { loop: it.loop, ofs: it.ofs })
        return e
      })
    }))
  }))
  const corrs = flat.filter((x) => x.corr !== undefined).map((x) => x.corr)
  const nFiles = jobs.length
  const secs = jobs.reduce((a, j) => a + j.ch[0].length / SR, 0)
  console.log(`  ${art.id.padEnd(10)} ${zones.length} roots ${zones[0].root}-${zones[zones.length - 1].root} · layers ${Math.max(...zones.map((z) => z.layers.length))} · ${nFiles} files ${secs.toFixed(0)} s${corrs.length ? ` · loop corr min ${Math.min(...corrs).toFixed(2)} med ${corrs.sort((a, b) => a - b)[corrs.length >> 1].toFixed(2)}` : ''}${zones.some((z) => z.tune) ? ` · tuned ${zones.filter((z) => z.tune).map((z) => `${z.root}:${z.tune}`).join(' ')}` : ''}`)

  // release samples (decay kinds)
  let releaseZones
  if (art.release) {
    const rel = await collect(art.release, { ...art, id: art.id + '-rel' })
    await pool(rel, JOBS, async (it) => {
      it.ch = (await it.load()).ch
    })
    // same octave correction as the main samples: match by nominal names
    const shift = plan.length && plan[0].layers[0][0].nominal != null ? plan[0].root - plan[0].layers[0][0].nominal : 0
    const byR = new Map()
    for (const it of rel) {
      const r = (it.nominal ?? it.root) + shift
      if (!byR.has(r)) byR.set(r, [])
      byR.get(r).push(it)
    }
    const rr = [...byR.keys()].sort((a, b) => a - b)
    const relTarget = Math.pow(10, -24 / 20)
    releaseZones = rr.map((r, i) => {
      const its = byR.get(r).sort((a, b) => a.rr - b.rr).slice(0, 2)
      const files = its.map((it, ri) => {
        let ch = trimStart(it.ch, { db: -40 })
        ch = trimTail(ch, { maxLen: art.releaseMaxLen ?? 1.2, floorDb: -54 })
        const g = Math.min(relTarget / (attackLoudness(ch) || 1e-6), 0.9 / (peakOf(ch) || 1))
        applyGain(ch, g)
        const f = `${inst.id}/${art.id}_rel_${r}_r${ri + 1}.flac`
        jobs.push({ rel: f, ch })
        return { f }
      })
      return {
        root: r,
        lo: i === 0 ? MIN_KEY : Math.floor((rr[i - 1] + r) / 2) + 1,
        hi: i === rr.length - 1 ? 127 : Math.floor((r + rr[i + 1]) / 2),
        layers: [{ vel: 127, lo: 1, hi: 127, amp: 1, files }]
      }
    })
    console.log(`  ${(art.id + ' rel').padEnd(10)} ${releaseZones.length} release roots`)
  }

  const json = {
    id: art.id,
    name: art.name,
    kind: art.kind,
    ...(art.damp ? { damp: art.damp } : {}),
    zones: outZones,
    ...(releaseZones ? { release: releaseZones } : {})
  }
  // free decoded sources
  for (const it of flat) it.load = null
  return { json, jobs }
}

/** Ensemble articulation from other instruments' built zones (same files). */
function buildRef(inst, art, built) {
  const zones = []
  for (const r of art.src) {
    const other = built[r.inst]
    if (!other) throw new Error(`${inst.id}: ref to ${r.inst} which is not built yet`)
    const a = other.articulations.find((x) => x.id === r.art)
    if (!a) throw new Error(`${inst.id}: ${r.inst} has no articulation ${r.art}`)
    for (const z of a.zones) {
      const lo = Math.max(z.lo, r.lo ?? 0), hi = Math.min(z.hi, r.hi ?? 127)
      if (lo > hi) continue
      zones.push({ ...z, lo, hi, pan: r.pan ?? 0, gain: +(r.gainDb ?? 0).toFixed(1), part: r.inst })
    }
  }
  console.log(`  ${art.id.padEnd(10)} ensemble · ${zones.length} zones from ${art.src.map((r) => r.inst).join(', ')}`)
  return { id: art.id, name: art.name, kind: art.kind, zones }
}

// ─── main ───
let FFMPEG = 'ffmpeg'

async function main() {
  FFMPEG = findFfmpeg()
  mkdirSync(OUT, { recursive: true })
  const built = {}
  const keep = new Map() // inst -> Set(files)
  let encoded = 0, total = 0

  for (const inst of INSTRUMENTS) {
    const jsonPath = join(OUT, inst.id, 'instrument.json')
    if (ONLY && !ONLY.has(inst.id)) {
      if (existsSync(jsonPath)) built[inst.id] = readJson(jsonPath)
      continue
    }
    console.log(`• ${inst.id} — ${inst.name}`)
    mkdirSync(join(OUT, inst.id), { recursive: true })
    const files = new Set()
    keep.set(inst.id, files)
    const arts = []
    for (const art of inst.arts) {
      const isRef = Array.isArray(art.src) && art.src.every((s) => s.type === 'ref')
      if (isRef) {
        arts.push(buildRef(inst, art, built))
        continue
      }
      const { json, jobs } = await buildArticulation(inst, art)
      total += jobs.length
      await pool(jobs, JOBS, async ({ rel, ch }) => {
        files.add(rel.split('/')[1])
        const out = join(OUT, rel)
        const h = createHash('sha1')
        for (const c of ch) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength))
        const digest = h.digest('hex')
        if (!args.force && state[rel] === digest && existsSync(out)) return
        await encodeFlac(FFMPEG, ch, out)
        state[rel] = digest
        encoded++
      })
      arts.push(json)
    }
    const json = {
      format: 1,
      id: inst.id,
      name: inst.name,
      section: inst.section,
      description: inst.description,
      sampleRate: SR,
      velocityExponent: VEL_EXP,
      range: inst.range,
      solo: !!inst.solo,
      stage: inst.stage,
      ...(inst.tone ? { tone: inst.tone } : {}),
      keyswitchBase: KS_BASE,
      articulations: arts
    }
    writeFileSync(jsonPath, JSON.stringify(json) + '\n')
    built[inst.id] = json
    // stale files of this instrument
    for (const f of readdirSync(join(OUT, inst.id))) if (f.endsWith('.flac') && !files.has(f)) rmSync(join(OUT, inst.id, f))
    mkdirSync(CACHE, { recursive: true })
    writeFileSync(STATE_PATH, JSON.stringify(state))
  }
  console.log(`encoded ${encoded} files (${total} total, unchanged ones skipped)`)

  // index + UI metadata
  const done = INSTRUMENTS.filter((i) => built[i.id])
  const index = done.map((i) => ({ id: i.id, name: i.name, section: i.section }))
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ format: 1, instruments: index }, null, 1) + '\n')
  const meta = done.map((i) => {
    const j = built[i.id]
    return {
      id: i.id,
      name: i.name,
      section: i.section,
      description: i.description,
      range: i.range,
      solo: !!i.solo,
      stage: i.stage,
      arts: j.articulations.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
      files: j.articulations.reduce((n, a) => n + a.zones.reduce((m, z) => m + z.layers.reduce((k, l) => k + l.files.length, 0), 0) + (a.release ?? []).length, 0)
    }
  })
  writeFileSync(
    GEN_TS,
    `// GENERATED by scripts/concerto/build.mjs — do not edit. Instrument metadata for the UI.\n` +
      `// The sample maps live in resources/concerto/<instrument>/instrument.json.\n` +
      `import type { EnsembleDef, InstrumentMeta } from './types'\n\n` +
      `export const SECTIONS = ${JSON.stringify(SECTIONS)} as const\n\n` +
      `export const INSTRUMENTS: InstrumentMeta[] = ${JSON.stringify(meta, null, 1)}\n\n` +
      `export const ENSEMBLES: EnsembleDef[] = ${JSON.stringify(ENSEMBLES, null, 1)}\n`
  )
  writeLicenses()

  writeFileSync(STATE_PATH, JSON.stringify(state))
  if (!ONLY) {
    const pruned = Object.fromEntries(Object.entries(lock.files).filter(([k]) => lockUsed.has(k)).sort(([a], [b]) => a.localeCompare(b)))
    if (lockDirty || Object.keys(pruned).length !== Object.keys(lock.files).length) writeFileSync(LOCK_PATH, JSON.stringify({ files: pruned }, null, 1) + '\n')
  } else if (lockDirty) {
    const sorted = Object.fromEntries(Object.entries(lock.files).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(LOCK_PATH, JSON.stringify({ files: sorted }, null, 1) + '\n')
  }

  let sum = 0
  for (const inst of INSTRUMENTS) {
    const dir = join(OUT, inst.id)
    if (!existsSync(dir)) continue
    let s = 0
    for (const f of readdirSync(dir)) s += statSync(join(dir, f)).size
    sum += s
    console.log(`  ${inst.id.padEnd(13)} ${(s / 1e6).toFixed(1).padStart(6)} MB`)
  }
  console.log(`total ${(sum / 1e6).toFixed(1)} MB in ${relative(ROOT, OUT)}`)
  if (warnings.length) console.log(`${warnings.length} warning(s):\n  ${warnings.join('\n  ')}`)
}

function writeLicenses() {
  const bySource = { vsco: [], vcsl: [], fluid: [] }
  for (const i of INSTRUMENTS) for (const a of i.arts) {
    for (const s of Array.isArray(a.src) ? a.src : [a.src]) {
      const k = s.type === 'vsco' ? 'vsco' : s.type === 'vcsl' ? 'vcsl' : s.type === 'sf2' ? 'fluid' : null
      if (k) bySource[k].push(`${i.name} — ${a.name}`)
    }
    if (a.release) bySource.vcsl.push(`${i.name} — ${a.name} (release samples)`)
  }
  const uniq = (l) => [...new Set(l)]
  const md = `# Concerto — sample sources & licences

The instruments in this folder are **derived works** of the freely redistributable sample libraries listed
below. They were produced by \`scripts/concerto/build.mjs\` (\`npm run concerto\`): velocity layers and round
robins were selected, root keys were verified by pitch detection (octave naming corrected, small tuning
offsets measured), leading silence was trimmed, sustained samples were shortened and given crossfaded loops,
decaying samples were shortened and faded, levels were normalised per note, and everything was resampled to
48 kHz and encoded as 16-bit FLAC. Exact download URLs and checksums are in \`scripts/concerto/sources.mjs\` /
\`sources.lock.json\`. Ensemble instruments (e.g. \`strings/\`) reuse other instruments' files.

## VSCO 2 Community Edition — CC0 1.0

Versilian Studios Chamber Orchestra 2: Community Edition — recorded by Sam Gossner & Simon Dalzell, sample
cutting by Elan Hickler / Soundemote. <${SOURCES.vsco.home}> (commit \`${VSCO_COMMIT}\`, the "SFZ" branch).
Public domain dedication: Creative Commons CC0 1.0 Universal — <https://creativecommons.org/publicdomain/zero/1.0/>.
The authors ask (not as a licence condition) that the samples are not sold on their own as a sample library,
that improvements are shared, and for credit to *Versilian Studios / Sam Gossner* and a link to the VSCO
Community page (<https://vis.versilstudios.net/vsco-community.html>).

Used for: ${uniq(bySource.vsco).join('; ')}.

## Versilian Community Sample Library — CC0 1.0

Versilian Studios — <${SOURCES.vcsl.home}> (commit \`${VCSL_COMMIT}\`).
Public domain dedication (CC0 1.0): "you can do whatever you want with these sounds (even make commercial
software), no royalties, no credit, no special terms".

Used for: ${uniq(bySource.vcsl).join('; ')}.

## FluidR3_GM SoundFont — MIT

FluidR3_GM by Frank Wen (and contributors), distributed under the MIT licence
(<${SOURCES.fluid.home}>, file \`FluidR3_GM.sf2\`, sha256 \`${SOURCES.fluid.sha256}\`). Used only where no CC0
multi-sampled recording was available. Loops were unrolled and re-looped at 48 kHz; the celesta got a baked decay.

Used for: ${uniq(bySource.fluid).join('; ')}.

> Copyright (c) 2000-2002, 2008, 2012 Frank Wen <getfrank@gmail.com>
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without
> limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
> the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial
> portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
> TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
> THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

## Suggested credit

> Orchestral samples: VSCO 2 Community Edition & VCSL by Versilian Studios (CC0); FluidR3_GM by Frank Wen (MIT).
`
  writeFileSync(join(OUT, 'LICENSES.md'), md)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
