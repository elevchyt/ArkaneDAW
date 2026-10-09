// SoundFont 2 reader for the Concerto build: presets → instrument zones (key/velocity ranges, root key,
// tuning, loop points, pan, attenuation) and 16-bit sample data. Only what a multi-sample mapping needs;
// modulators and envelopes are ignored.

const GEN = { startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3, startAddrsCoarseOffset: 4, endAddrsCoarseOffset: 12, pan: 17, instrument: 41, keyRange: 43, velRange: 44, startloopAddrsCoarseOffset: 45, endloopAddrsCoarseOffset: 50, initialAttenuation: 48, coarseTune: 51, fineTune: 52, sampleID: 53, sampleModes: 54, overridingRootKey: 58 }

function chunks(buf, start, end) {
  const out = {}
  let p = start
  while (p + 8 <= end) {
    const id = buf.toString('latin1', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'LIST') {
      const type = buf.toString('latin1', p + 8, p + 12)
      out[type] = chunks(buf, p + 12, p + 8 + size)
    } else out[id] = { start: p + 8, size }
    p += 8 + size + (size & 1)
  }
  return out
}

function readGens(buf, ch, i0, i1) {
  const g = {}
  for (let i = i0; i < i1; i++) {
    const o = ch.start + i * 4
    const op = buf.readUInt16LE(o)
    if (op === GEN.keyRange || op === GEN.velRange) g[op] = [buf.readUInt8(o + 2), buf.readUInt8(o + 3)]
    else if (op === GEN.instrument || op === GEN.sampleID || op === GEN.sampleModes) g[op] = buf.readUInt16LE(o + 2)
    else g[op] = buf.readInt16LE(o + 2)
  }
  return g
}

export function readSf2(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'sfbk') throw new Error('not an SF2 file')
  const root = chunks(buf, 12, buf.length)
  const pd = root.pdta
  const smpl = root.sdta.smpl
  const rec = (c, size) => Array.from({ length: c.size / size }, (_, i) => c.start + i * size)
  const phdr = rec(pd.phdr, 38).map((o) => ({ name: buf.toString('latin1', o, o + 20).split('\0')[0], preset: buf.readUInt16LE(o + 20), bank: buf.readUInt16LE(o + 22), bag: buf.readUInt16LE(o + 24) }))
  const pbag = rec(pd.pbag, 4).map((o) => buf.readUInt16LE(o))
  const inst = rec(pd.inst, 22).map((o) => ({ name: buf.toString('latin1', o, o + 20).split('\0')[0], bag: buf.readUInt16LE(o + 20) }))
  const ibag = rec(pd.ibag, 4).map((o) => buf.readUInt16LE(o))
  const shdr = rec(pd.shdr, 46).map((o) => ({
    name: buf.toString('latin1', o, o + 20).split('\0')[0],
    start: buf.readUInt32LE(o + 20),
    end: buf.readUInt32LE(o + 24),
    loopStart: buf.readUInt32LE(o + 28),
    loopEnd: buf.readUInt32LE(o + 32),
    sampleRate: buf.readUInt32LE(o + 36),
    pitch: buf.readUInt8(o + 40),
    correction: buf.readInt8(o + 41),
    link: buf.readUInt16LE(o + 42),
    type: buf.readUInt16LE(o + 44)
  }))

  function instZones(ii, pg) {
    const out = []
    const b0 = inst[ii].bag, b1 = inst[ii + 1].bag
    let global = {}
    for (let b = b0; b < b1; b++) {
      const g = readGens(buf, pd.igen, ibag[b], ibag[b + 1])
      if (g[GEN.sampleID] === undefined) {
        if (b === b0) global = g
        continue
      }
      const z = { ...global, ...g }
      const s = shdr[z[GEN.sampleID]]
      const key = intersect(z[GEN.keyRange] ?? [0, 127], pg[GEN.keyRange] ?? [0, 127])
      const vel = intersect(z[GEN.velRange] ?? [0, 127], pg[GEN.velRange] ?? [0, 127])
      if (!key || !vel) continue
      const off = (f, c) => (z[f] ?? 0) + 32768 * (z[c] ?? 0)
      out.push({
        sample: s,
        sampleIndex: z[GEN.sampleID],
        key,
        vel,
        root: z[GEN.overridingRootKey] >= 0 && z[GEN.overridingRootKey] <= 127 ? z[GEN.overridingRootKey] : s.pitch,
        // cents to ADD when playing at the root key
        tune: (z[GEN.coarseTune] ?? 0) * 100 + (z[GEN.fineTune] ?? 0) + (pg[GEN.coarseTune] ?? 0) * 100 + (pg[GEN.fineTune] ?? 0) + s.correction,
        pan: ((z[GEN.pan] ?? 0) + (pg[GEN.pan] ?? 0)) / 500,
        attenuation: ((z[GEN.initialAttenuation] ?? 0) + (pg[GEN.initialAttenuation] ?? 0)) / 10,
        loopMode: z[GEN.sampleModes] ?? 0,
        start: s.start + off(GEN.startAddrsOffset, GEN.startAddrsCoarseOffset),
        end: s.end + off(GEN.endAddrsOffset, GEN.endAddrsCoarseOffset),
        loopStart: s.loopStart + off(GEN.startloopAddrsOffset, GEN.startloopAddrsCoarseOffset),
        loopEnd: s.loopEnd + off(GEN.endloopAddrsOffset, GEN.endloopAddrsCoarseOffset)
      })
    }
    return out
  }

  return {
    presets: phdr.slice(0, -1).map((p, i) => ({ ...p, index: i })),
    samples: shdr,
    /** Zones of a preset (bank, program). */
    zones(bank, program) {
      const pi = phdr.findIndex((p) => p.bank === bank && p.preset === program)
      if (pi < 0 || pi >= phdr.length - 1) throw new Error(`SF2 preset ${bank}:${program} not found`)
      const out = []
      let global = {}
      for (let b = phdr[pi].bag; b < phdr[pi + 1].bag; b++) {
        const g = readGens(buf, pd.pgen, pbag[b], pbag[b + 1])
        if (g[GEN.instrument] === undefined) {
          if (b === phdr[pi].bag) global = g
          continue
        }
        const pg = { ...global, ...g }
        out.push(...instZones(pg[GEN.instrument], pg))
      }
      return out
    },
    /** Float32 PCM for absolute sample frames [start, end). */
    pcm(start, end) {
      const out = new Float32Array(end - start)
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(smpl.start + (start + i) * 2) / 32768
      return out
    }
  }
}

function intersect(a, b) {
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1])
  return lo <= hi ? [lo, hi] : null
}
