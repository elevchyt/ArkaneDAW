// Guitar body for the Guitar plugin: the transfer from the force on the bridge to the sound in the room.
// A chain of resonances (Helmholtz air mode, the top's main modes, a few higher plate modes, a broad presence
// region) on top of the radiation roll-off below the air mode and above a few kHz. It sits after the strings
// (not inside their loops), so a note that lands on a body mode gets the boom a real guitar gives it — a few dB —
// instead of building up without limit. Each pluck also knocks the top: a short burst of noise rung through the
// same resonances (the "wood" in the attack).
import { Biquad } from '../sdk/dsp'
import { MODEL } from './manifest'

/** [freq Hz, Q, gain dB at the default Body amount] */
type Res = [freq: number, q: number, db: number]

interface BodySpec {
  hp: number // radiation high-pass, Hz
  lp: number // top end of the radiation, Hz
  res: Res[]
  /** knock: level, decay (ms) and brightness (Hz) of the top being hit by the pluck */
  knock: number
  knockMs: number
  knockHz: number
}

// Mode sets after published modal analyses of dreadnought and classical guitars (air ≈ 100 Hz, top ≈ 200 Hz),
// gains and widths tuned by ear.
const SPECS: Record<number, BodySpec> = {
  [MODEL.STEEL]: {
    hp: 72,
    lp: 9500,
    res: [[101, 9, 7], [196, 12, 6], [232, 9, 2.5], [288, 8, 3], [392, 7, 2.5], [545, 5, 2], [760, 2.5, -2.5], [1250, 3, 1.5], [2600, 1.2, 2.5], [5200, 1.5, -2]],
    knock: 0.5,
    knockMs: 3,
    knockHz: 3500
  },
  [MODEL.NYLON]: {
    hp: 68,
    lp: 7000,
    res: [[96, 8, 7.5], [186, 11, 6], [240, 8, 2.5], [276, 8, 3], [385, 7, 2.5], [520, 5, 1.5], [800, 2, -2], [1500, 2.5, 1.5], [3000, 1.2, -2.5]],
    knock: 0.45,
    knockMs: 4,
    knockHz: 2400
  },
  // archtop: smaller, stiffer top — a nasal mid hump, little air boom (feeds the pickup through the top)
  [MODEL.HOLLOW]: {
    hp: 60,
    lp: 12000,
    res: [[128, 5, 3], [240, 6, 2.5], [520, 3, 3], [1050, 2.5, 1.5]],
    knock: 0.12,
    knockMs: 2,
    knockHz: 3000
  },
  // solid bodies barely move: a faint neck / body resonance
  [MODEL.SINGLE]: { hp: 30, lp: 16000, res: [[145, 4, 1], [310, 4, 0.6]], knock: 0, knockMs: 1, knockHz: 3000 },
  [MODEL.HUMBUCKER]: { hp: 30, lp: 16000, res: [[140, 4, 1.2], [300, 4, 0.6]], knock: 0, knockMs: 1, knockHz: 3000 }
}

const MAX_RES = 12
const DEFAULT_AMOUNT = 0.6

export class Body {
  private sr: number
  private hp: Biquad
  private lp: Biquad
  private res: Biquad[] = []
  private n = 0
  private spec: BodySpec = SPECS[MODEL.STEEL]
  private amount = DEFAULT_AMOUNT
  // knock
  private kEnv = 0
  private kDec = 0
  private kLp = 0
  private kC = 0
  private rnd: number

  constructor(sr: number, seed: number) {
    this.sr = sr
    this.hp = new Biquad(sr)
    this.lp = new Biquad(sr)
    for (let i = 0; i < MAX_RES; i++) this.res.push(new Biquad(sr))
    this.rnd = seed | 1
  }

  set(model: number, amount: number): void {
    const spec = (this.spec = SPECS[model] ?? SPECS[MODEL.STEEL])
    this.amount = amount
    // Body 0 → a flat, slightly thin pickup-like tone; the default → the modelled guitar; 1 → boomier
    const k = amount / DEFAULT_AMOUNT
    this.hp.set('hp', spec.hp * (1.6 - 0.6 * Math.min(1, k)), 0.7)
    this.lp.set('lp', spec.lp, 0.6)
    this.n = Math.min(MAX_RES, spec.res.length)
    for (let i = 0; i < this.n; i++) {
      const [f, q, db] = spec.res[i]
      this.res[i].set('peak', f, q, db * k)
    }
    this.kDec = Math.exp(-1 / ((spec.knockMs / 1000) * this.sr))
    this.kC = 1 - Math.exp((-2 * Math.PI * spec.knockHz) / this.sr)
  }

  /** The pluck knocks the top (vel 0..1). */
  knock(vel: number): void {
    const a = this.spec.knock * this.amount * (0.3 + 0.7 * vel) * 0.06
    if (a > this.kEnv) this.kEnv = a
  }

  reset(): void {
    this.hp.reset()
    this.lp.reset()
    for (const r of this.res) r.reset()
    this.kEnv = this.kLp = 0
  }

  process(x: number): number {
    if (this.kEnv > 1e-6) {
      let r = this.rnd
      r ^= r << 13
      r ^= r >>> 17
      r ^= r << 5
      this.rnd = r
      this.kLp += ((r >>> 0) / 2147483648 - 1 - this.kLp) * this.kC
      x += this.kLp * this.kEnv
      this.kEnv *= this.kDec
    }
    let y = this.hp.process(x)
    for (let i = 0; i < this.n; i++) y = this.res[i].process(y)
    return this.lp.process(y)
  }
}
