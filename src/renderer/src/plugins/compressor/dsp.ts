import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Smoother, UiLink, gainToDb, msCoef } from '../fx-common/dsp-util'
import { autoMakeup, compGain, manifest } from './manifest'

class CompressorDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private primed = false
  private thr = -18
  private ratio = 4
  private knee = 6
  private makeupDb = 0
  private auto = true
  private rms = true
  private sc = false
  private aCoef = 0
  private rCoef = 0
  private rmsCoef: number
  private ms = 0
  private env = 0 // gain change in dB (<= 0)
  private makeup: Smoother
  private mix: Smoother
  private ui: UiLink
  private mGr = 0
  private mIn = 0
  private mOut = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.makeup = new Smoother(this.sr, 1, 30)
    this.mix = new Smoother(this.sr, 1, 20)
    this.rmsCoef = msCoef(8, this.sr)
    this.ui = new UiLink(this.sr, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private updateMakeup(): void {
    const db = this.makeupDb + (this.auto ? autoMakeup(this.thr, this.ratio, this.knee) : 0)
    const g = Math.pow(10, db / 20)
    if (this.primed) this.makeup.set(g)
    else this.makeup.jump(g)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'threshold': this.thr = v; break
      case 'ratio': this.ratio = Math.max(1, v); break
      case 'knee': this.knee = Math.max(0, v); break
      case 'makeup': this.makeupDb = v; break
      case 'auto': this.auto = v >= 0.5; break
      case 'attack': this.aCoef = msCoef(v, this.sr); return
      case 'release': this.rCoef = msCoef(v, this.sr); return
      case 'detector': this.rms = Math.round(v) === 1; return
      case 'sidechain': this.sc = v >= 0.5; return
      case 'mix':
        if (this.primed) this.mix.set(v)
        else this.mix.jump(v)
        return
      default: return
    }
    this.updateMakeup()
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.ms = 0
    this.env = 0
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number, scL?: Float32Array, scR?: Float32Array): void {
    this.primed = true
    const useSc = this.sc && scL && scR
    const dL = useSc ? scL! : inL
    const dR = useSc ? scR! : inR
    const { thr, ratio, knee, aCoef, rCoef, rmsCoef } = this
    let ms = this.ms
    let env = this.env
    let mGr = this.mGr, mIn = this.mIn, mOut = this.mOut
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      const a = dL[i]
      const b = dR[i]
      let lvl: number
      if (this.rms) {
        ms = (a * a + b * b) * 0.5 + (ms - (a * a + b * b) * 0.5) * rmsCoef
        if (ms < 1e-20) ms = 0
        lvl = 10 * Math.log10(ms + 1e-20) + 3.0103 // calibrated so a sine reads its peak level
      } else {
        const pk = Math.max(Math.abs(a), Math.abs(b))
        lvl = 20 * Math.log10(pk + 1e-10)
      }
      const target = compGain(lvl, thr, ratio, knee)
      env = target < env ? target + (env - target) * aCoef : target + (env - target) * rCoef
      if (env > -1e-9) env = 0
      const g = Math.pow(10, env / 20) * this.makeup.next()
      const m = this.mix.next()
      const oL = l * (1 - m) + l * g * m
      const oR = r * (1 - m) + r * g * m
      outL[i] = oL
      outR[i] = oR
      if (env < mGr) mGr = env
      const ia = Math.max(Math.abs(l), Math.abs(r))
      if (ia > mIn) mIn = ia
      const oa = Math.max(Math.abs(oL), Math.abs(oR))
      if (oa > mOut) mOut = oa
    }
    this.ms = ms
    this.env = env
    if (this.ui.tick(end - start)) {
      this.post({ gr: mGr, inDb: gainToDb(mIn), outDb: gainToDb(mOut) })
      mGr = 0
      mIn = 0
      mOut = 0
    }
    this.mGr = mGr
    this.mIn = mIn
    this.mOut = mOut
  }
}

export default { id: 'compressor', kind: 'effect', create: (ctx) => new CompressorDSP(ctx) } satisfies DSPFactory
