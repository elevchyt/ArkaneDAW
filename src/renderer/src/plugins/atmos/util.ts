// Small allocation-free DSP helpers private to Atmos (worklet-safe: no DOM, no UI imports).

export const TAU = Math.PI * 2

/** Deterministic xorshift32 PRNG. `next()` returns -1..1, `uni()` returns 0..1. */
export class Rng {
  s: number
  constructor(seed = 0x9e3779b9) {
    this.s = seed | 0 || 1
  }
  next(): number {
    let x = this.s
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.s = x
    return x / 2147483648
  }
  uni(): number {
    return this.next() * 0.5 + 0.5
  }
}

/** TPT state-variable filter with every output available. */
export class Svf {
  ic1 = 0
  ic2 = 0
  a1 = 1
  a2 = 0
  a3 = 0
  k = 1.4
  set(fc: number, q: number, sr: number): void {
    const f = fc < 10 ? 10 : fc > sr * 0.47 ? sr * 0.47 : fc
    const g = Math.tan((Math.PI * f) / sr)
    this.k = 1 / (q < 0.05 ? 0.05 : q)
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }
  reset(): void {
    this.ic1 = this.ic2 = 0
  }
  lp(v0: number): number {
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return v2
  }
  /** Band-pass normalised to unity gain at the centre frequency. */
  bp(v0: number): number {
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return v1 * this.k
  }
  hp(v0: number): number {
    const v3 = v0 - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    return v0 - this.k * v1 - v2
  }
}

/** Smooth random (cosine-interpolated random targets). */
export class SmoothRand {
  a = 0
  b = 0
  t = 0
  constructor(private rng: Rng) {
    this.a = rng.next()
    this.b = rng.next()
    this.t = rng.uni()
  }
  /** Advance by `cycles` (rate * seconds) and return -1..1. */
  step(cycles: number): number {
    this.t += cycles
    while (this.t >= 1) {
      this.t -= 1
      this.a = this.b
      this.b = this.rng.next()
    }
    return this.a + (this.b - this.a) * (0.5 - 0.5 * Math.cos(Math.PI * this.t))
  }
}

/**
 * Envelope evaluated at control rate. Attack is a smoothstep (swells land softly), decay is exponential,
 * release reaches -60 dB at `r` seconds. Times may be very long (20 s attack / 30 s release).
 */
export class Env {
  stage = 0 // 0 idle, 1 attack, 2 decay, 3 sustain, 4 release
  v = 0
  x = 0
  private aInc = 0
  private dC = 0
  private rC = 0
  private dCK = 0
  private rCK = 0
  s = 1
  constructor(private sr: number, private K: number) {}
  set(a: number, d: number, s: number, r: number): void {
    this.aInc = 1 / Math.max(1, a * this.sr)
    this.dC = Math.exp(-4.6 / Math.max(1, d * this.sr))
    this.rC = Math.exp(-6.9078 / Math.max(1, r * this.sr))
    this.dCK = Math.pow(this.dC, this.K)
    this.rCK = Math.pow(this.rC, this.K)
    this.s = s
  }
  on(): void {
    this.stage = 1
    this.x = 0
    this.v = 0
  }
  off(): void {
    if (this.stage !== 0) this.stage = 4
  }
  step(n: number): number {
    switch (this.stage) {
      case 1: {
        const x = (this.x += this.aInc * n)
        if (x >= 1) {
          this.x = 1
          this.v = 1
          this.stage = 2
        } else this.v = x * x * (3 - 2 * x)
        break
      }
      case 2:
        this.v = this.s + (this.v - this.s) * (n === this.K ? this.dCK : Math.pow(this.dC, n))
        if (Math.abs(this.v - this.s) < 1e-4) {
          this.v = this.s
          this.stage = this.s <= 1e-5 ? 0 : 3
        }
        break
      case 3:
        this.v = this.s
        break
      case 4:
        this.v *= n === this.K ? this.rCK : Math.pow(this.rC, n)
        if (this.v < 1e-5) {
          this.v = 0
          this.stage = 0
        }
        break
    }
    return this.v
  }
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** Transparent below 0.9, soft knee to a hard ceiling of 1.2. */
export function safety(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= 0.9) return x
  const y = 0.9 + 0.3 * Math.tanh((a - 0.9) / 0.3)
  return x < 0 ? -y : y
}
