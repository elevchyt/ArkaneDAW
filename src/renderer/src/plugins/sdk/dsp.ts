// DSP toolkit shared by built-in plugins. Everything here is allocation-free per sample and safe
// to run inside the AudioWorklet thread.

export const TAU = Math.PI * 2

export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)
export const dbToGain = (db: number): number => Math.pow(10, db / 20)
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Fast tanh-ish soft clipper. */
export function softClip(x: number): number {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

/** Equal-power pan: returns [gainL, gainR] for pan in -1..1. */
export function panGains(pan: number): [number, number] {
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]
}

/** One-pole parameter smoother. */
export class Smoother {
  value: number
  target: number
  private coef: number
  constructor(sampleRate: number, initial = 0, timeMs = 20) {
    this.value = this.target = initial
    this.coef = Math.exp(-1 / ((timeMs / 1000) * sampleRate))
  }
  set(v: number): void {
    this.target = v
  }
  jump(v: number): void {
    this.value = this.target = v
  }
  next(): number {
    this.value = this.target + (this.value - this.target) * this.coef
    return this.value
  }
}

/** Linear-in-dB-ish ADSR with exponential segments. Times in seconds. */
export class ADSR {
  stage: 0 | 1 | 2 | 3 | 4 = 0 // idle, attack, decay, sustain, release
  value = 0
  attack = 0.005
  decay = 0.2
  sustain = 0.7
  release = 0.2
  private sr: number
  private aInc = 0
  private dCoef = 0
  private rCoef = 0
  constructor(sampleRate: number) {
    this.sr = sampleRate
    this.update()
  }
  set(a: number, d: number, s: number, r: number): void {
    this.attack = a
    this.decay = d
    this.sustain = s
    this.release = r
    this.update()
  }
  private update(): void {
    this.aInc = 1 / Math.max(1, this.attack * this.sr)
    this.dCoef = Math.exp(-4.6 / Math.max(1, this.decay * this.sr))
    this.rCoef = Math.exp(-4.6 / Math.max(1, this.release * this.sr))
  }
  gate(on: boolean): void {
    if (on) this.stage = 1
    else if (this.stage !== 0) this.stage = 4
  }
  /** Retrigger from current level (legato-safe). */
  reset(): void {
    this.stage = 0
    this.value = 0
  }
  get active(): boolean {
    return this.stage !== 0
  }
  next(): number {
    switch (this.stage) {
      case 1:
        this.value += this.aInc
        if (this.value >= 1) {
          this.value = 1
          this.stage = 2
        }
        break
      case 2:
        this.value = this.sustain + (this.value - this.sustain) * this.dCoef
        if (this.value - this.sustain < 0.0005) this.stage = 3
        break
      case 3:
        this.value = this.sustain
        if (this.sustain <= 0.0001) this.stage = 0
        break
      case 4:
        this.value *= this.rCoef
        if (this.value < 0.0001) {
          this.value = 0
          this.stage = 0
        }
        break
    }
    return this.value
  }
}

/** Zavalishin TPT state-variable filter. mode: 0 LP, 1 HP, 2 BP, 3 notch, 4 peak, 5 allpass */
export class SVF {
  private ic1 = 0
  private ic2 = 0
  private g = 0
  private k = 1
  private a1 = 0
  private a2 = 0
  private a3 = 0
  mode = 0
  constructor(private sr: number) {
    this.set(1000, 0.707)
  }
  /** q: 0.5..20 */
  set(cutoff: number, q: number): void {
    const fc = clamp(cutoff, 10, this.sr * 0.49)
    this.g = Math.tan((Math.PI * fc) / this.sr)
    this.k = 1 / Math.max(0.05, q)
    this.a1 = 1 / (1 + this.g * (this.g + this.k))
    this.a2 = this.g * this.a1
    this.a3 = this.g * this.a2
  }
  reset(): void {
    this.ic1 = this.ic2 = 0
  }
  process(v0: number): number {
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    switch (this.mode) {
      case 0:
        return v2
      case 1:
        return v0 - this.k * v1 - v2
      case 2:
        return v1
      case 3:
        return v0 - this.k * v1
      case 4:
        return v0 - this.k * v1 - 2 * v2
      default:
        return v0 - 2 * this.k * v1
    }
  }
}

/** RBJ biquad (for EQs). type: 'lp'|'hp'|'bp'|'notch'|'peak'|'lowshelf'|'highshelf'|'ap' */
export class Biquad {
  b0 = 1
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  private z1 = 0
  private z2 = 0
  constructor(private sr: number) {}
  set(type: string, freq: number, q: number, gainDb = 0): void {
    const w0 = (TAU * clamp(freq, 5, this.sr * 0.49)) / this.sr
    const cos = Math.cos(w0)
    const sin = Math.sin(w0)
    const alpha = sin / (2 * Math.max(0.05, q))
    const A = Math.pow(10, gainDb / 40)
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0
    switch (type) {
      case 'lp':
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'hp':
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'bp':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'notch':
        b0 = 1; b1 = -2 * cos; b2 = 1; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'ap':
        b0 = 1 - alpha; b1 = -2 * cos; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
        break
      case 'peak':
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A
        break
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s)
        a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s
        break
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s)
        a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s
        break
      }
    }
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }
  reset(): void {
    this.z1 = this.z2 = 0
  }
  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
  /** Magnitude response at freq (for drawing EQ curves on the UI thread). */
  magnitude(freq: number): number {
    const w = (TAU * freq) / this.sr
    const cos1 = Math.cos(w), sin1 = Math.sin(w), cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w)
    const nr = this.b0 + this.b1 * cos1 + this.b2 * cos2
    const ni = -(this.b1 * sin1 + this.b2 * sin2)
    const dr = 1 + this.a1 * cos1 + this.a2 * cos2
    const di = -(this.a1 * sin1 + this.a2 * sin2)
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di))
  }
}

/** PolyBLEP correction for band-limited saw/square. */
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt
    return t + t - t * t - 1
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt
    return t * t + t + t + 1
  }
  return 0
}

/** Band-limited oscillator. shape: 0 sine, 1 triangle, 2 saw, 3 square/pulse, 4 noise */
export class Osc {
  phase = 0
  pw = 0.5
  private tri = 0
  next(shape: number, dt: number): number {
    const t = this.phase
    let out: number
    switch (shape) {
      case 0:
        out = Math.sin(TAU * t)
        break
      case 1: {
        // integrated square -> triangle (leaky)
        let sq = t < 0.5 ? 1 : -1
        sq += polyBlep(t, dt) - polyBlep((t + 0.5) % 1, dt)
        this.tri = dt * 4 * sq + (1 - dt * 0.5) * this.tri
        out = this.tri
        break
      }
      case 2:
        out = 2 * t - 1 - polyBlep(t, dt)
        break
      case 3: {
        const pw = this.pw
        out = t < pw ? 1 : -1
        out += polyBlep(t, dt) - polyBlep((t + 1 - pw) % 1, dt)
        break
      }
      default:
        out = Math.random() * 2 - 1
    }
    this.phase += dt
    if (this.phase >= 1) this.phase -= 1
    return out
  }
}

/** Fractional delay line (power-of-two ring buffer). */
export class DelayLine {
  private buf: Float32Array
  private mask: number
  private w = 0
  constructor(maxSamples: number) {
    let n = 1
    while (n < maxSamples + 4) n <<= 1
    this.buf = new Float32Array(n)
    this.mask = n - 1
  }
  write(x: number): void {
    this.buf[this.w] = x
    this.w = (this.w + 1) & this.mask
  }
  /** Read `delay` samples back (linear interpolation). */
  read(delay: number): number {
    const d = clamp(delay, 1, this.mask - 2)
    const i = Math.floor(d)
    const f = d - i
    const a = this.buf[(this.w - i) & this.mask]
    const b = this.buf[(this.w - i - 1) & this.mask]
    return a + (b - a) * f
  }
  clear(): void {
    this.buf.fill(0)
  }
}

/** Simple LFO. shape: 0 sine, 1 triangle, 2 saw, 3 square, 4 S&H */
export class LFO {
  phase = 0
  private sh = 0
  next(shape: number, inc: number): number {
    const t = this.phase
    let v: number
    switch (shape) {
      case 0: v = Math.sin(TAU * t); break
      case 1: v = 1 - 4 * Math.abs(t - 0.5); break
      case 2: v = 2 * t - 1; break
      case 3: v = t < 0.5 ? 1 : -1; break
      default: v = this.sh
    }
    this.phase += inc
    if (this.phase >= 1) {
      this.phase -= 1
      this.sh = Math.random() * 2 - 1
    }
    return v
  }
}

/** Generic voice allocator with stealing. Voices must expose `active` and `age`. */
export interface VoiceLike {
  active: boolean
  noteId: number
  key: number
  age: number
  releasing: boolean
}

export function allocVoice<V extends VoiceLike>(voices: V[], clock: number): V {
  let best: V | null = null
  for (const v of voices) if (!v.active) return v
  // steal: prefer releasing, then oldest
  for (const v of voices) if (v.releasing && (!best || v.age < best.age)) best = v
  if (best) return best
  for (const v of voices) if (!best || v.age < best.age) best = v
  void clock
  return best!
}
