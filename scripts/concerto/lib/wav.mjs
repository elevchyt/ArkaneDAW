// WAV reading/writing (copied from scripts/drumkits/lib/wav.mjs). Handles PCM 16/24/32-bit, 32-bit float and
// WAVE_FORMAT_EXTENSIBLE, any channel count, and truncated files.

/** Parse the header; returns null if the buffer is too short to contain the data chunk start. */
export function parseWavHeader(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
  let p = 12
  let fmt = null
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'fmt ') {
      if (p + 8 + 16 > buf.length) return null
      let format = buf.readUInt16LE(p + 8)
      const channels = buf.readUInt16LE(p + 10)
      const sampleRate = buf.readUInt32LE(p + 12)
      const bits = buf.readUInt16LE(p + 22)
      if (format === 0xfffe && size >= 40) format = buf.readUInt16LE(p + 8 + 24)
      fmt = { format, channels, sampleRate, bits }
    } else if (id === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk')
      return { ...fmt, dataOffset: p + 8, dataSize: size }
    }
    p += 8 + size + (size & 1)
  }
  return null
}

/** Decode to Float32Array per channel. Truncated data is decoded as far as it goes. */
export function decodeWav(buf) {
  const h = parseWavHeader(buf)
  if (!h) throw new Error('incomplete WAV header')
  const bps = h.bits / 8
  const frameBytes = bps * h.channels
  const avail = Math.min(h.dataSize, buf.length - h.dataOffset)
  const frames = Math.floor(avail / frameBytes)
  const out = Array.from({ length: h.channels }, () => new Float32Array(frames))
  let o = h.dataOffset
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < h.channels; c++) {
      let v
      if (h.format === 3 && h.bits === 32) v = buf.readFloatLE(o)
      else if (h.format === 3 && h.bits === 64) v = buf.readDoubleLE(o)
      else if (h.bits === 16) v = buf.readInt16LE(o) / 32768
      else if (h.bits === 24) v = buf.readIntLE(o, 3) / 8388608
      else if (h.bits === 32) v = buf.readInt32LE(o) / 2147483648
      else if (h.bits === 8) v = (buf.readUInt8(o) - 128) / 128
      else throw new Error(`unsupported WAV: format ${h.format}, ${h.bits} bit`)
      out[c][i] = v
      o += bps
    }
  }
  return { sampleRate: h.sampleRate, channels: out }
}

/** Write a 32-bit float WAV (intermediate file handed to ffmpeg). */
export function encodeWavF32(channels, sampleRate) {
  const ch = channels.length
  const n = channels[0].length
  const dataSize = n * ch * 4
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(3, 20)
  buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * ch * 4, 28)
  buf.writeUInt16LE(ch * 4, 32)
  buf.writeUInt16LE(32, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  let o = 44
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, o += 4) buf.writeFloatLE(channels[c][i], o)
  return buf
}
