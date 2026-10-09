import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Biquad, Smoother, UiLink, msCoef } from '../fx-common/dsp-util'
import { compGain } from '../fx-common/dynamics'
import { manifest } from './manifest'

const Q = 0.7071067811865476
const KNEE = 6

/** Linkwitz-Riley 4th-order split for one channel: two cascaded Butterworth LP and HP sections. */
class LR4 {
  lp1: Biquad
  lp2: Biquad
  hp1: Biquad
  hp2: Biquad
  constructor(sr: number) {
    this.lp1 = new Biquad(sr)
    this.lp2 = new Biquad(sr)
    this.hp1 = new Biquad(sr)
    this.hp2 = new Biquad(sr)
  }
  set(f: number): void {
    this.lp1.set('lp', f, Q)
    this.lp2.set('lp', f, Q)
    this.hp1.set('hp', f, Q)
    this.hp2.set('hp', f, Q)
  }
  lo = 0
  hi = 0
  split(x: number): void {
    this.lo = this.lp2.process(this.lp1.process(x))
    this.hi = this.hp2.process(this.hp1.process(x))
  }
  reset(): void {
    this.lp1.reset()
    this.lp2.reset()
    this.hp1.reset()
    this.hp2.reset()
  }
}

class Band {
  thr = -20
  ratio = 3
  gain: Smoother
  ms = 0
  env = 0
  mGr = 0
  constructor(sr: number) {
    this.gain = new Smoother(sr, 1, 30)
  }
}

class MultibandDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private primed = false
  private x1L: LR4
  private x1R: LR4
  private x2L: LR4
  private x2R: LR4
  private apL: Biquad // keeps the low band phase-aligned with mid+high
  private apR: Biquad
  private bands: Band[]
  private aCoef = 0
  private rCoef = 0
  private rmsCoef: number
  private out: Smoother
  private mix: Smoother
  private ui: UiLink
  private xlow = 200
  private xhigh = 2500

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.x1L = new LR4(this.sr)
    this.x1R = new LR4(this.sr)
    this.x2L = new LR4(this.sr)
    this.x2R = new LR4(this.sr)
    this.apL = new Biquad(this.sr)
    this.apR = new Biquad(this.sr)
    this.bands = [new Band(this.sr), new Band(this.sr), new Band(this.sr)]
    this.rmsCoef = msCoef(5, this.sr)
    this.out = new Smoother(this.sr, 1, 20)
    this.mix = new Smoother(this.sr, 1, 20)
    this.ui = new UiLink(this.sr, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  private updateX(): void {
    const lo = Math.min(this.xlow, this.xhigh * 0.7)
    this.x1L.set(lo)
    this.x1R.set(lo)
    this.x2L.set(this.xhigh)
    this.x2R.set(this.xhigh)
    this.apL.set('ap', this.xhigh, Q)
    this.apR.set('ap', this.xhigh, Q)
  }

  setParam(id: string, v: number): void {
    const dot = id.indexOf('.')
    if (dot > 0) {
      const b = this.bands[['low', 'mid', 'high'].indexOf(id.slice(0, dot))]
      if (!b) return
      const k = id.slice(dot + 1)
      if (k === 'thr') b.thr = v
      else if (k === 'ratio') b.ratio = Math.max(1, v)
      else if (k === 'gain') this.set(b.gain, Math.pow(10, v / 20))
      return
    }
    switch (id) {
      case 'xlow': this.xlow = v; this.updateX(); break
      case 'xhigh': this.xhigh = v; this.updateX(); break
      case 'attack': this.aCoef = msCoef(v, this.sr); break
      case 'release': this.rCoef = msCoef(v, this.sr); break
      case 'output': this.set(this.out, Math.pow(10, v / 20)); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.x1L.reset()
    this.x1R.reset()
    this.x2L.reset()
    this.x2R.reset()
    this.apL.reset()
    this.apR.reset()
    for (const b of this.bands) {
      b.ms = 0
      b.env = 0
    }
  }

  private comp(b: Band, l: number, r: number): number {
    const p = (l * l + r * r) * 0.5
    b.ms = p + (b.ms - p) * this.rmsCoef
    if (b.ms < 1e-20) b.ms = 0
    const lvl = 10 * Math.log10(b.ms + 1e-20) + 3.0103
    const t = compGain(lvl, b.thr, b.ratio, KNEE)
    b.env = t < b.env ? t + (b.env - t) * this.aCoef : t + (b.env - t) * this.rCoef
    if (b.env < b.mGr) b.mGr = b.env
    return Math.pow(10, b.env / 20) * b.gain.next()
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const [B0, B1, B2] = this.bands
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      this.x1L.split(l)
      this.x1R.split(r)
      const lowL = this.apL.process(this.x1L.lo)
      const lowR = this.apR.process(this.x1R.lo)
      this.x2L.split(this.x1L.hi)
      this.x2R.split(this.x1R.hi)
      const midL = this.x2L.lo
      const midR = this.x2R.lo
      const hiL = this.x2L.hi
      const hiR = this.x2R.hi
      const g0 = this.comp(B0, lowL, lowR)
      const g1 = this.comp(B1, midL, midR)
      const g2 = this.comp(B2, hiL, hiR)
      const o = this.out.next()
      const m = this.mix.next()
      const wl = (lowL * g0 + midL * g1 + hiL * g2) * o
      const wr = (lowR * g0 + midR * g1 + hiR * g2) * o
      outL[i] = l * (1 - m) + wl * m
      outR[i] = r * (1 - m) + wr * m
    }
    if (this.ui.tick(end - start)) {
      this.post({ gr: [B0.mGr, B1.mGr, B2.mGr] })
      B0.mGr = B1.mGr = B2.mGr = 0
    }
  }
}

export default { id: 'multiband', kind: 'effect', create: (ctx) => new MultibandDSP(ctx) } satisfies DSPFactory
