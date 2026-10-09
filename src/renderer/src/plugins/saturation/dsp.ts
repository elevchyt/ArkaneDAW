import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Biquad, DCBlocker, OnePole, Oversampler4x, Smoother, UiLink, flush, gainToDb, msCoef } from '../fx-common/dsp-util'
import { manifest, satCurve } from './manifest'

const LAT = Oversampler4x.LATENCY

class Channel {
  os = new Oversampler4x()
  dc: DCBlocker
  tilt: OnePole
  bump: Biquad
  roll: Biquad
  mem = 0 // tape "hysteresis" memory (lagged output)
  dry = new Float32Array(LAT + 1)
  fn: (x: number) => number
  constructor(sr: number, owner: SaturationDSP) {
    this.dc = new DCBlocker(sr, 6)
    this.tilt = new OnePole(sr, 900)
    this.bump = new Biquad(sr)
    this.roll = new Biquad(sr)
    this.bump.set('peak', 90, 0.8, 1.5)
    this.fn = (x: number) => {
      const v = x * owner.g
      if (owner.mode === 0) {
        // tape: the curve sees a little of its own recent past -> soft, level-dependent smear
        const y = satCurve(0, v - 0.18 * this.mem, owner.asym)
        this.mem = flush(this.mem + (y - this.mem) * 0.12)
        return y
      }
      return satCurve(owner.mode, v, owner.asym)
    }
  }
  reset(): void {
    this.os.reset()
    this.dc.reset()
    this.tilt.reset()
    this.bump.reset()
    this.roll.reset()
    this.mem = 0
    this.dry.fill(0)
  }
}

class SaturationDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private primed = false
  mode = 0
  asym = 0.3
  g = 1
  private L: Channel
  private R: Channel
  private drive: Smoother
  private bias: Smoother
  private tiltS: Smoother
  private out: Smoother
  private mix: Smoother
  private auto = true
  private autoG: Smoother
  private msIn = 0
  private msOut = 0
  private rmsCoef: number
  private dw = 0
  private ui: UiLink
  private mIn = 0
  private mOut = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.L = new Channel(this.sr, this)
    this.R = new Channel(this.sr, this)
    this.drive = new Smoother(this.sr, 1, 30)
    this.bias = new Smoother(this.sr, 0.3, 30)
    this.tiltS = new Smoother(this.sr, 0, 30)
    this.out = new Smoother(this.sr, 1, 30)
    this.mix = new Smoother(this.sr, 1, 30)
    this.autoG = new Smoother(this.sr, 1, 150)
    this.rmsCoef = msCoef(300, this.sr)
    this.ui = new UiLink(this.sr, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  private updateRoll(driveDb: number): void {
    // tape loses a little top end as it is pushed harder
    const f = 20000 - driveDb * 250
    this.L.roll.set('lp', f, 0.6)
    this.R.roll.set('lp', f, 0.6)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'mode': this.mode = Math.round(v); break
      case 'drive': this.set(this.drive, Math.pow(10, v / 20)); this.updateRoll(v); break
      case 'tone': this.set(this.tiltS, v); break
      case 'bias': this.set(this.bias, v); break
      case 'output': this.set(this.out, Math.pow(10, v / 20)); break
      case 'auto': this.auto = v >= 0.5; break
      case 'mix': this.set(this.mix, v); break
    }
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.L.reset()
    this.R.reset()
    this.msIn = this.msOut = 0
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const L = this.L
    const R = this.R
    const n = L.dry.length
    const tape = this.mode === 0
    let mIn = this.mIn, mOut = this.mOut
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      this.g = this.drive.next()
      this.asym = this.bias.next()
      const tilt = this.tiltS.next()
      let wl = L.dc.process(L.os.process(l, L.fn))
      let wr = R.dc.process(R.os.process(r, R.fn))
      if (tape) {
        wl = L.roll.process(L.bump.process(wl))
        wr = R.roll.process(R.bump.process(wr))
      }
      // tilt EQ around ~900 Hz (+-6 dB at the extremes)
      const gh = Math.pow(2, tilt) // +-6 dB
      const lowL = L.tilt.lp(wl)
      const lowR = R.tilt.lp(wr)
      wl = lowL / gh + (wl - lowL) * gh
      wr = lowR / gh + (wr - lowR) * gh
      // delayed dry (oversampler latency)
      L.dry[this.dw] = l
      R.dry[this.dw] = r
      const rd = (this.dw + 1) % n
      this.dw = rd
      const dl = L.dry[rd]
      const dr = R.dry[rd]
      // auto gain: match wet RMS to (latency-aligned) input RMS
      const c = this.rmsCoef
      this.msIn = (dl * dl + dr * dr) * 0.5 + (this.msIn - (dl * dl + dr * dr) * 0.5) * c
      this.msOut = (wl * wl + wr * wr) * 0.5 + (this.msOut - (wl * wl + wr * wr) * 0.5) * c
      if (this.auto) {
        if (this.msIn > 1e-9 && this.msOut > 1e-12) {
          let ag = Math.sqrt(this.msIn / this.msOut)
          if (ag > 2) ag = 2
          else if (ag < 0.06) ag = 0.06
          this.autoG.set(ag)
        }
      } else this.autoG.set(1)
      const g = this.autoG.next() * this.out.next()
      const m = this.mix.next()
      const ol = dl * (1 - m) + wl * g * m
      const or = dr * (1 - m) + wr * g * m
      outL[i] = ol
      outR[i] = or
      const ia = Math.max(Math.abs(l), Math.abs(r))
      if (ia > mIn) mIn = ia
      const oa = Math.max(Math.abs(ol), Math.abs(or))
      if (oa > mOut) mOut = oa
    }
    if (this.ui.tick(end - start)) {
      this.post({ inDb: gainToDb(mIn), outDb: gainToDb(mOut) })
      mIn = mOut = 0
    }
    this.mIn = mIn
    this.mOut = mOut
  }
}

export default { id: 'saturation', kind: 'effect', create: (ctx) => new SaturationDSP(ctx) } satisfies DSPFactory
