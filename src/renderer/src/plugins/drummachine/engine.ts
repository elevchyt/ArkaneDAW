// Drum Machine synthesis engine (runs in the AudioWorklet; no DOM, no allocation in render paths).
//
// One generic "drum circuit" voice (SynthVoice) is configured by a Recipe:
//   o  = tonal oscillators / resonators (sine, triangle, square) with pitch + amp envelopes
//        (808 bridged-T kick = a decaying sine with a tiny pitch drop, toms, congas, modal shells...)
//   n  = filtered noise sources (snappy, claps with multi-burst envelopes, hats, beater clicks)
//   m  = the 808-style metal section: up to 6 square oscillators -> band-passes -> high-pass
// The analog kits run SynthVoices in real time. The sample-era kits render the same recipes once
// (with many more modal partials) into ROM-style buffers at the machine's sample rate and play them
// back through the machine's converter (8-bit companding, 12-bit, aliasing, reconstruction filter).
import { SVF, TAU, clamp, polyBlep, softClip } from '../sdk/dsp'

const LN1000 = 6.907755278982137 // -60 dB

export interface OscC {
  f: number
  /** 0 sine, 1 triangle, 2 square */
  w?: 0 | 1 | 2
  l: number
  /** T60 decay (s) */
  d: number
  /** optional second (tail) decay and its mix */
  d2?: number
  x2?: number
  /** linear attack (s) */
  a?: number
  /** pitch envelope: semitones above f at onset, decaying with time-constant pd (s) */
  pa?: number
  pd?: number
  /** start phase 0..1 (0.25 = cosine start = analog click) */
  ph?: number
}

export interface NoiseC {
  l: number
  d: number
  d2?: number
  x2?: number
  a?: number
  /** filter mode 0 LP, 1 BP, 2 HP */
  m?: 0 | 1 | 2
  f: number
  q?: number
  /** extra high-pass (Hz) */
  hp?: number
  /** filter sweep: octaves above f at onset, time-constant fd (s) */
  fs?: number
  fd?: number
  /** clap style: number of bursts and gap between them (s) */
  bursts?: number
  gap?: number
  /** decorrelated stereo noise */
  st?: boolean
  /** start delay (s) */
  delay?: number
}

export interface BandC {
  f: number
  q: number
  l: number
  d: number
  d2?: number
  x2?: number
}

export interface MetalC {
  fr: number[]
  bands: BandC[]
  hp?: number
  a?: number
}

export interface Recipe {
  o?: OscC[]
  n?: NoiseC[]
  m?: MetalC
  /** voice saturation amount */
  drv?: number
  /** bit depth of the "sample" (909 cymbals: 6) */
  bits?: number
  /** output peak at full velocity */
  lvl?: number
  pan?: number
  /** output low/high pass */
  lp?: number
  hp?: number
}

export interface Mods {
  ratio: number
  decay: number
  tone: number
  vel: number
  /** extra saturation (character) */
  sat: number
}

export const REF_MODS: Mods = { ratio: 1, decay: 1, tone: 0, vel: 1, sat: 0 }

class Env {
  l = 0
  att = 1
  ai = 0
  e1 = 0
  c1 = 1
  e2 = 0
  c2 = 1
  x2 = 0
  bn = 0
  bcnt = 0
  bgap = 0
  bc = 1
  delay = 0
  /** last envelope value without level (VCA tracking for bit reduction) */
  last = 0
  set(sr: number, l: number, d: number, d2: number, x2: number, a: number, bursts: number, gap: number, delay: number): void {
    this.l = l
    this.ai = a > 0 ? 1 / (a * sr) : 0
    this.att = a > 0 ? 0 : 1
    this.e1 = 1
    this.c1 = Math.exp(-LN1000 / (Math.max(d, 1e-4) * sr))
    this.x2 = d2 > 0 ? x2 : 0
    this.e2 = 1
    this.c2 = d2 > 0 ? Math.exp(-LN1000 / (d2 * sr)) : 1
    this.bn = bursts > 1 ? bursts : 0
    this.bgap = Math.max(1, Math.round(gap * sr))
    this.bcnt = this.bgap
    this.bc = Math.exp(-LN1000 / (Math.max(gap, 1e-4) * 1.6 * sr))
    this.delay = Math.round(delay * sr)
  }
  next(): number {
    if (this.delay > 0) {
      this.delay--
      return 0
    }
    if (this.bn > 1) {
      const g = this.e1
      this.e1 *= this.bc
      if (--this.bcnt <= 0) {
        this.bn--
        this.e1 = 1
        this.bcnt = this.bgap
      }
      this.last = g
      return g * this.l
    }
    if (this.att < 1) {
      this.att += this.ai
      if (this.att > 1) this.att = 1
    }
    const g = this.x2 > 0 ? this.e1 * (1 - this.x2) + this.e2 * this.x2 : this.e1
    this.e1 *= this.c1
    this.e2 *= this.c2
    this.last = g * this.att
    return g * this.att * this.l
  }
  alive(): boolean {
    if (this.l === 0) return false
    return this.delay > 0 || this.bn > 1 || this.e1 > 1e-4 || (this.x2 > 0 && this.e2 > 1e-4)
  }
}

function initFilter(s: SVF, mode: number, f: number, q: number): void {
  s.mode = mode
  s.reset()
  s.set(f, q)
}

const MAXN = 4
const MAXM = 6
const MAXB = 2

export class SynthVoice {
  readonly sr: number
  readonly cap: number
  // oscillators
  nO = 0
  private oPh: Float64Array
  private oInc: Float64Array
  private oPa: Float64Array
  private oPe: Float64Array
  private oPc: Float64Array
  private oW: Int8Array
  private oRec: Uint8Array
  private oK: Float64Array
  private oK2: Float64Array
  private oThr: Float64Array
  private oS1: Float64Array
  private oS2: Float64Array
  private oEnv: Env[]
  // noise
  nN = 0
  private nEnv: Env[] = []
  private nF: SVF[] = []
  private nFR: SVF[] = []
  private nH: SVF[] = []
  private nHR: SVF[] = []
  private nSt = new Uint8Array(MAXN)
  private nHasH = new Uint8Array(MAXN)
  private nF0 = new Float64Array(MAXN)
  private nQ = new Float64Array(MAXN)
  private nFs = new Float64Array(MAXN)
  private nFe = new Float64Array(MAXN)
  private nFc = new Float64Array(MAXN)
  // metal
  private mOn = false
  private mN = 0
  private mPh = new Float64Array(MAXM)
  private mInc = new Float64Array(MAXM)
  private mNB = 0
  private mB: SVF[] = []
  private mEnv: Env[] = []
  private mHP: SVF
  private mHasHP = false
  private mAtt = 1
  private mAi = 0
  // output
  private drv = 0
  private quant = 0
  private lpL: SVF
  private lpR: SVF
  private hpL: SVF
  private hpR: SVF
  private hasLP = false
  private hasHP = false
  private rng = 0x9e3779b9 | 0
  private n = 0
  // host bookkeeping
  active = false
  key = -1
  noteId = -1
  grp = 0
  age = 0
  gainL = 0
  gainR = 0
  fade = 1
  fadeStep = 0

  constructor(sr: number, oscCap = 8) {
    this.sr = sr
    this.cap = oscCap
    this.oPh = new Float64Array(oscCap)
    this.oInc = new Float64Array(oscCap)
    this.oPa = new Float64Array(oscCap)
    this.oPe = new Float64Array(oscCap)
    this.oPc = new Float64Array(oscCap)
    this.oW = new Int8Array(oscCap)
    this.oRec = new Uint8Array(oscCap)
    this.oK = new Float64Array(oscCap)
    this.oK2 = new Float64Array(oscCap)
    this.oThr = new Float64Array(oscCap)
    this.oS1 = new Float64Array(oscCap)
    this.oS2 = new Float64Array(oscCap)
    this.oEnv = Array.from({ length: oscCap }, () => new Env())
    for (let i = 0; i < MAXN; i++) {
      this.nEnv.push(new Env())
      this.nF.push(new SVF(sr))
      this.nFR.push(new SVF(sr))
      this.nH.push(new SVF(sr))
      this.nHR.push(new SVF(sr))
    }
    for (let i = 0; i < MAXB; i++) {
      this.mB.push(new SVF(sr))
      this.mEnv.push(new Env())
    }
    this.mHP = new SVF(sr)
    this.mHP.mode = 1
    this.lpL = new SVF(sr)
    this.lpR = new SVF(sr)
    this.hpL = new SVF(sr)
    this.hpR = new SVF(sr)
    this.hpL.mode = this.hpR.mode = 1
  }

  /** Configure from a recipe. `fs` = full scale for bit reduction (0 = no bit reduction). */
  setup(r: Recipe, m: Mods, fs: number, seed: number): void {
    const sr = this.sr
    const nyq = sr * 0.45
    const t = clamp(m.tone, -1, 1)
    const acc = clamp((m.vel - 0.6) / 0.4, 0, 1)
    const hasNM = !!(r.n?.length || r.m)
    const fr = Math.pow(m.ratio, 0.75) * Math.pow(2, 0.5 * t)
    this.rng = (seed * 2654435761 + 12345) | 0 || 1
    this.n = 0
    // oscillators
    const os = r.o ?? []
    this.nO = Math.min(os.length, this.cap)
    const oLev = hasNM ? Math.pow(2, -0.35 * t) : 1
    for (let i = 0; i < this.nO; i++) {
      const o = os[i]
      const f = Math.min(o.f * m.ratio, nyq)
      const inc = f / sr
      this.oInc[i] = inc
      this.oPh[i] = o.ph ?? 0
      this.oW[i] = o.w ?? 0
      this.oPa[i] = o.pa ? Math.pow(2, o.pa / 12) - 1 : 0
      this.oPe[i] = 1
      this.oPc[i] = o.pd ? Math.exp(-1 / (o.pd * sr)) : 0
      const rec = (o.w ?? 0) === 0 && !o.pa
      // very high partials beyond nyquist are silenced
      const lv = o.f * m.ratio >= nyq ? 0 : o.l * oLev
      const damped = rec && !o.a && !o.d2
      this.oRec[i] = damped ? 2 : rec ? 1 : 0
      if (rec) {
        const w = TAU * inc
        const p0 = TAU * (o.ph ?? 0)
        if (damped) {
          // exponentially decaying sine as a damped 2-pole resonator: no envelope needed
          const r = Math.exp(-LN1000 / (Math.max(o.d * m.decay, 1e-4) * sr))
          this.oK[i] = 2 * r * Math.cos(w)
          this.oK2[i] = r * r
          this.oS1[i] = (lv * Math.sin(p0 - w)) / r
          this.oS2[i] = (lv * Math.sin(p0 - 2 * w)) / (r * r)
          this.oThr[i] = 1e-8 * lv * lv
        } else {
          this.oK[i] = 2 * Math.cos(w)
          this.oK2[i] = 1
          this.oS1[i] = Math.sin(p0 - w)
          this.oS2[i] = Math.sin(p0 - 2 * w)
        }
      }
      this.oEnv[i].set(sr, damped ? 0 : lv, o.d * m.decay, (o.d2 ?? 0) * m.decay, o.x2 ?? 0, o.a ?? 0, 1, 0, 0)
    }
    // noise
    const ns = r.n ?? []
    this.nN = Math.min(ns.length, MAXN)
    const nLev = Math.pow(2, t) * (1 + 0.3 * acc)
    for (let i = 0; i < this.nN; i++) {
      const c = ns[i]
      const f = clamp(c.f * fr, 20, nyq)
      const q = c.q ?? 0.707
      this.nF0[i] = f
      this.nQ[i] = q
      this.nFs[i] = c.fs ?? 0
      this.nFe[i] = 1
      this.nFc[i] = c.fd ? Math.exp(-1 / (c.fd * sr)) : 0
      const sf = c.fs ? clamp(f * Math.pow(2, c.fs), 20, nyq) : f
      initFilter(this.nF[i], c.m ?? 0, sf, q)
      initFilter(this.nFR[i], c.m ?? 0, sf, q)
      this.nHasH[i] = c.hp ? 1 : 0
      if (c.hp) {
        const hf = clamp(c.hp * fr, 20, nyq)
        initFilter(this.nH[i], 1, hf, 0.707)
        initFilter(this.nHR[i], 1, hf, 0.707)
      }
      this.nSt[i] = c.st ? 1 : 0
      this.nEnv[i].set(sr, c.l * nLev, c.d * m.decay, (c.d2 ?? 0) * m.decay, c.x2 ?? 0, c.a ?? 0, c.bursts ?? 1, c.gap ?? 0, c.delay ?? 0)
    }
    // metal
    const mt = r.m
    this.mOn = !!mt
    if (mt) {
      this.mN = Math.min(mt.fr.length, MAXM)
      for (let i = 0; i < this.mN; i++) {
        this.mInc[i] = Math.min(0.45, (mt.fr[i] * m.ratio) / sr)
        this.mPh[i] = (i * 0.137) % 1
      }
      this.mNB = Math.min(mt.bands.length, MAXB)
      for (let b = 0; b < this.mNB; b++) {
        const bd = mt.bands[b]
        this.mB[b].mode = 2
        this.mB[b].reset()
        this.mB[b].set(clamp(bd.f * fr, 50, nyq), bd.q)
        this.mEnv[b].set(sr, bd.l * (1 + 0.2 * acc), bd.d * m.decay, (bd.d2 ?? 0) * m.decay, bd.x2 ?? 0, 0, 1, 0, 0)
      }
      this.mHasHP = !!mt.hp
      if (mt.hp) {
        this.mHP.reset()
        this.mHP.set(clamp(mt.hp * fr, 20, nyq), 0.707)
      }
      this.mAi = mt.a ? 1 / (mt.a * sr) : 0
      this.mAtt = mt.a ? 0 : 1
    }
    // output stage
    this.drv = (r.drv ?? 0) + acc * 0.3 + (hasNM ? Math.max(0, t) * 0.3 : Math.max(0, t) * 1.5) + m.sat
    this.quant = r.bits && fs > 0 ? Math.pow(2, r.bits - 1) / fs : 0
    let lp = r.lp ?? 0
    if (t < 0) {
      const lt = 18000 * Math.pow(2, 5 * t)
      lp = lp > 0 ? Math.min(lp, lt) : lt
    }
    this.hasLP = lp > 0 && lp < nyq
    if (this.hasLP) {
      this.lpL.reset()
      this.lpR.reset()
      this.lpL.set(lp, 0.707)
      this.lpR.set(lp, 0.707)
    }
    this.hasHP = !!r.hp
    if (r.hp) {
      this.hpL.reset()
      this.hpR.reset()
      this.hpL.set(r.hp, 0.707)
      this.hpR.set(r.hp, 0.707)
    }
    this.active = true
    this.fade = 1
    this.fadeStep = 0
  }

  private noise(): number {
    let x = this.rng
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rng = x
    return (x | 0) * 4.656612873077393e-10
  }

  /** Start a fade-out over `seconds` (chokes, gate mode). */
  release(seconds: number): void {
    const step = 1 / Math.max(1, seconds * this.sr)
    if (this.fadeStep === 0 || step > this.fadeStep) this.fadeStep = step
  }

  /** ADD the voice into outL/outR[start, end) with the voice gains. */
  render(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const gL = this.gainL
    const gR = this.gainR
    const drv = this.drv
    const dg = 1 + drv
    const dInv = drv > 0 ? 1 / Math.pow(dg, 0.75) : 1
    const quant = this.quant
    for (let i = start; i < end; i++) {
      let y = 0
      let sL = 0
      let sR = 0
      // oscillators
      for (let o = 0; o < this.nO; o++) {
        let s: number
        const rc = this.oRec[o]
        if (rc === 2) {
          s = this.oK[o] * this.oS1[o] - this.oK2[o] * this.oS2[o]
          this.oS2[o] = this.oS1[o]
          this.oS1[o] = s
          y += s
          continue
        }
        if (rc === 1) {
          s = this.oK[o] * this.oS1[o] - this.oS2[o]
          this.oS2[o] = this.oS1[o]
          this.oS1[o] = s
        } else {
          const pe = this.oPe[o]
          let inc = this.oInc[o] * (1 + this.oPa[o] * pe)
          if (inc > 0.45) inc = 0.45
          this.oPe[o] = pe * this.oPc[o]
          const ph = this.oPh[o]
          const w = this.oW[o]
          if (w === 0) s = Math.sin(TAU * ph)
          else if (w === 1) s = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph
          else {
            s = ph < 0.5 ? 1 : -1
            s += polyBlep(ph, inc) - polyBlep((ph + 0.5) % 1, inc)
          }
          let np = ph + inc
          if (np >= 1) np -= 1
          this.oPh[o] = np
        }
        y += s * this.oEnv[o].next()
      }
      // noise
      for (let k = 0; k < this.nN; k++) {
        const e = this.nEnv[k].next()
        if (this.nFc[k] > 0 && (this.n & 7) === 0) {
          const fe = this.nFe[k]
          const f = this.nF0[k] * Math.pow(2, this.nFs[k] * fe)
          this.nF[k].set(f, this.nQ[k])
          if (this.nSt[k]) this.nFR[k].set(f, this.nQ[k])
        }
        if (this.nFc[k] > 0) this.nFe[k] *= this.nFc[k]
        let a = this.nF[k].process(this.noise())
        if (this.nHasH[k]) a = this.nH[k].process(a)
        if (this.nSt[k]) {
          let b = this.nFR[k].process(this.noise())
          if (this.nHasH[k]) b = this.nHR[k].process(b)
          sL += a * e
          sR += b * e
        } else y += a * e
      }
      // metal
      if (this.mOn) {
        let sq = 0
        for (let j = 0; j < this.mN; j++) {
          const ph = this.mPh[j]
          sq += ph < 0.5 ? 1 : -1
          let np = ph + this.mInc[j]
          if (np >= 1) np -= 1
          this.mPh[j] = np
        }
        sq *= 1 / 6
        let mm = 0
        for (let b = 0; b < this.mNB; b++) mm += this.mB[b].process(sq) * this.mEnv[b].next()
        if (this.mHasHP) mm = this.mHP.process(mm)
        if (this.mAtt < 1) {
          this.mAtt = Math.min(1, this.mAtt + this.mAi)
          mm *= this.mAtt
        }
        y += mm
      }
      let L = y + sL
      let R = y + sR
      if (drv > 0) {
        L = softClip(L * dg) * dInv
        R = softClip(R * dg) * dInv
      }
      if (quant > 0) {
        // 6-bit ROM played through an analog VCA: the quantizer step follows the envelope
        let vca = 1e-3
        for (let k = 0; k < this.nN; k++) if (this.nEnv[k].last > vca) vca = this.nEnv[k].last
        for (let b = 0; b < this.mNB; b++) if (this.mEnv[b].last > vca) vca = this.mEnv[b].last
        for (let o = 0; o < this.nO; o++) if (this.oEnv[o].last > vca) vca = this.oEnv[o].last
        const q = quant / vca
        L = Math.round(L * q) / q
        R = Math.round(R * q) / q
      }
      if (this.hasHP) {
        L = this.hpL.process(L)
        R = this.hpR.process(R)
      }
      if (this.hasLP) {
        L = this.lpL.process(L)
        R = this.lpR.process(R)
      }
      let f = this.fade
      if (this.fadeStep > 0) {
        f -= this.fadeStep
        if (f <= 0) {
          f = 0
          this.active = false
          this.fade = 0
          return
        }
        this.fade = f
      }
      outL[i] += L * gL * f
      outR[i] += R * gR * f
      this.n++
    }
    if (!this.alive()) this.active = false
  }

  alive(): boolean {
    for (let o = 0; o < this.nO; o++) {
      if (this.oRec[o] === 2) {
        if (this.oS1[o] * this.oS1[o] + this.oS2[o] * this.oS2[o] > this.oThr[o]) return true
      } else if (this.oEnv[o].alive()) return true
    }
    for (let k = 0; k < this.nN; k++) if (this.nEnv[k].alive()) return true
    if (this.mOn) for (let b = 0; b < this.mNB; b++) if (this.mEnv[b].alive()) return true
    return false
  }

  /** Rough per-sample cost (for render budgeting). */
  cost(): number {
    return 4 + this.nO * 0.6 + this.nN * 6 + (this.mOn ? 14 : 0)
  }
}

// ─── Level normalization (lazy, cached per recipe & sample rate) ─────────────

const normCache = new WeakMap<Recipe, Map<number, number>>()
let scratchL = new Float32Array(0)
let scratchR = new Float32Array(0)
function scratch(n: number): void {
  if (scratchL.length < n) {
    scratchL = new Float32Array(n)
    scratchR = new Float32Array(n)
  }
}

/** Raw peak of a recipe at reference settings (bits off). */
export function recipePeak(r: Recipe, sr: number): number {
  let m = normCache.get(r)
  if (!m) normCache.set(r, (m = new Map()))
  const c = m.get(sr)
  if (c !== undefined) return c
  const v = new SynthVoice(sr, Math.max(1, r.o?.length ?? 0))
  v.setup(r, REF_MODS, 0, 1)
  v.gainL = v.gainR = 1
  const n = Math.round(sr * 0.3)
  scratch(1024)
  let peak = 0
  for (let pos = 0; pos < n && v.active; pos += 1024) {
    const len = Math.min(1024, n - pos)
    scratchL.fill(0, 0, len)
    scratchR.fill(0, 0, len)
    v.render(scratchL, scratchR, 0, len)
    for (let i = 0; i < len; i++) {
      const a = Math.max(Math.abs(scratchL[i]), Math.abs(scratchR[i]))
      if (a > peak) peak = a
    }
  }
  peak = Math.max(peak, 1e-6)
  m.set(sr, peak)
  return peak
}

// ─── Sample-era kits: ROM rendering + converter ──────────────────────────────

export interface Converter {
  /** machine sample rate */
  rate: number
  /** bit depth (0 = clean float) */
  bits: number
  /** 8-bit companding DAC (µ-law-ish, like the AM6070 in Linn/Oberheim/E-mu machines) */
  mu?: boolean
  /** render at 2x and decimate without anti-alias filtering (SP-1200 grit) */
  alias?: boolean
  /** reconstruction / output filter */
  lp: number
  /** input saturation (tape/preamp) */
  sat?: number
}

export class SampleEntry {
  readonly rate: number
  readonly renderRate: number
  private raw: Float32Array
  clean: Float32Array
  dirty: Float32Array
  len = 0
  done = false
  private voice: SynthVoice | null
  private pos = 0
  private bits: number
  private peak = 1e-9
  /** 0 = rendering, 1 = converting */
  private stage = 0
  private cpos = 0
  private gain = 1
  private q = 0
  private sat = 0
  private satG = 1
  private static readonly MU = 255
  private static readonly LMU = Math.log1p(255)

  constructor(readonly recipe: Recipe, readonly conv: Converter, seed: number) {
    this.rate = conv.rate
    this.renderRate = conv.alias ? conv.rate * 2 : conv.rate
    const maxLen = Math.ceil(estimateLength(recipe) * this.renderRate)
    this.raw = new Float32Array(maxLen)
    this.clean = conv.alias ? new Float32Array(Math.ceil(maxLen / 2)) : this.raw
    this.bits = recipe.bits && conv.bits ? Math.min(recipe.bits, conv.bits) : recipe.bits ?? conv.bits
    this.dirty = this.bits > 0 || conv.sat ? new Float32Array(this.clean.length) : this.clean
    const v = new SynthVoice(this.renderRate, Math.max(1, recipe.o?.length ?? 0))
    v.setup(recipe, REF_MODS, 0, seed)
    v.gainL = v.gainR = 0.5
    this.voice = v
  }

  /** Render/convert up to `budget` cost units (resumable). Returns true when finished. */
  advance(budget: number): boolean {
    if (this.done) return true
    const v = this.voice
    if (this.stage === 0 && v) {
      let n = Math.max(64, Math.floor(budget / v.cost()))
      budget -= n * v.cost()
      scratch(1024)
      while (n > 0 && v.active && this.pos < this.raw.length) {
        const len = Math.min(1024, n, this.raw.length - this.pos)
        scratchL.fill(0, 0, len)
        scratchR.fill(0, 0, len)
        v.render(scratchL, scratchR, 0, len)
        let pk = this.peak
        for (let i = 0; i < len; i++) {
          const x = scratchL[i] + scratchR[i]
          this.raw[this.pos + i] = x
          const ax = x < 0 ? -x : x
          if (ax > pk) pk = ax
        }
        this.peak = pk
        this.pos += len
        n -= len
      }
      if (v.active && this.pos < this.raw.length) return false
      this.beginConvert()
    }
    // conversion: ~12 cost units per sample
    let n = Math.max(256, Math.floor(budget / 12))
    const end = Math.min(this.len, this.cpos + n)
    this.convert(this.cpos, end)
    this.cpos = end
    if (this.cpos >= this.len) {
      this.voice = null
      this.done = true
    }
    return this.done
  }

  /** Complete synchronously (a pad was hit before its background render finished). */
  finish(): void {
    while (!this.done) this.advance(1e12)
  }

  private beginConvert(): void {
    this.stage = 1
    this.len = this.conv.alias ? Math.floor(this.pos / 2) : this.pos
    this.gain = 1 / this.peak
    this.q = this.bits > 0 ? Math.pow(2, this.bits - 1) - 1 : 0
    this.sat = this.conv.sat ?? 0
    this.satG = this.sat > 0 ? 1 / softClip(1 + this.sat * 2) : 1
  }

  private convert(from: number, to: number): void {
    const { raw, clean, dirty, gain, q, sat, satG, len } = this
    const alias = !!this.conv.alias
    const mu = this.conv.mu
    const fadeN = Math.min(len, 64)
    const MU = SampleEntry.MU
    const LMU = SampleEntry.LMU
    for (let i = from; i < to; i++) {
      let x = (alias ? raw[i * 2] : raw[i]) * gain
      if (i >= len - fadeN) x *= (len - i) / fadeN
      clean[i] = x
      if (dirty === clean) continue
      if (sat > 0) x = softClip(x * (1 + sat * 2)) * satG
      if (q > 0) {
        if (mu) {
          const sg = x < 0 ? -1 : 1
          const y = Math.round((Math.log1p(MU * Math.abs(x)) / LMU) * q) / q
          x = (sg * (Math.pow(1 + MU, y) - 1)) / MU
        } else x = Math.round(x * q) / q
      }
      dirty[i] = x
    }
  }
}

/** Upper bound (s) for a recipe's ring-out. */
export function estimateLength(r: Recipe): number {
  let t = 0.05
  const k = 1.4 // -60 dB -> ~-84 dB
  for (const o of r.o ?? []) t = Math.max(t, (o.a ?? 0) + Math.max(o.d, o.d2 ?? 0) * k)
  for (const n of r.n ?? []) t = Math.max(t, (n.delay ?? 0) + (n.a ?? 0) + (n.bursts ?? 1) * (n.gap ?? 0) + Math.max(n.d, n.d2 ?? 0) * k)
  for (const b of r.m?.bands ?? []) t = Math.max(t, Math.max(b.d, b.d2 ?? 0) * k)
  return Math.min(6, t)
}

/** Plays a SampleEntry through the machine's converter character. */
export class SampleVoice {
  active = false
  key = -1
  noteId = -1
  grp = 0
  age = 0
  gainL = 0
  gainR = 0
  fade = 1
  fadeStep = 0
  private e: SampleEntry | null = null
  private pos = 0
  private inc = 1
  private c = 1
  private vca = 1
  private vcaC = 1
  private hasLP = false
  private lp: SVF
  private hp: SVF
  private bright = 0
  constructor(private sr: number) {
    this.lp = new SVF(sr)
    this.hp = new SVF(sr)
    this.hp.mode = 1
  }
  start(e: SampleEntry, ratio: number, decay: number, tone: number, character: number): void {
    this.e = e
    this.pos = 0
    this.inc = (e.rate / this.sr) * ratio
    this.c = clamp(character, 0, 1)
    const t = clamp(tone, -1, 1)
    const nyq = this.sr * 0.45
    let lp = Math.exp(Math.log(Math.min(e.conv.lp, 20000)) * this.c + Math.log(20000) * (1 - this.c))
    if (t < 0) lp = Math.min(lp, 18000 * Math.pow(2, 5 * t))
    this.hasLP = lp < nyq
    this.lp.reset()
    if (this.hasLP) this.lp.set(lp, 0.707)
    this.bright = t > 0 ? t * 1.5 : 0
    this.hp.reset()
    this.hp.set(3000, 0.707)
    this.vca = 1
    if (decay < 0.999) {
      const dur = e.len / e.rate / ratio
      const tau = Math.max(0.004, dur * decay * decay * 0.3)
      this.vcaC = Math.exp(-1 / (tau * this.sr))
    } else this.vcaC = 1
    this.active = true
    this.fade = 1
    this.fadeStep = 0
  }
  release(seconds: number): void {
    const step = 1 / Math.max(1, seconds * this.sr)
    if (this.fadeStep === 0 || step > this.fadeStep) this.fadeStep = step
  }
  render(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const e = this.e
    if (!e) {
      this.active = false
      return
    }
    const cl = e.clean
    const di = e.dirty
    const last = e.len - 1
    const c = this.c
    for (let i = start; i < end; i++) {
      const idx = this.pos | 0
      if (idx >= last) {
        this.active = false
        return
      }
      const fr = this.pos - idx
      const a = cl[idx]
      const vc = a + (cl[idx + 1] - a) * fr
      let v = vc + (di[idx] - vc) * c
      if (this.hasLP) v = this.lp.process(v)
      if (this.bright > 0) v += this.bright * this.hp.process(v)
      v *= this.vca
      this.vca *= this.vcaC
      this.pos += this.inc
      let f = this.fade
      if (this.fadeStep > 0) {
        f -= this.fadeStep
        if (f <= 0) {
          this.active = false
          this.fade = 0
          return
        }
        this.fade = f
      }
      outL[i] += v * this.gainL * f
      outR[i] += v * this.gainR * f
    }
    if (this.vcaC < 1 && this.vca < 1e-4) this.active = false
  }
}
