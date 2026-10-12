// Guitar body impulse responses for commuted synthesis. A body is a set of decaying modes (Helmholtz air
// resonance, top / back plate modes, a dense upper series) plus a short burst of filtered noise for the
// "wood" in the attack. The response is computed once per model; each pluck low-passes it by its pulse width
// and feeds it into the string loop (string.ts), so every note carries the body's colour and boom.
import { MODEL } from './manifest'

type Mode = [freq: number, decayMs: number, gain: number]

// Measured-guitar-like mode sets (frequencies from published modal analyses of dreadnought and classical
// guitars; decays and gains tuned by ear).
const STEEL: Mode[] = [
  [102, 110, 1.0], [198, 85, 0.95], [226, 60, 0.45], [287, 55, 0.5], [395, 45, 0.42], [462, 38, 0.36],
  [548, 34, 0.32], [652, 30, 0.3], [781, 26, 0.3], [930, 22, 0.28], [1110, 19, 0.26], [1340, 16, 0.24],
  [1620, 14, 0.22], [1990, 12, 0.2], [2450, 10, 0.18], [3050, 8, 0.15], [3800, 6, 0.12], [4700, 5, 0.1]
]
const NYLON: Mode[] = [
  [96, 130, 1.0], [184, 95, 0.9], [236, 65, 0.4], [272, 60, 0.42], [380, 48, 0.36], [440, 40, 0.3],
  [530, 36, 0.27], [630, 32, 0.25], [750, 28, 0.23], [900, 24, 0.2], [1080, 20, 0.18], [1300, 16, 0.15],
  [1580, 13, 0.12], [1950, 10, 0.1], [2400, 8, 0.08], [3000, 6, 0.06]
]
// Archtop / hollow electric: smaller, stiffer top, a nasal mid hump.
const HOLLOW: Mode[] = [
  [128, 60, 0.7], [240, 50, 0.6], [330, 40, 0.5], [520, 32, 0.45], [760, 26, 0.4], [1050, 20, 0.3],
  [1450, 15, 0.22], [2000, 11, 0.15]
]
// Solid bodies barely move: a faint neck/body resonance only.
const SOLID: Mode[] = [[140, 40, 0.3], [310, 30, 0.2], [680, 20, 0.12]]

const SETS: Record<number, { modes: Mode[]; noise: number; noiseMs: number; noiseHz: number; lengthMs: number }> = {
  [MODEL.STEEL]: { modes: STEEL, noise: 0.35, noiseMs: 7, noiseHz: 5200, lengthMs: 140 },
  [MODEL.NYLON]: { modes: NYLON, noise: 0.22, noiseMs: 9, noiseHz: 3200, lengthMs: 150 },
  [MODEL.SINGLE]: { modes: SOLID, noise: 0.05, noiseMs: 3, noiseHz: 6000, lengthMs: 60 },
  [MODEL.HUMBUCKER]: { modes: SOLID, noise: 0.05, noiseMs: 3, noiseHz: 5000, lengthMs: 60 },
  [MODEL.HOLLOW]: { modes: HOLLOW, noise: 0.12, noiseMs: 5, noiseHz: 4000, lengthMs: 90 }
}

export const BODY_MAX_SECONDS = 0.15

/** Write the body response of `model` into `out` (preallocated, ≥ BODY_MAX_SECONDS·sr); returns its length. */
export function makeBody(model: number, sr: number, out: Float32Array): number {
  const set = SETS[model] ?? SETS[MODEL.STEEL]
  const len = Math.min(out.length, Math.round((Math.min(set.lengthMs, BODY_MAX_SECONDS * 1000) / 1000) * sr))
  out.fill(0, 0, len)
  let seed = 12345 + model * 977
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  // modes: decaying sinusoids with a fixed random phase per model
  for (const [f, ms, g] of set.modes) {
    if (f >= sr * 0.45) continue
    const ph = rnd() * Math.PI * 2
    const w = (2 * Math.PI * f) / sr
    const dec = Math.exp(-1 / ((ms / 1000) * sr))
    // recursive oscillator: cheaper than sin() per sample
    let a = Math.sin(ph)
    let b = Math.sin(ph - w)
    const k = 2 * Math.cos(w)
    let env = g
    for (let i = 0; i < len; i++) {
      out[i] += a * env
      const c = k * a - b
      b = a
      a = c
      env *= dec
    }
  }
  // wood: short noise burst, low-passed
  const nLen = Math.min(len, Math.round((set.noiseMs / 1000) * sr * 4))
  const nDec = Math.exp(-1 / ((set.noiseMs / 1000) * sr))
  const c = 1 - Math.exp((-2 * Math.PI * set.noiseHz) / sr)
  let lp = 0
  let env = set.noise * 3
  for (let i = 0; i < nLen; i++) {
    lp += (rnd() * 2 - 1 - lp) * c
    out[i] += lp * env
    env *= nDec
  }
  // fade the tail, remove DC, normalise to unit energy
  const fade = Math.round(len * 0.3)
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade
  let mean = 0
  for (let i = 0; i < len; i++) mean += out[i]
  mean /= len
  let e = 0
  for (let i = 0; i < len; i++) {
    out[i] -= mean
    e += out[i] * out[i]
  }
  const norm = 1 / Math.sqrt(Math.max(1e-9, e / (0.004 * sr)))
  for (let i = 0; i < len; i++) out[i] *= norm
  return len
}
