import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { SlidingMin, Smoother, UiLink, gainToDb, msCoef } from '../fx-common/dsp-util'
import { manifest } from './manifest'

/**
 * Brickwall look-ahead limiter. Per sample: required gain = ceiling/|peak| (stereo-linked) ->
 * sliding minimum over the look-ahead window -> release smoothing (can only rise slowly) ->
 * boxcar average of length L (a smooth attack that is guaranteed to reach the required gain
 * before the delayed sample comes out) -> applied to the audio delayed by L samples.
 */
class LimiterDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private primed = false
  private drive: Smoother
  private ceil = 1
  private relCoef = 0
  private L = 96
  private maxL: number
  private dl: Float32Array
  private dr: Float32Array
  private envRing: Float64Array
  private w = 0
  private sum = 0
  private env = 1
  private min: SlidingMin
  private ui: UiLink
  private mGr = 1
  private mIn = 0
  private mOut = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.maxL = Math.ceil(0.0051 * this.sr) + 2
    this.dl = new Float32Array(this.maxL + 1)
    this.dr = new Float32Array(this.maxL + 1)
    this.envRing = new Float64Array(this.maxL + 1)
    this.min = new SlidingMin(this.maxL + 2)
    this.drive = new Smoother(this.sr, 1, 20)
    this.ui = new UiLink(this.sr, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
    this.reset()
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'gain': {
        const g = Math.pow(10, v / 20)
        if (this.primed) this.drive.set(g)
        else this.drive.jump(g)
        break
      }
      case 'ceiling':
        this.ceil = Math.pow(10, Math.min(0, v) / 20)
        break
      case 'release':
        this.relCoef = msCoef(v, this.sr)
        break
      case 'lookahead': {
        const L = Math.max(1, Math.min(this.maxL, Math.round((v / 1000) * this.sr)))
        if (L !== this.L) {
          this.L = L
          this.min.len = L + 1
          this.resum()
        }
        break
      }
    }
  }

  /** Recompute the boxcar sum over the last L env values. */
  private resum(): void {
    const n = this.envRing.length
    let s = 0
    for (let k = 1; k <= this.L; k++) s += this.envRing[(this.w - k + n) % n]
    this.sum = s
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.dl.fill(0)
    this.dr.fill(0)
    this.envRing.fill(1)
    this.env = 1
    this.min.reset()
    this.resum()
  }

  get latency(): number {
    return this.L
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const n = this.dl.length
    const ceil = this.ceil
    const L = this.L
    let w = this.w
    let sum = this.sum
    let env = this.env
    let mGr = this.mGr, mIn = this.mIn, mOut = this.mOut
    for (let i = start; i < end; i++) {
      const g = this.drive.next()
      const l = inL[i] * g
      const r = inR[i] * g
      const pk = Math.max(Math.abs(l), Math.abs(r))
      if (pk > mIn) mIn = pk
      const req = pk > ceil ? ceil / pk : 1
      const h = this.min.push(req)
      env = h < env ? h : h + (env - h) * this.relCoef
      // boxcar over last L env values
      const old = this.envRing[(w - L + n) % n]
      this.envRing[w] = env
      sum += env - old
      let s = sum / L
      if (s > 1) s = 1
      // delay line
      this.dl[w] = l
      this.dr[w] = r
      const rd = (w - L + n) % n
      let oL = this.dl[rd] * s
      let oR = this.dr[rd] * s
      // numerical safety net (should never engage by more than rounding)
      if (oL > ceil) oL = ceil
      else if (oL < -ceil) oL = -ceil
      if (oR > ceil) oR = ceil
      else if (oR < -ceil) oR = -ceil
      outL[i] = oL
      outR[i] = oR
      w = (w + 1) % n
      if (s < mGr) mGr = s
      const oa = Math.max(Math.abs(oL), Math.abs(oR))
      if (oa > mOut) mOut = oa
    }
    this.w = w
    this.sum = sum
    this.env = env
    if (this.ui.tick(end - start)) {
      this.post({ gr: gainToDb(mGr), inDb: gainToDb(mIn), outDb: gainToDb(mOut) })
      mGr = 1
      mIn = 0
      mOut = 0
    }
    this.mGr = mGr
    this.mIn = mIn
    this.mOut = mOut
  }
}

export default { id: 'limiter', kind: 'effect', create: (ctx) => new LimiterDSP(ctx) } satisfies DSPFactory
