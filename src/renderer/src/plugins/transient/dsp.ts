import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Smoother, UiLink, msCoef } from '../fx-common/dsp-util'
import { manifest } from './manifest'

/**
 * Differential-envelope transient shaper:
 *   attack  = fast-attack follower vs slow-attack follower (positive only during onsets)
 *   sustain = slow-release follower vs fast-release follower (positive during tails)
 * Both differences are in dB, scaled by the knobs, so the effect is level independent.
 */
class TransientDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private primed = false
  private aAmt = 0
  private sAmt = 0
  private fastA = 0 // fast attack env
  private slowA = 0 // slow attack env
  private fastR = 0 // fast release env
  private slowR = 0 // slow release env
  private cFastAtk = 0
  private cSlowAtk = 0
  private cRel = 0
  private cFastRel = 0
  private cSlowRel = 0
  private gDb = 0
  private gCoef: number
  private out: Smoother
  private mix: Smoother
  private ui: UiLink
  private mMax = 0
  private mMin = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.gCoef = msCoef(1, this.sr)
    this.out = new Smoother(this.sr, 1, 20)
    this.mix = new Smoother(this.sr, 1, 20)
    this.ui = new UiLink(this.sr, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'attack': this.aAmt = v / 100; break
      case 'sustain': this.sAmt = v / 100; break
      case 'speed': {
        const k = Math.pow(2, (0.5 - v) * 2) // 0.5..2 time scale
        this.cFastAtk = msCoef(0.5 * k, this.sr)
        this.cSlowAtk = msCoef(25 * k, this.sr)
        this.cRel = msCoef(120 * k, this.sr)
        this.cFastRel = msCoef(40 * k, this.sr)
        this.cSlowRel = msCoef(400 * k, this.sr)
        break
      }
      case 'output': this.set(this.out, Math.pow(10, v / 20)); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.fastA = this.slowA = this.fastR = this.slowR = 0
    this.gDb = 0
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    let mMax = this.mMax, mMin = this.mMin
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      const x = Math.max(Math.abs(l), Math.abs(r)) + 1e-9
      // attack detectors (shared release)
      this.fastA = x > this.fastA ? x + (this.fastA - x) * this.cFastAtk : x + (this.fastA - x) * this.cRel
      this.slowA = x > this.slowA ? x + (this.slowA - x) * this.cSlowAtk : x + (this.slowA - x) * this.cRel
      // sustain detectors (shared fast attack)
      this.fastR = x > this.fastR ? x + (this.fastR - x) * this.cFastAtk : x + (this.fastR - x) * this.cFastRel
      this.slowR = x > this.slowR ? x + (this.slowR - x) * this.cFastAtk : x + (this.slowR - x) * this.cSlowRel
      const atkDb = 20 * Math.log10(this.fastA / (this.slowA + 1e-12))
      const susDb = 20 * Math.log10(this.slowR / (this.fastR + 1e-12))
      let target = this.aAmt * Math.max(0, atkDb) * 1.5 + this.sAmt * Math.max(0, susDb) * 0.8
      if (target > 18) target = 18
      else if (target < -30) target = -30
      // silence: don't let noise-floor ratios do anything
      if (x < 1e-5) target = 0
      this.gDb = target + (this.gDb - target) * this.gCoef
      const g = Math.pow(10, this.gDb / 20) * this.out.next()
      const m = this.mix.next()
      outL[i] = l * (1 - m) + l * g * m
      outR[i] = r * (1 - m) + r * g * m
      if (this.gDb > mMax) mMax = this.gDb
      if (this.gDb < mMin) mMin = this.gDb
    }
    if (this.ui.tick(end - start)) {
      this.post({ max: mMax, min: mMin })
      mMax = mMin = 0
    }
    this.mMax = mMax
    this.mMin = mMin
  }
}

export default { id: 'transient', kind: 'effect', create: (ctx) => new TransientDSP(ctx) } satisfies DSPFactory
