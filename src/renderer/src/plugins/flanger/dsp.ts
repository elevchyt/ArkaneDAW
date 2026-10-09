import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { ModDelay, Smoother, flush, softClip } from '../fx-common/dsp-util'
import { manifest } from './manifest'

/** Triangle 0..1 */
const tri = (ph: number): number => (ph < 0.5 ? 2 * ph : 2 - 2 * ph)

class FlangerDSP implements EffectDSP {
  private sr: number
  private primed = false
  private dl: ModDelay
  private dr: ModDelay
  private lastL = 0
  private lastR = 0
  private phase = 0
  private rate = 0.25
  private depth: Smoother
  private manual: Smoother
  private fb: Smoother
  private stereo: Smoother
  private mix: Smoother

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    const max = Math.ceil(0.1 * this.sr)
    this.dl = new ModDelay(max)
    this.dr = new ModDelay(max)
    this.depth = new Smoother(this.sr, 0.7, 40)
    this.manual = new Smoother(this.sr, 0, 60)
    this.fb = new Smoother(this.sr, 0.6, 30)
    this.stereo = new Smoother(this.sr, 0.25, 40)
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
      case 'manual': this.set(this.manual, Math.log2(Math.max(0.05, v))); break
      case 'feedback': this.set(this.fb, Math.max(-0.95, Math.min(0.95, v))); break
      case 'stereo': this.set(this.stereo, v); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  reset(): void {
    this.dl.clear()
    this.dr.clear()
    this.lastL = this.lastR = 0
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const inc = this.rate / this.sr
    const msS = this.sr / 1000
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      this.phase += inc
      if (this.phase >= 1) this.phase -= 1
      const d = this.depth.next() * 3 // sweep range in octaves of delay time
      const man = this.manual.next()
      const st = this.stereo.next()
      const fb = this.fb.next()
      let pr = this.phase + st * 0.5
      if (pr >= 1) pr -= 1
      const tl = Math.pow(2, man + d * tri(this.phase)) * msS
      const tr = Math.pow(2, man + d * tri(pr)) * msS
      this.dl.write(flush(l + fb * this.lastL))
      this.dr.write(flush(r + fb * this.lastR))
      const yl = this.dl.read(tl)
      const yr = this.dr.read(tr)
      this.lastL = softClip(yl)
      this.lastR = softClip(yr)
      const m = this.mix.next()
      outL[i] = l * (1 - m) + yl * m
      outR[i] = r * (1 - m) + yr * m
    }
  }
}

export default { id: 'flanger', kind: 'effect', create: (ctx) => new FlangerDSP(ctx) } satisfies DSPFactory
