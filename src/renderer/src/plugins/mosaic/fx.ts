// Mosaic master effects: EQ (3-band) → Chorus/Ensemble → Phaser → Delay → Reverb (8-line FDN).
// Compact, allocation-free in process().
import { Biquad } from '../sdk/dsp'

const TAU = Math.PI * 2

export interface FXParams {
  eqLow: number
  eqMid: number
  eqMidF: number
  eqHigh: number
  choOn: boolean
  choRate: number
  choDepth: number
  choMix: number
  phaOn: boolean
  phaRate: number
  phaDepth: number
  phaFb: number
  phaMix: number
  dlyOn: boolean
  dlyTime: number // ms
  dlyFb: number
  dlyTone: number
  dlyPP: boolean
  dlyMix: number
  revOn: boolean
  revSize: number
  revDecay: number // s
  revDamp: number
  revPre: number // ms
  revMix: number
}

class Ring {
  buf: Float32Array
  mask: number
  w = 0
  constructor(len: number) {
    let n = 1
    while (n < len + 4) n <<= 1
    this.buf = new Float32Array(n)
    this.mask = n - 1
  }
  push(x: number): void {
    this.buf[this.w] = x
    this.w = (this.w + 1) & this.mask
  }
  /** integer delay d ≥ 1 */
  at(d: number): number {
    return this.buf[(this.w - d) & this.mask]
  }
  /** fractional delay d ≥ 1 */
  frac(d: number): number {
    const i = d | 0
    const f = d - i
    const a = this.buf[(this.w - i) & this.mask]
    const b = this.buf[(this.w - i - 1) & this.mask]
    return a + (b - a) * f
  }
  clear(): void {
    this.buf.fill(0)
  }
}

class Allpass {
  ring: Ring
  constructor(
    public len: number,
    public g: number
  ) {
    this.ring = new Ring(len)
  }
  process(x: number): number {
    const d = this.ring.at(this.len)
    const v = x - this.g * d
    this.ring.push(v)
    return d + this.g * v
  }
}

const REV_MS = [31.3, 37.9, 41.3, 47.1, 53.7, 59.3, 67.1, 73.9]

export class MasterFX {
  private sr: number
  // EQ
  private eq: Biquad[] = []
  private eqKey = ''
  // chorus
  private choL: Ring
  private choR: Ring
  private choPh = 0
  // phaser
  private phZL = new Float64Array(6)
  private phZR = new Float64Array(6)
  private phPh = 0
  private phFbL = 0
  private phFbR = 0
  // delay
  private dL: Ring
  private dR: Ring
  private dTime = -1
  private dLpL = 0
  private dLpR = 0
  // reverb
  private pre: Ring
  private diff: Allpass[]
  private lines: Ring[]
  private lp = new Float64Array(8)
  private len = new Float64Array(8)
  private gain = new Float64Array(8)
  private revPh = 0
  private revKey = ''
  private revTail = 0
  private dlyTail = 0
  private den = 1e-18

  constructor(sr: number) {
    this.sr = sr
    for (let i = 0; i < 6; i++) this.eq.push(new Biquad(sr))
    this.choL = new Ring(Math.ceil(sr * 0.05))
    this.choR = new Ring(Math.ceil(sr * 0.05))
    this.dL = new Ring(Math.ceil(sr * 2.1))
    this.dR = new Ring(Math.ceil(sr * 2.1))
    this.pre = new Ring(Math.ceil(sr * 0.25))
    this.diff = [4.77, 3.59, 12.73, 9.31].map((ms) => new Allpass(Math.round((ms / 1000) * sr), 0.7))
    this.lines = REV_MS.map((ms) => new Ring(Math.ceil((ms / 1000) * sr * 1.7) + 32))
  }

  reset(): void {
    for (const b of this.eq) b.reset()
    this.choL.clear()
    this.choR.clear()
    this.phZL.fill(0)
    this.phZR.fill(0)
    this.dL.clear()
    this.dR.clear()
    this.pre.clear()
    for (const a of this.diff) a.ring.clear()
    for (const l of this.lines) l.clear()
    this.lp.fill(0)
  }

  process(L: Float32Array, R: Float32Array, n: number, p: FXParams): void {
    const sr = this.sr
    // anti-denormal: tiny alternating offset keeps feedback states out of subnormal range
    this.den = -this.den
    const den = this.den

    // ── EQ ──
    const ek = `${p.eqLow}|${p.eqMid}|${p.eqMidF}|${p.eqHigh}`
    if (ek !== this.eqKey) {
      this.eqKey = ek
      for (let c = 0; c < 2; c++) {
        this.eq[c * 3].set('lowshelf', 180, 0.7, p.eqLow)
        this.eq[c * 3 + 1].set('peak', p.eqMidF, 0.8, p.eqMid)
        this.eq[c * 3 + 2].set('highshelf', 4500, 0.7, p.eqHigh)
      }
    }
    if (p.eqLow !== 0 || p.eqMid !== 0 || p.eqHigh !== 0) {
      const [l0, l1, l2, r0, r1, r2] = this.eq
      for (let i = 0; i < n; i++) {
        L[i] = l2.process(l1.process(l0.process(L[i] + den)))
        R[i] = r2.process(r1.process(r0.process(R[i] + den)))
      }
    }

    // ── Chorus / ensemble (3 modulated taps per side, 120° apart) ──
    if (p.choOn && p.choMix > 0.001) {
      const inc = p.choRate / sr
      const base = 0.007 * sr
      const depth = (0.0005 + p.choDepth * 0.0045) * sr
      const mix = Math.min(1, p.choMix)
      const cl = this.choL
      const cr = this.choR
      let ph = this.choPh
      const third = 1 / 3
      for (let i = 0; i < n; i++) {
        const xl = L[i]
        const xr = R[i]
        cl.push(xl)
        cr.push(xr)
        const s0 = Math.sin(TAU * ph)
        const s1 = Math.sin(TAU * (ph + third))
        const s2 = Math.sin(TAU * (ph + 2 * third))
        const wl = (cl.frac(base + depth * s0) + cl.frac(base + depth * s1) + cl.frac(base + depth * s2)) * 0.4
        const wr = (cr.frac(base - depth * s0) + cr.frac(base - depth * s2) + cr.frac(base - depth * s1)) * 0.4
        L[i] = xl * (1 - mix * 0.45) + wl * mix
        R[i] = xr * (1 - mix * 0.45) + wr * mix
        ph += inc
        if (ph >= 1) ph -= 1
      }
      this.choPh = ph
    }

    // ── Phaser (6 first-order allpasses, stereo quadrature LFO) ──
    if (p.phaOn && p.phaMix > 0.001) {
      const zl = this.phZL
      const zr = this.phZR
      const fb = p.phaFb
      const mix = Math.min(1, p.phaMix)
      let ph = this.phPh
      const inc = p.phaRate / sr
      let al = 0
      let ar = 0
      for (let i = 0; i < n; i++) {
        if ((i & 15) === 0) {
          const ml = 0.5 + 0.5 * Math.sin(TAU * ph)
          const mr = 0.5 + 0.5 * Math.sin(TAU * (ph + 0.25))
          const span = 1 + p.phaDepth * 4.5
          const fl = 180 * Math.pow(2, ml * span)
          const fr = 180 * Math.pow(2, mr * span)
          const tl = Math.tan((Math.PI * Math.min(fl, sr * 0.45)) / sr)
          const tr = Math.tan((Math.PI * Math.min(fr, sr * 0.45)) / sr)
          al = (tl - 1) / (tl + 1)
          ar = (tr - 1) / (tr + 1)
        }
        let yl = L[i] + this.phFbL * fb
        let yr = R[i] + this.phFbR * fb
        for (let k = 0; k < 6; k++) {
          const ol = al * yl + zl[k]
          zl[k] = yl - al * ol
          yl = ol
          const or = ar * yr + zr[k]
          zr[k] = yr - ar * or
          yr = or
        }
        this.phFbL = yl
        this.phFbR = yr
        L[i] = (L[i] + yl * mix) / (1 + mix * 0.5)
        R[i] = (R[i] + yr * mix) / (1 + mix * 0.5)
        ph += inc
        if (ph >= 1) ph -= 1
      }
      this.phPh = ph
    }

    // ── Delay (stereo or ping-pong) ──
    if (p.dlyOn && p.dlyMix > 0.001) {
      const target = Math.max(1, Math.min(2 * sr, (p.dlyTime / 1000) * sr))
      if (this.dTime < 0) this.dTime = target
      const sm = 1 - Math.exp(-1 / (0.05 * sr))
      const fb = Math.min(0.95, p.dlyFb)
      const lpA = Math.exp((-TAU * (800 + p.dlyTone * p.dlyTone * 15000)) / sr)
      const mix = Math.min(1, p.dlyMix)
      const pp = p.dlyPP
      for (let i = 0; i < n; i++) {
        this.dTime += (target - this.dTime) * sm
        const yl = this.dL.frac(this.dTime)
        const yr = this.dR.frac(this.dTime)
        this.dLpL = yl + (this.dLpL - yl) * lpA
        this.dLpR = yr + (this.dLpR - yr) * lpA
        const xl = L[i]
        const xr = R[i]
        if (pp) {
          this.dL.push((xl + xr) * 0.5 + this.dLpR * fb + den)
          this.dR.push(this.dLpL * fb + den)
        } else {
          this.dL.push(xl + this.dLpL * fb + den)
          this.dR.push(xr + this.dLpR * fb + den)
        }
        L[i] = xl + yl * mix
        R[i] = xr + yr * mix
      }
      this.dlyTail = 1
    } else if (this.dlyTail) {
      this.dL.clear()
      this.dR.clear()
      this.dlyTail = 0
      this.dTime = -1
    }

    // ── Reverb: predelay → diffusion → 8-line FDN (Householder) ──
    if (p.revOn && p.revMix > 0.001) {
      const scale = 0.35 + p.revSize * 1.3
      const rk = `${scale}|${p.revDecay}`
      if (rk !== this.revKey) {
        this.revKey = rk
        for (let k = 0; k < 8; k++) {
          const len = (REV_MS[k] / 1000) * sr * scale
          this.len[k] = len
          this.gain[k] = Math.pow(10, (-3 * len) / sr / Math.max(0.1, p.revDecay))
        }
      }
      const damp = Math.exp((-TAU * (16000 - p.revDamp * 14500)) / sr)
      const pre = Math.max(1, (p.revPre / 1000) * sr)
      const mix = Math.min(1, p.revMix)
      const lines = this.lines
      const lp = this.lp
      const g = this.gain
      const len = this.len
      const d = this.diff
      const o = O
      const modInc = 0.6 / sr
      let ph = this.revPh
      for (let i = 0; i < n; i++) {
        const xl = L[i]
        const xr = R[i]
        this.pre.push((xl + xr) * 0.5)
        let x = this.pre.frac(pre)
        x = d[3].process(d[2].process(d[1].process(d[0].process(x))))
        const mod = Math.sin(TAU * ph) * 6
        ph += modInc
        if (ph >= 1) ph -= 1
        let sum = 0
        for (let k = 0; k < 8; k++) {
          const raw = k === 0 ? lines[0].frac(len[0] + mod) : k === 5 ? lines[5].frac(len[5] - mod) : lines[k].at(len[k] | 0)
          o[k] = raw
          const s = raw + (lp[k] - raw) * damp
          lp[k] = s
          const v = s * g[k]
          F[k] = v
          sum += v
        }
        const hh = sum * 0.25
        for (let k = 0; k < 8; k++) lines[k].push(F[k] - hh + (k & 1 ? -x : x) + den)
        const wl = (o[0] - o[2] + o[4] - o[6] + o[1] * 0.3) * 0.32
        const wr = (o[1] - o[3] + o[5] - o[7] + o[2] * 0.3) * 0.32
        L[i] = xl * (1 - mix * 0.3) + wl * mix
        R[i] = xr * (1 - mix * 0.3) + wr * mix
      }
      this.revPh = ph
      this.revTail = 1
    } else if (this.revTail) {
      for (const l of this.lines) l.clear()
      this.lp.fill(0)
      this.revTail = 0
    }
  }
}

const O = new Float64Array(8)
const F = new Float64Array(8)
