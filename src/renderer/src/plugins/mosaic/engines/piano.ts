// Acoustic piano: modal synthesis of struck, stiff, coupled strings.
//
// Per note, every partial n of the string is two damped sinusoids (Weinreich's coupled-string
// picture): the in-phase "prompt" mode decays fast, the out-of-phase "aftersound" mode decays
// slowly and is slightly mistuned → two-stage decay + beating that differs per key.
//   f_n = n·f0·√(1+B·n²)            (stiff-string inharmonicity, B per register)
//   a_n ∝ |sin(nπβ)| · n^-0.7 · H(f_n)  (strike position β comb · hammer felt lowpass H)
//   σ_n = σ_1 + b1·f + b3·f²         (frequency dependent losses)
// + hammer knock noise, contact-time attack ramp, stretch tuning (Railsback), damper with
// release thump (top 20 keys undamped), soundboard body resonances & diffusion (part post).
import { Biquad } from '../../sdk/dsp'
import { ModalBank, Noise, Reson, clamp, type EngineVoice, type Mods, type PartParams, type PartPost } from './common'

// variant: [B multiplier, decay multiplier, hardness offset, unison cents, body type]
const VARIANTS = [
  { B: 1, decay: 1, hard: 0, cents: 2, prompt: 0.55 },
  { B: 1, decay: 0.9, hard: 0.22, cents: 2.2, prompt: 0.6 },
  { B: 2.2, decay: 0.55, hard: -0.05, cents: 3, prompt: 0.62 },
  { B: 1.6, decay: 0.6, hard: 0.12, cents: 11, prompt: 0.5 }
]

/** log-interpolated aftersound T60 of the fundamental by key. */
function t60After(key: number): number {
  const pts: [number, number][] = [
    [21, 40],
    [48, 26],
    [60, 18],
    [72, 11],
    [84, 6],
    [96, 3],
    [108, 1.2]
  ]
  if (key <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    const [k1, v1] = pts[i]
    const [k0, v0] = pts[i - 1]
    if (key <= k1) {
      const t = (key - k0) / (k1 - k0)
      return Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * t)
    }
  }
  return pts[pts.length - 1][1]
}

export function inharmonicity(key: number): number {
  if (key >= 30) return Math.pow(10, -4 + (key - 30) * 0.025)
  return 1e-4 + 1.5e-4 * ((30 - key) / 9)
}

/** deterministic per-key pseudo random in [0,1) */
const hash = (k: number, salt: number): number => {
  const x = Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

const MAXP = 56

export class PianoVoice implements EngineVoice {
  stereo = true
  private bank = new ModalBank(MAXP * 2)
  private sr = 48000
  private f0 = 440
  private key = 60
  private noise = new Noise(1234)
  private knock = new Reson()
  private thump = new Reson()
  private nEnv = 0
  private nDec = 0
  private nLvl = 0
  private tEnv = 0
  private tDec = 0
  private tLvl = 0
  private atk = 0
  private atkLen = 1
  private width = 0.6
  private damperNoise = 0.4

  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    this.key = key
    this.startFreq = freq
    const V = VARIANTS[clamp(p.variant | 0, 0, 3)]
    const h = clamp(p.hard + V.hard + m.bright * 0.5, 0, 1)
    const decayMul = p.decay * V.decay
    // stretch tuning (Railsback curve) on top of the played frequency
    const stretch = p.stretch * 3.4e-4 * Math.pow(key - 64, 3) // cents (≈ ±30 at the extremes)
    const f0 = freq * Math.pow(2, stretch / 1200)
    this.f0 = f0
    const B = inharmonicity(key) * V.B
    const beta = clamp(p.strike, 0.04, 0.3) + (hash(key, 3) - 0.5) * 0.01
    // hammer felt: lowpass corner rises with velocity, hardness, and register
    const fc = 900 * Math.pow(2, vel * 2.6) * Math.pow(2, h * 1.6 - 0.8) * Math.pow(2, (key - 60) / 24)
    const slope = 2.2 + (1 - h) * 1.2
    // decays
    const ta = t60After(key) * decayMul
    const sigA = 6.9078 / ta
    const sigP = sigA * (4.5 + 2 * (1 - vel))
    const cents = V.cents * (0.25 + 1.5 * p.unison + m.detune * 0.8) * (0.5 + hash(key, 7))
    const dA = Math.pow(2, -cents / 2400)
    const dB = Math.pow(2, cents / 2400)
    const prompt = V.prompt
    const nyq = Math.min(sr * 0.45, 18000)
    const bank = this.bank
    bank.begin(sr)
    // first pass amplitudes for normalisation
    let sum2 = 0
    const amps = AMPS
    const freqs = FREQS
    let np = 0
    for (let n = 1; n <= MAXP; n++) {
      const fn = n * f0 * Math.sqrt((1 + B * n * n) / (1 + B))
      if (fn >= nyq) break
      const comb = Math.abs(Math.sin(n * Math.PI * beta))
      const H = 1 / (1 + Math.pow(fn / fc, slope))
      const a = (0.08 + comb) * Math.pow(n, -0.7) * H
      amps[np] = a
      freqs[np] = fn
      np++
      sum2 += a * a
    }
    const norm = 0.42 / Math.sqrt(Math.max(1e-9, sum2))
    const amax = amps[0] * norm
    const f1k = freqs[0] / 1000
    const g1 = 0.2 * f1k + 0.5 * f1k * f1k
    for (let i = 0; i < np; i++) {
      const a = amps[i] * norm
      if (a < amax * 1e-3 && i > 2) continue
      const fn = freqs[i]
      const fk = fn / 1000
      const extra = (0.2 * fk + 0.5 * fk * fk - g1) / decayMul
      const odd = i & 1
      bank.add(fn * dA, a * prompt, sigP + extra, odd ? 1 : 0)
      bank.add(fn * dB, a * (1 - prompt), sigA + extra, odd ? 0 : 1)
    }
    // hammer knock: band-limited noise burst near the strike + low soundboard thump
    this.knock.reset()
    this.knock.set(clamp(f0 * 3, 300, 4000), clamp(f0 * 2, 300, 2500), sr)
    this.thump.reset()
    this.thump.set(110 + hash(key, 11) * 60, 70, sr)
    this.nLvl = p.noise * (0.08 + 0.5 * vel * vel) * (0.5 + h)
    this.nEnv = 1
    this.nDec = Math.exp(-1 / (sr * (0.004 + 0.012 * (1 - (key - 21) / 87))))
    this.tLvl = p.noise * 0.9 * vel * vel
    this.tEnv = 1
    this.tDec = Math.exp(-1 / (sr * 0.03))
    // contact time ramp (1–4 ms)
    const T = 0.0035 * Math.pow(2, -(key - 60) / 30) * (1.5 - 1.0 * vel) * (1.25 - 0.6 * h)
    this.atkLen = Math.max(8, Math.round(clamp(T, 0.0004, 0.006) * sr))
    this.atk = 0
    this.width = p.width
    this.damperNoise = p.damper
  }

  private startFreq = 440
  setFreq(freq: number): void {
    // ratio to the played freq at note-on (stretch is a constant factor, cancels out)
    this.bank.retune(freq / this.startFreq)
  }

  release(relVel: number): void {
    if (this.key >= 89) return // no dampers on the top keys
    const reg = clamp((this.key - 21) / 68, 0, 1)
    const t60 = 0.9 - 0.7 * reg // bass dampers are slower
    this.bank.damp(6.9078 / t60, 8)
    // damper felt thump
    this.tLvl = this.damperNoise * 0.25 * (0.4 + relVel)
    this.tEnv = 1
    this.tDec = Math.exp(-1 / (this.sr * 0.025))
    this.thump.set(80 + reg * 60, 60, this.sr)
  }

  render(l: Float32Array, r: Float32Array, n: number): boolean {
    l.fill(0, 0, n)
    r.fill(0, 0, n)
    this.bank.render(l, r, n, true)
    // attack ramp (hammer contact)
    if (this.atk < this.atkLen) {
      const len = this.atkLen
      for (let i = 0; i < n && this.atk < len; i++, this.atk++) {
        const g = 0.5 - 0.5 * Math.cos((Math.PI * this.atk) / len)
        l[i] *= g
        r[i] *= g
      }
    }
    // noise components
    if (this.nEnv > 1e-4 || this.tEnv > 1e-4) {
      for (let i = 0; i < n; i++) {
        const w = this.noise.next()
        const s = this.knock.process(w) * this.nEnv * this.nLvl + this.thump.process(w) * this.tEnv * this.tLvl
        this.nEnv *= this.nDec
        this.tEnv *= this.tDec
        l[i] += s
        r[i] += s
      }
    }
    // stereo: cross-blend the two string groups
    const x = 0.15 + 0.85 * (1 - this.width)
    for (let i = 0; i < n; i++) {
      const a = l[i]
      const b = r[i]
      l[i] = a + b * x
      r[i] = b + a * x
    }
    return this.bank.alive || this.tEnv > 1e-4
  }
}

// static scratch (single-threaded worklet)
const AMPS = new Float64Array(MAXP + 1)
const FREQS = new Float64Array(MAXP + 1)

/** Soundboard / cabinet: parallel body modes + short diffusion + tone shaping, per part. */
export class PianoBody implements PartPost {
  private modes: Reson[] = []
  private gains: number[] = []
  private ap: { buf: Float32Array; i: number; g: number }[] = []
  private hs: [Biquad, Biquad]
  private hp: [Biquad, Biquad]
  private amount = 0.5
  private variant = -1
  constructor(private sr: number) {
    this.hs = [new Biquad(sr), new Biquad(sr)]
    this.hp = [new Biquad(sr), new Biquad(sr)]
    this.hp[0].set('hp', 28, 0.7)
    this.hp[1].set('hp', 28, 0.7)
    const delays = [0.0031, 0.0047, 0.0037, 0.0053]
    for (const d of delays) this.ap.push({ buf: new Float32Array(Math.round(d * sr)), i: 0, g: 0.6 })
  }
  update(p: PartParams): void {
    this.amount = p.body
    const v = clamp(p.variant | 0, 0, 3)
    if (v === this.variant) return
    this.variant = v
    const sets = [
      // grand: big board, low modes
      [[92, 25, 1], [175, 35, 0.8], [290, 50, 0.6], [470, 80, 0.45], [820, 140, 0.3], [1500, 260, 0.2], [2700, 450, 0.15]],
      [[92, 25, 0.8], [175, 35, 0.7], [290, 50, 0.5], [520, 80, 0.45], [1000, 160, 0.35], [2100, 300, 0.3], [3400, 500, 0.3]],
      // upright: boxy mids
      [[130, 40, 0.6], [240, 45, 0.9], [380, 55, 0.8], [600, 90, 0.6], [1100, 160, 0.35], [1900, 280, 0.2], [3000, 500, 0.12]],
      [[120, 40, 0.6], [230, 45, 0.9], [400, 60, 0.8], [650, 90, 0.6], [1250, 180, 0.4], [2300, 320, 0.3], [3600, 500, 0.2]]
    ][v]
    this.modes = sets.map(([f, bw]) => {
      const r = new Reson()
      r.set(f, bw, this.sr)
      return r
    })
    this.gains = sets.map(([, , g]) => g)
    const shelf = [1.5, 5, 0, 3][v]
    this.hs[0].set('highshelf', 3200, 0.7, shelf)
    this.hs[1].set('highshelf', 3200, 0.7, shelf)
  }
  reset(): void {
    for (const m of this.modes) m.reset()
    for (const a of this.ap) a.buf.fill(0)
    this.hs[0].reset()
    this.hs[1].reset()
    this.hp[0].reset()
    this.hp[1].reset()
  }
  process(L: Float32Array, R: Float32Array, n: number): void {
    const amt = this.amount
    const modes = this.modes
    const gains = this.gains
    const nm = modes.length
    const [a0, a1, a2, a3] = this.ap
    for (let i = 0; i < n; i++) {
      const xl = L[i]
      const xr = R[i]
      const mono = (xl + xr) * 0.5
      let body = 0
      for (let k = 0; k < nm; k++) body += modes[k].process(mono) * gains[k]
      body *= amt * 2.2
      // diffusion: two allpasses per side fed by the body signal
      let dl = body
      let y = a0.buf[a0.i]
      let v = dl + y * -a0.g
      a0.buf[a0.i] = v
      dl = y + v * a0.g
      a0.i = a0.i + 1 >= a0.buf.length ? 0 : a0.i + 1
      y = a1.buf[a1.i]
      v = dl + y * -a1.g
      a1.buf[a1.i] = v
      dl = y + v * a1.g
      a1.i = a1.i + 1 >= a1.buf.length ? 0 : a1.i + 1
      let dr = body
      y = a2.buf[a2.i]
      v = dr + y * -a2.g
      a2.buf[a2.i] = v
      dr = y + v * a2.g
      a2.i = a2.i + 1 >= a2.buf.length ? 0 : a2.i + 1
      y = a3.buf[a3.i]
      v = dr + y * -a3.g
      a3.buf[a3.i] = v
      dr = y + v * a3.g
      a3.i = a3.i + 1 >= a3.buf.length ? 0 : a3.i + 1
      const ol = xl * (1 - amt * 0.25) + dl
      const or = xr * (1 - amt * 0.25) + dr
      L[i] = this.hp[0].process(this.hs[0].process(ol))
      R[i] = this.hp[1].process(this.hs[1].process(or))
    }
  }
}
