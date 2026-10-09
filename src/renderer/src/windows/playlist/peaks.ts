// Waveform peak pyramids for drawing audio clips quickly at any zoom.

export interface PeakLevel {
  block: number // samples per bucket
  min: Float32Array
  max: Float32Array
}

export interface Peaks {
  length: number // frames
  sampleRate: number
  levels: PeakLevel[] // finest first
}

/** Mixes all channels (max |x| semantics per bucket) into min/max buckets of `block` frames. */
export function computePeaks(channels: readonly Float32Array[], sampleRate: number, block = 128, factor = 8, levels = 4): Peaks {
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0)
  const n = Math.ceil(length / block)
  const min = new Float32Array(n)
  const max = new Float32Array(n)
  for (let b = 0; b < n; b++) {
    let lo = Infinity
    let hi = -Infinity
    const s0 = b * block
    const s1 = Math.min(length, s0 + block)
    for (const ch of channels) {
      const e = Math.min(s1, ch.length)
      for (let i = s0; i < e; i++) {
        const v = ch[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    min[b] = lo === Infinity ? 0 : lo
    max[b] = hi === -Infinity ? 0 : hi
  }
  const out: PeakLevel[] = [{ block, min, max }]
  for (let l = 1; l < levels; l++) {
    const prev = out[l - 1]
    const m = Math.ceil(prev.min.length / factor)
    if (m < 1) break
    const lmin = new Float32Array(m)
    const lmax = new Float32Array(m)
    for (let b = 0; b < m; b++) {
      let lo = Infinity
      let hi = -Infinity
      const e = Math.min(prev.min.length, (b + 1) * factor)
      for (let i = b * factor; i < e; i++) {
        if (prev.min[i] < lo) lo = prev.min[i]
        if (prev.max[i] > hi) hi = prev.max[i]
      }
      lmin[b] = lo === Infinity ? 0 : lo
      lmax[b] = hi === -Infinity ? 0 : hi
    }
    out.push({ block: prev.block * factor, min: lmin, max: lmax })
  }
  return { length, sampleRate, levels: out }
}

/** Min/max over the frame range [f0, f1) using the coarsest level that still resolves it. */
export function peakRange(p: Peaks, f0: number, f1: number): [number, number] {
  if (f1 <= f0) f1 = f0 + 1
  f0 = Math.max(0, f0)
  f1 = Math.min(p.length, f1)
  if (f1 <= f0) return [0, 0]
  const span = f1 - f0
  let lvl = p.levels[0]
  for (const l of p.levels) if (l.block * 2 <= span) lvl = l
  const b0 = Math.floor(f0 / lvl.block)
  const b1 = Math.max(b0 + 1, Math.ceil(f1 / lvl.block))
  let lo = Infinity
  let hi = -Infinity
  for (let b = b0; b < b1 && b < lvl.min.length; b++) {
    if (lvl.min[b] < lo) lo = lvl.min[b]
    if (lvl.max[b] > hi) hi = lvl.max[b]
  }
  return lo === Infinity ? [0, 0] : [lo, hi]
}

const cache = new WeakMap<AudioBuffer, Peaks>()

/** Cached peaks for a decoded buffer. */
export function peaksFor(buf: AudioBuffer): Peaks {
  let p = cache.get(buf)
  if (!p) {
    const chans: Float32Array[] = []
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
    p = computePeaks(chans, buf.sampleRate)
    cache.set(buf, p)
  }
  return p
}
