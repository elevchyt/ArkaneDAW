import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Biquad, DelayLine, Smoother, dryGain, flush, softClip, wetGain } from '../fx-common/dsp-util'
import { divisionMs } from '../fx-common/divisions'
import { MAX_DELAY_S, manifest } from './manifest'

class DelayDSP implements EffectDSP {
  private sr: number
  private primed = false
  private mode = 1
  private sync = true
  private div = 0
  private timeMs = 350
  private tempo = 120
  private dL: DelayLine
  private dR: DelayLine
  private time: Smoother
  private fb: Smoother
  private mix: Smoother
  private lcL: Biquad
  private lcR: Biquad
  private hcL: Biquad
  private hcR: Biquad

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    const max = Math.ceil(MAX_DELAY_S * this.sr) + 8
    this.dL = new DelayLine(max)
    this.dR = new DelayLine(max)
    this.time = new Smoother(this.sr, 1000, 120)
    this.fb = new Smoother(this.sr, 0.45, 20)
    this.mix = new Smoother(this.sr, 0.35, 20)
    this.lcL = new Biquad(this.sr)
    this.lcR = new Biquad(this.sr)
    this.hcL = new Biquad(this.sr)
    this.hcR = new Biquad(this.sr)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private updateTime(): void {
    const ms = this.sync ? divisionMs(this.div, this.tempo) : this.timeMs
    const s = Math.max(1, Math.min(MAX_DELAY_S * this.sr, (ms / 1000) * this.sr))
    if (this.primed) this.time.set(s)
    else this.time.jump(s)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'mode': this.mode = Math.round(v); break
      case 'sync': this.sync = v >= 0.5; this.updateTime(); break
      case 'div': this.div = Math.round(v); this.updateTime(); break
      case 'time': this.timeMs = v; this.updateTime(); break
      case 'tempo': if (v > 0) { this.tempo = v; this.updateTime() } break
      case 'feedback': this.set(this.fb, Math.max(0, Math.min(1, v))); break
      case 'lowcut': this.lcL.set('hp', v, 0.707); this.lcR.set('hp', v, 0.707); break
      case 'highcut': this.hcL.set('lp', v, 0.707); this.hcR.set('lp', v, 0.707); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  reset(): void {
    this.dL.clear()
    this.dR.clear()
    this.lcL.reset()
    this.lcR.reset()
    this.hcL.reset()
    this.hcR.reset()
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const mode = this.mode
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      const t = this.time.next()
      const fb = this.fb.next()
      const mx = this.mix.next()
      const yl = this.dL.read(t)
      const yr = mode === 2 ? yl : this.dR.read(t)
      // feedback path: filters + gentle saturation keeps even 100% feedback bounded
      const fl = softClip(this.hcL.process(this.lcL.process(yl)) * fb)
      const fr = mode === 2 ? fl : softClip(this.hcR.process(this.lcR.process(yr)) * fb)
      if (mode === 0) {
        this.dL.write(flush(l + fl))
        this.dR.write(flush(r + fr))
      } else if (mode === 1) {
        this.dL.write(flush((l + r) * 0.5 + fr))
        this.dR.write(flush(fl))
      } else {
        this.dL.write(flush((l + r) * 0.5 + fl))
      }
      const dg = dryGain(mx)
      const wg = wetGain(mx)
      outL[i] = l * dg + yl * wg
      outR[i] = r * dg + yr * wg
    }
  }
}

export default { id: 'delay', kind: 'effect', create: (ctx) => new DelayDSP(ctx) } satisfies DSPFactory
