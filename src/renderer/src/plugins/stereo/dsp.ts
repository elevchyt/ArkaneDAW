import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Biquad, Smoother, UiLink } from '../fx-common/dsp-util'
import { manifest } from './manifest'

const SCOPE = 256

class StereoDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private primed = false
  private width: Smoother
  private gl: Smoother
  private gr: Smoother
  private pan = 0
  private gain = 1
  private swap = false
  private invL = false
  private invR = false
  private bassOn = false
  private hp1: Biquad
  private hp2: Biquad
  private ui: UiLink
  private scope = new Float32Array(SCOPE * 2)
  private sp = 0
  private dec = 0
  private sLR = 0
  private sLL = 0
  private sRR = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.width = new Smoother(this.sr, 1, 20)
    this.gl = new Smoother(this.sr, 1, 20)
    this.gr = new Smoother(this.sr, 1, 20)
    this.hp1 = new Biquad(this.sr)
    this.hp2 = new Biquad(this.sr)
    this.ui = new UiLink(this.sr, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  private updateGains(): void {
    // balance-style pan (FL mixer behaviour): the far channel is attenuated
    const p = this.pan
    const l = (p > 0 ? 1 - p : 1) * this.gain * (this.invL ? -1 : 1)
    const r = (p < 0 ? 1 + p : 1) * this.gain * (this.invR ? -1 : 1)
    this.set(this.gl, l)
    this.set(this.gr, r)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'width': this.set(this.width, Math.max(0, v) / 100); break
      case 'pan': this.pan = Math.max(-1, Math.min(1, v / 100)); this.updateGains(); break
      case 'gain': this.gain = Math.pow(10, v / 20); this.updateGains(); break
      case 'swap': this.swap = v >= 0.5; break
      case 'invL': this.invL = v >= 0.5; this.updateGains(); break
      case 'invR': this.invR = v >= 0.5; this.updateGains(); break
      case 'monoBass':
        this.bassOn = v >= 20
        if (this.bassOn) {
          this.hp1.set('hp', v, 0.7071)
          this.hp2.set('hp', v, 0.7071)
        } else {
          this.hp1.reset()
          this.hp2.reset()
        }
        break
    }
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.hp1.reset()
    this.hp2.reset()
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const scope = this.ui.active
    for (let i = start; i < end; i++) {
      let l = inL[i]
      let r = inR[i]
      if (this.swap) {
        const t = l
        l = r
        r = t
      }
      const m = (l + r) * 0.5
      let s = (l - r) * 0.5
      if (this.bassOn) s = this.hp2.process(this.hp1.process(s))
      s *= this.width.next()
      const ol = (m + s) * this.gl.next()
      const or = (m - s) * this.gr.next()
      outL[i] = ol
      outR[i] = or
      if (scope) {
        this.sLR += ol * or
        this.sLL += ol * ol
        this.sRR += or * or
        if (++this.dec >= 3) {
          this.dec = 0
          this.scope[this.sp++] = ol
          this.scope[this.sp++] = or
          if (this.sp >= this.scope.length) this.sp = 0
        }
      }
    }
    if (this.ui.tick(end - start)) {
      const den = Math.sqrt(this.sLL * this.sRR)
      this.post({ scope: this.scope, pos: this.sp, corr: den > 1e-12 ? this.sLR / den : 0 })
      this.sLR = this.sLL = this.sRR = 0
    }
  }
}

export default { id: 'stereo', kind: 'effect', create: (ctx) => new StereoDSP(ctx) } satisfies DSPFactory
