import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Smoother, TAU, flush, softClip } from '../fx-common/dsp-util'
import { STAGES, manifest } from './manifest'

const MAXS = 12

class PhaserDSP implements EffectDSP {
  private sr: number
  private primed = false
  private sL = new Float64Array(MAXS)
  private sR = new Float64Array(MAXS)
  private lastL = 0
  private lastR = 0
  private phase = 0
  private rate = 0.4
  private stages = 6
  private depth: Smoother
  private freq: Smoother
  private fb: Smoother
  private stereo: Smoother
  private mix: Smoother

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.depth = new Smoother(this.sr, 0.7, 40)
    this.freq = new Smoother(this.sr, 700, 40)
    this.fb = new Smoother(this.sr, 0.5, 30)
    this.stereo = new Smoother(this.sr, 0.5, 40)
    this.mix = new Smoother(this.sr, 0.5, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'rate': this.rate = v; break
      case 'depth': this.set(this.depth, v); break
      case 'freq': this.set(this.freq, Math.log2(v)); break
      case 'feedback': this.set(this.fb, Math.max(-0.95, Math.min(0.95, v))); break
      case 'stages': this.stages = STAGES[Math.max(0, Math.min(STAGES.length - 1, Math.round(v)))]; break
      case 'stereo': this.set(this.stereo, v); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  reset(): void {
    this.sL.fill(0)
    this.sR.fill(0)
    this.lastL = this.lastR = 0
  }

  private coef(lf: number): number {
    let f = Math.pow(2, lf)
    const max = this.sr * 0.45
    if (f > max) f = max
    else if (f < 20) f = 20
    const t = Math.tan((Math.PI * f) / this.sr)
    return (t - 1) / (t + 1)
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const inc = this.rate / this.sr
    const S = this.stages
    const sL = this.sL
    const sR = this.sR
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      this.phase += inc
      if (this.phase >= 1) this.phase -= 1
      const depth = this.depth.next() * 3 // octaves either side
      const lf = this.freq.next()
      const fb = this.fb.next()
      const st = this.stereo.next()
      const aL = this.coef(lf + depth * Math.sin(TAU * this.phase))
      const aR = this.coef(lf + depth * Math.sin(TAU * (this.phase + st * 0.5)))
      let xl = l + fb * this.lastL
      let xr = r + fb * this.lastR
      for (let k = 0; k < S; k++) {
        const yl = aL * xl + sL[k]
        sL[k] = flush(xl - aL * yl)
        xl = yl
        const yr = aR * xr + sR[k]
        sR[k] = flush(xr - aR * yr)
        xr = yr
      }
      // soft-limit the loop so extreme feedback stays well-behaved
      this.lastL = softClip(xl)
      this.lastR = softClip(xr)
      const m = this.mix.next()
      outL[i] = l * (1 - m) + xl * m
      outR[i] = r * (1 - m) + xr * m
    }
  }
}

export default { id: 'phaser', kind: 'effect', create: (ctx) => new PhaserDSP(ctx) } satisfies DSPFactory
