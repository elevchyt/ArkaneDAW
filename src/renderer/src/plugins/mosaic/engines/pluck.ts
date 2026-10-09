// Plucked & bowed strings: extended Karplus-Strong digital waveguide.
//  · loop = delay (Thiran allpass fractional tuning) → one-pole loss filter (brightness) → gain (T60)
//  · loop delay is compensated for the loss filter's phase delay so notes stay in tune
//  · excitation = plucked-shape (triangle at pluck position) + velocity-filtered noise, pick-position comb
//  · koto/steel: tension pitch-drop; bowed: continuous band-limited stick-slip drive into the loop
//  · part post: body resonances per instrument (guitar, harp, koto, violin family)
import { Osc } from '../../sdk/dsp'
import { Noise, Reson, clamp, type EngineVoice, type Mods, type PartParams, type PartPost } from './common'

// variant: [loss coef, T60 low, T60 high, release T60, excitation softness]
const VARS = [
  { a: 0.42, tLo: 4, tHi: 0.9, rel: 0.25, soft: 0.75, drop: 0 }, // nylon
  { a: 0.18, tLo: 7, tHi: 1.6, rel: 0.25, soft: 0.35, drop: 0.08 }, // steel
  { a: 0.14, tLo: 9, tHi: 2.5, rel: 0.12, soft: 0.45, drop: 0.03 }, // electric
  { a: 0.3, tLo: 6, tHi: 1.2, rel: 6, soft: 0.65, drop: 0 }, // harp (rings on)
  { a: 0.12, tLo: 5, tHi: 1.5, rel: 0.4, soft: 0.25, drop: 0.35 }, // koto
  { a: 0.5, tLo: 0.7, tHi: 0.25, rel: 0.1, soft: 0.5, drop: 0 }, // pizzicato
  { a: 0.3, tLo: 1.2, tHi: 0.6, rel: 0.25, soft: 0.5, drop: 0 } // bowed
]

export class PluckVoice implements EngineVoice {
  stereo = false
  private sr = 48000
  private buf: Float32Array
  private mask: number
  private w = 0
  private freq = 220
  private a = 0.3
  private g = 0.99
  private lp = 0
  private ap = 0
  private delay = 100
  private M = 99
  private eta = 0
  private bowed = false
  private bowOsc = new Osc()
  private bowAmt = 0
  private bowNorm = 0.05
  private bowNoise = 0.3
  private noise = new Noise(4242)
  private dropEnv = 0
  private dropDec = 0
  private dropAmt = 0
  private peak = 0
  private silent = 0
  private relT60 = 0.25
  private variant = 0
  private t60 = 3

  constructor(sr: number) {
    let n = 1
    while (n < sr / 15) n <<= 1
    this.buf = new Float32Array(n)
    this.mask = n - 1
  }

  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    const vi = clamp(p.variant | 0, 0, VARS.length - 1)
    this.variant = vi
    const V = VARS[vi]
    const reg = clamp((key - 36) / 60, 0, 1)
    const bright = clamp(p.bright + m.bright * 0.5, 0, 1)
    this.a = clamp(V.a * (1.6 - 1.2 * bright) * (1 - 0.3 * vel), 0.02, 0.85)
    this.t60 = Math.exp(Math.log(V.tLo) + (Math.log(V.tHi) - Math.log(V.tLo)) * reg) * p.decay
    this.relT60 = V.rel
    this.bowed = vi === 6
    this.freq = freq
    this.lp = 0
    this.ap = 0
    this.peak = 0
    this.silent = 0
    this.dropAmt = (V.drop + p.bend * 0.6) * (0.4 + vel)
    this.dropEnv = 1
    this.dropDec = Math.exp(-1 / (sr * (0.06 + 0.1 * p.bend)))
    this.retune(freq)
    // excitation: pluck shape + noise, lowpassed by velocity, pick-position comb
    const N = Math.max(2, Math.round(sr / freq))
    const buf = this.buf
    buf.fill(0)
    const pos = clamp(p.pos, 0.03, 0.5)
    const pk = Math.max(1, Math.round(pos * N))
    const soft = V.soft
    const cut = clamp((0.15 + 0.85 * vel * vel) * (0.35 + bright * 0.65) * (1 - soft * 0.6), 0.02, 1)
    let f1 = 0
    let f2 = 0
    const ex = EX
    let mean = 0
    for (let i = 0; i < N; i++) {
      const tri = i < pk ? i / pk : (N - i) / (N - pk)
      const x = tri * soft + this.noise.next() * (1 - soft * 0.7)
      f1 += (x - f1) * cut
      f2 += (f1 - f2) * cut
      ex[i] = f2
      mean += f2
    }
    mean /= N
    let peak = 1e-9
    for (let i = 0; i < N; i++) {
      const y = ex[i] - mean - (i >= pk ? ex[i - pk] - mean : 0) * 0.6
      ex[i] = y
      peak = Math.max(peak, Math.abs(y))
    }
    const amp = this.bowed ? 0.02 : 0.7 / peak
    this.w = 0
    for (let i = 0; i < N; i++) {
      buf[this.w] = ex[i] * amp
      this.w = (this.w + 1) & this.mask
    }
    this.bowAmt = this.bowed ? 0.25 + 0.15 * vel : 0
    this.bowNoise = 0.1 + p.bow * 0.8
    this.bowOsc.phase = 0
  }

  private retune(freq: number): void {
    const sr = this.sr
    const f = Math.max(15, freq)
    const w = (2 * Math.PI * f) / sr
    const a = this.a
    // loss filter phase delay at f
    const pd = Math.atan2(a * Math.sin(w), 1 - a * Math.cos(w)) / w
    const D = Math.max(2, sr / f - pd)
    let M = Math.floor(D - 0.5)
    if (M < 1) M = 1
    const d = D - M
    this.M = M
    this.eta = (1 - d) / (1 + d)
    // loop gain from T60 at the fundamental, compensating the filter's magnitude
    const mag = (1 - a) / Math.sqrt(1 - 2 * a * Math.cos(w) + a * a)
    const gt = Math.pow(10, -3 / (this.t60 * f))
    this.g = Math.min(0.99995, gt / mag)
    this.delay = D
    this.bowNorm = Math.max(0.002, 1 - this.g) * 1.0
  }

  setFreq(freq: number): void {
    const f = freq * (1 + this.dropAmt * this.dropEnv * 0.06)
    if (Math.abs(f - this.freq) > 1e-3 * this.freq || this.dropEnv > 1e-3) {
      this.freq = f
      this.retune(f)
    }
  }

  release(): void {
    this.t60 = Math.min(this.t60, this.relT60)
    this.bowAmt = 0
    this.retune(this.freq)
  }

  render(l: Float32Array, _r: Float32Array, n: number): boolean {
    const buf = this.buf
    const mask = this.mask
    const M = this.M
    const eta = this.eta
    const a = this.a
    const g = this.g
    let w = this.w
    let lp = this.lp
    let ap = this.ap
    let peak = 0
    const bow = this.bowAmt
    const bn = this.bowNorm
    const dt = this.freq / this.sr
    for (let i = 0; i < n; i++) {
      const s0 = buf[(w - M) & mask]
      const s1 = buf[(w - M - 1) & mask]
      const y = eta * (s0 - ap) + s1
      ap = y
      lp = (1 - a) * y + a * lp
      let v = lp * g
      if (bow > 0) v += (this.bowOsc.next(2, dt) + this.noise.next() * this.bowNoise) * bow * bn
      buf[w] = v
      w = (w + 1) & mask
      l[i] = y
      const ay = y < 0 ? -y : y
      if (ay > peak) peak = ay
    }
    this.w = w
    this.lp = lp
    this.ap = ap
    this.dropEnv *= Math.pow(this.dropDec, n)
    if (peak < 1e-4) this.silent += n
    else this.silent = 0
    return this.silent < this.sr * 0.05 || bow > 0
  }
}

const EX = new Float32Array(8192)

const BODIES: number[][][] = [
  [[98, 25, 1.0], [204, 40, 0.8], [390, 60, 0.5], [560, 80, 0.3], [1200, 300, 0.15]],
  [[110, 25, 0.9], [220, 40, 0.8], [420, 70, 0.5], [900, 150, 0.35], [2500, 400, 0.25]],
  [[3000, 1800, 0.5]],
  [[120, 40, 0.6], [250, 60, 0.6], [480, 100, 0.4], [1100, 250, 0.2]],
  [[180, 40, 0.6], [350, 70, 0.6], [700, 120, 0.4], [1400, 250, 0.35]],
  [[280, 40, 0.8], [460, 60, 0.9], [1000, 150, 0.5], [2800, 600, 0.7], [4500, 800, 0.3]],
  [[280, 40, 0.8], [460, 60, 0.9], [1000, 150, 0.5], [2800, 600, 0.7], [4500, 800, 0.3]]
]

/** Instrument body resonances (linear → once per part). */
export class BodyPost implements PartPost {
  private modesL: Reson[] = []
  private modesR: Reson[] = []
  private gains: number[] = []
  private variant = -1
  private amount = 0.5
  constructor(
    private sr: number,
    private sets: number[][][] = BODIES
  ) {}
  update(p: PartParams): void {
    this.amount = p.body ?? 0.5
    const v = clamp(p.variant | 0, 0, this.sets.length - 1)
    if (v === this.variant) return
    this.variant = v
    const set = this.sets[v]
    this.modesL = set.map(([f, bw]) => {
      const r = new Reson()
      r.set(f, bw, this.sr)
      return r
    })
    this.modesR = set.map(([f, bw]) => {
      const r = new Reson()
      r.set(f * 1.03, bw, this.sr)
      return r
    })
    this.gains = set.map((s) => s[2])
  }
  reset(): void {
    for (const r of this.modesL) r.reset()
    for (const r of this.modesR) r.reset()
  }
  process(L: Float32Array, R: Float32Array, n: number): void {
    const amt = this.amount
    if (amt <= 0.001) return
    const nm = this.modesL.length
    const g = this.gains
    for (let i = 0; i < n; i++) {
      const xl = L[i]
      const xr = R[i]
      let bl = 0
      let br = 0
      for (let k = 0; k < nm; k++) {
        bl += this.modesL[k].process(xl) * g[k]
        br += this.modesR[k].process(xr) * g[k]
      }
      L[i] = xl * (1 - amt * 0.35) + bl * amt * 2.5
      R[i] = xr * (1 - amt * 0.35) + br * amt * 2.5
    }
  }
}
