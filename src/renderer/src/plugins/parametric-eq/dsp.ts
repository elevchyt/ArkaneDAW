import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Biquad, Smoother, SpectrumAnalyzer, UiLink } from '../fx-common/dsp-util'
import { NBANDS, bandShape, manifest } from './manifest'

const SUB = 16 // coefficient update granularity while parameters glide

class Band {
  on = true
  type = 0
  // smoothed values: log2(freq), gain dB, log2(q)
  cur = new Float64Array(3)
  tgt = new Float64Array(3)
  dirty = true
  l1: Biquad
  r1: Biquad
  l2: Biquad
  r2: Biquad
  double = false
  active = true
  constructor(sr: number) {
    this.l1 = new Biquad(sr)
    this.r1 = new Biquad(sr)
    this.l2 = new Biquad(sr)
    this.r2 = new Biquad(sr)
  }
  update(): void {
    const sh = bandShape(this.type)
    const f = Math.pow(2, this.cur[0])
    const g = this.cur[1]
    const q = Math.pow(2, this.cur[2])
    this.double = sh.double
    this.l1.set(sh.kind, f, q, g)
    this.r1.set(sh.kind, f, q, g)
    if (sh.double) {
      this.l2.set(sh.kind, f, q, g)
      this.r2.set(sh.kind, f, q, g)
    }
    // a peak/shelf at 0 dB is an identity: skip it entirely
    const was = this.active
    this.active = this.on && (!sh.usesGain || Math.abs(g) > 1e-4)
    if (this.active && !was) this.reset()
  }
  reset(): void {
    this.l1.reset()
    this.r1.reset()
    this.l2.reset()
    this.r2.reset()
  }
}

class ParametricEqDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private primed = false
  private bands: Band[] = []
  private out: Smoother
  private glide: number
  private ui: UiLink
  private spec: SpectrumAnalyzer
  private sub = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    for (let i = 0; i < NBANDS; i++) this.bands.push(new Band(this.sr))
    this.out = new Smoother(this.sr, 1, 20)
    // per-SUB-block glide coefficient (~25 ms time constant)
    this.glide = Math.exp(-SUB / (0.025 * this.sr))
    this.ui = new UiLink(this.sr, 20)
    this.spec = new SpectrumAnalyzer(this.sr, 4096)
    for (const p of manifest.params) this.setParam(p.id, p.default)
    for (const b of this.bands) b.update()
  }

  setParam(id: string, v: number): void {
    if (id === 'out') {
      const g = Math.pow(10, v / 20)
      if (this.primed) this.out.set(g)
      else this.out.jump(g)
      return
    }
    if (id[0] !== 'b') return
    const n = parseInt(id.slice(1), 10) - 1
    const b = this.bands[n]
    if (!b) return
    const key = id.slice(id.indexOf('.') + 1)
    let k = -1
    switch (key) {
      case 'on': b.on = v >= 0.5; b.dirty = true; return
      case 'type': b.type = Math.round(v); b.dirty = true; return
      case 'freq': k = 0; v = Math.log2(Math.max(10, v)); break
      case 'gain': k = 1; break
      case 'q': k = 2; v = Math.log2(Math.max(0.05, v)); break
      default: return
    }
    b.tgt[k] = v
    if (!this.primed) b.cur[k] = v
    b.dirty = true
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    for (const b of this.bands) b.reset()
    this.spec.reset()
  }

  private advance(): void {
    const c = this.glide
    for (const b of this.bands) {
      if (!b.dirty) continue
      let moving = false
      for (let k = 0; k < 3; k++) {
        const d = b.cur[k] - b.tgt[k]
        if (Math.abs(d) > 1e-4) {
          b.cur[k] = b.tgt[k] + d * c
          moving = true
        } else b.cur[k] = b.tgt[k]
      }
      b.update()
      if (!moving) b.dirty = false
    }
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const bands = this.bands
    const showSpec = this.ui.active
    for (let i = start; i < end; i++) {
      if (this.sub-- <= 0) {
        this.sub = SUB - 1
        this.advance()
      }
      let l = inL[i]
      let r = inR[i]
      for (let k = 0; k < NBANDS; k++) {
        const b = bands[k]
        if (!b.active) continue
        l = b.l1.process(l)
        r = b.r1.process(r)
        if (b.double) {
          l = b.l2.process(l)
          r = b.r2.process(r)
        }
      }
      const g = this.out.next()
      l *= g
      r *= g
      outL[i] = l
      outR[i] = r
      if (showSpec) this.spec.push((l + r) * 0.5)
    }
    if (this.ui.tick(end - start)) this.post({ spec: this.spec.compute() })
  }
}

export default { id: 'parametric-eq', kind: 'effect', create: (ctx) => new ParametricEqDSP(ctx) } satisfies DSPFactory
