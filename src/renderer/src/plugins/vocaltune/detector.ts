// Monophonic pitch detector for VocalTune (worklet-safe: no allocation after construction).
//
// YIN (de Cheveigné & Kawahara 2002) on a ~12 kHz decimated copy of the input:
//   * 2x biquad low-pass + decimation (48k -> 12k), 20 ms integration window, 58..1250 Hz lag range,
//   * cumulative-mean-normalised difference + absolute threshold -> coarse period,
//   * refinement at the full sample rate: difference function on a few lags around the coarse period
//     + parabolic interpolation -> sub-sample period (well under 1 cent on steady tones),
//   * voiced/unvoiced: aperiodicity (CMNDF minimum) with hysteresis + an energy gate.
// One analysis every ~4 ms (`hop`). Pitch reports describe roughly the last 20-37 ms of audio.
import { Biquad } from '../sdk/dsp'

export const F_MIN = 58
export const F_MAX = 1250

const YIN_THRESHOLD = 0.15
const VOICED_ON = 0.25 // aperiodicity needed to become voiced
const VOICED_OFF = 0.35 // ... and to stay voiced
const GATE = 0.0016 // ~ -56 dBFS RMS

function pow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export class PitchDetector {
  readonly sr: number
  readonly dec: number
  readonly dsRate: number
  /** Full-rate samples between analyses. */
  readonly hop: number
  /** Detected frequency (Hz) of the last voiced analysis. */
  freq = 0
  /** Detected period in full-rate samples (fractional). */
  period = 0
  voiced = false
  /** CMNDF minimum of the last analysis (0 = perfectly periodic, ~1 = noise). */
  aperiodicity = 1
  rms = 0

  private lp1: Biquad
  private lp2: Biquad
  private full: Float32Array
  private fullMask: number
  private fw = 0
  private ds: Float32Array
  private dsMask: number
  private dw = 0
  private dsFilled = 0
  private decPhase = 0
  private hopDs: number
  private hopCount = 0
  private W: number
  private Wmax: number
  private Wmin: number
  private tauMin: number
  private tauMax: number
  private Wf: number
  private frame: Float32Array
  private d: Float32Array
  private df: Float64Array

  constructor(sampleRate: number) {
    this.sr = sampleRate
    this.dec = Math.max(1, Math.round(sampleRate / 12000))
    this.dsRate = sampleRate / this.dec
    this.lp1 = new Biquad(sampleRate)
    this.lp2 = new Biquad(sampleRate)
    const fc = Math.min(0.3 * this.dsRate, 0.45 * sampleRate)
    this.lp1.set('lp', fc, 0.54)
    this.lp2.set('lp', fc, 1.31)
    this.Wmax = this.W = Math.round(this.dsRate * 0.02)
    this.Wmin = Math.round(this.dsRate * 0.005)
    this.tauMin = Math.max(2, Math.floor(this.dsRate / F_MAX))
    this.tauMax = Math.ceil(this.dsRate / F_MIN)
    this.hopDs = Math.max(1, Math.round(this.dsRate * 0.004))
    this.hop = this.hopDs * this.dec
    this.Wf = Math.min(this.W * this.dec, 1024)
    const n = this.Wmax + this.tauMax + 2
    this.frame = new Float32Array(n)
    this.d = new Float32Array(this.tauMax + 2)
    this.df = new Float64Array(2 * this.dec + 8)
    this.ds = new Float32Array(pow2(n + 8))
    this.dsMask = this.ds.length - 1
    this.full = new Float32Array(pow2(Math.min(this.Wmax * this.dec, 1024) + (this.tauMax + 2) * this.dec + 16))
    this.fullMask = this.full.length - 1
  }

  /** Age (s) of the audio the last estimate describes (centre of the analysed span). */
  get lag(): number {
    return (0.5 * (this.Wf + this.period)) / this.sr
  }

  reset(): void {
    this.lp1.reset()
    this.lp2.reset()
    this.full.fill(0)
    this.ds.fill(0)
    this.fw = this.dw = this.dsFilled = this.decPhase = this.hopCount = 0
    this.freq = this.period = 0
    this.voiced = false
    this.aperiodicity = 1
    this.rms = 0
  }

  /** Feed one mono sample. Returns true when a new analysis has just completed. */
  push(x: number): boolean {
    this.full[this.fw] = x
    this.fw = (this.fw + 1) & this.fullMask
    const y = this.lp2.process(this.lp1.process(x))
    if (++this.decPhase < this.dec) return false
    this.decPhase = 0
    this.ds[this.dw] = y
    this.dw = (this.dw + 1) & this.dsMask
    if (this.dsFilled < this.frame.length) this.dsFilled++
    if (++this.hopCount < this.hopDs) return false
    this.hopCount = 0
    if (this.dsFilled < this.frame.length) return false
    this.analyze()
    return true
  }

  private analyze(): void {
    // Adaptive integration window: ~3 periods of the last voiced pitch (5..20 ms) keeps the
    // estimate recent (low lag on vibrato/scoops); the full 20 ms is used while searching.
    const W = this.voiced ? Math.max(this.Wmin, Math.min(this.Wmax, Math.round((3 * this.period) / this.dec))) : this.Wmax
    this.W = W
    this.Wf = Math.min(W * this.dec, 1024)
    const tauMax = this.tauMax
    const N = W + tauMax
    const f = this.frame
    // linearise the most recent N decimated samples
    let p = (this.dw - N) & this.dsMask
    let e = 0
    for (let i = 0; i < N; i++) {
      const v = this.ds[p]
      f[i] = v
      p = (p + 1) & this.dsMask
    }
    for (let i = tauMax; i < N; i++) e += f[i] * f[i]
    this.rms = Math.sqrt(e / W)
    if (this.rms < GATE) {
      this.voiced = false
      this.aperiodicity = 1
      return
    }
    // difference function, compared against the newest W samples
    const d = this.d
    const base = tauMax
    d[0] = 1
    let cum = 0
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0
      const o = base - tau
      for (let j = 0; j < W; j++) {
        const df = f[base + j] - f[o + j]
        s += df * df
      }
      cum += s
      d[tau] = cum > 0 ? (s * tau) / cum : 1 // CMNDF
    }
    // absolute threshold, then walk down to the local minimum
    let tau = -1
    for (let t = this.tauMin; t < tauMax; t++) {
      if (d[t] < YIN_THRESHOLD) {
        while (t + 1 < tauMax && d[t + 1] < d[t]) t++
        tau = t
        break
      }
    }
    if (tau < 0) {
      let best = 1e9
      for (let t = this.tauMin; t < tauMax; t++) {
        if (d[t] < best) {
          best = d[t]
          tau = t
        }
      }
    }
    const ap = d[tau]
    this.aperiodicity = ap
    const thr = this.voiced ? VOICED_OFF : VOICED_ON
    if (ap > thr) {
      this.voiced = false
      return
    }
    const period = this.refine(tau)
    const freq = this.sr / period
    if (!(freq >= F_MIN && freq <= F_MAX)) {
      this.voiced = false
      return
    }
    this.period = period
    this.freq = freq
    this.voiced = true
  }

  /** Full-rate difference function around the coarse lag + parabolic interpolation. */
  private refine(tauDs: number): number {
    const dec = this.dec
    const c = tauDs * dec
    const lo = Math.max(2, c - dec - 1)
    const hi = c + dec + 1
    const Wf = this.Wf
    const full = this.full
    const m = this.fullMask
    const newest = this.fw // one past the newest sample
    const start = newest - Wf // window = newest Wf samples, compared with tau samples earlier
    let best = lo
    let bestV = Infinity
    for (let t = lo; t <= hi; t++) {
      let s = 0
      for (let j = 0; j < Wf; j++) {
        const a = full[(start + j) & m]
        const b = full[(start + j - t) & m]
        const df = a - b
        s += df * df
      }
      this.df[t - lo] = s
      if (s < bestV) {
        bestV = s
        best = t
      }
    }
    if (best <= lo || best >= hi) return best
    const y0 = this.df[best - 1 - lo]
    const y1 = this.df[best - lo]
    const y2 = this.df[best + 1 - lo]
    const den = y0 - 2 * y1 + y2
    const delta = den > 1e-20 ? (0.5 * (y0 - y2)) / den : 0
    return best + Math.max(-1, Math.min(1, delta))
  }
}
