import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, stat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkForUpdate,
  compareVersions,
  downloadFile,
  fetchChecksum,
  findChecksumAsset,
  isNewer,
  packageInstallCommand,
  parseChecksum,
  parseRepoSlug,
  parseVersion,
  pickRelease,
  planInstall,
  replaceAppImage,
  selectAsset,
  type FetchLike,
  type GhRelease,
  type UpdateInfo
} from './updater-core'

describe('semver', () => {
  it('parses v-prefixed, short and pre-release versions', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: [] })
    expect(parseVersion('V2')).toEqual({ major: 2, minor: 0, patch: 0, pre: [] })
    expect(parseVersion('1.0.0-beta.2+build.7')).toEqual({ major: 1, minor: 0, patch: 0, pre: ['beta', 2] })
    expect(parseVersion('nightly')).toBeNull()
  })

  it('orders versions per semver precedence', () => {
    const sorted = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(compareVersions(sorted[i], sorted[i + 1])).toBeLessThan(0)
      expect(compareVersions(sorted[i + 1], sorted[i])).toBeGreaterThan(0)
    }
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
  })

  it('isNewer handles v-prefix, pre-releases and garbage', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true)
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0-beta.1', '0.1.0')).toBe(true)
    expect(isNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
    expect(isNewer('0.2.0', '0.2.0-beta.1')).toBe(true)
    expect(isNewer('latest', '0.1.0')).toBe(false)
  })

  it('parses the repository slug from package.json forms', () => {
    expect(parseRepoSlug({ type: 'git', url: 'https://github.com/elevchyt/ArkaneDAW' })).toBe('elevchyt/ArkaneDAW')
    expect(parseRepoSlug('git+https://github.com/elevchyt/ArkaneDAW.git')).toBe('elevchyt/ArkaneDAW')
    expect(parseRepoSlug('git@github.com:elevchyt/ArkaneDAW.git')).toBe('elevchyt/ArkaneDAW')
    expect(parseRepoSlug('github:elevchyt/ArkaneDAW')).toBe('elevchyt/ArkaneDAW')
    expect(parseRepoSlug('elevchyt/ArkaneDAW')).toBe('elevchyt/ArkaneDAW')
    expect(parseRepoSlug('https://gitlab.com/x/y')).toBeNull()
    expect(parseRepoSlug(undefined)).toBeNull()
  })
})

const rel = (tag: string, extra: Partial<GhRelease> = {}): GhRelease => ({
  tag_name: tag,
  name: `ArkaneDAW ${tag}`,
  body: '## Changes\n- stuff',
  html_url: `https://github.com/elevchyt/ArkaneDAW/releases/tag/${tag}`,
  published_at: '2026-10-01T10:00:00Z',
  draft: false,
  prerelease: false,
  assets: [],
  ...extra
})

function mockFetch(routes: Record<string, () => Response>): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(url)
    const r = routes[url]
    if (!r) throw new Error(`unexpected fetch ${url}`)
    return r()
  }) as FetchLike & { calls: string[] }
  f.calls = calls
  return f
}
const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const API = 'https://api.github.com/repos/elevchyt/ArkaneDAW/releases'

describe('checkForUpdate', () => {
  it('reports a newer stable release', async () => {
    const fetch = mockFetch({ [`${API}/latest`]: json(rel('v0.2.0', { assets: [{ name: 'ArkaneDAW-0.2.0.AppImage', size: 10, browser_download_url: 'https://x/a' }] })) })
    const r = await checkForUpdate({ repo: 'elevchyt/ArkaneDAW', current: '0.1.0', fetch })
    expect(r.status).toBe('available')
    if (r.status !== 'available') return
    expect(r.info).toMatchObject({ version: '0.2.0', tag: 'v0.2.0', name: 'ArkaneDAW v0.2.0', notes: '## Changes\n- stuff', prerelease: false })
    expect(r.info.assets).toEqual([{ name: 'ArkaneDAW-0.2.0.AppImage', size: 10, url: 'https://x/a' }])
  })

  it('treats 404 (no releases) as up to date and same version as none', async () => {
    expect(await checkForUpdate({ repo: 'elevchyt/ArkaneDAW', current: '0.1.0', fetch: mockFetch({ [`${API}/latest`]: json({ message: 'Not Found' }, 404) }) })).toEqual({ status: 'none', current: '0.1.0' })
    expect(await checkForUpdate({ repo: 'elevchyt/ArkaneDAW', current: '0.1.0', fetch: mockFetch({ [`${API}/latest`]: json(rel('v0.1.0')) }) })).toEqual({ status: 'none', current: '0.1.0', latest: '0.1.0' })
  })

  it('ignores drafts and pre-releases for stable builds', async () => {
    const draft = await checkForUpdate({ repo: 'elevchyt/ArkaneDAW', current: '0.1.0', fetch: mockFetch({ [`${API}/latest`]: json(rel('v0.3.0', { draft: true })) }) })
    expect(draft.status).toBe('none')
    const pre = await checkForUpdate({ repo: 'elevchyt/ArkaneDAW', current: '0.1.0', fetch: mockFetch({ [`${API}/latest`]: json(rel('v0.3.0-beta.1', { prerelease: true })) }) })
    expect(pre.status).toBe('none')
  })

  it('pre-release builds list releases and see newer betas (never drafts)', async () => {
    const fetch = mockFetch({
      [`${API}?per_page=30`]: json([rel('v0.3.0', { draft: true }), rel('v0.2.0-beta.3', { prerelease: true }), rel('v0.2.0-beta.2', { prerelease: true }), rel('v0.1.0')])
    })
    const r = await checkForUpdate({ repo: 'elevchyt/ArkaneDAW', current: '0.2.0-beta.2', fetch })
    expect(r.status === 'available' && r.info.version).toBe('0.2.0-beta.3')
    expect(fetch.calls).toEqual([`${API}?per_page=30`])
  })

  it('reports network errors and rate limits as errors', async () => {
    const down = await checkForUpdate({
      repo: 'elevchyt/ArkaneDAW',
      current: '0.1.0',
      fetch: async () => {
        throw new Error('getaddrinfo ENOTFOUND')
      }
    })
    expect(down).toEqual({ status: 'error', current: '0.1.0', message: 'getaddrinfo ENOTFOUND' })
    const limited = await checkForUpdate({ repo: 'elevchyt/ArkaneDAW', current: '0.1.0', fetch: mockFetch({ [`${API}/latest`]: json({}, 403) }) })
    expect(limited.status).toBe('error')
  })

  it('pickRelease takes the highest acceptable version', () => {
    expect(pickRelease([rel('v1.0.0'), rel('v1.2.0'), rel('v1.1.0')], false)?.tag_name).toBe('v1.2.0')
    expect(pickRelease([rel('v1.0.0'), rel('v2.0.0-rc.1', { prerelease: true })], false)?.tag_name).toBe('v1.0.0')
    expect(pickRelease([rel('v1.0.0'), rel('v2.0.0-rc.1', { prerelease: true })], true)?.tag_name).toBe('v2.0.0-rc.1')
  })
})

const A = (name: string, size = 100) => ({ name, size, url: `https://dl/${name}` })

describe('asset selection', () => {
  const assets = [
    A('ArkaneDAW-0.2.0.AppImage'),
    A('ArkaneDAW-0.2.0-arm64.AppImage'),
    A('arkane-daw_0.2.0_amd64.deb'),
    A('arkane-daw_0.2.0_arm64.deb'),
    A('arkane-daw-0.2.0.x86_64.rpm'),
    A('arkane-daw-0.2.0.aarch64.rpm'),
    A('SHA256SUMS.txt')
  ]

  it('matches arch tokens, untagged names count as x64', () => {
    expect(selectAsset(assets, '.AppImage', 'x64')?.name).toBe('ArkaneDAW-0.2.0.AppImage')
    expect(selectAsset(assets, '.AppImage', 'arm64')?.name).toBe('ArkaneDAW-0.2.0-arm64.AppImage')
    expect(selectAsset(assets, '.deb', 'x64')?.name).toBe('arkane-daw_0.2.0_amd64.deb')
    expect(selectAsset(assets, '.deb', 'arm64')?.name).toBe('arkane-daw_0.2.0_arm64.deb')
    expect(selectAsset(assets, '.rpm', 'x64')?.name).toBe('arkane-daw-0.2.0.x86_64.rpm')
    expect(selectAsset(assets, '.rpm', 'arm64')?.name).toBe('arkane-daw-0.2.0.aarch64.rpm')
    expect(selectAsset([A('ArkaneDAW-x86_64.AppImage')], '.AppImage', 'arm64')).toBeNull()
    expect(selectAsset([A('ArkaneDAW-x86_64.AppImage')], '.appimage', 'x64')?.name).toBe('ArkaneDAW-x86_64.AppImage')
  })

  it('finds per-file and combined checksum assets', () => {
    expect(findChecksumAsset([A('a.AppImage'), A('a.AppImage.sha256')], 'a.AppImage')?.name).toBe('a.AppImage.sha256')
    expect(findChecksumAsset(assets, 'ArkaneDAW-0.2.0.AppImage')?.name).toBe('SHA256SUMS.txt')
    expect(findChecksumAsset([A('ArkaneDAW-0.2.0-checksums.txt')], 'x')?.name).toBe('ArkaneDAW-0.2.0-checksums.txt')
    expect(findChecksumAsset([A('a.AppImage'), A('b.deb')], 'a.AppImage')).toBeNull()
  })

  it('parses checksum files', () => {
    const h1 = 'a'.repeat(64)
    const h2 = 'B'.repeat(64)
    expect(parseChecksum(`${h1}  other.deb\n${h2} *ArkaneDAW.AppImage\n`, 'ArkaneDAW.AppImage')).toBe('b'.repeat(64))
    expect(parseChecksum(`${h1}\n`, 'whatever')).toBe(h1)
    expect(parseChecksum(`SHA256 (x.rpm) = ${h1}`, 'x.rpm')).toBe(h1)
    expect(parseChecksum(`${h1}  dist/x.rpm`, 'x.rpm')).toBe(h1)
    expect(parseChecksum(`${h1}  other`, 'x.rpm')).toBeNull()
  })

  const info: UpdateInfo = { version: '0.2.0', tag: 'v0.2.0', name: 'x', notes: '', htmlUrl: 'https://github.com/r', publishedAt: null, prerelease: false, assets }

  it('plans AppImage replacement, distro packages, or the browser', () => {
    expect(planInstall(info, { isPackaged: false, appImagePath: '/a/x.AppImage', arch: 'x64', family: 'apt' }).kind).toBe('browser')
    const ai = planInstall(info, { isPackaged: true, appImagePath: '/home/u/Apps/ArkaneDAW.AppImage', arch: 'x64', family: 'apt' })
    expect(ai).toMatchObject({ kind: 'appimage', target: '/home/u/Apps/ArkaneDAW.AppImage', asset: { name: 'ArkaneDAW-0.2.0.AppImage' }, checksum: { name: 'SHA256SUMS.txt' } })
    expect(planInstall(info, { isPackaged: true, arch: 'x64', family: 'apt' })).toMatchObject({ kind: 'package', format: 'deb', asset: { name: 'arkane-daw_0.2.0_amd64.deb' } })
    expect(planInstall(info, { isPackaged: true, arch: 'arm64', family: 'dnf' })).toMatchObject({ kind: 'package', format: 'rpm', asset: { name: 'arkane-daw-0.2.0.aarch64.rpm' } })
    expect(planInstall(info, { isPackaged: true, arch: 'x64', family: 'zypper' })).toMatchObject({ kind: 'package', format: 'rpm' })
    expect(planInstall(info, { isPackaged: true, arch: 'x64', family: 'pacman' }).kind).toBe('browser')
    expect(planInstall({ ...info, assets: [] }, { isPackaged: true, appImagePath: '/a.AppImage', arch: 'x64', family: 'apt' }).kind).toBe('browser')
  })

  it('builds package install commands with quoting', () => {
    expect(packageInstallCommand('apt', '/home/u/Downloads/a.deb')).toBe('sudo apt install "/home/u/Downloads/a.deb"')
    expect(packageInstallCommand('dnf', '/x/$y.rpm')).toBe('sudo dnf install "/x/\\$y.rpm"')
    expect(packageInstallCommand('zypper', '/x.rpm')).toBe('sudo zypper install "/x.rpm"')
  })
})

describe('download + install', () => {
  const payload = new Uint8Array(200_000).map((_, i) => i % 251)
  const sha = createHash('sha256').update(payload).digest('hex')
  const fileFetch: FetchLike = async () => new Response(payload, { status: 200, headers: { 'content-length': String(payload.length) } })

  it('downloads with progress and verifies size + sha256', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arkane-upd-'))
    const dest = join(dir, 'x.AppImage.update')
    const seen: number[] = []
    await downloadFile({ url: 'https://dl/x', dest, expectedSize: payload.length, sha256: sha, fetch: fileFetch, onProgress: (r) => seen.push(r) })
    expect(new Uint8Array(await readFile(dest))).toEqual(payload)
    expect(seen.at(-1)).toBe(payload.length)
    expect(await readdir(dir)).toEqual(['x.AppImage.update'])
  })

  it('rejects size and checksum mismatches without leaving files behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arkane-upd-'))
    await expect(downloadFile({ url: 'u', dest: join(dir, 'a'), expectedSize: payload.length + 1, fetch: fileFetch })).rejects.toThrow(/incomplete/)
    await expect(downloadFile({ url: 'u', dest: join(dir, 'b'), expectedSize: payload.length, sha256: 'f'.repeat(64), fetch: fileFetch })).rejects.toThrow(/Checksum/)
    await expect(downloadFile({ url: 'u', dest: join(dir, 'c'), fetch: async () => new Response('nope', { status: 404 }) })).rejects.toThrow(/HTTP 404/)
    expect(await readdir(dir)).toEqual([])
  })

  it('fetches the checksum for a file', async () => {
    const f: FetchLike = async () => new Response(`${sha}  ArkaneDAW.AppImage\n`)
    expect(await fetchChecksum(f, A('SHA256SUMS'), 'ArkaneDAW.AppImage')).toBe(sha)
    expect(await fetchChecksum(f, null, 'x')).toBeNull()
    await expect(fetchChecksum(f, A('SHA256SUMS'), 'other')).rejects.toThrow(/no checksum/)
  })

  it('atomically replaces the AppImage keeping it executable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arkane-upd-'))
    const target = join(dir, 'ArkaneDAW.AppImage')
    const tmp = join(dir, '.ArkaneDAW.AppImage.update')
    await writeFile(target, 'old', { mode: 0o700 })
    await writeFile(tmp, 'new', { mode: 0o600 })
    await replaceAppImage(target, tmp)
    expect(await readFile(target, 'utf8')).toBe('new')
    expect((await stat(target)).mode & 0o777).toBe(0o755)
    expect(await readdir(dir)).toEqual(['ArkaneDAW.AppImage'])
  })
})
