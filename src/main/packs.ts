// Content packs (main process): optional sample libraries (Concerto, Studio Drums…) that are NOT shipped with
// the app but downloaded on demand from a GitHub release (tag `packs-v1`) into <userData>/packs/<id>/.
//
// Install = fetch `<id>-<version>.json` (manifest: size, sha256) → download `<id>-<version>.tar` to
// <packs>/.downloads/<asset>.part (resumes with a Range request when a partial file exists) → verify size +
// sha256 → extract the (uncompressed, ustar) tar into <packs>/<id>.tmp → write pack.json → swap into
// <packs>/<id>. A pack counts as installed only when <packs>/<id>/pack.json exists.
//
// Node built-ins only and no `electron` import, so the whole thing runs under vitest; src/main/index.ts wires
// it to IPC with registerPackIpc().
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

export const PACKS_TAG = 'packs-v1'
export const DEFAULT_REPO = 'elevchyt/ArkaneDAW'

export interface PackSpec {
  id: string
  version: string
  /** sha256 compiled into the app (packs.json); when set, the release manifest must match it */
  sha256?: string
}

/** <id>-<version>.json, uploaded next to the tar (written by scripts/packs/build.mjs). */
export interface PackManifest {
  id: string
  version: string
  file: string
  size: number
  sha256: string
  files: number
  unpackedSize?: number
}

/** <userData>/packs/<id>/pack.json */
export interface InstalledPack {
  id: string
  version: string
  sha256: string
  files: number
  installedAt: string
}

export type PackPhase = 'manifest' | 'download' | 'verify' | 'extract' | 'done'
export interface PackProgress {
  id: string
  phase: PackPhase
  received: number
  total: number
}

export type PackErrorCode = 'not-published' | 'network' | 'http' | 'checksum' | 'cancelled' | 'disk' | 'bad-archive'
export class PackError extends Error {
  constructor(public code: PackErrorCode, message: string) {
    super(message)
  }
}

export interface PackInfo {
  packsDir: string
  isPackaged: boolean
  resources: string
  repo: string
  baseUrl: string
}

// ─── repo / URLs ───

/** "owner/repo" from package.json's "repository" (string or { url }), falling back to DEFAULT_REPO. */
export function repoSlug(pkg: unknown): string {
  const r = (pkg as { repository?: unknown } | null)?.repository
  const url = typeof r === 'string' ? r : typeof r === 'object' && r && typeof (r as { url?: unknown }).url === 'string' ? (r as { url: string }).url : ''
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?\/?$/.exec(url) ?? /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(url)
  return m ? `${m[1]}/${m[2]}` : DEFAULT_REPO
}

export function readRepoSlug(appPath: string): string {
  try {
    return repoSlug(JSON.parse(readFileSync(join(appPath, 'package.json'), 'utf8')))
  } catch {
    return DEFAULT_REPO
  }
}

export const releaseBaseUrl = (repo: string): string => `https://github.com/${repo}/releases/download/${PACKS_TAG}`
export const assetName = (s: PackSpec, ext: 'tar' | 'json'): string => `${s.id}-${s.version}.${ext}`

// ─── HTTP (redirects, Range resume, cancel) ───

const MAX_REDIRECTS = 10
const IDLE_TIMEOUT = 30_000
const NET_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPIPE', 'ECONNABORTED', 'ERR_SOCKET_CONNECTION_TIMEOUT'])

function netError(e: unknown): PackError {
  if (e instanceof PackError) return e
  const code = (e as { code?: string })?.code ?? ''
  if (NET_CODES.has(code)) return new PackError('network', `Network error (${code}). Check your internet connection and retry.`)
  return new PackError('network', `Download failed: ${(e as Error)?.message ?? String(e)}`)
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PackError('cancelled', 'Cancelled')
}

/** GET with redirects; resolves with the final response (caller consumes or destroys it). */
function request(url: string, headers: Record<string, string>, signal?: AbortSignal, redirects = 0): Promise<http.IncomingMessage> {
  return new Promise((resolveP, reject) => {
    checkAbort(signal)
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return reject(new PackError('http', `Bad URL: ${url}`))
    }
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.get(u, { headers: { 'User-Agent': 'ArkaneDAW', Accept: 'application/octet-stream', ...headers } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        signal?.removeEventListener('abort', onAbort)
        if (redirects >= MAX_REDIRECTS) return reject(new PackError('http', 'Too many redirects'))
        return resolveP(request(new URL(res.headers.location, u).toString(), headers, signal, redirects + 1))
      }
      signal?.removeEventListener('abort', onAbort)
      resolveP(res)
    })
    const onAbort = (): void => {
      req.destroy()
      reject(new PackError('cancelled', 'Cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    req.setTimeout(IDLE_TIMEOUT, () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })))
    req.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.aborted ? new PackError('cancelled', 'Cancelled') : netError(e))
    })
  })
}

function statusError(status: number, what: string): PackError {
  if (status === 404) return new PackError('not-published', `Pack not published yet (${what} returned 404).`)
  return new PackError('http', `Server returned HTTP ${status} for ${what}.`)
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await request(url, { Accept: 'application/json, application/octet-stream' }, signal)
  const status = res.statusCode ?? 0
  if (status !== 200) {
    res.resume()
    throw statusError(status, url.split('/').pop() ?? url)
  }
  const chunks: Buffer[] = []
  try {
    for await (const c of res) chunks.push(c as Buffer)
  } catch (e) {
    throw signal?.aborted ? new PackError('cancelled', 'Cancelled') : netError(e)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new PackError('bad-archive', 'Pack manifest is not valid JSON.')
  }
}

/**
 * Download `url` to `dest`. When `dest` already holds a partial download it asks for the rest with a Range
 * request (206 → append; 200 → server ignored Range, start over; 416 → treat the file as complete).
 */
export async function downloadFile(url: string, dest: string, opts: { total?: number; signal?: AbortSignal; onProgress?: (received: number, total: number) => void } = {}): Promise<number> {
  await fsp.mkdir(dirname(dest), { recursive: true })
  let have = 0
  try {
    have = (await fsp.stat(dest)).size
  } catch {
    /* fresh */
  }
  if (opts.total && have > opts.total) {
    await fsp.rm(dest, { force: true })
    have = 0
  }
  if (opts.total && have === opts.total) {
    opts.onProgress?.(have, have)
    return have
  }
  const res = await request(url, have ? { Range: `bytes=${have}-` } : {}, opts.signal)
  const status = res.statusCode ?? 0
  if (status === 416 && have) {
    res.resume()
    opts.onProgress?.(have, have)
    return have
  }
  if (status !== 200 && status !== 206) {
    res.resume()
    throw statusError(status, url.split('/').pop() ?? url)
  }
  const append = status === 206 && have > 0
  if (!append) have = 0
  const len = Number(res.headers['content-length'] ?? 0)
  const total = opts.total || (len ? have + len : 0)
  let received = have
  opts.onProgress?.(received, total)
  const out = createWriteStream(dest, { flags: append ? 'a' : 'w' })
  try {
    await new Promise<void>((resolveP, reject) => {
      const onAbort = (): void => {
        res.destroy()
        reject(new PackError('cancelled', 'Cancelled'))
      }
      opts.signal?.addEventListener('abort', onAbort, { once: true })
      res.on('data', (c: Buffer) => {
        received += c.length
        if (!out.write(c)) {
          res.pause()
          out.once('drain', () => res.resume())
        }
        opts.onProgress?.(received, total)
      })
      res.on('end', () => {
        opts.signal?.removeEventListener('abort', onAbort)
        if (len && received - have < len) reject(new PackError('network', 'Connection closed before the download finished.'))
        else resolveP()
      })
      res.on('error', (e) => reject(opts.signal?.aborted ? new PackError('cancelled', 'Cancelled') : netError(e)))
      res.on('aborted', () => reject(opts.signal?.aborted ? new PackError('cancelled', 'Cancelled') : new PackError('network', 'Connection lost during download.')))
      out.on('error', (e) => reject(new PackError('disk', `Cannot write ${dest}: ${e.message}`)))
    })
  } finally {
    await new Promise<void>((r) => out.end(r))
  }
  return received
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolveP, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolveP(h.digest('hex')))
      .on('error', reject)
  })
}

// ─── tar (ustar + pax + GNU long names) ───

export interface TarEntry {
  name: string
  type: 'file' | 'dir'
  size: number
  mode: number
}

/** Resolve a tar member path under `root`; rejects absolute paths, drive letters and `..` components. */
export function safeJoin(root: string, name: string): string {
  const clean = name.replace(/\\/g, '/')
  if (!clean || isAbsolute(clean) || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) throw new PackError('bad-archive', `Unsafe path in archive: ${name}`)
  const parts = clean.split('/').filter((p) => p && p !== '.')
  if (parts.some((p) => p === '..')) throw new PackError('bad-archive', `Unsafe path in archive: ${name}`)
  const full = resolve(root, ...parts)
  const r = resolve(root)
  if (full !== r && !full.startsWith(r + sep)) throw new PackError('bad-archive', `Unsafe path in archive: ${name}`)
  return full
}

function cstr(b: Buffer, off: number, len: number): string {
  const s = b.subarray(off, off + len)
  const z = s.indexOf(0)
  return (z < 0 ? s : s.subarray(0, z)).toString('utf8')
}
function octal(b: Buffer, off: number, len: number): number {
  // GNU base-256 for huge sizes
  if (b[off] & 0x80) {
    let v = 0
    for (let i = off + 1; i < off + len; i++) v = v * 256 + b[i]
    return v
  }
  const s = cstr(b, off, len).trim()
  return s ? parseInt(s, 8) : 0
}
function checksumOk(h: Buffer): boolean {
  const want = octal(h, 148, 8)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i]
  return sum === want
}
function parsePax(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i)
    if (sp < 0) break
    const len = parseInt(buf.subarray(i, sp).toString('utf8'), 10)
    if (!len) break
    const rec = buf.subarray(sp + 1, i + len - 1).toString('utf8')
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    i += len
  }
  return out
}

/** Minimal streaming reader over an open file: calls onEntry for files/dirs; file data via `write` sink. */
export async function readTar(
  path: string,
  onEntry: (e: TarEntry, data: AsyncIterable<Buffer> | null) => Promise<void>,
  signal?: AbortSignal
): Promise<number> {
  const fh = await fsp.open(path, 'r')
  try {
    const size = (await fh.stat()).size
    let pos = 0
    let count = 0
    let longName: string | null = null
    let pax: Record<string, string> = {}
    const header = Buffer.alloc(512)
    const readExact = async (buf: Buffer, at: number): Promise<void> => {
      let got = 0
      while (got < buf.length) {
        const { bytesRead } = await fh.read(buf, got, buf.length - got, at + got)
        if (!bytesRead) throw new PackError('bad-archive', 'Archive is truncated.')
        got += bytesRead
      }
    }
    while (pos + 512 <= size) {
      checkAbort(signal)
      await readExact(header, pos)
      pos += 512
      if (header.every((x) => x === 0)) break // end-of-archive
      if (!checksumOk(header)) throw new PackError('bad-archive', 'Archive header checksum mismatch.')
      const typeflag = String.fromCharCode(header[156] || 48)
      const entSize = octal(header, 124, 12)
      const padded = Math.ceil(entSize / 512) * 512
      if (pos + entSize > size) throw new PackError('bad-archive', 'Archive is truncated.')
      if (typeflag === 'x' || typeflag === 'g' || typeflag === 'L') {
        const b = Buffer.alloc(entSize)
        await readExact(b, pos)
        if (typeflag === 'x') pax = parsePax(b)
        else if (typeflag === 'L') longName = cstr(b, 0, b.length)
        pos += padded
        continue
      }
      const magic = cstr(header, 257, 6)
      const prefix = magic.startsWith('ustar') ? cstr(header, 345, 155) : ''
      let name = pax.path ?? longName ?? (prefix ? `${prefix}/${cstr(header, 0, 100)}` : cstr(header, 0, 100))
      const realSize = pax.size ? Number(pax.size) : entSize
      pax = {}
      longName = null
      const mode = octal(header, 100, 8)
      if (typeflag === '0' || typeflag === '7') {
        const start = pos
        const data: AsyncIterable<Buffer> = {
          async *[Symbol.asyncIterator]() {
            let off = 0
            while (off < realSize) {
              checkAbort(signal)
              const n = Math.min(1 << 20, realSize - off)
              const b = Buffer.alloc(n)
              await readExact(b, start + off)
              off += n
              yield b
            }
          }
        }
        await onEntry({ name, type: 'file', size: realSize, mode }, data)
        count++
      } else if (typeflag === '5') {
        name = name.replace(/\/+$/, '')
        if (name) await onEntry({ name, type: 'dir', size: 0, mode }, null)
      } // links, devices, fifos: ignored
      pos += Math.ceil(realSize / 512) * 512
    }
    return count
  } finally {
    await fh.close()
  }
}

/** Extract `tarPath` into `dest` (created). Returns the number of files. */
export async function extractTar(tarPath: string, dest: string, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<number> {
  await fsp.mkdir(dest, { recursive: true })
  const total = (await fsp.stat(tarPath)).size
  let done = 0
  return readTar(
    tarPath,
    async (e, data) => {
      const full = safeJoin(dest, e.name)
      if (e.type === 'dir') {
        await fsp.mkdir(full, { recursive: true })
        return
      }
      await fsp.mkdir(dirname(full), { recursive: true })
      const fh = await fsp.open(full, 'w')
      try {
        for await (const chunk of data!) {
          await fh.write(chunk)
          done += chunk.length
          opts.onProgress?.(done, total)
        }
      } finally {
        await fh.close()
      }
    },
    opts.signal
  )
}

// ─── install / status / remove ───

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const VER_RE = /^[0-9A-Za-z.+_-]{1,32}$/
function checkSpec(s: PackSpec): void {
  if (!ID_RE.test(s.id) || !VER_RE.test(s.version)) throw new PackError('bad-archive', `Invalid pack id/version: ${s.id}@${s.version}`)
}

export async function readInstalled(packsDir: string, id: string): Promise<InstalledPack | null> {
  if (!ID_RE.test(id)) return null
  try {
    const j = JSON.parse(await fsp.readFile(join(packsDir, id, 'pack.json'), 'utf8')) as InstalledPack
    return j && typeof j.version === 'string' ? j : null
  } catch {
    return null
  }
}

export async function removeInstalled(packsDir: string, id: string): Promise<void> {
  if (!ID_RE.test(id)) throw new PackError('bad-archive', `Invalid pack id: ${id}`)
  await fsp.rm(join(packsDir, id), { recursive: true, force: true })
  await fsp.rm(join(packsDir, `${id}.tmp`), { recursive: true, force: true })
  await fsp.rm(join(packsDir, `${id}.old`), { recursive: true, force: true })
}

export async function installPack(
  spec: PackSpec,
  opts: { packsDir: string; baseUrl: string; signal?: AbortSignal; onProgress?: (p: PackProgress) => void }
): Promise<InstalledPack> {
  checkSpec(spec)
  const { packsDir, baseUrl, signal } = opts
  const emit = (phase: PackPhase, received = 0, total = 0): void => opts.onProgress?.({ id: spec.id, phase, received, total })
  emit('manifest')
  const manifest = await fetchJson<PackManifest>(`${baseUrl}/${assetName(spec, 'json')}`, signal)
  if (manifest.id !== spec.id || typeof manifest.sha256 !== 'string' || !(manifest.size > 0)) throw new PackError('bad-archive', 'Pack manifest does not match the requested pack.')
  if (spec.sha256 && manifest.sha256.toLowerCase() !== spec.sha256.toLowerCase())
    throw new PackError('checksum', `The published ${spec.id} ${spec.version} pack does not match this version of ArkaneDAW (checksum differs).`)
  const file = assetName(spec, 'tar')
  const part = join(packsDir, '.downloads', `${file}.part`)
  try {
    await fsp.mkdir(dirname(part), { recursive: true })
  } catch (e) {
    throw new PackError('disk', `Cannot create ${dirname(part)}: ${(e as Error).message}`)
  }
  let last = 0
  await downloadFile(`${baseUrl}/${file}`, part, {
    total: manifest.size,
    signal,
    onProgress: (r, t) => {
      const now = Date.now()
      if (now - last >= 100 || r === t) {
        last = now
        emit('download', r, t)
      }
    }
  })
  checkAbort(signal)
  emit('verify', manifest.size, manifest.size)
  const size = (await fsp.stat(part)).size
  const hash = await sha256File(part)
  if (size !== manifest.size || hash !== manifest.sha256.toLowerCase()) {
    await fsp.rm(part, { force: true })
    throw new PackError('checksum', 'Downloaded file is corrupt (checksum mismatch). Retry to download it again.')
  }
  const tmp = join(packsDir, `${spec.id}.tmp`)
  const final = join(packsDir, spec.id)
  const old = join(packsDir, `${spec.id}.old`)
  await fsp.rm(tmp, { recursive: true, force: true })
  let files: number
  try {
    files = await extractTar(part, tmp, { signal, onProgress: (d, t) => emit('extract', d, t) })
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true })
    if (e instanceof PackError) throw e
    throw new PackError('disk', `Extracting failed: ${(e as Error).message}`)
  }
  checkAbort(signal)
  const info: InstalledPack = { id: spec.id, version: manifest.version, sha256: hash, files, installedAt: new Date().toISOString() }
  // marker written last inside the temp dir; the rename makes the pack appear atomically
  await fsp.writeFile(join(tmp, 'pack.json'), JSON.stringify(info, null, 1))
  await fsp.rm(old, { recursive: true, force: true })
  if (existsSync(final)) await fsp.rename(final, old)
  await fsp.rename(tmp, final)
  await fsp.rm(old, { recursive: true, force: true })
  await fsp.rm(part, { force: true })
  emit('done', manifest.size, manifest.size)
  return info
}

// ─── IPC ───

interface IpcMainLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (e: any, ...args: any[]) => unknown): void
}
interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void
  isDestroyed?(): boolean
}

export type PackResult = { ok: true; installed: InstalledPack } | { ok: false; code: PackErrorCode; message: string }

/**
 * packs:info → PackInfo · packs:installed(id) → InstalledPack|null · packs:install({id,version}) → PackResult
 * (progress on 'packs:progress') · packs:cancel(id) · packs:remove(id)
 */
export function registerPackIpc(ipc: IpcMainLike, target: () => WebContentsLike | null | undefined, info: Omit<PackInfo, 'baseUrl'> & { baseUrl?: string }): void {
  const full: PackInfo = { ...info, baseUrl: process.env.ARKANE_PACKS_BASE_URL || info.baseUrl || releaseBaseUrl(info.repo) }
  const jobs = new Map<string, AbortController>()
  const send = (ch: string, ...args: unknown[]): void => {
    const t = target()
    if (t && !t.isDestroyed?.()) t.send(ch, ...args)
  }
  ipc.handle('packs:info', () => full)
  ipc.handle('packs:installed', (_e, id: string) => readInstalled(full.packsDir, id))
  ipc.handle('packs:install', async (_e, spec: PackSpec): Promise<PackResult> => {
    if (jobs.has(spec.id)) return { ok: false, code: 'http', message: 'Already downloading.' }
    const ac = new AbortController()
    jobs.set(spec.id, ac)
    try {
      const installed = await installPack(spec, { packsDir: full.packsDir, baseUrl: full.baseUrl, signal: ac.signal, onProgress: (p) => send('packs:progress', p) })
      return { ok: true, installed }
    } catch (e) {
      const pe = e instanceof PackError ? e : new PackError('disk', (e as Error)?.message ?? String(e))
      return { ok: false, code: pe.code, message: pe.message }
    } finally {
      jobs.delete(spec.id)
    }
  })
  ipc.handle('packs:cancel', (_e, id: string) => {
    jobs.get(id)?.abort()
    return true
  })
  ipc.handle('packs:remove', async (_e, id: string) => {
    jobs.get(id)?.abort()
    await removeInstalled(full.packsDir, id)
    return true
  })
}
