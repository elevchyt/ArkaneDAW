// Choir / formant: an ensemble of "singers" (glottal-like band-limited pulses with individual
// detune, drift and vibrato) + breath noise through 5 vowel formant resonators (morphable A-E-I-O-U,
// male↔female formant sets). Voice Pad = supersaw source through the formants; Breathy = mostly air.
import { Osc } from '../../sdk/dsp'
import { Noise, Reson, clamp, type EngineVoice, type Mods, type PartParams } from './common'

// [vowel][formant] = [freq, dB, bw]  (bass/male, soprano/female) — classic Csound formant tables
const MALE = [
  [[600, 0, 60], [1040, -7, 70], [2250, -9, 110], [2450, -9, 120], [2750, -20, 130]],
  [[400, 0, 40], [1620, -12, 80], [2400, -9, 100], [2800, -12, 120], [3100, -18, 120]],
  [[250, 0, 60], [1750, -30, 90], [2600, -16, 100], [3050, -22, 120], [3340, -28, 120]],
  [[400, 0, 40], [750, -11, 80], [2400, -21, 100], [2600, -20, 120], [2900, -40, 120]],
  [[350, 0, 40], [600, -20, 80], [2400, -32, 100], [2675, -28, 120], [2950, -36, 120]]
]
const FEMALE = [
  [[800, 0, 80], [1150, -6, 90], [2900, -32, 120], [3900, -20, 130], [4950, -50, 140]],
  [[350, 0, 60], [2000, -20, 100], [2800, -15, 120], [3600, -40, 150], [4950, -56, 200]],
  [[270, 0, 60], [2140, -12, 90], [2950, -26, 100], [3900, -26, 120], [4950, -44, 120]],
  [[450, 0, 70], [800, -11, 80], [2830, -22, 100], [3800, -22, 130], [4950, -50, 135]],
  [[325, 0, 50], [700, -16, 60], [2700, -35, 170], [3800, -40, 180], [4950, -60, 200]]
]

function formant(vowel: number, gender: number, k: number, out: Float64Array): void {
  const v = clamp(vowel, 0, 4)
  const i0 = Math.min(3, Math.floor(v))
  const t = v - i0
  const get = (tab: number[][][], j: number) => tab[i0][k][j] * (1 - t) + tab[i0 + 1][k][j] * t
  out[0] = get(MALE, 0) * (1 - gender) + get(FEMALE, 0) * gender
  out[1] = get(MALE, 1) * (1 - gender) + get(FEMALE, 1) * gender
  out[2] = get(MALE, 2) * (1 - gender) + get(FEMALE, 2) * gender
}
const TMP = new Float64Array(3)

export class ChoirVoice implements EngineVoice {
  stereo = true
  private sr = 48000
  private src: Osc[] = Array.from({ length: 8 }, () => new Osc())
  private det = new Float64Array(8)
  private vibPh = new Float64Array(8)
  private vibRate = new Float64Array(8)
  private drift = new Float64Array(8)
  private fl: Reson[] = Array.from({ length: 5 }, () => new Reson())
  private fr: Reson[] = Array.from({ length: 5 }, () => new Reson())
  private fg = new Float64Array(5)
  private noise = new Noise(31337)
  private glL = 0
  private glR = 0
  private freq = 220
  private ns = 3
  private variant = 0
  private breath = 0.2
  private vowel = 0
  private gender = 0.5
  private bright = 0.5
  private gain = 1
  private ctl = 0

  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    this.freq = freq
    this.variant = clamp(p.variant | 0, 0, 2)
    const ens = clamp(Math.round(p.ens), 1, 4)
    this.ns = this.variant === 1 ? ens * 2 : ens
    const det = clamp(p.detune + m.detune * 0.5, 0, 1)
    for (let k = 0; k < this.ns; k++) {
      const sign = k & 1 ? 1 : -1
      this.det[k] = Math.pow(2, (sign * (k + 1) * det * 7 + (Math.random() - 0.5) * det * 4) / 1200)
      this.vibPh[k] = Math.random()
      this.vibRate[k] = 4.6 + Math.random() * 1.4
      this.drift[k] = 0
      this.src[k].phase = Math.random()
    }
    this.breath = p.breath
    this.vowel = p.vowel
    this.gender = p.gender
    this.bright = clamp(p.bright + m.bright * 0.5, 0, 1)
    for (const f of this.fl) f.reset()
    for (const f of this.fr) f.reset()
    this.glL = this.glR = 0
    this.ctl = 0
    this.gain = 0.33 / Math.sqrt(this.ns)
    void key
    void vel
    this.updateFormants()
  }

  private updateFormants(): void {
    const sr = this.sr
    // register-aware: high notes pull the first formant up (singers open the vowel)
    const f0 = this.freq
    for (let k = 0; k < 5; k++) {
      formant(this.vowel, this.gender, k, TMP)
      let f = TMP[0]
      if (k === 0 && f < f0 * 1.1) f = f0 * 1.1
      const db = TMP[1] + (k >= 2 ? (this.bright - 0.5) * 18 : 0)
      const bw = TMP[2] * 1.4
      this.fl[k].set(f, bw, sr)
      this.fr[k].set(f * 1.01, bw, sr)
      // resonator peak gain is ~1 at centre: scale by dB and compensate narrow bandwidths
      this.fg[k] = Math.pow(10, db / 20) * (1 + 400 / bw) * 0.5
    }
  }

  setFreq(freq: number): void {
    this.freq = freq
  }

  release(): void {}

  render(l: Float32Array, r: Float32Array, n: number): boolean {
    const sr = this.sr
    if ((this.ctl++ & 3) === 0) this.updateFormants()
    const ns = this.ns
    const v = this.variant
    const shape = v === 1 ? 2 : 2
    const glottalA = Math.exp((-2 * Math.PI * (v === 1 ? 6000 : 1400 + this.bright * 2000)) / sr)
    const srcAmt = v === 2 ? 0.25 : 1
    const breath = (v === 2 ? 0.9 : this.breath * 0.5) * 1.2
    // per-singer pitch (vibrato + slow drift) at control rate
    for (let k = 0; k < ns; k++) {
      this.vibPh[k] += (this.vibRate[k] * n) / sr
      if (this.vibPh[k] >= 1) this.vibPh[k] -= 1
      this.drift[k] += (Math.random() - 0.5) * 0.0006 - this.drift[k] * 0.01
    }
    l.fill(0, 0, n)
    r.fill(0, 0, n)
    const base = this.freq / sr
    for (let k = 0; k < ns; k++) {
      const o = this.src[k]
      const vib = 1 + Math.sin(this.vibPh[k] * 6.2832) * 0.0035 + this.drift[k]
      const dt = Math.min(0.45, base * this.det[k] * vib)
      const out = k & 1 ? r : l
      for (let i = 0; i < n; i++) out[i] += o.next(shape, dt) * srcAmt
    }
    const fl = this.fl
    const fr = this.fr
    const fg = this.fg
    let gl = this.glL
    let gr = this.glR
    const mix = v === 1 ? 0.35 : 0
    for (let i = 0; i < n; i++) {
      // glottal rolloff + breath
      gl = l[i] + (gl - l[i]) * glottalA
      gr = r[i] + (gr - r[i]) * glottalA
      const nz = this.noise.next() * breath
      const xl = gl + nz
      const xr = gr + nz
      let yl = 0
      let yr = 0
      for (let k = 0; k < 5; k++) {
        yl += fl[k].process(xl) * fg[k]
        yr += fr[k].process(xr) * fg[k]
      }
      l[i] = (yl + gl * mix) * this.gain
      r[i] = (yr + gr * mix) * this.gain
    }
    this.glL = gl
    this.glR = gr
    return true
  }
}
