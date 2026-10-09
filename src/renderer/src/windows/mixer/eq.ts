// 3-band mixer EQ helpers (shared by the panel's curve display). Band shapes match the engine:
// low shelf, peaking (Q = EQ_MID_Q) and high shelf, RBJ cookbook with S = 1.
import type { MixerTrack } from '@/store/types'

export const EQ_MID_Q = 0.9
export const EQ_GAIN_MAX = 18
export const EQ_FREQ: Record<'low' | 'mid' | 'high', [number, number]> = {
  low: [20, 1000],
  mid: [80, 12000],
  high: [1000, 20000]
}

export const freqToNorm = (f: number, [lo, hi]: [number, number]): number => Math.log(f / lo) / Math.log(hi / lo)
export const normToFreq = (n: number, [lo, hi]: [number, number]): number => lo * Math.pow(hi / lo, Math.min(1, Math.max(0, n)))

type Kind = 'lowshelf' | 'peaking' | 'highshelf'

function coeffs(kind: Kind, f0: number, gainDb: number, fs: number): number[] {
  const A = Math.pow(10, gainDb / 40)
  const w0 = (2 * Math.PI * f0) / fs
  const cs = Math.cos(w0)
  const sn = Math.sin(w0)
  if (kind === 'peaking') {
    const alpha = sn / (2 * EQ_MID_Q)
    return [1 + alpha * A, -2 * cs, 1 - alpha * A, 1 + alpha / A, -2 * cs, 1 - alpha / A]
  }
  const alpha = (sn / 2) * Math.SQRT2
  const sq = 2 * Math.sqrt(A) * alpha
  if (kind === 'lowshelf')
    return [
      A * (A + 1 - (A - 1) * cs + sq),
      2 * A * (A - 1 - (A + 1) * cs),
      A * (A + 1 - (A - 1) * cs - sq),
      A + 1 + (A - 1) * cs + sq,
      -2 * (A - 1 + (A + 1) * cs),
      A + 1 + (A - 1) * cs - sq
    ]
  return [
    A * (A + 1 + (A - 1) * cs + sq),
    -2 * A * (A - 1 + (A + 1) * cs),
    A * (A + 1 + (A - 1) * cs - sq),
    A + 1 - (A - 1) * cs + sq,
    2 * (A - 1 - (A + 1) * cs),
    A + 1 - (A - 1) * cs - sq
  ]
}

function magDb(c: number[], f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs
  const c1 = Math.cos(w)
  const c2 = Math.cos(2 * w)
  const s1 = Math.sin(w)
  const s2 = Math.sin(2 * w)
  const nr = c[0] + c[1] * c1 + c[2] * c2
  const ni = -(c[1] * s1 + c[2] * s2)
  const dr = c[3] + c[4] * c1 + c[5] * c2
  const di = -(c[4] * s1 + c[5] * s2)
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di))
}

/** Total response in dB at each frequency. */
export function eqResponse(eq: MixerTrack['eq'], freqs: number[], fs = 48000): number[] {
  const bands = [coeffs('lowshelf', eq.lowFreq, eq.lowGain, fs), coeffs('peaking', eq.midFreq, eq.midGain, fs), coeffs('highshelf', eq.highFreq, eq.highGain, fs)]
  return freqs.map((f) => bands.reduce((a, c) => a + magDb(c, f, fs), 0))
}
