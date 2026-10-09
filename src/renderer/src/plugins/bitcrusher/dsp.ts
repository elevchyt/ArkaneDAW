import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Smoother } from '../fx-common/dsp-util'
import { manifest } from './manifest'

class BitcrusherDSP implements EffectDSP {
  private sr: number
  private primed = false
  private levels: Smoother
  private ratio = 0.25
  private ph = 1
  private hl = 0
  private hr = 0
  private out: Smoother
  private mix: Smoother

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.levels = new Smoother(this.sr, 128, 20)
    this.out = new Smoother(this.sr, 1, 20)
    this.mix = new Smoother(this.sr, 1, 20)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'bits': this.set(this.levels, Math.pow(2, Math.max(1, Math.min(16, v)) - 1)); break
      case 'rate': this.ratio = Math.min(1, v / this.sr); break
      case 'output': this.set(this.out, Math.pow(10, v / 20)); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  reset(): void {
    this.hl = this.hr = 0
    this.ph = 1
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      const q = this.levels.next()
      this.ph += this.ratio
      if (this.ph >= 1) {
        this.ph -= Math.floor(this.ph)
        // mid-tread quantiser (a 1-bit setting still passes sign information)
        this.hl = Math.round(l * q) / q
        this.hr = Math.round(r * q) / q
      }
      const o = this.out.next()
      const m = this.mix.next()
      outL[i] = l * (1 - m) + this.hl * o * m
      outR[i] = r * (1 - m) + this.hr * o * m
    }
  }
}

export default { id: 'bitcrusher', kind: 'effect', create: (ctx) => new BitcrusherDSP(ctx) } satisfies DSPFactory
