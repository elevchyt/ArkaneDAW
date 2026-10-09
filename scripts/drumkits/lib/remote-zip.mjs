// Minimal ZIP reader (zip64 aware) over a random-access byte source: a local file or a remote URL
// read with HTTP range requests. The remote variant lets the build fetch only the members it needs
// from the multi-GB DrumGizmo kits (and only a prefix of very long samples).
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { inflateRawSync, constants as zlibConstants } from 'node:zlib'

async function httpRange(url, start, end) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
      if (res.status !== 206) throw new Error(`range request failed: HTTP ${res.status} for ${url}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (attempt >= 4) throw e
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
}

function fileSource(path) {
  const size = statSync(path).size
  return {
    size,
    async range(start, end) {
      const fd = openSync(path, 'r')
      try {
        const buf = Buffer.alloc(end - start + 1)
        readSync(fd, buf, 0, buf.length, start)
        return buf
      } finally {
        closeSync(fd)
      }
    }
  }
}

async function urlSource(url) {
  const res = await fetch(url, { method: 'HEAD' })
  if (!res.ok) throw new Error(`HEAD ${url}: HTTP ${res.status}`)
  return { size: Number(res.headers.get('content-length')), range: (s, e) => httpRange(url, s, e) }
}

async function openZip(src) {
  const { size } = src
  const tailLen = Math.min(size, 66000 + 20 + 56)
  const tail = await src.range(size - tailLen, size - 1)
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0) throw new Error('ZIP end of central directory not found')
  let cdCount = tail.readUInt16LE(eocd + 10)
  let cdSize = tail.readUInt32LE(eocd + 12)
  let cdOffset = tail.readUInt32LE(eocd + 16)
  if (cdOffset === 0xffffffff || cdCount === 0xffff || cdSize === 0xffffffff) {
    const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]), eocd)
    if (loc < 0) throw new Error('zip64 locator not found')
    const z64off = Number(tail.readBigUInt64LE(loc + 8))
    const z64 = await src.range(z64off, z64off + 55)
    if (z64.readUInt32LE(0) !== 0x06064b50) throw new Error('bad zip64 EOCD')
    cdCount = Number(z64.readBigUInt64LE(32))
    cdSize = Number(z64.readBigUInt64LE(40))
    cdOffset = Number(z64.readBigUInt64LE(48))
  }
  const cd = await src.range(cdOffset, cdOffset + cdSize - 1)
  const entries = []
  let p = 0
  for (let i = 0; i < cdCount; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry')
    const method = cd.readUInt16LE(p + 10)
    const crc = cd.readUInt32LE(p + 16)
    let csize = cd.readUInt32LE(p + 20)
    let usize = cd.readUInt32LE(p + 24)
    const nameLen = cd.readUInt16LE(p + 28)
    const extraLen = cd.readUInt16LE(p + 30)
    const commentLen = cd.readUInt16LE(p + 32)
    let offset = cd.readUInt32LE(p + 42)
    const name = cd.toString('utf8', p + 46, p + 46 + nameLen)
    let e = p + 46 + nameLen
    const eEnd = e + extraLen
    while (e + 4 <= eEnd) {
      const id = cd.readUInt16LE(e)
      const len = cd.readUInt16LE(e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8 }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8 }
        if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); q += 8 }
      }
      e += 4 + len
    }
    entries.push({ name, method, crc, csize, usize, offset })
    p = eEnd + commentLen
  }
  return {
    size,
    entries,
    find(suffix) {
      return entries.find((x) => x.name === suffix || x.name.endsWith('/' + suffix))
    },
    /**
     * Read a member. With `maxBytes`, only (at least) the first maxBytes of the *uncompressed* data are
     * fetched/decoded — deflate streams can be decoded from a prefix (Z_SYNC_FLUSH).
     */
    async read(entry, maxBytes = Infinity) {
      const head = await src.range(entry.offset, entry.offset + 29)
      if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('bad local header for ' + entry.name)
      const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
      if (!entry.csize) return Buffer.alloc(0)
      if (entry.method === 0) return src.range(start, start + Math.min(entry.csize, maxBytes) - 1)
      if (entry.method !== 8) throw new Error(`unsupported zip method ${entry.method} (${entry.name})`)
      if (maxBytes >= entry.usize) return inflateRawSync(await src.range(start, start + entry.csize - 1))
      const ratio = entry.csize / Math.max(1, entry.usize)
      let want = Math.min(entry.csize, Math.ceil(maxBytes * ratio * 1.2) + 65536)
      for (;;) {
        const raw = await src.range(start, start + want - 1)
        const out = inflateRawSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
        if (out.length >= maxBytes || want >= entry.csize) return out
        want = Math.min(entry.csize, want * 2)
      }
    }
  }
}

export async function openRemoteZip(url) {
  return openZip(await urlSource(url))
}

export async function openLocalZip(path) {
  return openZip(fileSource(path))
}
