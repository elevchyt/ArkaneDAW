// Tiny SoundFont 2 reader: extracts named samples (16-bit PCM) from the sdta/smpl chunk using the
// pdta/shdr headers. Stereo samples come as "<name>(L)" / "<name>(R)" pairs.

export function readSf2Samples(buf) {
  const smplId = buf.indexOf('smpl')
  const shdrId = buf.indexOf('shdr')
  if (smplId < 0 || shdrId < 0) throw new Error('not an SF2 file (smpl/shdr missing)')
  const smplStart = smplId + 8
  const n = buf.readUInt32LE(shdrId + 4) / 46
  const list = []
  for (let k = 0; k < n; k++) {
    const o = shdrId + 8 + k * 46
    const name = buf.toString('latin1', o, o + 20).split('\0')[0]
    list.push({ name, start: buf.readUInt32LE(o + 20), end: buf.readUInt32LE(o + 24), sampleRate: buf.readUInt32LE(o + 36), type: buf.readUInt16LE(o + 44) })
  }
  return {
    list,
    /** Float32 PCM of a sample by exact name. */
    get(name) {
      const s = list.find((x) => x.name === name)
      if (!s) throw new Error(`SF2 sample not found: ${name}`)
      const out = new Float32Array(s.end - s.start)
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(smplStart + (s.start + i) * 2) / 32768
      return { sampleRate: s.sampleRate, data: out }
    }
  }
}
