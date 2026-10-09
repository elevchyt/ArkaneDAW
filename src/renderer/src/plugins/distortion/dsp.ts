import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Biquad, DCBlocker, Oversampler4x, Smoother } from '../fx-common/dsp-util'
import { driveComp, manifest, shape } from './manifest'

const LAT = Oversampler4x.LATENCY

class DistortionDSP implements EffectDSP {
  private sr: number
  private primed = false
  private mode = 0
  private osL = new Oversampler4x()
  private osR = new Oversampler4x()
  private dcL: DCBlocker
  private dcR: DCBlocker
  private toneL: Biquad
  private toneR: Biquad
  private drive: Smoother
  private out: Smoother
  private mix: Smoother
  private g = 1 // current drive gain (read by the shaper closure)
  private fn: (v: number) => number
  // dry delay lines (latency compensation for the mix)
  private dryL = new Float32Array(LAT + 1)
  private dryR = new Float32Array(LAT + 1)
  private dw = 0
  private driveDb = 12
  private outDb = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.dcL = new DCBlocker(this.sr, 8)
    this.dcR = new DCBlocker(this.sr, 8)
    this.toneL = new Biquad(this.sr)
    this.toneR = new Biquad(this.sr)
    this.drive = new Smoother(this.sr, 4, 30)
    this.out = new Smoother(this.sr, 1, 30)
    this.mix = new Smoother(this.sr, 1, 30)
    this.fn = (v: number) => shape(this.mode, v * this.g)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  private updateOut(): void {
    this.set(this.out, Math.pow(10, (this.outDb + driveComp(this.driveDb)) / 20))
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'mode': this.mode = Math.round(v); break
      case 'drive':
        this.driveDb = v
        this.set(this.drive, Math.pow(10, v / 20))
        this.updateOut()
        break
      case 'tone': this.toneL.set('lp', v, 0.707); this.toneR.set('lp', v, 0.707); break
      case 'output': this.outDb = v; this.updateOut(); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  reset(): void {
    this.osL.reset()
    this.osR.reset()
    this.dcL.reset()
    this.dcR.reset()
    this.toneL.reset()
    this.toneR.reset()
    this.dryL.fill(0)
    this.dryR.fill(0)
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const n = this.dryL.length
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      this.g = this.drive.next()
      const o = this.out.next()
      const m = this.mix.next()
      let wl = this.osL.process(l, this.fn)
      let wr = this.osR.process(r, this.fn)
      wl = this.toneL.process(this.dcL.process(wl)) * o
      wr = this.toneR.process(this.dcR.process(wr)) * o
      // dry delayed by the oversampler latency so partial mixes don't comb-filter
      this.dryL[this.dw] = l
      this.dryR[this.dw] = r
      const rd = (this.dw + 1) % n // oldest = LAT samples ago
      this.dw = rd
      outL[i] = this.dryL[rd] * (1 - m) + wl * m
      outR[i] = this.dryR[rd] * (1 - m) + wr * m
    }
  }
}

export default { id: 'distortion', kind: 'effect', create: (ctx) => new DistortionDSP(ctx) } satisfies DSPFactory
