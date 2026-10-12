// One guitar string: a dual-polarisation digital waveguide (extended Karplus-Strong).
//  - each polarisation is a delay loop read with 4-point Lagrange interpolation (smooth under slides/bends/vibrato)
//    and a one-pole loss filter designed from two decay times (the fundamental's and the treble's at 2.5 kHz), so
//    every string loses its highs at the rate a real one does — wound bass strings don't ring metallic; the
//    filter's phase delay is taken out of the delay line, so tuning stays exact at any brightness
//  - the vertical polarisation is slightly detuned and decays faster: natural beating and the two-stage decay
//    of a real string
//  - the excitation is written once per pluck into a buffer (pick/finger pulse, pick scrape noise) and fed into
//    the loop; the pluck position is a comb on the excitation
//  - acoustic strings are heard through the force they put on the bridge (the slope of the string there, which
//    drives the body: body.ts); electric strings through a magnetic pickup at a position along the string
//  - a re-pluck chokes the old vibration (the pick meeting the string) without a click
//  - damping (note off, palm mute, dead notes) changes loop gain / brightness smoothly
// Allocation-free after construction.

export interface PluckSpec {
  vel: number // 0..1
  /** brightness of the pluck: cutoff of the excitation in Hz (soft fingertip ≈ 800, hard pick ≈ 8000) */
  cutoff: number
  /** pick-scrape noise amount 0..1 */
  scrape: number
  /** pluck position as a fraction of the string length (0.04 at the bridge … 0.5 at the middle) */
  pluckPos: number
  /** T60 at this pitch, seconds (0 = keep the current damping) */
  t60: number
  /** T60 of the string's partials around 2.5 kHz, seconds (how fast the treble dies) */
  t60hi: number
  /** angle of the pluck between the two polarisations, 0..1 (0 = all horizontal) */
  angle: number
  /** detune of the vertical polarisation, cents */
  detune: number
  /** 0 = none; >0 adds energy without a full pluck (hammer-on / pull-off) */
  legato?: number
  /** random generator state */
  seed: number
}

const MAX_EXC_SECONDS = 0.05
/** reference frequency of the treble decay time */
const HI_HZ = 2500

export class GuitarString {
  readonly sr: number
  private bufH: Float32Array
  private bufV: Float32Array
  private mask: number
  private w = 0
  // loss filter memories per polarisation
  private h1 = 0
  private v1 = 0
  // loop parameters (current → smoothed toward targets)
  private period = 100
  private gH = 0.999
  private gV = 0.998
  private gHt = 0.999
  private gVt = 0.998
  /** one-pole loss filter coefficient (≤ 0; more negative = duller) and its phase delay at the fundamental */
  private a = -0.05
  private at = -0.05
  private aV = -0.05
  private aVt = -0.05
  private pdH = 0.05
  private pdV = 0.05
  private t60 = 5
  private t60hi = 1
  private detuneRatio = 1
  // re-pluck: the old vibration is choked; `declick` bridges the step in the output
  private declick = 0
  private lastPre = 0
  private declickCoef: number
  private smooth: number
  // excitation
  private exc: Float32Array
  private excLen = 0
  private excT = 0
  private excH = 1
  private excV = 0
  // pickup
  private pickup = 0 // 0 = acoustic bridge output; else fraction of the string length
  private pickNorm = 1
  // bridge force (acoustic output): slope of the string at the bridge ≈ first difference of the wave
  private prevOut = 0
  private forceNorm = 1
  // dc blocker on the output
  private dcx = 0
  private dcy = 0
  private dcR: number
  private rnd = 1
  /** energy follower: lets the voice manager know the string is silent */
  level = 0
  private levelCoef: number
  /** sounding pitch, Hz */
  freq = 110

  constructor(sr: number) {
    this.sr = sr
    let n = 1
    while (n < sr / 25 + 16) n <<= 1
    this.bufH = new Float32Array(n)
    this.bufV = new Float32Array(n)
    this.mask = n - 1
    this.exc = new Float32Array(Math.ceil(MAX_EXC_SECONDS * sr))
    this.smooth = 1 - Math.exp(-1 / (0.004 * sr))
    this.dcR = Math.exp((-2 * Math.PI * 18) / sr)
    this.levelCoef = Math.exp(-1 / (0.05 * sr))
    this.declickCoef = Math.exp(-1 / (0.0015 * sr))
  }

  reset(): void {
    this.bufH.fill(0)
    this.bufV.fill(0)
    this.h1 = this.v1 = 0
    this.prevOut = 0
    this.declick = this.lastPre = 0
    this.excLen = this.excT = 0
    this.dcx = this.dcy = 0
    this.level = 0
  }

  private random(): number {
    // xorshift32 → -1..1
    let x = this.rnd
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rnd = x
    return (x >>> 0) / 2147483648 - 1
  }

  /** Set the sounding frequency (call at control rate for glides / vibrato / bends). */
  setFreq(f: number): void {
    const lo = 20
    const hi = this.sr / 5
    this.freq = f < lo ? lo : f > hi ? hi : f
    this.period = this.sr / this.freq
    // the slope at the bridge grows with frequency: normalise (most of it) so the treble strings sit just below
    // the bass ones, as on a real guitar
    this.forceNorm = (this.sr / (2 * Math.PI * this.freq)) * Math.pow(this.freq / 110, 0.2) * 0.5
  }

  /** Magnetic pickup position (fraction of the string length from the bridge); 0 = acoustic (bridge force). */
  setPickup(pos: number): void {
    this.pickup = pos
    // the comb |1 - e^{-j2πfτ}| peaks at 2; normalise for the low harmonics
    this.pickNorm = pos > 0 ? 1 / Math.max(0.35, 2 * Math.sin(Math.PI * pos)) : 1
  }

  /** Loop decay targets: T60 of the fundamental and of the partials around 2.5 kHz. */
  setDamping(t60: number, t60hi: number, immediate = false): void {
    const f = this.freq
    t60 = Math.max(0.005, t60)
    t60hi = Math.min(t60, Math.max(0.003, t60hi))
    this.t60 = t60
    this.t60hi = t60hi
    // the vertical polarisation loses energy faster (it pushes on the bridge / top)
    const tv = Math.max(0.004, t60 * 0.45)
    const tvhi = Math.min(tv, t60hi * 0.7)
    this.at = lossCoef(f, t60, t60hi, this.sr)
    this.aVt = lossCoef(f, tv, tvhi, this.sr)
    const w0 = (2 * Math.PI * f) / this.sr
    this.gHt = Math.exp(-6.9078 / (f * t60)) / onePoleMag(this.at, w0)
    this.gVt = Math.exp(-6.9078 / (f * tv)) / onePoleMag(this.aVt, w0)
    if (immediate) {
      this.gH = this.gHt
      this.gV = this.gVt
      this.a = this.at
      this.aV = this.aVt
      this.updatePhase()
    }
  }

  private updatePhase(): void {
    // tuned where the ear (and a tuner) weighs the partials: the phase delay of the one-pole falls with frequency,
    // so its upper partials run slightly sharp, like a stiff string's
    const w = Math.min(1.5, (2.5 * 2 * Math.PI * this.freq) / this.sr)
    this.pdH = onePoleDelay(this.a, w)
    this.pdV = onePoleDelay(this.aV, w * this.detuneRatio)
  }

  /** Pluck the string at the current frequency (adds to whatever is already vibrating, like a real re-pluck). */
  pluck(p: PluckSpec): void {
    const sr = this.sr
    this.rnd = (p.seed | 0) || 0x9e3779b9
    this.detuneRatio = Math.pow(2, p.detune / 1200)
    if (p.t60 > 0) this.setDamping(p.t60, p.t60hi, true)
    else this.updatePhase()
    const exc = this.exc
    const period = this.period
    const v = p.vel
    // a re-pluck stops most of the old vibration first: the pick meets the moving string. The output step that
    // leaves is bridged by a short decaying offset (no click).
    if (!p.legato && this.level > 1e-4) {
      const k = 0.2
      const { bufH, bufV } = this
      for (let i = 0; i < bufH.length; i++) {
        bufH[i] *= k
        bufV[i] *= k
      }
      this.h1 *= k
      this.v1 *= k
      this.prevOut *= k
      this.declick += (1 - k) * this.lastPre
    }
    const P = Math.max(4, Math.round(period))
    const len = Math.min(exc.length, P + 24)
    exc.fill(0, 0, len)
    const amp = p.legato ? p.legato * 0.6 : 1
    // initial string shape (one period, i.e. the whole string): a triangle with its apex at the pluck point —
    // harmonics fall as sin(nπβ)/n² — with a little noise so no two plucks are identical. The pick's hardness
    // low-passes it (a soft fingertip rounds the corner): two poles, so a soft pluck is really soft.
    const beta = Math.min(0.5, Math.max(0.03, p.pluckPos))
    const apex = beta * P
    const fc = Math.min(0.3 * sr, Math.max(120, p.cutoff))
    const pole = Math.exp((-2 * Math.PI * fc) / sr)
    const noiseAmt = p.legato ? 0 : 0.08
    let lp = 0
    let lp2 = 0
    let nlp = 0
    for (let i = 0; i < P; i++) {
      const tri = i < apex ? i / apex : (P - i) / (P - apex)
      nlp += (this.random() - nlp) * 0.5
      const x = tri + nlp * noiseAmt
      lp = pole * lp + (1 - pole) * x
      lp2 = pole * lp2 + (1 - pole) * lp
      exc[i] += lp2 * amp
    }
    // the low-pass tail would leave a DC step: ramp it out over a few samples
    for (let i = P, k = 0; k < 16 && i < len; i++, k++) exc[i] += lp2 * amp * (1 - k / 16)
    // pick scrape: short burst of bright noise
    if (p.scrape > 0 && !p.legato) {
      const n = Math.min(len, Math.round(0.002 * sr))
      let q = 0
      const g = p.scrape * 0.35 * (P / 200 < 1 ? Math.sqrt(P / 200) : 1)
      for (let i = 0; i < n; i++) {
        const r = this.random()
        q += (r - q) * 0.35
        exc[i] += (r - q) * g * (1 - i / n) * (1 - i / n)
      }
    }
    // pick angle → polarisation split; loudness
    const ang = p.angle * Math.PI * 0.5
    const gain = (0.2 + 0.8 * v) * 0.5
    this.excH = Math.cos(ang) * gain
    this.excV = Math.sin(ang) * gain
    this.excLen = len
    this.excT = 0
    this.level = Math.max(this.level, 0.1)
  }

  /** Inject a little energy at the current pitch without re-plucking (hammer-on / pull-off). Keeps the damping. */
  tap(amount: number, seed: number): void {
    this.pluck({ vel: amount, cutoff: 1500, scrape: 0, pluckPos: 0.2, t60: 0, t60hi: 0, angle: 0.2, detune: 0, legato: amount, seed })
  }

  /** Render one sample. */
  process(): number {
    const sm = this.smooth
    this.gH += (this.gHt - this.gH) * sm
    this.gV += (this.gVt - this.gV) * sm
    const da = this.at - this.a
    if (da > 1e-6 || da < -1e-6 || this.aVt !== this.aV) {
      this.a += da * sm
      this.aV += (this.aVt - this.aV) * sm
      if (Math.abs(this.aVt - this.aV) < 1e-6) this.aV = this.aVt
      this.updatePhase()
    }
    const mask = this.mask
    const w = this.w
    const gH = this.gH
    const gV = this.gV
    // horizontal polarisation: delay line + one-pole loss filter (its phase delay is part of the period)
    let x = lagrange(this.bufH, w, this.period - this.pdH, mask)
    const a = this.a
    let yH = gH * (1 + a) * x - a * this.h1
    this.h1 = yH
    // vertical polarisation (slightly detuned)
    x = lagrange(this.bufV, w, this.period / this.detuneRatio - this.pdV, mask)
    const aV = this.aV
    let yV = gV * (1 + aV) * x - aV * this.v1
    this.v1 = yV
    if (this.excT < this.excLen) {
      const e = this.exc[this.excT++]
      yH += e * this.excH
      yV += e * this.excV
    }
    // a little coupling between the two at the bridge
    const cpl = (yV - yH) * 0.0015
    yH += cpl
    yV -= cpl
    this.bufH[w] = yH
    this.bufV[w] = yV
    this.w = (w + 1) & mask
    let out: number
    if (this.pickup > 0) {
      // magnetic pickup at `pickup` of the string length: travelling-wave difference
      const pd = this.pickup * this.period
      const s = yH + yV * 0.6
      const back = lagrange1(this.bufH, this.w, pd + 1, mask) + 0.6 * lagrange1(this.bufV, this.w, pd + 1, mask)
      out = (s - back) * this.pickNorm
    } else {
      // bridge force: the slope of the string at the bridge (vertical polarisation drives the top harder)
      const s = yH + yV * 1.2
      out = (s - this.prevOut) * this.forceNorm
      this.prevOut = s
    }
    this.lastPre = out
    if (this.declick !== 0) {
      out += this.declick
      this.declick *= this.declickCoef
      if (this.declick < 1e-7 && this.declick > -1e-7) this.declick = 0
    }
    const o = out - this.dcx + this.dcR * this.dcy
    this.dcx = out
    this.dcy = o
    const ab = o < 0 ? -o : o
    this.level = ab > this.level ? ab : this.level * this.levelCoef
    return o
  }
}

/** Magnitude of the normalised one-pole low-pass (1 + a) / (1 + a·z⁻¹) at ω. */
function onePoleMag(a: number, w: number): number {
  return (1 + a) / Math.sqrt(1 + 2 * a * Math.cos(w) + a * a)
}

/** Phase delay (samples) of the one-pole at ω. */
function onePoleDelay(a: number, w: number): number {
  if (w < 1e-6) return -a / (1 + a)
  return Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w)) / w
}

/**
 * One-pole loss coefficient for a string at f0 whose fundamental decays in `t60` and whose partials around
 * HI_HZ decay in `t60hi`: the filter's magnitude at HI_HZ (per period, relative to DC) must be the ratio of the
 * two per-period gains.
 */
function lossCoef(f0: number, t60: number, t60hi: number, sr: number): number {
  const fh = Math.min(HI_HZ, sr * 0.45)
  if (fh <= f0 * 1.05) return 0
  const g0 = -6.9078 / (f0 * t60)
  const g1 = -6.9078 / (f0 * t60hi)
  let rho = Math.exp(g1 - g0)
  if (rho >= 0.99999) return 0
  if (rho < 0.05) rho = 0.05
  const c = Math.cos((2 * Math.PI * fh) / sr)
  // (1 + a)² = ρ²(1 + 2ac + a²)  →  (1 − ρ²)a² + 2(1 − ρ²c)a + (1 − ρ²) = 0, the root inside (−1, 0]
  const A = 1 - rho * rho
  const B = 2 * (1 - rho * rho * c)
  const disc = B * B - 4 * A * A
  const a = (-B + Math.sqrt(Math.max(0, disc))) / (2 * A)
  return a < -0.95 ? -0.95 : a > 0 ? 0 : a
}

/** 4-point (3rd order) Lagrange read of the sample written `d` pushes ago (d ≥ 2). */
function lagrange(buf: Float32Array, w: number, d: number, mask: number): number {
  if (d < 2) d = 2
  const di = d | 0
  const f = d - di
  const xm1 = buf[(w - di + 1) & mask]
  const x0 = buf[(w - di) & mask]
  const x1 = buf[(w - di - 1) & mask]
  const x2 = buf[(w - di - 2) & mask]
  const fm1 = f - 1
  const fm2 = f - 2
  const fp1 = f + 1
  return -xm1 * (f * fm1 * fm2) / 6 + x0 * (fp1 * fm1 * fm2) / 2 - x1 * (fp1 * f * fm2) / 2 + x2 * (fp1 * f * fm1) / 6
}

/** Linear read (pickup taps). */
function lagrange1(buf: Float32Array, w: number, d: number, mask: number): number {
  const di = d | 0
  const f = d - di
  const a = buf[(w - di) & mask]
  const b = buf[(w - di - 1) & mask]
  return a + (b - a) * f
}
