import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { LFO, ModSVF, Smoother } from '../fx-common/dsp-util'
import { DIVISIONS } from '../fx-common/divisions'
import { manifest, resToQ } from './manifest'

const Q1_24 = 0.54 // first section of the 24 dB cascade (Butterworth-ish)

/** Gentle safety saturation: linear up to ~1, never above 3. */
const safe = (x: number): number => {
  const y = x / 3
  if (y > 3) return 3
  if (y < -3) return -3
  const y2 = y * y
  return (3 * y * (27 + y2)) / (27 + 9 * y2)
}

class FilterDSP implements EffectDSP {
  private sr: number
  private primed = false
  private type = 0
  private slope = 1
  private shape = 0
  private sync = false
  private div = 9
  private tempo = 120
  private rate = 1
  private l1: ModSVF
  private l2: ModSVF
  private r1: ModSVF
  private r2: ModSVF
  private lfo = new LFO()
  private cutoff: Smoother // log2 Hz
  private q: Smoother
  private drive: Smoother
  private amt: Smoother
  private mix: Smoother
  private driveOn = false
  private sub = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.l1 = new ModSVF(this.sr)
    this.l2 = new ModSVF(this.sr)
    this.r1 = new ModSVF(this.sr)
    this.r2 = new ModSVF(this.sr)
    this.cutoff = new Smoother(this.sr, 11, 25)
    this.q = new Smoother(this.sr, 0.7, 25)
    this.drive = new Smoother(this.sr, 1, 25)
    this.amt = new Smoother(this.sr, 0, 25)
    this.mix = new Smoother(this.sr, 1, 25)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'type': this.type = Math.round(v); break
      case 'slope': this.slope = Math.round(v); break
      case 'cutoff': this.set(this.cutoff, Math.log2(Math.max(10, v))); break
      case 'res': this.set(this.q, resToQ(v)); break
      case 'drive': this.driveOn = v > 0.05; this.set(this.drive, Math.pow(10, v / 20)); break
      case 'lfoAmt': this.set(this.amt, v); break
      case 'lfoRate': this.rate = v; break
      case 'lfoShape': this.shape = Math.round(v); break
      case 'lfoSync': this.sync = v >= 0.5; break
      case 'lfoDiv': this.div = Math.round(v); break
      case 'tempo': if (v > 0) this.tempo = v; break
      case 'mix': this.set(this.mix, v); break
    }
  }

  reset(): void {
    this.l1.reset()
    this.l2.reset()
    this.r1.reset()
    this.r2.reset()
    this.lfo.phase = 0
  }

  private out(f: ModSVF, x: number): number {
    f.process(x)
    switch (this.type) {
      case 1: return f.hp
      case 2: return f.bp * f.kq // unity gain at the centre
      case 3: return x - f.kq * f.bp
      default: return f.lp
    }
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const hz = this.sync ? this.tempo / 60 / (DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, this.div))].beats) : this.rate
    const inc = hz / this.sr
    const two = this.slope === 1
    let lfoV = 0
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      lfoV = this.lfo.next(this.shape, inc)
      const amt = this.amt.next()
      const lc = this.cutoff.next() + amt * 4 * lfoV
      const q = this.q.next()
      const g = this.drive.next()
      const m = this.mix.next()
      const fc = Math.pow(2, lc)
      if (this.sub-- <= 0 || amt !== 0) {
        this.sub = 7
        if (two) {
          this.l1.set(fc, Q1_24)
          this.r1.set(fc, Q1_24)
          this.l2.set(fc, q)
          this.r2.set(fc, q)
        } else {
          this.l1.set(fc, q)
          this.r1.set(fc, q)
        }
      }
      let xl = l
      let xr = r
      if (this.driveOn) {
        xl = Math.tanh(l * g) / Math.sqrt(g)
        xr = Math.tanh(r * g) / Math.sqrt(g)
      }
      let yl = this.out(this.l1, xl)
      let yr = this.out(this.r1, xr)
      if (two) {
        yl = this.out(this.l2, yl)
        yr = this.out(this.r2, yr)
      }
      yl = safe(yl)
      yr = safe(yr)
      outL[i] = l * (1 - m) + yl * m
      outR[i] = r * (1 - m) + yr * m
    }
  }
}

export default { id: 'filter', kind: 'effect', create: (ctx) => new FilterDSP(ctx) } satisfies DSPFactory
