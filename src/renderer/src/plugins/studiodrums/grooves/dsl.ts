// A compact step-grid notation for writing drum grooves as data.
//
//   pat('Groove A', { steps: 16, lines: { [HH]: 'x-o-|x-o-|x-o-|x-o-', [K]: 'x---|----|x-x-|----', [SN]: '----|x---|----|x---' } })
//
// Every line has `steps × bars` cells ('|' and spaces are ignored). Cell → velocity:
//   X 124 (accent) · x 100 · o 84 · m 66 · h 52 · g 36 (ghost) · 1–9 = 14·n · '-' or '.' rest
// `swing` (0..1) delays every odd grid step by up to a third of a step (1 = full triplet feel).
// `push` shifts single keys by ticks (e.g. a laid-back snare).

export const PPQ = 96

/** General-MIDI keys (+ Studio Drums extras) used by the grooves. */
export const D = {
  K: 36, K2: 35, SN: 38, XS: 37, RIM: 40, FLAM: 25, GHOST: 26, SWEEP: 28, STICKS: 31,
  HH: 42, PH: 44, OH: 46, HO: 23, HSPL: 21,
  T0: 50, T1: 48, T2: 45, T3: 47, FT: 43, FT2: 41,
  CR: 49, CR2: 57, CRC: 29, RD: 51, BL: 53, RD2: 59, CH: 52, SP: 55,
  CLAP: 39, TAMB: 54, CB: 56, CBCHA: 89, VIB: 58,
  BGH: 60, BGL: 61, BGM: 90, CGM: 62, CGO: 63, CGL: 64, QUINTO: 85, TUMBA: 86,
  TBH: 65, TBL: 66, PAILA: 84, AGH: 67, AGL: 68, CAB: 69, MAR: 70,
  GRS: 73, GRL: 74, CLV: 75, WBH: 76, WBL: 77, TRM: 80, TRO: 81, SHK: 82, CAJB: 87, CAJS: 88
} as const

export type GroovePart = 'Intro' | 'Groove A' | 'Groove B' | 'Groove C' | 'Groove D' | 'Fill 1' | 'Fill 2' | 'Ending'

export interface GrooveNote {
  /** tick (PPQ 96) */
  t: number
  /** MIDI key */
  k: number
  /** velocity 1..127 */
  v: number
  /** length in ticks (for the piano roll; drums are one-shots) */
  d: number
}

export interface Groove {
  id: string
  name: string
  part: GroovePart
  bars: number
  timeSig: [number, number]
  /** grid steps per bar used to write it (useful for editors) */
  steps: number
  notes: GrooveNote[]
  /** total length in ticks */
  length: number
}

export interface GrooveGenre {
  id: string
  name: string
  /** suggested tempo (BPM, quarter note) */
  tempo: number
  /** suggested kit id */
  kit: string
  description: string
  grooves: Groove[]
}

const VEL: Record<string, number> = { X: 124, x: 100, o: 84, m: 66, h: 52, g: 36 }

export function barTicks([num, den]: [number, number]): number {
  return Math.round((num * PPQ * 4) / den)
}

/** Deterministic small PRNG so grooves are stable between runs. */
function rng(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

export interface PatOptions {
  part: GroovePart
  bars?: number
  sig?: [number, number]
  /** grid steps per bar (default: 16 in 4/4, 12 in 3/4, 12 in 6/8) */
  steps?: number
  swing?: number
  /** velocity humanisation ± (default 4; accents X are never changed) */
  human?: number
  /** per-key tick offsets */
  push?: Record<number, number>
  lines: Record<number, string>
}

export function pat(name: string, o: PatOptions): Groove {
  const sig = o.sig ?? [4, 4]
  const bars = o.bars ?? 1
  const steps = o.steps ?? (sig[0] === 3 && sig[1] === 4 ? 12 : sig[1] === 8 ? sig[0] * 2 : 16)
  const bt = barTicks(sig)
  const stepT = bt / steps
  const swing = o.swing ?? 0
  const human = o.human ?? 4
  const rand = rng(name + o.part)
  const notes: GrooveNote[] = []
  for (const [keyStr, raw] of Object.entries(o.lines)) {
    const key = Number(keyStr)
    const cells = raw.replace(/[|\s]/g, '')
    if (cells.length !== steps * bars) throw new Error(`groove "${name}" key ${key}: ${cells.length} cells, expected ${steps * bars}`)
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      if (c === '-' || c === '.') continue
      let v = VEL[c] ?? (c >= '1' && c <= '9' ? (c.charCodeAt(0) - 48) * 14 : NaN)
      if (Number.isNaN(v)) throw new Error(`groove "${name}": bad cell "${c}"`)
      if (c !== 'X' && human > 0) v += Math.round((rand() * 2 - 1) * human)
      let t = i * stepT + (i % 2 === 1 ? (swing * stepT) / 3 : 0) + (o.push?.[key] ?? 0)
      t = Math.max(0, Math.round(t))
      notes.push({ t, k: key, v: Math.max(1, Math.min(127, v)), d: Math.max(6, Math.round(stepT)) })
    }
  }
  notes.sort((a, b) => a.t - b.t || a.k - b.k)
  return { id: '', name, part: o.part, bars, timeSig: sig, steps, notes, length: bt * bars }
}

export function genre(g: Omit<GrooveGenre, 'grooves'> & { grooves: Groove[] }): GrooveGenre {
  return { ...g, grooves: g.grooves.map((x, i) => ({ ...x, id: `${g.id}.${i + 1}` })) }
}
