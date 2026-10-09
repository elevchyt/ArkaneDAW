import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Smoother, TAU, msCoef } from '../fx-common/dsp-util'
import { DIVISIONS } from '../fx-common/divisions'
import { manifest } from './manifest'

function wave(shape: number, ph: number): number {
  // unipolar 0..1
  switch (shape) {
    case 1: return 1 - 2 * Math.abs(ph - 0.5)
    case 2: return ph < 0.5 ? 1 : 0
    case 3: return 1 - ph
    case 4: return ph
    default: return 0.5 + 0.5 * Math.cos(TAU * ph)
  }
}

class TremoloDSP implements EffectDSP {
  private sr: number
  private primed = false
  private mode = 0
  private rate = 4
  private sync = true
  private div = 6
  private tempo = 120
  private shape = 0
  private phase = 0
  private sm = 0
  private wl = 1
  private wr = 1
  private depth: Smoother
  private stereo: Smoother

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.depth = new Smoother(this.sr, 0.6, 20)
    this.stereo = new Smoother(this.sr, 0, 20)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'mode': this.mode = Math.round(v); break
      case 'rate': this.rate = v; break
      case 'sync': this.sync = v >= 0.5; break
      case 'div': this.div = Math.round(v); break
      case 'tempo': if (v > 0) this.tempo = v; break
      case 'depth': this.set(this.depth, v); break
      case 'shape': this.shape = Math.round(v); break
      case 'smooth': this.sm = msCoef(0.3 + v * 25, this.sr); break
      case 'stereo': this.set(this.stereo, v); break
    }
  }

  reset(): void {
    this.phase = 0
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const hz = this.sync ? this.tempo / 60 / DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, this.div))].beats : this.rate
    const inc = hz / this.sr
    const sm = this.sm
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      this.phase += inc
      if (this.phase >= 1) this.phase -= 1
      const d = this.depth.next()
      let tl: number
      let tr: number
      if (this.mode === 1) {
        // auto-pan: -1..1 pan position, balance law with equal-power feel
        const p = (wave(this.shape, this.phase) * 2 - 1) * d
        tl = Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2
        tr = Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2
        if (tl > 1) tl = 1
        if (tr > 1) tr = 1
      } else {
        let pr = this.phase + this.stereo.next() * 0.5
        if (pr >= 1) pr -= 1
        tl = 1 - d * (1 - wave(this.shape, this.phase))
        tr = 1 - d * (1 - wave(this.shape, pr))
      }
      // smoothing removes clicks on square / saw edges
      this.wl = tl + (this.wl - tl) * sm
      this.wr = tr + (this.wr - tr) * sm
      outL[i] = l * this.wl
      outR[i] = r * this.wr
    }
  }
}

export default { id: 'tremolo', kind: 'effect', create: (ctx) => new TremoloDSP(ctx) } satisfies DSPFactory
