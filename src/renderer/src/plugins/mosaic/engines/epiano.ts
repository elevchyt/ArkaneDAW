// Electric pianos: Tine (Rhodes-style FM tine + tonebar + asymmetric pickup "bark"),
// Reed (Wurlitzer-style: odd-harmonic reed bite with grit) and FM (DX-style two-stack EP).
// Part post: tremolo or stereo auto-pan.
import { asymSat, clamp, sinp, wrap, type EngineVoice, type Mods, type PartParams, type PartPost } from './common'

export class EPVoice implements EngineVoice {
  stereo = false
  private sr = 48000
  private variant = 0
  private freq = 440
  private ph1 = 0
  private ph2 = 0
  private ph3 = 0
  private ph4 = 0
  private ampEnv = 1
  private ampDec = 1
  private idx = 0 // modulation index (cycles)
  private idxDec = 1
  private idxSus = 0
  private tine = 0
  private tineDec = 1
  private tineRatio = 7
  private drive = 0
  private bias = 0.2
  private atk = 0
  private atkInc = 1
  private alive = true
  private released = false

  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    this.variant = clamp(p.variant | 0, 0, 2)
    this.freq = freq
    this.ph1 = this.ph2 = this.ph3 = this.ph4 = 0
    this.alive = true
    this.released = false
    const reg = clamp((key - 28) / 72, 0, 1)
    const bark = clamp(p.bark + m.bright * 0.6, 0, 1)
    const decayMul = p.decay
    let t60: number
    if (this.variant === 0) {
      // Rhodes: long sustain in the bass, tine "bell" ping, pickup bark grows with velocity
      t60 = (9 - 7 * reg) * decayMul
      this.idx = (0.15 + bark * 1.1 * vel * vel) * (1.2 - 0.6 * reg)
      this.idxSus = 0.05 + 0.05 * bark
      this.idxDec = Math.exp(-1 / (sr * (0.25 + 0.4 * (1 - reg))))
      this.tine = p.tine * 0.35 * (0.3 + vel)
      this.tineRatio = 7.1 - 2 * reg
      this.tineDec = Math.exp(-1 / (sr * (0.04 + 0.05 * (1 - reg))))
      this.drive = 0.6 + (p.drive + m.drive) * 3 + bark * vel * 2.5
      this.bias = 0.35
      this.atkInc = 1 / (sr * 0.0015)
    } else if (this.variant === 1) {
      // Wurlitzer: reed, faster decay, odd harmonics, gritty with velocity
      t60 = (4.5 - 3.3 * reg) * decayMul
      this.idx = 0.12 + 0.25 * vel
      this.idxSus = 0.08
      this.idxDec = Math.exp(-1 / (sr * 0.15))
      this.tine = p.tine * 0.12 * vel
      this.tineRatio = 4.2
      this.tineDec = Math.exp(-1 / (sr * 0.02))
      this.drive = 1.2 + (p.drive + m.drive) * 4 + bark * vel * vel * 5
      this.bias = 0.08
      this.atkInc = 1 / (sr * 0.002)
    } else {
      // DX EP: 1:1 body stack + 14:1 tine stack
      t60 = (6 - 4.5 * reg) * decayMul
      this.idx = (0.2 + 0.6 * bark * vel) * (1.1 - 0.5 * reg)
      this.idxSus = 0.04
      this.idxDec = Math.exp(-1 / (sr * 0.6))
      this.tine = (0.15 + 0.9 * p.tine * vel) * (1 - 0.5 * reg)
      this.tineRatio = 14
      this.tineDec = Math.exp(-1 / (sr * (0.08 + 0.1 * (1 - reg))))
      this.drive = 0.5 + (p.drive + m.drive) * 2
      this.bias = 0.0
      this.atkInc = 1 / (sr * 0.001)
    }
    this.ampEnv = 1
    this.ampDec = Math.exp(-6.9 / (sr * Math.max(0.2, t60)))
    this.atk = 0
  }

  setFreq(freq: number): void {
    this.freq = freq
  }

  release(): void {
    this.released = true
    this.ampDec = Math.exp(-6.9 / (this.sr * 0.18))
  }

  render(l: Float32Array, _r: Float32Array, n: number): boolean {
    const inc = this.freq / this.sr
    const v = this.variant
    const tr = this.tineRatio
    const drv = this.drive
    const bias = this.bias
    const norm = 1 / Math.tanh(drv * 0.5 + 1e-3)
    let ph1 = this.ph1
    let ph2 = this.ph2
    let ph3 = this.ph3
    let ph4 = this.ph4
    let idx = this.idx
    let tine = this.tine
    let env = this.ampEnv
    let atk = this.atk
    for (let i = 0; i < n; i++) {
      let y: number
      if (v === 0) {
        const mod = sinp(ph2) * (idx + this.idxSus)
        const body = sinp(wrap(ph1 + mod))
        const bell = sinp(ph3) * tine
        y = asymSat((body + bell) * drv * 0.5, bias) * norm * 0.32
      } else if (v === 1) {
        const mod = sinp(ph2) * (idx + this.idxSus)
        const reed = sinp(wrap(ph1 + mod))
        y = (Math.tanh(reed * drv) / Math.tanh(drv) + asymSat(reed * 0.6, bias) * 0.3 + sinp(ph3) * tine) * 0.26
      } else {
        const m1 = sinp(ph2) * (idx + this.idxSus)
        const c1 = sinp(wrap(ph1 + m1))
        const m2 = sinp(ph4) * tine * 1.6
        const c2 = sinp(wrap(ph3 + m2))
        y = (c1 + c2 * 0.45) * 0.3
        if (drv > 0.6) y = Math.tanh(y * drv * 1.4) / (drv * 1.4) * 1.1
      }
      if (atk < 1) {
        atk += this.atkInc
        y *= atk > 1 ? 1 : atk
      }
      l[i] = y * env
      env *= this.ampDec
      idx *= this.idxDec
      tine *= this.tineDec
      ph1 += inc
      if (ph1 >= 1) ph1 -= 1
      ph2 += inc
      if (ph2 >= 1) ph2 -= 1
      if (v === 2) {
        ph3 += inc * 1.0017
        ph4 += inc * tr
      } else ph3 += inc * tr
      if (ph3 >= 1) ph3 -= Math.floor(ph3)
      if (ph4 >= 1) ph4 -= Math.floor(ph4)
    }
    this.ph1 = ph1
    this.ph2 = ph2
    this.ph3 = ph3
    this.ph4 = ph4
    this.idx = idx
    this.tine = tine
    this.ampEnv = env
    this.atk = atk
    if (env < 1e-4) this.alive = false
    void this.released
    return this.alive
  }
}

/** Tremolo / auto-pan (the Suitcase/Wurli amp stage). */
export class EPPost implements PartPost {
  private ph = 0
  private mode = 1
  private rate = 4
  private depth = 0.3
  constructor(private sr: number) {}
  update(p: PartParams): void {
    this.mode = p['trem.mode'] | 0
    this.rate = p['trem.rate']
    this.depth = p['trem.depth']
  }
  reset(): void {
    this.ph = 0
  }
  process(L: Float32Array, R: Float32Array, n: number, m: Mods): void {
    const d = clamp(this.depth + m.tremolo, 0, 1)
    if (d <= 0.001) return
    const inc = this.rate / this.sr
    let ph = this.ph
    for (let i = 0; i < n; i++) {
      const s = sinp(ph)
      if (this.mode === 1) {
        const gl = 1 - d * (0.5 + 0.5 * s)
        const gr = 1 - d * (0.5 - 0.5 * s)
        L[i] *= gl
        R[i] *= gr
      } else {
        const g = 1 - d * (0.5 + 0.5 * s)
        L[i] *= g
        R[i] *= g
      }
      ph += inc
      if (ph >= 1) ph -= 1
    }
    this.ph = ph
  }
}
