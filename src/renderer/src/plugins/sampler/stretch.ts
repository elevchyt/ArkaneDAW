// Offline time stretching / pitch shifting for the Sampler and stretched playlist audio clips.
// WSOLA (waveform-similarity overlap-add): Hann-windowed grains are laid down at a fixed output hop; each
// grain is taken from near its nominal input position, nudged to where it best continues the previous one,
// so the pitch is kept while the length changes. Pitch shifting = stretch, then resample back.
// Pure (no DOM): runs in the audio worklet and on the main thread.

/** Time stretching modes (FL "Mode"). Resample changes pitch with speed; the others keep the pitch. */
export const STRETCH_MODES = ['Resample', 'Stretch', 'Stretch (transient)', 'Stretch (smooth)'] as const

/** Grain length per mode, seconds (short grains keep drum hits tight, long ones keep pads smooth). */
const GRAIN = [0, 0.04, 0.015, 0.09]

export const isResample = (mode: number): boolean => Math.round(mode) <= 0

/**
 * Length multiplier from the Sampler's MUL and TIME knobs. TIME (beats, 0 = off) sets the playback duration
 * at the project tempo; MUL multiplies on top.
 */
export function lengthFactor(p: Record<string, number>, frames: number, sampleRate: number): number {
  const mul = Math.max(0.25, p.mul ?? 1)
  const time = p.time ?? 0
  if (time <= 0 || frames <= 0) return mul
  const target = (time * 60) / Math.max(10, p.tempo ?? 130)
  return mul * (target / (frames / sampleRate))
}

/** Stretch `input` to `factor` times its length without changing the pitch. */
export function timeStretch(input: readonly Float32Array[], sampleRate: number, factor: number, mode = 1): Float32Array[] {
  const len = input[0]?.length ?? 0
  if (!len || !(factor > 0) || Math.abs(factor - 1) < 1e-4) return input.map((c) => c)
  const outLen = Math.max(1, Math.round(len * factor))
  const grain = GRAIN[Math.max(1, Math.min(GRAIN.length - 1, Math.round(mode)))]
  const W = Math.max(64, 2 * Math.round((grain * sampleRate) / 2))
  const Hs = W / 2 // output hop: 50 % overlap, Hann windows sum to 1
  const Ha = Hs / factor // nominal input hop
  const tol = Math.max(8, Math.round(Math.min(Hs / 2, sampleRate * 0.01))) // search range around the nominal position
  const win = new Float32Array(W)
  for (let i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / W)

  // mono mix for the similarity search
  const mono = new Float32Array(len)
  for (const c of input) for (let i = 0; i < len; i++) mono[i] += c[i] / input.length
  const maxPos = Math.max(0, len - W)
  const corr = (a: number, b: number, step: number): number => {
    let s = 0
    const n = Math.min(Hs, len - a, len - b)
    for (let i = 0; i < n; i += step) s += mono[a + i] * mono[b + i]
    return s
  }

  const out = input.map(() => new Float32Array(outLen + W))
  const norm = new Float32Array(outLen + W)
  let prev = 0
  for (let k = 0; k * Hs < outLen; k++) {
    let pos = Math.min(maxPos, Math.round(k * Ha))
    if (k > 0) {
      // where the previous grain would naturally continue
      const natural = Math.min(maxPos, prev + Hs)
      const lo = Math.max(0, pos - tol)
      const hi = Math.min(maxPos, pos + tol)
      // coarse search, then refine around the best candidate
      let best = pos
      let bestV = -Infinity
      for (let p = lo; p <= hi; p += 4) {
        const v = corr(p, natural, 8)
        if (v > bestV) {
          bestV = v
          best = p
        }
      }
      const rlo = Math.max(lo, best - 4)
      const rhi = Math.min(hi, best + 4)
      bestV = -Infinity
      for (let p = rlo; p <= rhi; p++) {
        const v = corr(p, natural, 2)
        if (v > bestV) {
          bestV = v
          pos = p
        }
      }
    }
    const o = k * Hs
    for (let ci = 0; ci < input.length; ci++) {
      const src = input[ci]
      const dst = out[ci]
      for (let i = 0; i < W && pos + i < len; i++) dst[o + i] += src[pos + i] * win[i]
    }
    for (let i = 0; i < W; i++) norm[o + i] += win[i]
    prev = pos
  }
  // the first half grain only has one window: even out the gain there
  return out.map((c) => {
    const r = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 0.05 ? c[i] / Math.max(norm[i], 0.5) : c[i]
    return r
  })
}

/** Linear-interpolation resample of every channel to `outLen` frames. */
export function resampleTo(input: readonly Float32Array[], outLen: number): Float32Array[] {
  return input.map((c) => {
    const n = c.length
    const r = new Float32Array(outLen)
    if (!n) return r
    const step = outLen > 1 ? (n - 1) / (outLen - 1) : 0
    for (let i = 0; i < outLen; i++) {
      const x = i * step
      const i0 = Math.floor(x)
      const i1 = Math.min(n - 1, i0 + 1)
      r[i] = c[i0] + (c[i1] - c[i0]) * (x - i0)
    }
    return r
  })
}

/**
 * Change length by `factor` and pitch by `cents` independently (pitch-keeping modes).
 * Returns the input when there's nothing to do.
 */
export function stretchAndShift(input: readonly Float32Array[], sampleRate: number, factor: number, cents: number, mode: number): Float32Array[] {
  if (!input.length || !input[0].length) return input as Float32Array[]
  const ratio = Math.pow(2, cents / 1200)
  if (Math.abs(factor - 1) < 1e-4 && Math.abs(cents) < 0.5) return input as Float32Array[]
  const target = Math.max(1, Math.round(input[0].length * factor))
  // stretch longer by the pitch ratio, then squeeze back: the squeeze raises the pitch by `ratio`
  const stretched = timeStretch(input, sampleRate, factor * ratio, mode)
  return Math.abs(ratio - 1) < 1e-4 ? stretched : resampleTo(stretched, target)
}
