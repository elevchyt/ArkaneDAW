// Piano post stages (stereo, in-place, allocation-free): tone EQ (lid / pickup / cabinet voicing),
// tape (wow & flutter + saturation) and pedal mechanics noise.
import { Biquad } from '../sdk/dsp'
import { Noise, Reson } from '../mosaic/engines/common'

const TAU = Math.PI * 2

export interface ToneSettings {
  hp: number
  lowShelf: number
  midF: number
  midG: number
  cabG: number
  highShelf: number
  lp: number
  sat: number
}

/** HP → low shelf → mid peak → cabinet peak → lid high shelf → LP, then optional saturation. */
export class ToneStage {
  private l: Biquad[]
  private r: Biquad[]
  private sat = 0
  constructor(sr: number) {
    this.l = Array.from({ length: 6 }, () => new Biquad(sr))
    this.r = Array.from({ length: 6 }, () => new Biquad(sr))
  }
  set(t: ToneSettings): void {
    for (let c = 0; c < 2; c++) {
      const b = c === 0 ? this.l : this.r
      b[0].set('hp', t.hp, 0.7)
      b[1].set('lowshelf', 200, 0.7, t.lowShelf)
      b[2].set('peak', t.midF, 0.9, t.midG)
      b[3].set('peak', 190, 1.1, t.cabG)
      b[4].set('highshelf', 3000, 0.7, t.highShelf)
      b[5].set('lp', t.lp, 0.6)
    }
    this.sat = t.sat
  }
  reset(): void {
    for (const b of this.l) b.reset()
    for (const b of this.r) b.reset()
  }
  process(L: Float32Array, R: Float32Array, n: number): void {
    const [l0, l1, l2, l3, l4, l5] = this.l
    const [r0, r1, r2, r3, r4, r5] = this.r
    for (let i = 0; i < n; i++) {
      L[i] = l5.process(l4.process(l3.process(l2.process(l1.process(l0.process(L[i]))))))
      R[i] = r5.process(r4.process(r3.process(r2.process(r1.process(r0.process(R[i]))))))
    }
    const s = this.sat
    if (s > 0.01) {
      const d = 1 + s * 4
      const g = (1 + s * 0.5) / d
      for (let i = 0; i < n; i++) {
        L[i] = Math.tanh(L[i] * d) * g
        R[i] = Math.tanh(R[i] * d) * g
      }
    }
  }
}

/** Cassette transport: wow (slow), flutter (fast) and random drift as a modulated delay. */
export class TapeStage {
  private bl: Float32Array
  private br: Float32Array
  private mask: number
  private w = 0
  private phW = 0
  private phF = 0.3
  private drift = 0
  private driftTarget = 0
  private noise = new Noise(4242)
  private on = false
  constructor(private sr: number) {
    let size = 1
    while (size < sr * 0.03) size <<= 1
    this.bl = new Float32Array(size)
    this.br = new Float32Array(size)
    this.mask = size - 1
  }
  reset(): void {
    this.bl.fill(0)
    this.br.fill(0)
  }
  process(L: Float32Array, R: Float32Array, n: number, amt: number): void {
    if (amt <= 0.001) {
      if (this.on) {
        this.reset()
        this.on = false
      }
      return
    }
    this.on = true
    const sr = this.sr
    const base = 0.006 * sr
    const wowD = amt * 0.0032 * sr
    const flD = amt * 0.00008 * sr
    const incW = 0.55 / sr
    const incF = 6.3 / sr
    // slow random drift (control rate)
    if (Math.abs(this.drift - this.driftTarget) < 0.02) this.driftTarget = this.noise.next()
    const dStep = (this.driftTarget - this.drift) * Math.min(1, n / (sr * 0.8))
    const mask = this.mask
    const bl = this.bl
    const br = this.br
    let w = this.w
    let phW = this.phW
    let phF = this.phF
    let drift = this.drift
    const dInc = dStep / n
    for (let i = 0; i < n; i++) {
      bl[w] = L[i]
      br[w] = R[i]
      const d = base + wowD * (Math.sin(TAU * phW) * 0.7 + drift * 0.6) + flD * Math.sin(TAU * phF)
      const di = d | 0
      const f = d - di
      const i0 = (w - di) & mask
      const i1 = (w - di - 1) & mask
      L[i] = bl[i0] + (bl[i1] - bl[i0]) * f
      R[i] = br[i0] + (br[i1] - br[i0]) * f
      w = (w + 1) & mask
      phW += incW
      if (phW >= 1) phW -= 1
      phF += incF
      if (phF >= 1) phF -= 1
      drift += dInc
    }
    this.w = w
    this.phW = phW
    this.phF = phF
    this.drift = drift
  }
}

/** Sustain pedal mechanics: felt thud when pressed, thump + damper "shh" when lifted. ADDs. */
export class PedalNoise {
  private noise = new Noise(777)
  private thump = new Reson()
  private hiss = new Reson()
  private tEnv = 0
  private tDec = 0
  private tLvl = 0
  private hEnv = 0
  private hDec = 0
  private hLvl = 0
  constructor(private sr: number) {}
  down(amt: number): void {
    const sr = this.sr
    this.thump.set(58, 30, sr)
    this.tLvl = amt * 1.1
    this.tEnv = 1
    this.tDec = Math.exp(-1 / (sr * 0.05))
    this.hiss.set(1100, 1400, sr)
    this.hLvl = amt * 0.05
    this.hEnv = 1
    this.hDec = Math.exp(-1 / (sr * 0.04))
  }
  up(amt: number): void {
    const sr = this.sr
    this.thump.set(90, 45, sr)
    this.tLvl = amt * 0.8
    this.tEnv = 1
    this.tDec = Math.exp(-1 / (sr * 0.04))
    this.hiss.set(2400, 2600, sr)
    this.hLvl = amt * 0.09
    this.hEnv = 1
    this.hDec = Math.exp(-1 / (sr * 0.11))
  }
  get active(): boolean {
    return this.tEnv > 1e-4 || this.hEnv > 1e-4
  }
  reset(): void {
    this.tEnv = this.hEnv = 0
    this.thump.reset()
    this.hiss.reset()
  }
  process(L: Float32Array, R: Float32Array, n: number): void {
    if (!this.active) return
    for (let i = 0; i < n; i++) {
      const w = this.noise.next()
      const s = this.thump.process(w) * this.tEnv * this.tLvl + this.hiss.process(w) * this.hEnv * this.hLvl
      this.tEnv *= this.tDec
      this.hEnv *= this.hDec
      L[i] += s
      R[i] += s
    }
  }
}
