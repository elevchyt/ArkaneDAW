import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { ModDelay, Smoother, TAU } from '../fx-common/dsp-util'
import { manifest } from './manifest'

const MAXV = 4
const RATE_SPREAD = [1, 1.13, 0.89, 1.27]

class ChorusDSP implements EffectDSP {
  private sr: number
  private primed = false
  private dl: ModDelay
  private dr: ModDelay
  private phase = 0
  private rate = 0.6
  private voices = 3
  private vphase = new Float64Array(MAXV)
  private depth: Smoother
  private base: Smoother
  private width: Smoother
  private mix: Smoother
  private vgain: Smoother

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    const max = Math.ceil(0.05 * this.sr)
    this.dl = new ModDelay(max)
    this.dr = new ModDelay(max)
    this.depth = new Smoother(this.sr, 0.45, 40)
    this.base = new Smoother(this.sr, 11, 80)
    this.width = new Smoother(this.sr, 1, 30)
    this.mix = new Smoother(this.sr, 0.5, 30)
    this.vgain = new Smoother(this.sr, 1, 30)
    for (let v = 0; v < MAXV; v++) this.vphase[v] = v / MAXV
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
      case 'delay': this.set(this.base, v); break
      case 'voices':
        this.voices = Math.max(1, Math.min(MAXV, Math.round(v)))
        this.set(this.vgain, 1 / Math.sqrt(this.voices))
        break
      case 'width': this.set(this.width, v); break
      case 'mix': this.set(this.mix, v); break
    }
  }

  reset(): void {
    this.dl.clear()
    this.dr.clear()
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const msS = this.sr / 1000
    const V = this.voices
    const inc = this.rate / this.sr
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      this.dl.write(l)
      this.dr.write(r)
      const depthMs = this.depth.next() * 5
      const base = this.base.next()
      const w = this.width.next()
      let wl = 0
      let wr = 0
      for (let v = 0; v < V; v++) {
        let ph = this.vphase[v] + inc * RATE_SPREAD[v]
        if (ph >= 1) ph -= 1
        this.vphase[v] = ph
        const ml = Math.sin(TAU * ph)
        const mr = Math.sin(TAU * (ph + 0.25 * w))
        wl += this.dl.read((base + depthMs * (0.5 + 0.5 * ml)) * msS)
        wr += this.dr.read((base + depthMs * (0.5 + 0.5 * mr)) * msS)
      }
      const g = this.vgain.next()
      wl *= g
      wr *= g
      // width on the wet signal
      const mid = (wl + wr) * 0.5
      const side = (wl - wr) * 0.5 * (0.3 + 0.7 * w)
      const m = this.mix.next()
      outL[i] = l * (1 - m) + (mid + side) * m
      outR[i] = r * (1 - m) + (mid - side) * m
    }
    this.phase = this.vphase[0]
  }
}

export default { id: 'chorus', kind: 'effect', create: (ctx) => new ChorusDSP(ctx) } satisfies DSPFactory
