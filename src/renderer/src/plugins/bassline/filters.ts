// Bass filters & tables. Allocation-free per sample; safe for the AudioWorklet.

const TN = 4096
const SIN = new Float32Array(TN + 1)
for (let i = 0; i <= TN; i++) SIN[i] = Math.sin((2 * Math.PI * i) / TN)

/** Table sine; `ph` in cycles (any real value). */
export function sin1(ph: number): number {
  let x = ph - Math.floor(ph)
  x *= TN
  const i = x | 0
  const f = x - i
  return SIN[i] + (SIN[i + 1] - SIN[i]) * f
}

/** tanh-like soft clipper (bounded to ±1). */
export function sat(x: number): number {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

/** Cheap 2^x for |x| < ~20 (control-rate use is fine with Math.pow too). */
export const exp2 = (x: number): number => Math.pow(2, x)

/**
 * Zero-delay-feedback transistor ladder (4 poles, 24 dB/oct, Moog-ish) / diode ladder (3 poles, 18 dB/oct,
 * TB-303-ish squelch: no bass compensation, hotter input saturation) / TPT SVF (LP/BP/HP 12 dB).
 * mode: 0 off, 1 ladder, 2 diode, 3 LP12, 4 BP12, 5 HP12
 */
export class BassFilter {
  mode = 1
  private G = 0
  private k = 0
  private comp = 0
  private s1 = 0
  private s2 = 0
  private s3 = 0
  private s4 = 0
  // SVF
  private g = 0
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private kk = 1
  private ic1 = 0
  private ic2 = 0
  private drive = 1
  private outGain = 1
  constructor(private sr: number) {}

  reset(): void {
    this.s1 = this.s2 = this.s3 = this.s4 = this.ic1 = this.ic2 = 0
  }

  /** fc in Hz, res 0..1 (ladder self-oscillates near 1), drive 0..1 */
  set(fc: number, res: number, drive: number): void {
    const f = fc < 15 ? 15 : fc > this.sr * 0.45 ? this.sr * 0.45 : fc
    const g = Math.tan((Math.PI * f) / this.sr)
    if (this.mode <= 2) {
      this.G = g / (1 + g)
      if (this.mode === 2) {
        this.k = res * res * 8.6 + res * 0.4
        this.comp = 0.1
        this.drive = 1.3 + drive * 5
        this.outGain = 1 / (0.9 + drive * 1.6)
      } else {
        this.k = res * 4.15
        this.comp = 0.55
        this.drive = 1 + drive * 4
        this.outGain = 1 / (0.85 + drive * 1.4)
      }
    } else {
      this.g = g
      this.kk = 2 - 1.96 * res
      this.a1 = 1 / (1 + g * (g + this.kk))
      this.a2 = g * this.a1
      this.a3 = g * this.a2
      this.drive = 1 + drive * 3
      this.outGain = 1 / (1 + drive * 1.2)
    }
  }

  process(x: number): number {
    const mode = this.mode
    if (mode === 0) return x
    if (mode === 1) {
      const G = this.G
      const H = 1 - G
      const k = this.k
      const xi = x * this.drive * (1 + k * this.comp)
      const G2 = G * G
      const sigma = G2 * G * H * this.s1 + G2 * H * this.s2 + G * H * this.s3 + H * this.s4
      const y4est = (G2 * G2 * xi + sigma) / (1 + k * G2 * G2)
      const u = sat(xi - k * y4est)
      let v = (u - this.s1) * G
      const y1 = v + this.s1
      this.s1 = y1 + v
      v = (y1 - this.s2) * G
      const y2 = v + this.s2
      this.s2 = y2 + v
      v = (y2 - this.s3) * G
      const y3 = v + this.s3
      this.s3 = y3 + v
      v = (y3 - this.s4) * G
      const y4 = v + this.s4
      this.s4 = y4 + v
      return y4 * this.outGain
    }
    if (mode === 2) {
      const G = this.G
      const H = 1 - G
      const k = this.k
      const xi = x * this.drive * (1 + k * this.comp)
      const G2 = G * G
      const sigma = G2 * H * this.s1 + G * H * this.s2 + H * this.s3
      const y3est = (G2 * G * xi + sigma) / (1 + k * G2 * G)
      const u = sat(xi - sat(k * y3est))
      let v = (u - this.s1) * G
      const y1 = v + this.s1
      this.s1 = y1 + v
      v = (y1 - this.s2) * G
      const y2 = v + this.s2
      this.s2 = y2 + v
      v = (y2 - this.s3) * G
      const y3 = v + this.s3
      this.s3 = y3 + v
      return y3 * this.outGain
    }
    const v0 = sat(x * this.drive * 0.7) / 0.7
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    if (mode === 3) return v2 * this.outGain
    if (mode === 4) return v1 * this.kk * 1.5 * this.outGain
    return (v0 - this.kk * v1 - v2) * this.outGain
  }
}

/** Minimal TPT bandpass used for formants / clicks. */
export class BP {
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private k = 1
  private ic1 = 0
  private ic2 = 0
  constructor(private sr: number) {}
  set(fc: number, q: number): void {
    const f = fc < 20 ? 20 : fc > this.sr * 0.45 ? this.sr * 0.45 : fc
    const g = Math.tan((Math.PI * f) / this.sr)
    this.k = 1 / q
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  reset(): void {
    this.ic1 = this.ic2 = 0
  }
  /** Returns the band-pass output normalized to unity gain at the centre. */
  process(x: number): number {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return v1 * this.k
  }
}

/** ADSR with exponential decay/release, linear attack from the current level and a legato `resume()`. */
export class Env {
  stage = 0 // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
  value = 0
  sustain = 0.7
  private aInc = 0.01
  private dCoef = 0.99
  private rCoef = 0.99
  constructor(private sr: number) {}
  set(a: number, d: number, s: number, r: number): void {
    this.aInc = 1 / Math.max(1, a * this.sr)
    this.dCoef = Math.exp(-4.6 / Math.max(1, d * this.sr))
    this.rCoef = Math.exp(-4.6 / Math.max(1, r * this.sr))
    this.sustain = s
  }
  setDecay(d: number): void {
    this.dCoef = Math.exp(-4.6 / Math.max(1, d * this.sr))
  }
  setRelease(r: number): void {
    this.rCoef = Math.exp(-4.6 / Math.max(1, r * this.sr))
  }
  trigger(): void {
    this.stage = 1
  }
  /** Re-gate without a new attack (slides / legato after release). */
  resume(): void {
    if (this.stage === 4 || this.stage === 0) this.stage = 2
  }
  release(): void {
    if (this.stage !== 0) this.stage = 4
  }
  kill(): void {
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
        if (Math.abs(this.value - this.sustain) < 0.0003) {
          this.value = this.sustain
          this.stage = this.sustain <= 0.0001 ? 0 : 3
        }
        break
      case 3:
        break
      case 4:
        this.value *= this.rCoef
        if (this.value < 0.00005) {
          this.value = 0
          this.stage = 0
        }
        break
    }
    return this.value
  }
}
