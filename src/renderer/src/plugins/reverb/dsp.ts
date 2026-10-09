import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Biquad, DelayLine, OnePole, Smoother, dryGain, flush, wetGain } from '../fx-common/dsp-util'
import { manifest } from './manifest'

const N = 8

interface Voicing {
  lines: number[] // ms at scale 1
  scale: [number, number] // size 0..1 -> scale range
  diff: number[] // input diffuser lengths (ms)
  diffG: number
  mod: number // modulation depth (ms)
  inGain: number
}

const VOICINGS: Voicing[] = [
  // Room
  { lines: [7.3, 9.1, 11.3, 13.7, 16.1, 18.9, 22.3, 25.7], scale: [0.55, 1.7], diff: [0.9, 1.7, 2.9, 4.1], diffG: 0.65, mod: 0.12, inGain: 0.5 },
  // Hall
  { lines: [29.7, 35.3, 41.1, 46.9, 53.3, 61.1, 70.7, 80.9], scale: [0.45, 1.35], diff: [1.3, 2.3, 3.7, 5.9], diffG: 0.7, mod: 0.35, inGain: 0.42 },
  // Plate
  { lines: [10.9, 13.3, 15.7, 18.1, 21.1, 24.7, 28.3, 32.9], scale: [0.6, 1.35], diff: [2.1, 3.1, 5.3, 7.9], diffG: 0.76, mod: 0.22, inGain: 0.45 }
]

const MAX_LINE_MS = 81 * 1.4 + 2
const MAX_DIFF_MS = 8 * 1.6 + 1
const LFO_RATES = [0.31, 0.43, 0.57, 0.71, 0.83, 0.97, 1.09, 1.21]
// output tap signs for L/R decorrelation (rows of a Hadamard-ish pattern)
const OUT_L = [1, -1, 1, -1, 1, -1, 1, -1]
const OUT_R = [1, 1, -1, -1, 1, 1, -1, -1]

class Allpass {
  private d: DelayLine
  len = 10
  constructor(max: number, public g: number) {
    this.d = new DelayLine(max)
  }
  process(x: number): number {
    const z = this.d.read(this.len)
    const v = x + this.g * z
    this.d.write(flush(v))
    return z - this.g * v
  }
  clear(): void {
    this.d.clear()
  }
}

class ReverbDSP implements EffectDSP {
  private sr: number
  private primed = false
  private mode = 1
  private sizeV = 0.5
  private decay = 2.2
  private lines: DelayLine[] = []
  private damp: OnePole[] = []
  private len = new Float64Array(N) // current (smoothed) length in samples
  private gains = new Float64Array(N)
  private phase = new Float64Array(N)
  private inc = new Float64Array(N)
  private y = new Float64Array(N)
  private v = new Float64Array(N)
  private scale: Smoother
  private pre: Smoother
  private preL: DelayLine
  private preR: DelayLine
  private apL: Allpass[] = []
  private apR: Allpass[] = []
  private lcL: Biquad
  private lcR: Biquad
  private width: Smoother
  private mix: Smoother
  private modDepth = 0
  private inGain = 0.4

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    const maxLine = Math.ceil((MAX_LINE_MS / 1000) * this.sr)
    for (let i = 0; i < N; i++) {
      this.lines.push(new DelayLine(maxLine))
      this.damp.push(new OnePole(this.sr, 7000))
      this.inc[i] = LFO_RATES[i] / this.sr
      this.phase[i] = i / N
    }
    const maxDiff = Math.ceil((MAX_DIFF_MS / 1000) * this.sr)
    for (let k = 0; k < 4; k++) {
      this.apL.push(new Allpass(maxDiff, 0.7))
      this.apR.push(new Allpass(maxDiff, 0.7))
    }
    this.preL = new DelayLine(Math.ceil(0.26 * this.sr))
    this.preR = new DelayLine(Math.ceil(0.26 * this.sr))
    this.lcL = new Biquad(this.sr)
    this.lcR = new Biquad(this.sr)
    this.scale = new Smoother(this.sr, 1, 150)
    this.pre = new Smoother(this.sr, 0, 80)
    this.width = new Smoother(this.sr, 1, 30)
    this.mix = new Smoother(this.sr, 0.25, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
    this.applyVoicing()
    for (let i = 0; i < N; i++) this.len[i] = this.target(i)
  }

  private get voicing(): Voicing {
    return VOICINGS[this.mode] ?? VOICINGS[1]
  }

  private sizeScale(): number {
    const [a, b] = this.voicing.scale
    return a + (b - a) * this.sizeV
  }

  private target(i: number): number {
    return (this.voicing.lines[i] / 1000) * this.sr * this.scale.value
  }

  private applyVoicing(): void {
    const v = this.voicing
    const s = this.sizeScale()
    if (this.primed) this.scale.set(s)
    else this.scale.jump(s)
    const ds = 0.6 + 0.6 * this.sizeV
    for (let k = 0; k < 4; k++) {
      this.apL[k].len = Math.max(1, (v.diff[k] / 1000) * this.sr * ds)
      this.apR[k].len = Math.max(1, ((v.diff[k] * 1.13) / 1000) * this.sr * ds)
      this.apL[k].g = v.diffG
      this.apR[k].g = v.diffG
    }
    this.modDepth = (v.mod / 1000) * this.sr
    this.inGain = v.inGain
  }

  private set(s: Smoother, v: number): void {
    if (this.primed) s.set(v)
    else s.jump(v)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'mode': {
        const m = Math.max(0, Math.min(2, Math.round(v)))
        if (m !== this.mode) {
          this.mode = m
          this.applyVoicing()
        }
        break
      }
      case 'size':
        this.sizeV = Math.max(0, Math.min(1, v))
        this.applyVoicing()
        break
      case 'decay':
        this.decay = Math.max(0.05, v)
        break
      case 'predelay':
        this.set(this.pre, (Math.max(0, v) / 1000) * this.sr)
        break
      case 'damp':
        for (const d of this.damp) d.setFreq(v)
        break
      case 'lowcut':
        this.lcL.set('hp', v, 0.6)
        this.lcR.set('hp', v, 0.6)
        break
      case 'width':
        this.set(this.width, v)
        break
      case 'mix':
        this.set(this.mix, v)
        break
    }
  }

  reset(): void {
    for (const l of this.lines) l.clear()
    for (const d of this.damp) d.reset()
    for (const a of this.apL) a.clear()
    for (const a of this.apR) a.clear()
    this.preL.clear()
    this.preR.clear()
    this.lcL.reset()
    this.lcR.reset()
    this.y.fill(0)
  }

  /** Per-line feedback gains so every line decays 60 dB in `decay` seconds. */
  private updateGains(): void {
    const k = -3 / (this.decay * this.sr)
    for (let i = 0; i < N; i++) this.gains[i] = Math.pow(10, k * this.len[i])
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.primed = true
    const lines = this.lines
    const len = this.len
    const y = this.y
    const v = this.v
    const voicing = this.voicing.lines
    const msToS = this.sr / 1000
    const md = this.modDepth
    const ig = this.inGain
    let count = 0
    this.updateGains()
    for (let i = start; i < end; i++) {
      const dl = inL[i]
      const dr = inR[i]
      // smoothed size -> line lengths (update every 32 samples)
      if ((count++ & 31) === 0) {
        const sc = this.scale.value
        for (let n = 0; n < N; n++) len[n] = voicing[n] * msToS * sc
        this.updateGains()
      }
      this.scale.next()
      // pre-delay + input diffusion
      const pd = this.pre.next()
      this.preL.write(dl)
      this.preR.write(dr)
      let a = pd >= 1 ? this.preL.read(pd) : dl
      let b = pd >= 1 ? this.preR.read(pd) : dr
      for (let k = 0; k < 4; k++) {
        a = this.apL[k].process(a)
        b = this.apR[k].process(b)
      }
      a *= ig
      b *= ig
      // read lines (modulated), damp, apply decay gain
      for (let n = 0; n < N; n++) {
        let ph = this.phase[n] + this.inc[n]
        if (ph >= 1) ph -= 1
        this.phase[n] = ph
        const m = md * Math.sin(6.283185307179586 * ph)
        const out = lines[n].read(len[n] + m + md + 1)
        y[n] = out
        v[n] = this.damp[n].lp(out) * this.gains[n]
      }
      // 8-point fast Hadamard (orthonormal)
      for (let h = 1; h < N; h <<= 1) {
        for (let s = 0; s < N; s += h << 1) {
          for (let j = s; j < s + h; j++) {
            const p = v[j]
            const q = v[j + h]
            v[j] = p + q
            v[j + h] = p - q
          }
        }
      }
      const norm = 0.35355339059327373 // 1/sqrt(8)
      for (let n = 0; n < N; n++) lines[n].write(flush(v[n] * norm + ((n & 1) === 0 ? a : b)))
      // stereo outputs
      let wl = 0
      let wr = 0
      for (let n = 0; n < N; n++) {
        wl += y[n] * OUT_L[n]
        wr += y[n] * OUT_R[n]
      }
      wl = this.lcL.process(wl * 0.5)
      wr = this.lcR.process(wr * 0.5)
      const w = this.width.next()
      const mid = (wl + wr) * 0.5
      const side = (wl - wr) * 0.5 * w
      const mx = this.mix.next()
      const dg = dryGain(mx)
      const wg = wetGain(mx)
      outL[i] = dl * dg + (mid + side) * wg
      outR[i] = dr * dg + (mid - side) * wg
    }
  }
}

export default { id: 'reverb', kind: 'effect', create: (ctx) => new ReverbDSP(ctx) } satisfies DSPFactory
