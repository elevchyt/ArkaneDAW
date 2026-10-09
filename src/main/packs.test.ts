// Content packs (main process): tar reader, path safety, sha256, repo slug, and the full download → verify →
// extract → install flow against a local HTTP server (redirect + Range resume + 404), plus a builder round trip.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { downloadFile, extractTar, installPack, PackError, readInstalled, readTar, removeInstalled, repoSlug, safeJoin, sha256File, type PackProgress } from './packs'

// ─── independent tiny tar writer for the tests ───
function hdr(name: string, size: number, type: string, prefix = ''): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100)
  h.write('0000644\0', 100)
  h.write('0000000\0', 108)
  h.write('0000000\0', 116)
  h.write(size.toString(8).padStart(11, '0') + '\0', 124)
  h.write('00000000000\0', 136)
  h.fill(0x20, 148, 156)
  h.write(type, 156)
  h.write('ustar\0', 257)
  h.write('00', 263)
  h.write(prefix, 345, 155)
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return h
}
const pad = (n: number): Buffer => Buffer.alloc((512 - (n % 512)) % 512)
type Member = { name: string; data?: Buffer | string; mode?: 'plain' | 'prefix' | 'pax' | 'gnu'; type?: string }
function makeTar(members: Member[]): Buffer {
  const out: Buffer[] = []
  for (const m of members) {
    const data = m.data === undefined ? Buffer.alloc(0) : Buffer.from(m.data)
    const type = m.type ?? '0'
    if (m.mode === 'prefix') {
      const i = m.name.lastIndexOf('/')
      out.push(hdr(m.name.slice(i + 1), data.length, type, m.name.slice(0, i)))
    } else if (m.mode === 'pax') {
      const body = ` path=${m.name}\n`
      let len = body.length + 2
      while (String(len).length + body.length !== len) len = String(len).length + body.length
      const rec = Buffer.from(`${len}${body}`)
      out.push(hdr('PaxHeaders/x', rec.length, 'x'), rec, pad(rec.length), hdr('truncated-name', data.length, type))
    } else if (m.mode === 'gnu') {
      const n = Buffer.from(m.name + '\0')
      out.push(hdr('././@LongLink', n.length, 'L'), n, pad(n.length), hdr(m.name.slice(0, 100), data.length, type))
    } else out.push(hdr(m.name, data.length, type))
    out.push(data, pad(data.length))
  }
  out.push(Buffer.alloc(1024))
  return Buffer.concat(out)
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
let tmp: string
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'arkane-packs-'))
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('tar reader', () => {
  it('extracts files, dirs, ustar-prefix, pax and GNU long names', async () => {
    const long1 = `${'a'.repeat(60)}/${'b'.repeat(60)}/file-with-a-long-name-${'c'.repeat(40)}.flac`
    const long2 = `${'d'.repeat(120)}/${'e'.repeat(150)}/x.json`
    const long3 = `gnu/${'f'.repeat(130)}.txt`
    const big = Buffer.alloc(3 * 512 + 17, 7)
    const tar = makeTar([
      { name: 'index.json', data: '{"ok":1}' },
      { name: 'violin/', type: '5' },
      { name: 'violin/instrument.json', data: '{}' },
      { name: 'violin/big.bin', data: big },
      { name: long1, data: 'prefix', mode: 'prefix' },
      { name: long2, data: 'pax', mode: 'pax' },
      { name: long3, data: 'gnu', mode: 'gnu' },
      { name: 'link', type: '2' } // symlink: ignored
    ])
    const tarPath = join(tmp, 't1.tar')
    writeFileSync(tarPath, tar)
    const dest = join(tmp, 'x1')
    const n = await extractTar(tarPath, dest)
    expect(n).toBe(6)
    expect(readFileSync(join(dest, 'index.json'), 'utf8')).toBe('{"ok":1}')
    expect(readFileSync(join(dest, 'violin/big.bin')).equals(big)).toBe(true)
    expect(readFileSync(join(dest, long1), 'utf8')).toBe('prefix')
    expect(readFileSync(join(dest, long2), 'utf8')).toBe('pax')
    expect(readFileSync(join(dest, long3), 'utf8')).toBe('gnu')
    expect(existsSync(join(dest, 'link'))).toBe(false)
  })

  it('rejects path traversal and absolute paths', async () => {
    for (const evil of ['../escape.txt', 'a/../../escape.txt', '/etc/evil']) {
      const p = join(tmp, `evil-${sha(Buffer.from(evil)).slice(0, 6)}.tar`)
      writeFileSync(p, makeTar([{ name: 'ok.txt', data: 'x' }, { name: evil, data: 'bad' }]))
      await expect(extractTar(p, join(tmp, 'evil-out'))).rejects.toMatchObject({ code: 'bad-archive' })
    }
    expect(existsSync(join(tmp, 'escape.txt'))).toBe(false)
    expect(() => safeJoin('/r', 'C:/x')).toThrow(PackError)
    expect(safeJoin('/r', './a//b')).toBe(resolve('/r/a/b'))
  })

  it('detects corrupt headers and truncation', async () => {
    const good = makeTar([{ name: 'a.txt', data: 'hello' }])
    const bad = Buffer.from(good)
    bad[0] ^= 0xff
    writeFileSync(join(tmp, 'bad.tar'), bad)
    await expect(readTar(join(tmp, 'bad.tar'), async () => {})).rejects.toMatchObject({ code: 'bad-archive' })
    const trunc = Buffer.concat([hdr('big.bin', 4096, '0'), Buffer.alloc(100)])
    writeFileSync(join(tmp, 'trunc.tar'), trunc)
    await expect(readTar(join(tmp, 'trunc.tar'), async () => {})).rejects.toMatchObject({ code: 'bad-archive' })
  })
})

describe('helpers', () => {
  it('sha256File', async () => {
    const b = Buffer.from('arkane'.repeat(10000))
    writeFileSync(join(tmp, 'h.bin'), b)
    expect(await sha256File(join(tmp, 'h.bin'))).toBe(sha(b))
  })
  it('repoSlug from package.json "repository"', () => {
    expect(repoSlug({ repository: { type: 'git', url: 'https://github.com/elevchyt/ArkaneDAW' } })).toBe('elevchyt/ArkaneDAW')
    expect(repoSlug({ repository: 'git+https://github.com/foo/bar.git' })).toBe('foo/bar')
    expect(repoSlug({ repository: 'github:foo/baz' })).toBe('foo/baz')
    expect(repoSlug({})).toBe('elevchyt/ArkaneDAW')
    expect(repoSlug(null)).toBe('elevchyt/ArkaneDAW')
  })
})

// ─── local release server ───
describe('download + install (local HTTP server)', () => {
  const files = new Map<string, Buffer>()
  let base = ''
  let server: http.Server
  const log: string[] = []
  let dropAfter = 0 // when > 0, the next full-tar response is cut after this many bytes

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? ''
      log.push(`${req.method} ${url} ${req.headers.range ?? ''}`.trim())
      // GitHub-like: /releases/download/... → 302 to /objects/...
      if (url.startsWith('/releases/')) {
        res.writeHead(302, { Location: url.replace('/releases/', '/objects/') })
        return res.end()
      }
      const body = files.get(url.replace('/objects/', '/'))
      if (!body) {
        res.writeHead(404)
        return res.end('Not Found')
      }
      const m = /bytes=(\d+)-/.exec(req.headers.range ?? '')
      if (m) {
        const start = Number(m[1])
        if (start >= body.length) {
          res.writeHead(416)
          return res.end()
        }
        res.writeHead(206, { 'Content-Length': body.length - start, 'Content-Range': `bytes ${start}-${body.length - 1}/${body.length}` })
        return res.end(body.subarray(start))
      }
      res.writeHead(200, { 'Content-Length': body.length })
      if (dropAfter && url.endsWith('.tar')) {
        const n = dropAfter
        dropAfter = 0
        res.write(body.subarray(0, n))
        setTimeout(() => res.destroy(), 20)
        return
      }
      res.end(body)
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases/download/packs-v1`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  function publish(id: string, version: string, members: Member[]): { tar: Buffer; sha256: string } {
    const tar = makeTar(members)
    const sha256 = sha(tar)
    files.set(`/download/packs-v1/${id}-${version}.tar`, tar)
    files.set(`/download/packs-v1/${id}-${version}.json`, Buffer.from(JSON.stringify({ id, version, file: `${id}-${version}.tar`, size: tar.length, sha256, files: members.length })))
    return { tar, sha256 }
  }

  it('follows redirects and resumes a partial download with Range', async () => {
    const body = Buffer.alloc(200_000)
    for (let i = 0; i < body.length; i++) body[i] = (i * 31) & 255
    files.set('/download/packs-v1/blob.bin', body)
    const dest = join(tmp, 'dl', 'blob.part')
    mkdirSync(join(tmp, 'dl'), { recursive: true })
    writeFileSync(dest, body.subarray(0, 50_000)) // previous interrupted download
    log.length = 0
    const seen: number[] = []
    const n = await downloadFile(`${base}/blob.bin`, dest, { total: body.length, onProgress: (r) => seen.push(r) })
    expect(n).toBe(body.length)
    expect(readFileSync(dest).equals(body)).toBe(true)
    expect(log.some((l) => l.includes('/objects/') && l.includes('bytes=50000-'))).toBe(true)
    expect(seen[0]).toBe(50_000)
    expect(seen[seen.length - 1]).toBe(body.length)
  })

  it('installs a small fake pack end to end (manifest → tar → sha256 → extract → pack.json)', async () => {
    const packsDir = join(tmp, 'packs')
    const { sha256 } = publish('fakepack', '1.0.0', [
      { name: 'index.json', data: '{"format":1}' },
      { name: 'violin/instrument.json', data: '{"id":"violin"}' },
      { name: 'violin/a.flac', data: Buffer.alloc(5000, 3) }
    ])
    const prog: PackProgress[] = []
    const info = await installPack({ id: 'fakepack', version: '1.0.0', sha256 }, { packsDir, baseUrl: base, onProgress: (p) => prog.push(p) })
    expect(info.files).toBe(3)
    expect(info.sha256).toBe(sha256)
    expect(readFileSync(join(packsDir, 'fakepack/violin/instrument.json'), 'utf8')).toBe('{"id":"violin"}')
    expect((await readInstalled(packsDir, 'fakepack'))?.version).toBe('1.0.0')
    expect(existsSync(join(packsDir, 'fakepack.tmp'))).toBe(false)
    expect(existsSync(join(packsDir, '.downloads/fakepack-1.0.0.tar.part'))).toBe(false)
    expect(prog.map((p) => p.phase)).toEqual(expect.arrayContaining(['manifest', 'download', 'verify', 'extract', 'done']))
    // update to 1.1.0 replaces the folder atomically
    publish('fakepack', '1.1.0', [{ name: 'index.json', data: '{"format":2}' }])
    await installPack({ id: 'fakepack', version: '1.1.0' }, { packsDir, baseUrl: base })
    expect((await readInstalled(packsDir, 'fakepack'))?.version).toBe('1.1.0')
    expect(existsSync(join(packsDir, 'fakepack/violin'))).toBe(false)
    await removeInstalled(packsDir, 'fakepack')
    expect(await readInstalled(packsDir, 'fakepack')).toBeNull()
  })

  it('resumes after the connection drops mid-download', async () => {
    const packsDir = join(tmp, 'packs-drop')
    const { tar } = publish('droppy', '1.0.0', [{ name: 'index.json', data: '{}' }, { name: 'big.bin', data: Buffer.alloc(300_000, 9) }])
    dropAfter = 100_000
    await expect(installPack({ id: 'droppy', version: '1.0.0' }, { packsDir, baseUrl: base })).rejects.toMatchObject({ code: 'network' })
    const part = join(packsDir, '.downloads/droppy-1.0.0.tar.part')
    expect(readFileSync(part).length).toBeGreaterThan(0)
    expect(readFileSync(part).length).toBeLessThan(tar.length)
    log.length = 0
    await installPack({ id: 'droppy', version: '1.0.0' }, { packsDir, baseUrl: base })
    expect(log.some((l) => l.includes('droppy-1.0.0.tar') && l.includes('bytes='))).toBe(true)
    expect(readFileSync(join(packsDir, 'droppy/big.bin')).length).toBe(300_000)
  })

  it('404 → "not published yet"', async () => {
    await expect(installPack({ id: 'missing', version: '9.9.9' }, { packsDir: join(tmp, 'p404'), baseUrl: base })).rejects.toMatchObject({ code: 'not-published', message: expect.stringMatching(/not published yet/i) })
    expect(await readInstalled(join(tmp, 'p404'), 'missing')).toBeNull()
  })

  it('checksum mismatch (corrupt download or app/manifest mismatch) never installs', async () => {
    const packsDir = join(tmp, 'pbad')
    publish('corrupt', '1.0.0', [{ name: 'index.json', data: '{}' }])
    // tamper with the served tar (manifest still has the original sha256)
    const key = '/download/packs-v1/corrupt-1.0.0.tar'
    const t = Buffer.from(files.get(key)!)
    t[600] ^= 1
    files.set(key, t)
    await expect(installPack({ id: 'corrupt', version: '1.0.0' }, { packsDir, baseUrl: base })).rejects.toMatchObject({ code: 'checksum' })
    expect(existsSync(join(packsDir, '.downloads/corrupt-1.0.0.tar.part'))).toBe(false)
    expect(await readInstalled(packsDir, 'corrupt')).toBeNull()
    publish('other', '1.0.0', [{ name: 'index.json', data: '{}' }])
    await expect(installPack({ id: 'other', version: '1.0.0', sha256: 'f'.repeat(64) }, { packsDir, baseUrl: base })).rejects.toMatchObject({ code: 'checksum' })
  })

  it('cancel aborts and keeps nothing installed', async () => {
    const packsDir = join(tmp, 'pcancel')
    publish('slow', '1.0.0', [{ name: 'index.json', data: '{}' }])
    const ac = new AbortController()
    ac.abort()
    await expect(installPack({ id: 'slow', version: '1.0.0' }, { packsDir, baseUrl: base, signal: ac.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(await readInstalled(packsDir, 'slow')).toBeNull()
  })

  it('network error → code "network"', async () => {
    await expect(installPack({ id: 'x', version: '1.0.0' }, { packsDir: join(tmp, 'pnet'), baseUrl: 'http://127.0.0.1:1/releases' })).rejects.toMatchObject({ code: 'network' })
  })
})

describe('pack builder round trip', () => {
  it('scripts/packs/build.mjs output extracts byte-identically and is deterministic', async () => {
    const src = join(tmp, 'src-pack')
    const deep = `${'deep'.repeat(30)}/${'nested'.repeat(20)}`
    mkdirSync(join(src, 'violin'), { recursive: true })
    mkdirSync(join(src, deep), { recursive: true })
    writeFileSync(join(src, 'index.json'), '{"format":1}')
    writeFileSync(join(src, 'violin/instrument.json'), '{"id":"violin"}')
    writeFileSync(join(src, 'violin/s.flac'), Buffer.alloc(1234, 5))
    writeFileSync(join(src, deep, `${'x'.repeat(120)}.flac`), 'deep')
    writeFileSync(join(src, '.hidden'), 'skip me')
    const root = resolve(__dirname, '../..')
    const run = (out: string): Record<string, unknown> => {
      execFileSync(process.execPath, [join(root, 'scripts/packs/build.mjs'), 'concerto', `--src=${src}`, `--out=${out}`, '--no-update'], { stdio: 'pipe' })
      const ver = JSON.parse(readFileSync(join(root, 'src/renderer/src/packs/packs.json'), 'utf8')).concerto.version
      return { ...JSON.parse(readFileSync(join(out, `concerto-${ver}.json`), 'utf8')), tar: join(out, `concerto-${ver}.tar`) }
    }
    const a = run(join(tmp, 'out-a'))
    const b = run(join(tmp, 'out-b'))
    expect(a.sha256).toBe(b.sha256)
    expect(a.files).toBe(4)
    expect(await sha256File(a.tar as string)).toBe(a.sha256)
    const dest = join(tmp, 'rt')
    expect(await extractTar(a.tar as string, dest)).toBe(4)
    expect(readFileSync(join(dest, 'violin/s.flac')).equals(Buffer.alloc(1234, 5))).toBe(true)
    expect(readFileSync(join(dest, deep, `${'x'.repeat(120)}.flac`), 'utf8')).toBe('deep')
    expect(existsSync(join(dest, '.hidden'))).toBe(false)
  })
})
