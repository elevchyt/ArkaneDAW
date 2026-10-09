#!/usr/bin/env node
// Content-pack builder — `npm run pack:concerto`, `npm run pack:studiodrums`, `npm run packs` (all).
//
// Packs the sample folders that are NOT shipped with the app (resources/concerto, resources/drumkits — the git-lfs
// files are the source of truth) into an uncompressed, deterministic ustar archive (FLACs are already compressed)
// plus a small manifest, both uploaded to the GitHub release `packs-v1`:
//
//   dist-packs/<id>-<version>.tar    members relative to the source folder (index.json, violin/instrument.json, …)
//   dist-packs/<id>-<version>.json   { id, version, file, size, sha256, files, unpackedSize }
//
// Pack ids, versions and source folders live in src/renderer/src/packs/packs.json (shared with the app); after a
// build its sizeBytes/files/sha256 fields are refreshed: the app shows the size before fetching anything and
// verifies the download against the sha256 compiled into it (not only the one in the release manifest).
// Bump a pack's "version" whenever its content changes (installed copies then show "update available").
//
// Options: <id…|all> · --src=DIR (override the source folder; tests) · --out=DIR (default dist-packs)
//          --no-update (don't touch packs.json)
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync, createWriteStream, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const DEFS_PATH = join(ROOT, 'src/renderer/src/packs/packs.json')
const PACKS_TAG = 'packs-v1'

const argv = process.argv.slice(2)
const opts = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] }))
const ids = argv.filter((a) => !a.startsWith('--'))
const defs = JSON.parse(readFileSync(DEFS_PATH, 'utf8'))
const want = !ids.length || ids.includes('all') ? Object.keys(defs) : ids
const OUT = resolve(ROOT, typeof opts.out === 'string' ? opts.out : 'dist-packs')

// ─── deterministic ustar writer ───
const MTIME = 1704067200 // 2024-01-01: fixed so identical content gives an identical archive (and sha256)

function octal(n, len) {
  return n.toString(8).padStart(len - 1, '0') + '\0'
}

function header(name, size, type, extra = {}) {
  const h = Buffer.alloc(512)
  const put = (s, off, len) => h.write(s, off, len, 'utf8')
  let nm = name
  let prefix = ''
  if (Buffer.byteLength(nm) > 100) {
    // ustar prefix split at a '/', name ≤ 100, prefix ≤ 155
    const i = nm.lastIndexOf('/', nm.length - 1)
    let cut = -1
    for (let j = i; j > 0; j = nm.lastIndexOf('/', j - 1)) {
      if (Buffer.byteLength(nm.slice(j + 1)) <= 100 && Buffer.byteLength(nm.slice(0, j)) <= 155) { cut = j; break }
    }
    if (cut < 0) throw new Error(`needs pax: ${name}`)
    prefix = nm.slice(0, cut)
    nm = nm.slice(cut + 1)
  }
  put(nm, 0, 100)
  put(octal(extra.mode ?? (type === '5' ? 0o755 : 0o644), 8), 100, 8)
  put(octal(0, 8), 108, 8)
  put(octal(0, 8), 116, 8)
  put(octal(size, 12), 124, 12)
  put(octal(MTIME, 12), 136, 12)
  h.fill(0x20, 148, 156)
  put(type, 156, 1)
  put('ustar\0', 257, 6)
  put('00', 263, 2)
  put(prefix, 345, 155)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`
  let len = Buffer.byteLength(body) + 1
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body)
  return `${len}${body}`
}

function fitsUstar(name) {
  if (Buffer.byteLength(name) <= 100) return true
  try { header(name, 0, '0'); return true } catch { return false }
}

/** Header block(s) for one member: plain ustar, ustar name+prefix, or a pax 'path' record for anything longer. */
function entryHeaders(name, size, type) {
  if (type === '5' && Buffer.byteLength(name) > 100) name = name.replace(/\/+$/, '') // dirs: typeflag says it all
  if (fitsUstar(name)) return [header(name, size, type)]
  const rec = Buffer.from(paxRecord('path', name), 'utf8')
  const short = name.replace(/\/+$/, '').split('/').pop().slice(-90) || 'entry'
  return [header(`PaxHeader/${short}`, rec.length, 'x'), rec, pad(rec.length), header(short, size, type)]
}

const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512)

function walk(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (e.isFile()) out.push(p)
  }
  return out
}

function isLfsPointer(p, size) {
  if (size > 1024) return false
  const fd = openSync(p, 'r')
  const b = Buffer.alloc(Math.min(size, 64))
  readSync(fd, b, 0, b.length, 0)
  closeSync(fd)
  return b.toString('utf8').startsWith('version https://git-lfs')
}

async function buildPack(id) {
  const def = defs[id]
  if (!def) throw new Error(`unknown pack "${id}" (known: ${Object.keys(defs).join(', ')})`)
  const src = resolve(ROOT, typeof opts.src === 'string' ? opts.src : def.source)
  if (!existsSync(join(src, 'index.json'))) throw new Error(`${src}/index.json not found — build the instruments first (npm run concerto / npm run drumkits) and make sure git-lfs files are pulled`)
  mkdirSync(OUT, { recursive: true })
  const file = `${id}-${def.version}.tar`
  const tarPath = join(OUT, file)
  const files = walk(src)
  const hash = createHash('sha256')
  const ws = createWriteStream(tarPath)
  let size = 0
  let unpacked = 0
  let wsError = null
  ws.on('error', (e) => (wsError = e))
  const write = (b) => new Promise((res, rej) => {
    if (wsError) return rej(wsError)
    hash.update(b)
    size += b.length
    if (ws.write(b)) res()
    else ws.once('drain', res)
  })
  const dirs = new Set()
  for (const p of files) {
    const rel = relative(src, p).split('\\').join('/')
    // directory entries (sorted order already guarantees parents first)
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/') + '/'
      if (dirs.has(d)) continue
      dirs.add(d)
      for (const b of entryHeaders(d, 0, '5')) await write(b)
    }
    const st = statSync(p)
    if (isLfsPointer(p, st.size)) throw new Error(`${rel} is a git-lfs pointer, not the real file — run "git lfs pull" first`)
    for (const b of entryHeaders(rel, st.size, '0')) await write(b)
    const data = readFileSync(p)
    await write(data)
    await write(pad(data.length))
    unpacked += data.length
  }
  await write(Buffer.alloc(1024)) // end-of-archive
  await new Promise((r) => ws.end(r))
  const manifest = { id, version: def.version, file, size, sha256: hash.digest('hex'), files: files.length, unpackedSize: unpacked }
  writeFileSync(join(OUT, `${id}-${def.version}.json`), JSON.stringify(manifest, null, 1) + '\n')
  return manifest
}

const built = []
for (const id of want) {
  process.stdout.write(`packing ${id}… `)
  const m = await buildPack(id)
  built.push(m)
  console.log(`${(m.size / 1048576).toFixed(1)} MB, ${m.files} files, sha256 ${m.sha256.slice(0, 16)}…`)
  if (!opts['no-update'] && typeof opts.src !== 'string') {
    defs[id].sizeBytes = m.size
    defs[id].files = m.files
    defs[id].sha256 = m.sha256
  }
}
if (!opts['no-update'] && typeof opts.src !== 'string') writeFileSync(DEFS_PATH, JSON.stringify(defs, null, 2) + '\n')

const assets = built.flatMap((m) => [join(relative(ROOT, OUT), m.file), join(relative(ROOT, OUT), `${m.id}-${m.version}.json`)])
console.log(`\nWrote ${assets.join(', ')}`)
console.log(`\nPublish (once per new version; the release tag holds every pack):`)
console.log(`  gh release view ${PACKS_TAG} >/dev/null 2>&1 || gh release create ${PACKS_TAG} --title "Content packs (v1)" --notes "Optional sound libraries downloaded by ArkaneDAW on demand. Do not delete."`)
console.log(`  gh release upload ${PACKS_TAG} ${assets.join(' ')} --clobber`)
