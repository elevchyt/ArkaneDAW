// Polygon built-in effects, modelled on early-90s module FX: JV-style chorus, ping-pong delay and a grainy,
// slightly metallic "early digital" reverb (decimated, unmodulated combs, 12-bit-ish truncated feedback, ZOH out).
// Allocation-free per sample; buffers are allocated in constructors only.

function pow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

// ─── Chorus ───────────────────────────────────────────────────────────────────

export class Chorus {
  oL = 0
  oR = 0
  private buf: Float32Array
  private mask: number
  private w = 0
  // quadrature LFO (rotating phasor)
  private x = 1
  private y = 0
  private c = 1
  private s = 0
  private n = 0
  private base = 0
  private depth = 0
  private fb = 0
  private taps = 2
  private fbv = 0
  private lpL = 0
  private lpR = 0
  private lpa = 0.5
  constructor(private sr: number) {
    this.mask = pow2(Math.ceil(sr * 0.06)) - 1
    this.buf = new Float32Array(this.mask + 1)
    this.lpa = 1 - Math.exp((-2 * Math.PI * 9000) / sr)
  }
  set(type: number, rate: number, depth: number): void {
    const w = (2 * Math.PI * rate) / this.sr
    this.c = Math.cos(w)
    this.s = Math.sin(w)
    const ms = this.sr / 1000
    switch (type) {
      case 1: this.base = 12 * ms; this.depth = 4.5 * depth * ms; this.fb = 0.1; this.taps = 2; break
      case 2: this.base = 15 * ms; this.depth = 6 * depth * ms; this.fb = 0; this.taps = 3; break
      case 3: this.base = 2 * ms; this.depth = 1.6 * depth * ms; this.fb = 0.6; this.taps = 2; break
      default: this.base = 7 * ms; this.depth = 2.8 * depth * ms; this.fb = 0; this.taps = 2
    }
  }
  private read(d: number): number {
    const i = d | 0
    const f = d - i
    const a = this.buf[(this.w - i) & this.mask]
    const b = this.buf[(this.w - i - 1) & this.mask]
    return a + (b - a) * f
  }
  process(l: number, r: number): void {
    this.buf[this.w] = (l + r) * 0.5 + this.fbv * this.fb
    // advance LFO
    const nx = this.x * this.c - this.y * this.s
    this.y = this.x * this.s + this.y * this.c
    this.x = nx
    if (++this.n >= 1024) {
      this.n = 0
      const g = 1 / Math.sqrt(this.x * this.x + this.y * this.y)
      this.x *= g
      this.y *= g
    }
    let a: number, b: number
    if (this.taps === 3) {
      const t0 = this.y
      const t1 = this.y * -0.5 + this.x * 0.866
      const t2 = this.y * -0.5 - this.x * 0.866
      const r0 = this.read(this.base + this.depth * t0)
      const r1 = this.read(this.base + this.depth * t1)
      const r2 = this.read(this.base + this.depth * t2)
      a = r0 * 0.7 + r1 * 0.5
      b = r2 * 0.7 + r1 * 0.5
    } else {
      a = this.read(this.base + this.depth * this.y)
      b = this.read(this.base + this.depth * -this.y + 0.37 * this.depth * this.x)
    }
    this.fbv = a
    this.w = (this.w + 1) & this.mask
    this.lpL += (a - this.lpL) * this.lpa
    this.lpR += (b - this.lpR) * this.lpa
    this.oL = this.lpL
    this.oR = this.lpR
  }
  clear(): void {
    this.buf.fill(0)
    this.fbv = this.lpL = this.lpR = 0
  }
}

// ─── Ping-pong delay ──────────────────────────────────────────────────────────

export class PingPong {
  oL = 0
  oR = 0
  private bl: Float32Array
  private br: Float32Array
  private mask: number
  private w = 0
  private time = 0
  private target = 0
  private fb = 0.3
  private dl = 0
  private dr = 0
  constructor(private sr: number) {
    this.mask = pow2(Math.ceil(sr * 1.6)) - 1
    this.bl = new Float32Array(this.mask + 1)
    this.br = new Float32Array(this.mask + 1)
  }
  set(ms: number, fb: number): void {
    this.target = Math.min(this.mask - 4, Math.max(1, (ms / 1000) * this.sr))
    if (this.time === 0) this.time = this.target
    this.fb = fb
  }
  private read(b: Float32Array, d: number): number {
    const i = d | 0
    const f = d - i
    const x = b[(this.w - i) & this.mask]
    const y = b[(this.w - i - 1) & this.mask]
    return x + (y - x) * f
  }
  process(l: number, r: number): void {
    this.time += (this.target - this.time) * 0.0005
    const yl = this.read(this.bl, this.time)
    const yr = this.read(this.br, this.time)
    // HF damping in the loop (tape-less, but darker than the input like a JV delay)
    this.dl += (yl - this.dl) * 0.45
    this.dr += (yr - this.dr) * 0.45
    let wl = (l + r) * 0.5 + this.dr * this.fb
    if (wl > -1e-7 && wl < 1e-7) wl = 0
    this.bl[this.w] = wl
    this.br[this.w] = this.dl
    this.w = (this.w + 1) & this.mask
    this.oL = yl
    this.oR = yr
  }
  clear(): void {
    this.bl.fill(0)
    this.br.fill(0)
    this.dl = this.dr = 0
  }
}

// ─── Lo-fi digital reverb ─────────────────────────────────────────────────────

const COMB = [1116, 1188, 1277, 1356]
const AP = [556, 441]
//               size  RT60  predelay(ms) early-reflection gain
const TYPES = [
  [0.32, 0.55, 4, 0.5],
  [0.45, 1.0, 8, 0.45],
  [0.6, 1.6, 14, 0.35],
  [0.72, 2.3, 18, 0.3],
  [0.88, 3.0, 24, 0.22],
  [1.1, 4.4, 32, 0.18]
]
const Q = 32768 // 16-bit feedback quantization (truncation toward zero avoids limit cycles)

class Comb {
  buf: Float32Array
  i = 0
  g = 0.8
  z = 0
  constructor(public len: number) {
    this.buf = new Float32Array(len)
  }
}

export class LoFiReverb {
  oL = 0
  oR = 0
  private D: number
  private cnt = 0
  private accL = 0
  private accR = 0
  private combs: Comb[][] = [[], []]
  private aps: { buf: Float32Array; i: number }[][] = [[], []]
  private pre: Float32Array
  private preW = 0
  private preLen = 1
  private er = 0.3
  private damp = 0.3
  private holdL = 0
  private holdR = 0
  private lpL = 0
  private lpR = 0
  private fsInt: number
  private type = -1
  private time = -1
  constructor(sr: number) {
    this.D = Math.max(1, Math.round(sr / 24000))
    this.fsInt = sr / this.D
    const k = this.fsInt / 44100
    for (let ch = 0; ch < 2; ch++) {
      for (const c of COMB) this.combs[ch].push(new Comb(Math.ceil((c + ch * 23) * k * 1.15) + 2))
      for (const a of AP) this.aps[ch].push({ buf: new Float32Array(Math.ceil((a + ch * 23) * k) + 1), i: 0 })
    }
    this.pre = new Float32Array(Math.ceil(this.fsInt * 0.05) + 8)
  }
  set(type: number, time: number, tone: number): void {
    this.damp = 0.04 + tone * 0.5
    if (type === this.type && time === this.time) return
    this.type = type
    this.time = time
    const [size, rt, pd, er] = TYPES[Math.max(0, Math.min(TYPES.length - 1, type))]
    const RT = rt * Math.pow(2, (time - 0.5) * 2.4)
    const k = this.fsInt / 44100
    for (let ch = 0; ch < 2; ch++) {
      this.combs[ch].forEach((c, j) => {
        c.len = Math.max(8, Math.min(c.buf.length, Math.round((COMB[j] + ch * 23) * k * size)))
        if (c.i >= c.len) c.i = 0
        c.g = Math.pow(10, (-3 * c.len) / (RT * this.fsInt))
      })
    }
    this.preLen = Math.max(1, Math.min(this.pre.length - 1, Math.round((pd / 1000) * this.fsInt)))
    this.er = er
  }
  private tick(inL: number, inR: number): void {
    const x = (inL + inR) * 0.5
    // predelay
    this.pre[this.preW] = x
    let ri = this.preW - this.preLen
    if (ri < 0) ri += this.pre.length
    const xin = this.pre[ri]
    // a couple of discrete early reflections from the predelay line
    let e1 = this.preW - (this.preLen >> 1)
    if (e1 < 0) e1 += this.pre.length
    let e2 = this.preW - ((this.preLen * 3) >> 2)
    if (e2 < 0) e2 += this.pre.length
    this.preW = (this.preW + 1) % this.pre.length
    const oL = this.chan(0, xin)
    const oR = this.chan(1, xin)
    const erv = this.er * (this.pre[e1] + 0.7 * this.pre[e2])
    this.holdL = oL + erv
    this.holdR = oR + erv * 0.8
  }
  private chan(ch: number, xin: number): number {
    const damp = this.damp
    let s = 0
    const combs = this.combs[ch]
    for (let j = 0; j < 4; j++) {
      const c = combs[j]
      const y = c.buf[c.i]
      c.z = y + (c.z - y) * damp
      c.buf[c.i] = Math.trunc((xin * 0.25 + c.z * c.g) * Q) / Q
      if (++c.i >= c.len) c.i = 0
      s += y
    }
    const aps = this.aps[ch]
    for (let j = 0; j < 2; j++) {
      const a = aps[j]
      const b = a.buf[a.i]
      const v = s + b * 0.5
      a.buf[a.i] = Math.trunc(v * Q) / Q
      s = b - v * 0.5
      if (++a.i >= a.buf.length) a.i = 0
    }
    return s
  }
  process(l: number, r: number): void {
    this.accL += l
    this.accR += r
    if (++this.cnt >= this.D) {
      this.tick(this.accL / this.D, this.accR / this.D)
      this.cnt = 0
      this.accL = this.accR = 0
    }
    // zero-order-hold output with a gentle smoothing pole (the grain stays)
    this.lpL += (this.holdL - this.lpL) * 0.7
    this.lpR += (this.holdR - this.lpR) * 0.7
    if (this.lpL > -1e-9 && this.lpL < 1e-9) this.lpL = 0
    if (this.lpR > -1e-9 && this.lpR < 1e-9) this.lpR = 0
    this.oL = this.lpL
    this.oR = this.lpR
  }
  clear(): void {
    for (const ch of this.combs) for (const c of ch) { c.buf.fill(0); c.z = 0 }
    for (const ch of this.aps) for (const a of ch) a.buf.fill(0)
    this.pre.fill(0)
    this.holdL = this.holdR = this.lpL = this.lpR = 0
  }
}
