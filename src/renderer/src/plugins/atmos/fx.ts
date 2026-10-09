// Atmos built-in FX. All process() methods work in place on [start, end) and never allocate.
import { TAU, nextPow2 } from './util'

const SQ8 = 1 / Math.sqrt(8)

class Allpass {
  private buf: Float32Array
  private w = 0
  constructor(private len: number, private g: number) {
    this.buf = new Float32Array(nextPow2(len + 1))
  }
  process(x: number): number {
    const mask = this.buf.length - 1
    const d = this.buf[(this.w - this.len) & mask]
    const v = x + d * this.g
    this.buf[this.w] = v
    this.w = (this.w + 1) & mask
    return d - v * this.g
  }
  clear(): void {
    this.buf.fill(0)
  }
}

/**
 * 8-line FDN reverb (Hadamard feedback, per-line damping & slow delay modulation) with a pitch shifter
 * inside the tank (shimmer) that is energy-neutral: it replaces the tank's mean component by
 * (1-s)·mean + s·shift(mean), so the loop gain never exceeds the decay gain. Freeze holds the tank.
 */
export class ShimmerVerb {
  private static BASE = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
  private S: number
  private mask: number
  private buf: Float32Array
  private w = 0
  private len = new Float64Array(8)
  private lenTarget = new Float64Array(8)
  private gain = new Float64Array(8)
  private damp = new Float64Array(8)
  private modPh = new Float64Array(8)
  private modRate = new Float64Array(8)
  private mod = new Float64Array(8)
  private apL: Allpass[]
  private apR: Allpass[]
  private pre: Float32Array
  private preMask: number
  private preW = 0
  // shifter
  private shBuf = new Float32Array(8192)
  private shW = 0
  private shPh = 0
  private shWin: number
  private shLp = 0
  private shHp = 0
  // settings
  mix = 0
  decay = 4
  size = 0.6
  dampAmt = 0.3
  modAmt = 0.4
  shimmer = 0
  ratio = 2
  freeze = false
  predelay = 0
  private dampCoef = 0.5
  private shimS = 0
  private inGain = 1
  private sizeDirty = true
  constructor(private sr: number) {
    const sc = sr / 44100
    const maxLen = 1617 * 3.0 * sc + 64
    this.S = nextPow2(maxLen)
    this.mask = this.S - 1
    this.buf = new Float32Array(this.S * 8)
    for (let i = 0; i < 8; i++) {
      this.modRate[i] = (0.07 + i * 0.11) / sr
      this.modPh[i] = i / 8
    }
    this.apL = [new Allpass(Math.round(142 * sc), 0.62), new Allpass(Math.round(379 * sc), 0.6), new Allpass(Math.round(107 * sc), 0.55)]
    this.apR = [new Allpass(Math.round(151 * sc), 0.62), new Allpass(Math.round(353 * sc), 0.6), new Allpass(Math.round(113 * sc), 0.55)]
    this.pre = new Float32Array(nextPow2(Math.ceil(sr * 0.26) * 2))
    this.preMask = this.pre.length - 1
    this.shWin = Math.min(4000, Math.round(sr * 0.06))
    this.update()
    for (let i = 0; i < 8; i++) this.len[i] = this.lenTarget[i]
  }
  /** Recompute coefficients (call per block). */
  update(): void {
    const sc = (this.sr / 44100) * (0.4 + 2.6 * this.size)
    for (let i = 0; i < 8; i++) this.lenTarget[i] = ShimmerVerb.BASE[i] * sc
    const fr = this.freeze
    for (let i = 0; i < 8; i++) this.gain[i] = fr ? 1 : Math.pow(10, (-3 * this.lenTarget[i]) / (Math.max(0.2, this.decay) * this.sr))
    const fc = 18000 * Math.pow(2, -this.dampAmt * 5.5)
    this.dampCoef = fr ? 1 : 1 - Math.exp((-TAU * fc) / this.sr)
    this.shimS = fr ? 0 : Math.min(0.95, this.shimmer)
    this.inGain = fr ? 0 : 1
  }
  clear(): void {
    this.buf.fill(0)
    this.pre.fill(0)
    this.shBuf.fill(0)
    this.damp.fill(0)
    for (const a of this.apL) a.clear()
    for (const a of this.apR) a.clear()
  }
  process(L: Float32Array, R: Float32Array, start: number, end: number): void {
    const buf = this.buf
    const S = this.S
    const mask = this.mask
    const len = this.len
    const gain = this.gain
    const damp = this.damp
    const dc = this.dampCoef
    const sh = this.shimS
    const inG = this.inGain * 0.35
    const wet = this.mix * 0.9
    const dry = 1 - this.mix * 0.5
    const preD = Math.max(1, Math.round(this.predelay * this.sr))
    const modDepth = this.modAmt * 14 * (this.sr / 48000)
    const shBuf = this.shBuf
    const shWin = this.shWin
    const shInc = (1 - this.ratio) / shWin
    const shLpC = 1 - Math.exp((-TAU * 7000) / this.sr)
    const shHpC = 1 - Math.exp((-TAU * 250) / this.sr)
    for (let c0 = start; c0 < end; c0 += 32) {
      const c1 = Math.min(end, c0 + 32)
      const n = c1 - c0
      // k-rate: smooth sizes, update modulation
      for (let i = 0; i < 8; i++) {
        len[i] += (this.lenTarget[i] - len[i]) * 0.02
        this.modPh[i] += this.modRate[i] * n
        if (this.modPh[i] >= 1) this.modPh[i] -= 1
        this.mod[i] = len[i] + modDepth * Math.sin(TAU * this.modPh[i])
      }
      const d0 = this.mod[0], d1 = this.mod[1], d2 = this.mod[2], d3 = this.mod[3]
      const d4 = this.mod[4], d5 = this.mod[5], d6 = this.mod[6], d7 = this.mod[7]
      for (let k = c0; k < c1; k++) {
        const xl = L[k]
        const xr = R[k]
        // predelay
        this.pre[this.preW] = xl
        this.pre[(this.preW + 1) & this.preMask] = xr
        const pr = (this.preW - preD * 2) & this.preMask
        const pl = this.pre[pr]
        const prr = this.pre[(pr + 1) & this.preMask]
        this.preW = (this.preW + 2) & this.preMask
        const il = this.apL[2].process(this.apL[1].process(this.apL[0].process(pl))) * inG
        const ir = this.apR[2].process(this.apR[1].process(this.apR[0].process(prr))) * inG
        const w = this.w
        // read lines (linear interpolation)
        const y0 = rd(buf, 0, S, mask, w, d0)
        const y1 = rd(buf, S, S, mask, w, d1)
        const y2 = rd(buf, 2 * S, S, mask, w, d2)
        const y3 = rd(buf, 3 * S, S, mask, w, d3)
        const y4 = rd(buf, 4 * S, S, mask, w, d4)
        const y5 = rd(buf, 5 * S, S, mask, w, d5)
        const y6 = rd(buf, 6 * S, S, mask, w, d6)
        const y7 = rd(buf, 7 * S, S, mask, w, d7)
        // damping + decay
        const z0 = (damp[0] += (y0 - damp[0]) * dc) * gain[0]
        const z1 = (damp[1] += (y1 - damp[1]) * dc) * gain[1]
        const z2 = (damp[2] += (y2 - damp[2]) * dc) * gain[2]
        const z3 = (damp[3] += (y3 - damp[3]) * dc) * gain[3]
        const z4 = (damp[4] += (y4 - damp[4]) * dc) * gain[4]
        const z5 = (damp[5] += (y5 - damp[5]) * dc) * gain[5]
        const z6 = (damp[6] += (y6 - damp[6]) * dc) * gain[6]
        const z7 = (damp[7] += (y7 - damp[7]) * dc) * gain[7]
        // Hadamard 8
        const a0 = z0 + z1, a1 = z0 - z1, a2 = z2 + z3, a3 = z2 - z3
        const a4 = z4 + z5, a5 = z4 - z5, a6 = z6 + z7, a7 = z6 - z7
        const b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3
        const b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7
        let h0 = (b0 + b4) * SQ8, h1 = (b1 + b5) * SQ8, h2 = (b2 + b6) * SQ8, h3 = (b3 + b7) * SQ8
        let h4 = (b0 - b4) * SQ8, h5 = (b1 - b5) * SQ8, h6 = (b2 - b6) * SQ8, h7 = (b3 - b7) * SQ8
        if (sh > 0) {
          const mean = (h0 + h1 + h2 + h3 + h4 + h5 + h6 + h7) * SQ8
          // pitch shifter on the tank's mean component
          shBuf[this.shW] = mean
          let ph = this.shPh + shInc
          if (ph >= 1) ph -= 1
          else if (ph < 0) ph += 1
          this.shPh = ph
          const ph2 = ph >= 0.5 ? ph - 0.5 : ph + 0.5
          const wa = 0.5 - 0.5 * Math.cos(TAU * ph)
          const q = rdShift(shBuf, this.shW, 1 + ph * shWin) * wa + rdShift(shBuf, this.shW, 1 + ph2 * shWin) * (1 - wa)
          this.shW = (this.shW + 1) & 8191
          this.shLp += (q - this.shLp) * shLpC
          this.shHp += (this.shLp - this.shHp) * shHpC
          const qf = this.shLp - this.shHp
          const corr = sh * (qf - mean) * SQ8
          h0 += corr; h1 += corr; h2 += corr; h3 += corr; h4 += corr; h5 += corr; h6 += corr; h7 += corr
        }
        buf[w] = h0 + il
        buf[S + w] = h1 + ir
        buf[2 * S + w] = h2 + il
        buf[3 * S + w] = h3 + ir
        buf[4 * S + w] = h4 + il
        buf[5 * S + w] = h5 + ir
        buf[6 * S + w] = h6 - il
        buf[7 * S + w] = h7 - ir
        this.w = (w + 1) & mask
        const ol = y0 - y2 + y4 - y6 + 0.5 * (y1 - y5)
        const or = y1 - y3 + y5 - y7 + 0.5 * (y2 - y6)
        L[k] = xl * dry + ol * wet
        R[k] = xr * dry + or * wet
      }
    }
  }
}

function rd(buf: Float32Array, base: number, S: number, mask: number, w: number, d: number): number {
  const i = d | 0
  const f = d - i
  const a = buf[base + ((w - i) & mask)]
  const b = buf[base + ((w - i - 1) & mask)]
  void S
  return a + (b - a) * f
}

function rdShift(buf: Float32Array, w: number, d: number): number {
  const i = d | 0
  const f = d - i
  const a = buf[(w - i) & 8191]
  const b = buf[(w - i - 1) & 8191]
  return a + (b - a) * f
}

/** Stereo ping-pong delay with damped feedback. */
export class PingPong {
  private bl: Float32Array
  private br: Float32Array
  private mask: number
  private w = 0
  private d = 0
  private lpL = 0
  private lpR = 0
  private hpL = 0
  private hpR = 0
  mix = 0
  time = 0.4
  fb = 0.4
  constructor(private sr: number) {
    const n = nextPow2(Math.ceil(sr * 2.1))
    this.bl = new Float32Array(n)
    this.br = new Float32Array(n)
    this.mask = n - 1
    this.d = this.time * sr
  }
  clear(): void {
    this.bl.fill(0)
    this.br.fill(0)
    this.lpL = this.lpR = this.hpL = this.hpR = 0
  }
  process(L: Float32Array, R: Float32Array, start: number, end: number): void {
    const target = Math.min(2, Math.max(0.01, this.time)) * this.sr
    const sc = 1 - Math.exp(-1 / (0.08 * this.sr))
    const lpc = 1 - Math.exp((-TAU * 4500) / this.sr)
    const hpc = 1 - Math.exp((-TAU * 150) / this.sr)
    const fb = Math.min(0.9, this.fb)
    const mix = this.mix
    const bl = this.bl
    const br = this.br
    const mask = this.mask
    for (let k = start; k < end; k++) {
      this.d += (target - this.d) * sc
      const di = this.d | 0
      const f = this.d - di
      const i0 = (this.w - di) & mask
      const i1 = (this.w - di - 1) & mask
      const dl = bl[i0] + (bl[i1] - bl[i0]) * f
      const dr = br[i0] + (br[i1] - br[i0]) * f
      this.lpL += (dl - this.lpL) * lpc
      this.hpL += (this.lpL - this.hpL) * hpc
      this.lpR += (dr - this.lpR) * lpc
      this.hpR += (this.lpR - this.hpR) * hpc
      const inp = (L[k] + R[k]) * 0.5
      bl[this.w] = inp + (this.lpR - this.hpR) * fb
      br[this.w] = (this.lpL - this.hpL) * fb
      this.w = (this.w + 1) & mask
      L[k] += dl * mix
      R[k] += dr * mix
    }
  }
}

/** Three-tap-per-side ensemble chorus (slow + fast modulation, Solina style). */
export class Ensemble {
  private bl: Float32Array
  private br: Float32Array
  private w = 0
  private ph = 0
  private ph2 = 0
  private cur = new Float64Array(6)
  private inc = new Float64Array(6)
  mix = 0
  rate = 0.5
  depth = 0.5
  constructor(private sr: number) {
    this.bl = new Float32Array(4096)
    this.br = new Float32Array(4096)
    for (let i = 0; i < 6; i++) this.cur[i] = 0.012 * sr
  }
  clear(): void {
    this.bl.fill(0)
    this.br.fill(0)
  }
  process(L: Float32Array, R: Float32Array, start: number, end: number): void {
    const sr = this.sr
    const base = 0.011 * sr
    const dep = Math.min(1, this.depth) * 0.0045 * sr
    const mix = this.mix
    const dry = 1 - mix * 0.45
    const g = mix * 0.6
    const bl = this.bl
    const br = this.br
    for (let c0 = start; c0 < end; c0 += 32) {
      const c1 = Math.min(end, c0 + 32)
      const n = c1 - c0
      this.ph += (this.rate * n) / sr
      if (this.ph >= 1) this.ph -= 1
      this.ph2 += (this.rate * 7.3 * n) / sr
      if (this.ph2 >= 1) this.ph2 -= 1
      for (let t = 0; t < 6; t++) {
        const off = t / 3 + (t >= 3 ? 1 / 6 : 0)
        const target = base + dep * (0.5 + 0.42 * Math.sin(TAU * (this.ph + off)) + 0.08 * Math.sin(TAU * (this.ph2 + off)))
        this.inc[t] = (target - this.cur[t]) / n
      }
      for (let k = c0; k < c1; k++) {
        bl[this.w] = L[k]
        br[this.w] = R[k]
        let wl = 0
        let wr = 0
        for (let t = 0; t < 3; t++) {
          const d = (this.cur[t] += this.inc[t])
          const i = d | 0
          const f = d - i
          const a = bl[(this.w - i) & 4095]
          wl += a + (bl[(this.w - i - 1) & 4095] - a) * f
        }
        for (let t = 3; t < 6; t++) {
          const d = (this.cur[t] += this.inc[t])
          const i = d | 0
          const f = d - i
          const a = br[(this.w - i) & 4095]
          wr += a + (br[(this.w - i - 1) & 4095] - a) * f
        }
        this.w = (this.w + 1) & 4095
        L[k] = L[k] * dry + wl * g
        R[k] = R[k] * dry + wr * g
      }
    }
  }
}
