// Mallets & bells: modal synthesis (damped mode bank) with per-instrument mode ratios, decays and
// mallet-hardness strike spectrum + contact click. Church bell uses mode doublets (warble), steel
// drum uses a swelling 2nd mode; vibraphone motor tremolo is the part post.
import { ModalBank, Noise, Reson, clamp, sinp, type EngineVoice, type Mods, type PartParams, type PartPost } from './common'

interface Model {
  ratios: number[]
  amps: number[]
  /** decay multiplier per mode (σ scale) */
  dmul: number[]
  /** fundamental T60 at C4 (s) and how it scales per octave (multiplier) */
  t60: number
  oct: number
  /** release damps (dampers) */
  damper: boolean
  click: number
  doublet?: number // cents spread for doublets
  swell?: boolean
}

const tubular = [9, 25, 49, 81, 121, 169, 225].map((x) => x / 40.5)

const MODELS: Model[] = [
  { ratios: [1, 3.99, 9.2], amps: [1, 0.3, 0.1], dmul: [1, 3, 6], t60: 1.4, oct: 0.55, damper: false, click: 0.6 }, // marimba
  { ratios: [1, 4.0, 10.1], amps: [1, 0.22, 0.06], dmul: [1, 2.5, 5], t60: 7, oct: 0.75, damper: true, click: 0.4 }, // vibraphone
  { ratios: [1, 2.71, 5.15, 8.43], amps: [1, 0.45, 0.25, 0.12], dmul: [1, 1.4, 2, 3], t60: 5, oct: 0.8, damper: false, click: 0.7 }, // glockenspiel
  { ratios: [1, 3.0, 6.1, 9.4], amps: [1, 0.45, 0.18, 0.07], dmul: [1, 2, 4, 6], t60: 0.7, oct: 0.6, damper: false, click: 1 }, // xylophone
  { ratios: tubular, amps: [0.12, 0.35, 0.6, 1, 0.8, 0.55, 0.3], dmul: [0.5, 0.7, 0.9, 1, 1.3, 1.7, 2.3], t60: 14, oct: 0.8, damper: false, click: 0.5, doublet: 1.2 }, // tubular
  { ratios: [1, 5.9, 15.2], amps: [1, 0.22, 0.06], dmul: [1, 4, 9], t60: 2.4, oct: 0.65, damper: false, click: 0.8 }, // kalimba
  { ratios: [1, 2.0, 3.0, 4.01, 5.03], amps: [1, 0.75, 0.45, 0.2, 0.1], dmul: [1, 1.3, 1.8, 2.5, 3], t60: 2, oct: 0.7, damper: false, click: 0.4, swell: true }, // steel drum
  { ratios: [1, 2.76, 5.4], amps: [1, 0.1, 0.04], dmul: [1, 3, 5], t60: 3, oct: 0.7, damper: true, click: 0.3 }, // celesta
  { ratios: [0.5, 1, 1.19, 1.5, 2, 2.5, 2.66, 3.0, 4.0], amps: [0.55, 0.75, 0.65, 0.35, 1, 0.3, 0.35, 0.25, 0.18], dmul: [0.35, 0.6, 0.8, 1, 0.9, 1.6, 1.8, 2.2, 3], t60: 18, oct: 0.8, damper: false, click: 0.6, doublet: 2 }, // church bell
  { ratios: [1, 6.27, 17.55], amps: [1, 0.18, 0.05], dmul: [1, 3, 7], t60: 1.8, oct: 0.7, damper: false, click: 0.9 } // music box
]

export class MalletVoice implements EngineVoice {
  stereo = true
  private bank = new ModalBank(24)
  private sr = 48000
  private startFreq = 440
  private noise = new Noise(5150)
  private click = new Reson()
  private cEnv = 0
  private cDec = 0
  private cLvl = 0
  private damper = false

  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    this.startFreq = freq
    const M = MODELS[clamp(p.variant | 0, 0, MODELS.length - 1)]
    this.damper = M.damper
    const h = clamp(p.hard + m.bright * 0.5, 0, 1)
    const t60 = M.t60 * Math.pow(M.oct, (key - 60) / 12) * p.decay
    const sigma = 6.9078 / Math.max(0.05, t60)
    const fc = freq * (1.2 + 14 * h * h * (0.35 + 0.65 * vel))
    const inh = p.detune + m.detune * 0.5
    const bank = this.bank
    bank.begin(sr)
    let sum = 0
    for (let k = 0; k < M.ratios.length; k++) {
      const w = 1 / (1 + Math.pow((freq * M.ratios[k]) / fc, 2))
      sum += M.amps[k] * (k === 0 ? 1 : w)
    }
    const norm = 0.45 / Math.max(0.3, sum)
    for (let k = 0; k < M.ratios.length; k++) {
      const ratio = M.ratios[k] * (1 + inh * 0.04 * k * (k & 1 ? 1 : -1))
      const f = freq * ratio
      const w = k === 0 ? 1 : 1 / (1 + Math.pow(f / fc, 2))
      const a = M.amps[k] * w * norm
      const s = sigma * M.dmul[k]
      const route = k & 1 ? 1 : 0
      if (M.doublet) {
        const c = Math.pow(2, (M.doublet * (0.5 + 0.5 * Math.sin(k * 3.7))) / 1200)
        bank.add(f / c, a * 0.5, s, route)
        bank.add(f * c, a * 0.5, s * 1.1, 1 - route)
      } else if (M.swell && k === 1) {
        // energy flows into the octave mode: a·(e^{-σt} − e^{-4σt}) swells then decays
        bank.add(f, a * 1.6, s, 2)
        bank.add(f, -a * 1.6, s * 6, 2)
      } else bank.add(f, a, s, k === 0 ? 2 : route)
    }
    // mallet contact click
    this.click.reset()
    this.click.set(clamp(freq * 6, 1500, 9000), 3000, sr)
    this.cEnv = 1
    this.cDec = Math.exp(-1 / (sr * (0.0015 + 0.003 * (1 - h))))
    this.cLvl = p.noise * M.click * vel * (0.3 + h) * 0.8
  }

  setFreq(freq: number): void {
    this.bank.retune(freq / this.startFreq)
  }

  release(): void {
    if (this.damper) this.bank.damp(6.9 / 0.35, 2)
  }

  render(l: Float32Array, r: Float32Array, n: number): boolean {
    l.fill(0, 0, n)
    r.fill(0, 0, n)
    this.bank.render(l, r, n, true)
    if (this.cEnv > 1e-4) {
      for (let i = 0; i < n; i++) {
        const s = this.click.process(this.noise.next()) * this.cEnv * this.cLvl
        this.cEnv *= this.cDec
        l[i] += s
        r[i] += s
      }
    }
    // gentle stereo blend
    for (let i = 0; i < n; i++) {
      const a = l[i]
      const b = r[i]
      l[i] = a + b * 0.45
      r[i] = b + a * 0.45
    }
    return this.bank.alive || this.cEnv > 1e-4
  }
}

/** Vibraphone motor: rotating discs → amplitude tremolo. */
export class MotorPost implements PartPost {
  private ph = 0
  private depth = 0
  private rate = 5
  constructor(private sr: number) {}
  update(p: PartParams): void {
    this.depth = p.motor
    this.rate = p.motorRate
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
      const g = 1 - d * 0.8 * (0.5 + 0.5 * s)
      L[i] *= g
      R[i] *= g
      ph += inc
      if (ph >= 1) ph -= 1
    }
    this.ph = ph
  }
}
