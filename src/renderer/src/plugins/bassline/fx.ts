// Output strip: 3-band EQ (low shelf / mid peak / high shelf) -> "punch" compressor -> stereo chorus on the
// band above ~120 Hz only (the low end stays mono) -> soft ceiling. Allocation-free per sample.
import { Biquad } from '../sdk/dsp'
import { sin1 } from './filters'

export class OutputFX {
  private lowL: Biquad
  private lowR: Biquad
  private midL: Biquad
  private midR: Biquad
  private hiL: Biquad
  private hiR: Biquad
  private xL: Biquad
  private xR: Biquad
  private eqOn = false
  private env = 0
  private atk: number
  private rel: number
  private thr = 1
  private makeup = 1
  private punch = 0
  private chorus = 0
  private chRate = 0.7
  private chPh = 0
  private dl: Float32Array
  private dmask: number
  private dw = 0
  private sr: number
  constructor(sr: number) {
    this.sr = sr
    this.lowL = new Biquad(sr)
    this.lowR = new Biquad(sr)
    this.midL = new Biquad(sr)
    this.midR = new Biquad(sr)
    this.hiL = new Biquad(sr)
    this.hiR = new Biquad(sr)
    this.xL = new Biquad(sr)
    this.xR = new Biquad(sr)
    this.xL.set('lp', 120, 0.707)
    this.xR.set('lp', 120, 0.707)
    this.atk = Math.exp(-1 / (0.006 * sr))
    this.rel = Math.exp(-1 / (0.12 * sr))
    let n = 1
    while (n < sr * 0.04) n <<= 1
    this.dl = new Float32Array(n)
    this.dmask = n - 1
    this.setEQ(0, 0, 0)
  }

  setEQ(low: number, mid: number, high: number): void {
    this.lowL.set('lowshelf', 90, 0.7, low)
    this.lowR.set('lowshelf', 90, 0.7, low)
    this.midL.set('peak', 650, 0.8, mid)
    this.midR.set('peak', 650, 0.8, mid)
    this.hiL.set('highshelf', 3200, 0.7, high)
    this.hiR.set('highshelf', 3200, 0.7, high)
    this.eqOn = Math.abs(low) > 0.05 || Math.abs(mid) > 0.05 || Math.abs(high) > 0.05
  }

  setDyn(punch: number, chorus: number, chRate: number): void {
    this.punch = punch
    // threshold falls from -4 dB to -22 dB; makeup partially restores level
    this.thr = Math.pow(10, (-4 - 18 * punch) / 20)
    this.makeup = Math.pow(10, (punch * 6) / 20)
    this.chorus = chorus
    this.chRate = chRate
  }

  reset(): void {
    this.lowL.reset(); this.lowR.reset(); this.midL.reset(); this.midR.reset(); this.hiL.reset(); this.hiR.reset()
    this.xL.reset(); this.xR.reset()
    this.env = 0
    this.dl.fill(0)
  }

  process(L: Float32Array, R: Float32Array, start: number, end: number): void {
    const eq = this.eqOn
    const punch = this.punch
    const chorus = this.chorus
    const dl = this.dl
    const mask = this.dmask
    const base = 0.009 * this.sr
    const depth = 0.0035 * this.sr
    const phInc = this.chRate / this.sr
    for (let i = start; i < end; i++) {
      let l = L[i]
      let r = R[i]
      if (eq) {
        l = this.hiL.process(this.midL.process(this.lowL.process(l)))
        r = this.hiR.process(this.midR.process(this.lowR.process(r)))
      }
      if (punch > 0.001) {
        const al = l < 0 ? -l : l
        const ar = r < 0 ? -r : r
        const det = al > ar ? al : ar
        this.env = det > this.env ? det + (this.env - det) * this.atk : det + (this.env - det) * this.rel
        let g = this.makeup
        if (this.env > this.thr) g *= Math.pow(this.thr / this.env, 0.7)
        l *= g
        r *= g
      }
      if (chorus > 0.001) {
        const lowl = this.xL.process(l)
        const lowr = this.xR.process(r)
        const lowM = (lowl + lowr) * 0.5
        const hl = l - lowl
        const hr = r - lowr
        dl[this.dw] = (hl + hr) * 0.5
        this.dw = (this.dw + 1) & mask
        this.chPh += phInc
        if (this.chPh >= 1) this.chPh -= 1
        const wl = this.tap(base + depth * sin1(this.chPh))
        const wr = this.tap(base + depth * sin1(this.chPh + 0.25))
        l = lowM + hl * (1 - 0.35 * chorus) + wl * chorus
        r = lowM + hr * (1 - 0.35 * chorus) + wr * chorus
      }
      // soft ceiling: transparent below 1.0, asymptotic to 1.5
      L[i] = ceil(l)
      R[i] = ceil(r)
    }
    void mask
  }

  private tap(d: number): number {
    const di = d | 0
    const f = d - di
    const a = this.dl[(this.dw - 1 - di) & this.dmask]
    const b = this.dl[(this.dw - 2 - di) & this.dmask]
    return a + (b - a) * f
  }
}

function ceil(x: number): number {
  if (x > 1) {
    const e = x - 1
    return 1 + e / (1 + 2 * e)
  }
  if (x < -1) {
    const e = -x - 1
    return -1 - e / (1 + 2 * e)
  }
  return x
}
