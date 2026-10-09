// Pure updater logic (no Electron imports) so it can be unit-tested under vitest/node:
// semver comparison, GitHub release fetching/parsing, asset selection per arch/distro, checksum parsing,
// streamed download with size + sha256 verification and the atomic AppImage swap.
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, rename, rm, stat } from 'node:fs/promises'
import type { DistroFamily } from '../renderer/src/system/distro'

// ── versions ─────────────────────────────────────────────────────────────────

export interface SemVer {
  major: number
  minor: number
  patch: number
  pre: (string | number)[]
}

/** Parse "1.2.3", "v1.2.3", "V1.2", "1.2.3-beta.1+build.5" (missing minor/patch = 0). Null when unparseable. */
export function parseVersion(v: string): SemVer | null {
  const m = /^\s*[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(v)
  if (!m) return null
  const pre = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : []
  return { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), pre }
}

/** Semver precedence: <0 if a<b, 0 if equal, >0 if a>b. Unparseable versions compare as equal (never "newer"). */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] - y[k]
  // A version without pre-release tags has higher precedence than one with.
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) + (y.pre.length ? 1 : 0)
  const n = Math.max(x.pre.length, y.pre.length)
  for (let i = 0; i < n; i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    if (typeof p === 'number' && typeof q === 'number') return p - q
    if (typeof p === 'number') return -1 // numeric identifiers sort before alphanumeric ones
    if (typeof q === 'number') return 1
    return p < q ? -1 : 1
  }
  return 0
}

export const isNewer = (candidate: string, current: string): boolean => compareVersions(candidate, current) > 0
export const isPrerelease = (v: string): boolean => (parseVersion(v)?.pre.length ?? 0) > 0

/** "owner/repo" from a package.json "repository" field (string or { url }). */
export function parseRepoSlug(repo: unknown): string | null {
  const raw = typeof repo === 'string' ? repo : repo && typeof repo === 'object' ? (repo as { url?: unknown }).url : null
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  const short = /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(s)
  if (short && !s.includes(':/') && !s.startsWith('git@')) return `${short[1]}/${short[2]}`
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(s)
  return m ? `${m[1]}/${m[2]}` : null
}

// ── GitHub releases ─────────────────────────────────────────────────────────

export interface GhAsset {
  name: string
  size: number
  browser_download_url: string
  content_type?: string
}
export interface GhRelease {
  tag_name: string
  name?: string | null
  body?: string | null
  html_url: string
  published_at?: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: GhAsset[]
}

export interface UpdateAsset {
  name: string
  size: number
  url: string
}
export interface UpdateInfo {
  version: string
  tag: string
  name: string
  /** release body (markdown) */
  notes: string
  htmlUrl: string
  publishedAt: string | null
  prerelease: boolean
  assets: UpdateAsset[]
}

export type CheckResult =
  | { status: 'available'; current: string; info: UpdateInfo }
  | { status: 'none'; current: string; latest?: string }
  | { status: 'error'; current: string; message: string }

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

export function toUpdateInfo(r: GhRelease): UpdateInfo {
  const version = r.tag_name.replace(/^[vV]/, '')
  return {
    version,
    tag: r.tag_name,
    name: r.name?.trim() || r.tag_name,
    notes: r.body ?? '',
    htmlUrl: r.html_url,
    publishedAt: r.published_at ?? null,
    prerelease: !!r.prerelease,
    assets: (r.assets ?? []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }))
  }
}

/** Newest acceptable release from a list (drafts never; pre-releases only when `allowPrerelease`). */
export function pickRelease(list: GhRelease[], allowPrerelease: boolean): GhRelease | null {
  let best: GhRelease | null = null
  for (const r of list) {
    if (r.draft || (r.prerelease && !allowPrerelease) || !parseVersion(r.tag_name)) continue
    if (!best || compareVersions(r.tag_name, best.tag_name) > 0) best = r
  }
  return best
}

export interface CheckOptions {
  repo: string
  current: string
  fetch: FetchLike
  /** Defaults to "current version is itself a pre-release". */
  allowPrerelease?: boolean
  signal?: AbortSignal
}

/**
 * Ask GitHub for the newest release. Stable builds use /releases/latest (which already excludes drafts and
 * pre-releases); pre-release builds list /releases so they also see newer betas. 404 = no releases.
 */
export async function checkForUpdate(o: CheckOptions): Promise<CheckResult> {
  const { repo, current } = o
  const allowPre = o.allowPrerelease ?? isPrerelease(current)
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `ArkaneDAW/${current}` }
  const base = `https://api.github.com/repos/${repo}/releases`
  try {
    const res = await o.fetch(allowPre ? `${base}?per_page=30` : `${base}/latest`, { headers, signal: o.signal })
    if (res.status === 404) return { status: 'none', current }
    if (res.status === 403 || res.status === 429) return { status: 'error', current, message: 'GitHub API rate limit reached. Try again later.' }
    if (!res.ok) return { status: 'error', current, message: `GitHub responded ${res.status}` }
    const data = (await res.json()) as GhRelease | GhRelease[]
    const rel = Array.isArray(data) ? pickRelease(data, true) : pickRelease([data], allowPre)
    if (!rel) return { status: 'none', current }
    const info = toUpdateInfo(rel)
    return isNewer(info.version, current) ? { status: 'available', current, info } : { status: 'none', current, latest: info.version }
  } catch (e) {
    return { status: 'error', current, message: e instanceof Error ? e.message : String(e) }
  }
}

// ── asset selection ──────────────────────────────────────────────────────────

const ARCH_TOKENS: Record<string, string[]> = {
  x64: ['x86_64', 'amd64', 'x64'],
  arm64: ['arm64', 'aarch64'],
  arm: ['armv7l', 'armhf', 'armv7'],
  ia32: ['i386', 'i686', 'ia32']
}
const ALL_ARCH_TOKENS = Object.values(ARCH_TOKENS).flat()

function archTokensIn(name: string): string[] {
  const n = name.toLowerCase()
  return ALL_ARCH_TOKENS.filter((t) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(n))
}

/**
 * The asset with extension `ext` (".AppImage", ".deb", ".rpm") built for `arch` (Node's process.arch).
 * Names tagged with our arch win; untagged names are accepted for x64 (electron-builder's default naming).
 */
export function selectAsset<T extends { name: string }>(assets: T[], ext: string, arch: string): T | null {
  const mine = ARCH_TOKENS[arch] ?? [arch]
  const cands = assets.filter((a) => a.name.toLowerCase().endsWith(ext.toLowerCase()))
  const tagged = cands.find((a) => archTokensIn(a.name).some((t) => mine.includes(t)))
  if (tagged) return tagged
  if (arch === 'x64') return cands.find((a) => archTokensIn(a.name).length === 0) ?? null
  return null
}

/** A checksum asset covering `fileName`: "<file>.sha256(sum)" or a combined SHA256SUMS / checksums file. */
export function findChecksumAsset<T extends { name: string }>(assets: T[], fileName: string): T | null {
  const lower = (s: string) => s.toLowerCase()
  const f = lower(fileName)
  return (
    assets.find((a) => [`${f}.sha256`, `${f}.sha256sum`, `${f}.sha256.txt`].includes(lower(a.name))) ??
    assets.find((a) => /^(sha256sums?|checksums?|sha256-?checksums?)(\.txt)?$/i.test(a.name) || /[-_.](sha256sums?|checksums)(\.txt)?$/i.test(a.name)) ??
    null
  )
}

/** sha256 (lowercase hex) for `fileName` from "<hash>  <file>" lines, or a lone hash. */
export function parseChecksum(text: string, fileName: string): string | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  for (const l of lines) {
    const m = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(l)
    if (m && (m[2].trim() === fileName || m[2].trim().split('/').pop() === fileName)) return m[1].toLowerCase()
    const bsd = /^SHA256 \((.+)\) = ([a-fA-F0-9]{64})$/.exec(l)
    if (bsd && bsd[1] === fileName) return bsd[2].toLowerCase()
  }
  if (lines.length === 1 && /^[a-fA-F0-9]{64}$/.test(lines[0])) return lines[0].toLowerCase()
  return null
}

export type InstallPlan =
  | { kind: 'appimage'; asset: UpdateAsset; checksum: UpdateAsset | null; target: string }
  | { kind: 'package'; format: 'deb' | 'rpm'; asset: UpdateAsset; checksum: UpdateAsset | null }
  | { kind: 'browser'; reason: string }

export interface InstallEnv {
  isPackaged: boolean
  /** process.env.APPIMAGE */
  appImagePath?: string
  arch: string
  family: DistroFamily
}

/** Decide how "Update now" installs `info` in this environment. */
export function planInstall(info: UpdateInfo, env: InstallEnv): InstallPlan {
  if (!env.isPackaged) return { kind: 'browser', reason: 'This is a development build, so no files are replaced. The release page was opened in your browser.' }
  if (env.appImagePath) {
    const asset = selectAsset(info.assets, '.AppImage', env.arch)
    if (asset) return { kind: 'appimage', asset, checksum: findChecksumAsset(info.assets, asset.name), target: env.appImagePath }
  }
  const format = env.family === 'apt' ? 'deb' : env.family === 'dnf' || env.family === 'zypper' ? 'rpm' : null
  if (format) {
    const asset = selectAsset(info.assets, `.${format}`, env.arch)
    if (asset) return { kind: 'package', format, asset, checksum: findChecksumAsset(info.assets, asset.name) }
  }
  return { kind: 'browser', reason: 'No download for this system was found in the release. The release page was opened in your browser.' }
}

export function packageInstallCommand(family: DistroFamily, file: string): string {
  const q = `"${file.replace(/(["\\$`])/g, '\\$1')}"`
  if (family === 'apt') return `sudo apt install ${q}`
  if (family === 'dnf') return `sudo dnf install ${q}`
  if (family === 'zypper') return `sudo zypper install ${q}`
  return file
}

// ── download / install ───────────────────────────────────────────────────────

export interface DownloadOptions {
  url: string
  dest: string
  expectedSize?: number
  sha256?: string | null
  fetch: FetchLike
  onProgress?: (received: number, total: number) => void
  signal?: AbortSignal
}

/** Stream `url` to `dest` via "<dest>.part", verifying size and sha256 before the final rename. */
export async function downloadFile(o: DownloadOptions): Promise<void> {
  const part = `${o.dest}.part`
  const res = await o.fetch(o.url, { signal: o.signal, headers: { Accept: 'application/octet-stream' } })
  if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status})`)
  const total = o.expectedSize || Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  const out = createWriteStream(part)
  let received = 0
  let lastTick = 0
  try {
    await new Promise<void>((resolve, reject) => {
      out.once('open', () => resolve())
      out.once('error', reject)
    })
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      received += chunk.length
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
      const now = Date.now()
      if (now - lastTick > 100) {
        lastTick = now
        o.onProgress?.(received, total)
      }
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
    o.onProgress?.(received, total)
    if (o.expectedSize && received !== o.expectedSize) throw new Error(`Download incomplete: got ${received} of ${o.expectedSize} bytes`)
    const digest = hash.digest('hex')
    if (o.sha256 && digest !== o.sha256.toLowerCase()) throw new Error('Checksum mismatch: the downloaded file is corrupt')
    await rename(part, o.dest)
  } catch (e) {
    out.destroy()
    await rm(part, { force: true }).catch(() => {})
    throw e
  }
}

/** Fetch a checksum asset and extract the hash for `fileName` (null when absent or unreadable). */
export async function fetchChecksum(fetch: FetchLike, asset: UpdateAsset | null, fileName: string): Promise<string | null> {
  if (!asset) return null
  const res = await fetch(asset.url, { headers: { Accept: 'application/octet-stream' } })
  if (!res.ok) throw new Error(`Could not download ${asset.name} (HTTP ${res.status})`)
  const hash = parseChecksum(await res.text(), fileName)
  if (!hash) throw new Error(`${asset.name} has no checksum for ${fileName}`)
  return hash
}

/** Atomically replace the running AppImage with a downloaded one (same directory → rename is atomic). */
export async function replaceAppImage(target: string, downloaded: string): Promise<void> {
  let mode = 0o755
  try {
    mode = ((await stat(target)).mode & 0o777) | 0o755
  } catch {
    /* target vanished: keep default */
  }
  await chmod(downloaded, mode)
  await rename(downloaded, target)
}
