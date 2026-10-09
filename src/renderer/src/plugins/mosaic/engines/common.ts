// Shared DSP helpers for Mosaic engines. Allocation-free in the render paths.
import type { NoteOn } from '../../sdk/types'

export const TAU = Math.PI * 2
/** Max frames rendered per control-rate chunk. */
export const CHUNK = 32

export type PartParams = Record<string, number>

/** Per-part modulation state recomputed per process() call (super knob + quick edits + host). */
export class Mods {
  cutoff = 0 // octaves
  reso = 0 // added to 0..1 reso
  attack = 0 // octaves (time multiplier exponent)
  release = 0
  level = 0
  bright = 0
  drive = 0
  vibrato = 0 // cents
  detune = 0
  tremolo = 0
  bend = 0 // semitones
  rotaryFast = 0 // 0..1 (organ)
}

/** A monophonic sound generator driven by the generic voice (amp env/filter/LFO live outside). */
export interface EngineVoice {
  /** True if render() writes both l and r. */
  stereo: boolean
  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void
  setFreq(freq: number): void
  release(relVel: number): void
  /** WRITE n samples into l (and r if stereo). Return false once the sound has died away. */
  render(l: Float32Array, r: Float32Array, n: number): boolean
}

/** Optional per-part stereo post stage (piano soundboard, EP tremolo, vibes motor…). In-place. */
export interface PartPost {
  update(p: PartParams): void
  process(L: Float32Array, R: Float32Array, n: number, m: Mods): void
  reset(): void
}

/** A Part's sound source. Poly engines are wrapped by PolyPart; the organ implements this itself. */
export interface PartEngine {
  update(p: PartParams): void
  noteOn(n: NoteOn, key: number): void
  noteOff(id: number, rel: number): void
  allOff(hard: boolean): void
  /** ADD n samples into L/R. */
  render(L: Float32Array, R: Float32Array, n: number, m: Mods): void
  active(): number
}

// ─── tables ──────────────────────────────────────────────────────────────────
export const SIN_SIZE = 4096
export const SIN = new Float32Array(SIN_SIZE + 1)
for (let i = 0; i <= SIN_SIZE; i++) SIN[i] = Math.sin((TAU * i) / SIN_SIZE)

/** sin(2π·phase) for phase in [0,1) with linear interpolation. */
export function sinp(phase: number): number {
  const x = phase * SIN_SIZE
  const i = x | 0
  const f = x - i
  const a = SIN[i & (SIN_SIZE - 1)]
  return a + (SIN[(i & (SIN_SIZE - 1)) + 1] - a) * f
}

/** Wrap any phase (also negative / > 1) to [0,1). */
export function wrap(x: number): number {
  return x - Math.floor(x)
}

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Small fast xorshift noise in [-1,1). */
export class Noise {
  private s: number
  constructor(seed = 22222) {
    this.s = seed | 0 || 1
  }
  next(): number {
    let s = this.s
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    this.s = s
    return (s | 0) / 2147483648
  }
}

/** Exponential envelope coefficient for a T60 (seconds). */
export const t60coef = (t60: number, sr: number): number => Math.exp(-6.907755 / Math.max(1e-4, t60 * sr))

/**
 * Simple 2-pole resonator (bandpass, constant peak gain) — for body/formant filters.
 * y = b0*(x - x2) + a1*y1 - a2*y2
 */
export class Reson {
  private b0 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0
  set(freq: number, bw: number, sr: number): void {
    const f = clamp(freq, 20, sr * 0.45)
    const r = Math.exp((-Math.PI * Math.max(1, bw)) / sr)
    this.a1 = 2 * r * Math.cos((TAU * f) / sr)
    this.a2 = r * r
    this.b0 = (1 - r * r) * 0.5
  }
  process(x: number): number {
    const y = this.b0 * (x - this.x2) + this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    return y
  }
  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }
}

/** One-pole lowpass. */
export class OnePole {
  y = 0
  a = 0
  setHz(f: number, sr: number): void {
    this.a = Math.exp((-TAU * clamp(f, 1, sr * 0.49)) / sr)
  }
  process(x: number): number {
    this.y = x + (this.y - x) * this.a
    return this.y
  }
}

/**
 * Bank of damped sinusoidal modes rendered with the 2-multiply recursive oscillator
 * y[n] = c·y[n-1] − d·y[n-2]. Amplitude & phase live in the initial state, so the inner loop
 * is just a multiply-add per mode per sample. Used by the piano and the mallets.
 */
export class ModalBank {
  readonly max: number
  /** per mode: base freq (Hz), amplitude, decay rate (nepers/s) */
  freq: Float64Array
  amp: Float64Array
  sigma: Float64Array
  c: Float64Array
  d: Float64Array
  w: Float64Array
  y1: Float64Array
  y2: Float64Array
  /** time (s) since start, for culling */
  env: Float64Array
  /** output routing 0 = L, 1 = R, 2 = both */
  route: Uint8Array
  n = 0
  private sr = 48000
  private ratio = 1
  constructor(max: number) {
    this.max = max
    this.freq = new Float64Array(max)
    this.amp = new Float64Array(max)
    this.sigma = new Float64Array(max)
    this.c = new Float64Array(max)
    this.d = new Float64Array(max)
    this.w = new Float64Array(max)
    this.y1 = new Float64Array(max)
    this.y2 = new Float64Array(max)
    this.env = new Float64Array(max)
    this.route = new Uint8Array(max)
  }
  begin(sr: number): void {
    this.sr = sr
    this.n = 0
    this.ratio = 1
  }
  /** Add a mode starting at phase 0 (sine) with given amplitude. */
  add(freq: number, amp: number, sigma: number, route = 2): void {
    if (this.n >= this.max) return
    const w = (TAU * freq) / this.sr
    if (w >= Math.PI * 0.95 || amp === 0) return
    const i = this.n++
    const r = Math.exp(-sigma / this.sr)
    this.freq[i] = freq
    this.amp[i] = amp
    this.sigma[i] = sigma
    this.c[i] = 2 * r * Math.cos(w)
    this.d[i] = r * r
    // output s[k] = A·r^k·sin(w(k+1)): state y1 = s[-1] = 0, y2 = s[-2] = −A·sin(w)/r²
    this.y1[i] = 0
    this.y2[i] = (-amp * Math.sin(w)) / (r * r)
    this.w[i] = w
    this.env[i] = Math.abs(amp)
    this.route[i] = route
  }
  /** Scale all mode frequencies by `ratio` relative to the start (pitch bend / glide). Keeps amplitude & phase. */
  retune(ratio: number): void {
    if (Math.abs(ratio - this.ratio) < 1e-5) return
    this.ratio = ratio
    const sr = this.sr
    for (let i = 0; i < this.n; i++) {
      const w = this.w[i]
      const w2 = Math.min(Math.PI * 0.95, (TAU * this.freq[i] * ratio) / sr)
      const r = Math.sqrt(this.d[i])
      const sw = Math.sin(w)
      if (sw < 1e-9) continue
      const S = this.y1[i]
      const C = (S * Math.cos(w) - this.y2[i] * r) / sw
      this.y2[i] = (S * Math.cos(w2) - C * Math.sin(w2)) / r
      this.c[i] = 2 * r * Math.cos(w2)
      this.w[i] = w2
    }
  }
  /** Increase all decay rates by `extra` nepers/s plus `hf`·(f/1kHz)² (damper). */
  damp(extra: number, hf: number): void {
    const sr = this.sr
    for (let i = 0; i < this.n; i++) {
      const fk = this.freq[i] / 1000
      const sigma = this.sigma[i] + extra + hf * fk * fk
      const rOld = Math.sqrt(this.d[i])
      const r = Math.exp(-sigma / sr)
      const cosw = Math.cos(this.w[i])
      this.sigma[i] = sigma
      this.c[i] = 2 * r * cosw
      this.d[i] = r * r
      this.y2[i] *= rOld / r
    }
  }
  /** ADD n samples; route 0→l, 1→r, 2→both. Advances amplitude bookkeeping and culls dead modes. */
  render(l: Float32Array, r: Float32Array, n: number, stereo: boolean): void {
    for (let i = 0; i < this.n; i++) {
      const c = this.c[i]
      const d = this.d[i]
      let y1 = this.y1[i]
      let y2 = this.y2[i]
      const route = stereo ? this.route[i] : 0
      if (route === 0) {
        for (let k = 0; k < n; k++) {
          const y = c * y1 - d * y2
          y2 = y1
          y1 = y
          l[k] += y
        }
      } else if (route === 1) {
        for (let k = 0; k < n; k++) {
          const y = c * y1 - d * y2
          y2 = y1
          y1 = y
          r[k] += y
        }
      } else {
        for (let k = 0; k < n; k++) {
          const y = c * y1 - d * y2
          y2 = y1
          y1 = y
          l[k] += y
          r[k] += y
        }
      }
      this.y1[i] = y1
      this.y2[i] = y2
      this.env[i] *= Math.exp((-this.sigma[i] * n) / this.sr)
    }
    // cull modes below -100 dB of full scale (swap-remove)
    for (let i = 0; i < this.n; ) {
      if (this.env[i] < 1e-5) {
        const j = --this.n
        this.freq[i] = this.freq[j]
        this.amp[i] = this.amp[j]
        this.sigma[i] = this.sigma[j]
        this.c[i] = this.c[j]
        this.d[i] = this.d[j]
        this.w[i] = this.w[j]
        this.y1[i] = this.y1[j]
        this.y2[i] = this.y2[j]
        this.env[i] = this.env[j]
        this.route[i] = this.route[j]
      } else i++
    }
  }
  get alive(): boolean {
    return this.n > 0
  }
}

/** Hammer/mallet contact-pulse spectrum: |FT of a half-sine pulse of length T| at f (normalized to 1 at DC). */
export function pulseSpectrum(f: number, T: number): number {
  const x = 2 * f * T
  if (Math.abs(x - 1) < 1e-4) return Math.PI / 4
  return Math.abs(Math.cos(Math.PI * f * T) / (1 - x * x))
}

/** Asymmetric soft saturation (even + odd harmonics), DC-neutral at 0. */
export function asymSat(x: number, bias: number): number {
  return Math.tanh(x + bias) - Math.tanh(bias)
}
