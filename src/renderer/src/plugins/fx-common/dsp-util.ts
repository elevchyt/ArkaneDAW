// Shared DSP helpers for the built-in effects pack. Worklet-safe: no DOM, no React, no allocation
// in per-sample methods. (This folder is not a plugin: it has no manifest/dsp.ts/index.tsx.)

export { TAU, clamp, dbToGain, softClip, Smoother, Biquad, DelayLine, LFO } from '../sdk/dsp'

/** Flush tiny values to zero (keeps recursive filters out of denormal territory). */
export const flush = (x: number): number => (x > 1e-15 || x < -1e-15 ? x : 0)

export const gainToDb = (g: number): number => 20 * Math.log10(g > 1e-9 ? g : 1e-9)

/** FL-style dry/wet balance: 0 = dry only, 0.5 = both at full level, 1 = wet only. */
export const dryGain = (mix: number): number => (mix <= 0.5 ? 1 : 2 - 2 * mix)
export const wetGain = (mix: number): number => (mix >= 0.5 ? 1 : 2 * mix)

/** Time constant (ms) -> one-pole coefficient. */
export const msCoef = (ms: number, sr: number): number => (ms <= 0 ? 0 : Math.exp(-1 / ((ms / 1000) * sr)))

/** One-pole low/high pass (6 dB/oct), TPT form so cutoff can be modulated. */
export class OnePole {
  private s = 0
  private g = 0
  constructor(private sr: number, freq = 1000) {
    this.setFreq(freq)
  }
  setFreq(f: number): void {
    const fc = Math.min(Math.max(f, 1), this.sr * 0.49)
    const t = Math.tan((Math.PI * fc) / this.sr)
    this.g = t / (1 + t)
  }
  lp(x: number): number {
    const v = (x - this.s) * this.g
    const y = v + this.s
    this.s = flush(y + v)
    return y
  }
  hp(x: number): number {
    return x - this.lp(x)
  }
  reset(): void {
    this.s = 0
  }
}

/** DC blocker (~10 Hz). */
export class DCBlocker {
  private x1 = 0
  private y1 = 0
  private r: number
  constructor(sr: number, freq = 10) {
    this.r = Math.exp((-2 * Math.PI * freq) / sr)
  }
  process(x: number): number {
    const y = x - this.x1 + this.r * this.y1
    this.x1 = x
    this.y1 = flush(y)
    return y
  }
  reset(): void {
    this.x1 = this.y1 = 0
  }
}

/**
 * TPT state-variable filter with cheap per-sample retuning (for modulated filters).
 * Returns all outputs via fields after process(): lp, bp, hp.
 */
export class ModSVF {
  lp = 0
  bp = 0
  hp = 0
  private ic1 = 0
  private ic2 = 0
  private g = 0
  private k = 1.4
  private a1 = 0
  private a2 = 0
  private a3 = 0
  constructor(private sr: number) {
    this.set(1000, 0.707)
  }
  set(freq: number, q: number): void {
    const fc = Math.min(Math.max(freq, 10), this.sr * 0.47)
    this.g = Math.tan((Math.PI * fc) / this.sr)
    this.k = 1 / (q < 0.05 ? 0.05 : q)
    this.a1 = 1 / (1 + this.g * (this.g + this.k))
    this.a2 = this.g * this.a1
    this.a3 = this.g * this.a2
  }
  get kq(): number {
    return this.k
  }
  process(v0: number): void {
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = flush(2 * v1 - this.ic1)
    this.ic2 = flush(2 * v2 - this.ic2)
    this.lp = v2
    this.bp = v1
    this.hp = v0 - this.k * v1 - v2
  }
  reset(): void {
    this.ic1 = this.ic2 = this.lp = this.bp = this.hp = 0
  }
}

/** Delay line with 4-point Hermite interpolation (for chorus/flanger: brighter than linear). */
export class ModDelay {
  private buf: Float32Array
  private mask: number
  private w = 0
  constructor(maxSamples: number) {
    let n = 1
    while (n < maxSamples + 8) n <<= 1
    this.buf = new Float32Array(n)
    this.mask = n - 1
  }
  write(x: number): void {
    this.buf[this.w] = x
    this.w = (this.w + 1) & this.mask
  }
  /** Read `d` samples back (d >= 1). */
  read(d: number): number {
    if (d < 1) d = 1
    else if (d > this.mask - 4) d = this.mask - 4
    const i = Math.floor(d)
    const f = d - i
    const b = this.buf
    const m = this.mask
    const w = this.w
    const xm1 = b[(w - i + 1) & m]
    const x0 = b[(w - i) & m]
    const x1 = b[(w - i - 1) & m]
    const x2 = b[(w - i - 2) & m]
    const c1 = 0.5 * (x1 - xm1)
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1)
    return ((c3 * f + c2) * f + c1) * f + x0
  }
  /** Integer tap. */
  tap(d: number): number {
    return this.buf[(this.w - d) & this.mask]
  }
  clear(): void {
    this.buf.fill(0)
  }
}

// ─── Half-band oversampling (polyphase FIR) ────────────────────────────────────

function halfbandTaps(P: number): Float64Array {
  // odd taps h[2i-1], i = 1..P of a Blackman-windowed half-band low-pass (cutoff fs/4)
  const N = 2 * P - 1 // max |k|
  const out = new Float64Array(P)
  for (let i = 1; i <= P; i++) {
    const k = 2 * i - 1
    const sinc = Math.sin((Math.PI * k) / 2) / ((Math.PI * k) / 2)
    const t = (k + N + 1) / (2 * N + 2) // 0..1 across the window
    const w = 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t)
    out[i - 1] = 0.5 * sinc * w
  }
  // normalize so that DC gain is exactly 1: 0.5 + 2*sum(odd) = 1
  let s = 0
  for (let i = 0; i < P; i++) s += out[i]
  const scale = 0.25 / s
  for (let i = 0; i < P; i++) out[i] *= scale
  return out
}

/** 2x upsampler: push one sample, read `a` then `b` at the doubled rate. */
export class Up2 {
  a = 0
  b = 0
  private h: Float64Array
  private buf: Float64Array
  private pos = 0
  private n: number
  constructor(private P: number) {
    this.h = halfbandTaps(P)
    this.n = 2 * P
    this.buf = new Float64Array(this.n * 2)
  }
  push(x: number): void {
    // history ring (doubled for contiguous reads); newest at index pos+n-1 after write
    const n = this.n
    this.buf[this.pos] = x
    this.buf[this.pos + n] = x
    this.pos = (this.pos + 1) % n
    // contiguous window buf[pos .. pos+n-1] = x[m-n+1 .. m] (m = newest).
    // Emit the half-way interpolation between x[c-1] and x[c] first, then x[c] itself, with
    // c = m - P + 1. Original samples land on odd high-rate positions, matching Down2's centring.
    const c = this.pos + this.P
    let acc = 0
    const h = this.h
    for (let i = 1; i <= this.P; i++) acc += h[i - 1] * (this.buf[c - i] + this.buf[c + i - 1])
    this.a = 2 * acc
    this.b = this.buf[c]
  }
  reset(): void {
    this.buf.fill(0)
    this.a = this.b = 0
  }
}

/** 2x decimator: feed two high-rate samples, returns one. */
export class Down2 {
  private h: Float64Array
  private ev: Float64Array
  private od: Float64Array
  private pos = 0
  private n: number
  constructor(private P: number) {
    this.h = halfbandTaps(P)
    this.n = 2 * P
    this.ev = new Float64Array(this.n * 2)
    this.od = new Float64Array(this.n * 2)
  }
  process(e: number, o: number): number {
    const n = this.n
    this.ev[this.pos] = e
    this.ev[this.pos + n] = e
    this.od[this.pos] = o
    this.od[this.pos + n] = o
    this.pos = (this.pos + 1) % n
    // newest pair index m at pos+n-1. Centred on odd samples so the delay is an integer number
    // of output samples (P): z[q] = 0.5*O[q] + sum_i h_i * (E[q-i+1] + E[q+i]),  q = m-P
    const m = this.pos + n - 1
    const q = m - this.P
    let acc = 0.5 * this.od[q]
    const h = this.h
    for (let i = 1; i <= this.P; i++) acc += h[i - 1] * (this.ev[q - i + 1] + this.ev[q + i])
    return acc
  }
  reset(): void {
    this.ev.fill(0)
    this.od.fill(0)
  }
}

/**
 * 4x oversampler around a per-sample nonlinearity:
 *   os.process(x, fn) -> runs fn at 4x and returns the decimated result.
 */
export class Oversampler4x {
  /** Total latency in base-rate samples: 2*P1 + P2. */
  static readonly LATENCY = 41
  private u1 = new Up2(16)
  private u2 = new Up2(10)
  private d2 = new Down2(10)
  private d1 = new Down2(16)
  private z = 0 // one-sample delay of the 2x stream: makes the total latency a whole base sample
  process(x: number, fn: (v: number) => number): number {
    this.u1.push(x)
    this.u2.push(this.z)
    this.z = this.u1.b
    const y0 = fn(this.u2.a)
    const y1 = fn(this.u2.b)
    this.u2.push(this.u1.a)
    const y2 = fn(this.u2.a)
    const y3 = fn(this.u2.b)
    const h0 = this.d2.process(y0, y1)
    const h1 = this.d2.process(y2, y3)
    return this.d1.process(h0, h1)
  }
  reset(): void {
    this.z = 0
    this.u1.reset()
    this.u2.reset()
    this.d2.reset()
    this.d1.reset()
  }
}

/**
 * UI link: the editor sends `{ t: 'ui' }` heartbeats while it is open; the DSP only computes/posts
 * visual feedback (meters, spectra) while the heartbeat is fresh.
 */
export class UiLink {
  private alive = 0
  private count = 0
  private period: number
  constructor(private sr: number, rateHz = 30) {
    this.period = Math.max(64, Math.round(sr / rateHz))
  }
  onMessage(msg: unknown): boolean {
    if (msg && typeof msg === 'object' && (msg as { t?: string }).t === 'ui') {
      this.alive = this.sr * 2
      return true
    }
    return false
  }
  get active(): boolean {
    return this.alive > 0
  }
  /** Advance by n frames; returns true when it's time to post an update. */
  tick(n: number): boolean {
    if (this.alive <= 0) return false
    this.alive -= n
    this.count += n
    if (this.count >= this.period) {
      this.count = 0
      return true
    }
    return false
  }
}

/** Radix-2 in-place complex FFT (preallocated twiddles). */
export class FFT {
  readonly size: number
  private cos: Float64Array
  private sin: Float64Array
  private rev: Uint32Array
  constructor(size: number) {
    this.size = size
    this.cos = new Float64Array(size / 2)
    this.sin = new Float64Array(size / 2)
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size)
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size)
    }
    this.rev = new Uint32Array(size)
    const bits = Math.log2(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
  }
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size
    for (let i = 0; i < n; i++) {
      const j = this.rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1
      const step = n / len
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const wr = this.cos[j * step]
          const wi = this.sin[j * step]
          const a = i + j
          const b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
  }
}

/**
 * Collects mono audio and produces a log-frequency magnitude spectrum (dB) in `bands`
 * (BANDS points spanning 20 Hz..20 kHz). Allocation-free after construction.
 */
export class SpectrumAnalyzer {
  static readonly BANDS = 96
  readonly bands = new Float32Array(SpectrumAnalyzer.BANDS)
  private fft: FFT
  private ring: Float32Array
  private w = 0
  private re: Float64Array
  private im: Float64Array
  private win: Float64Array
  private lo: Uint16Array
  private hi: Uint16Array
  constructor(private sr: number, size = 4096) {
    this.fft = new FFT(size)
    this.ring = new Float32Array(size)
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)
    this.win = new Float64Array(size)
    for (let i = 0; i < size; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
    const B = SpectrumAnalyzer.BANDS
    this.lo = new Uint16Array(B)
    this.hi = new Uint16Array(B)
    const binHz = sr / size
    for (let b = 0; b < B; b++) {
      const f0 = 20 * Math.pow(1000, b / B)
      const f1 = 20 * Math.pow(1000, (b + 1) / B)
      const i0 = Math.max(1, Math.floor(f0 / binHz))
      const i1 = Math.max(i0 + 1, Math.min(size / 2, Math.ceil(f1 / binHz)))
      this.lo[b] = i0
      this.hi[b] = i1
    }
    this.bands.fill(-120)
  }
  push(x: number): void {
    this.ring[this.w] = x
    this.w = (this.w + 1) % this.ring.length
  }
  compute(): Float32Array {
    const n = this.ring.length
    for (let i = 0; i < n; i++) {
      this.re[i] = this.ring[(this.w + i) % n] * this.win[i]
      this.im[i] = 0
    }
    this.fft.transform(this.re, this.im)
    const norm = 4 / n // hann coherent gain 0.5, single-sided x2
    for (let b = 0; b < this.bands.length; b++) {
      let m = 0
      for (let i = this.lo[b]; i < this.hi[b]; i++) {
        const p = this.re[i] * this.re[i] + this.im[i] * this.im[i]
        if (p > m) m = p
      }
      const db = 10 * Math.log10(m * norm * norm + 1e-14)
      // light temporal smoothing (fall), instant rise
      const prev = this.bands[b]
      this.bands[b] = db > prev ? db : prev - Math.min(6, prev - db)
    }
    return this.bands
  }
  reset(): void {
    this.ring.fill(0)
    this.bands.fill(-120)
  }
}

/** Sliding-window minimum over the last `len` pushed values (monotonic deque, O(1) amortized). */
export class SlidingMin {
  private val: Float64Array
  private idx: Float64Array
  private head = 0
  private tail = 0
  private cap: number
  private t = 0
  len: number
  constructor(maxLen: number) {
    this.cap = maxLen + 2
    this.val = new Float64Array(this.cap)
    this.idx = new Float64Array(this.cap)
    this.len = maxLen
  }
  push(v: number): number {
    const cap = this.cap
    // pop larger-or-equal values from the back
    while (this.tail !== this.head) {
      const last = (this.tail - 1 + cap) % cap
      if (this.val[last] >= v) this.tail = last
      else break
    }
    this.val[this.tail] = v
    this.idx[this.tail] = this.t
    this.tail = (this.tail + 1) % cap
    // expire from the front
    while (this.idx[this.head] <= this.t - this.len) this.head = (this.head + 1) % cap
    this.t++
    return this.val[this.head]
  }
  reset(): void {
    this.head = this.tail = 0
    this.t = 0
  }
}
