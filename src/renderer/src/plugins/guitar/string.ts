// One guitar string: a dual-polarisation digital waveguide (extended Karplus-Strong).
//  - each polarisation is a delay loop read with 4-point Lagrange interpolation (smooth under slides/bends/vibrato)
//    and a linear-phase 3-tap loss filter (exactly 1 sample of delay, so tuning stays exact at any brightness)
//  - the vertical polarisation is slightly detuned and decays faster: natural beating and the two-stage decay
//    of a real string
//  - the excitation is written once per pluck into a buffer (pick/finger pulse, pick scrape noise, the guitar
//    body's impulse response for acoustic models = commuted synthesis) and fed into the loop; the pluck position
//    is a comb on the excitation
//  - electric strings are read through a magnetic pickup at a position along the string (comb on the output)
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
  /** body impulse response (commuted) and its mix, or null */
  body: Float32Array | null
  bodyLen: number
  bodyAmt: number
  /** T60 at this pitch, seconds (0 = keep the current damping) */
  t60: number
  /** high-frequency loss 0 (bright, steel) .. 0.25 (dull) */
  loss: number
  /** angle of the pluck between the two polarisations, 0..1 (0 = all horizontal) */
  angle: number
  /** detune of the vertical polarisation, cents */
  detune: number
  /** 0 = none; >0 adds energy without a full pluck (hammer-on / pull-off) */
  legato?: number
  /** random generator state */
  seed: number
}

const MAX_EXC_SECONDS = 0.16
/** level of the body response in the excitation, relative to the string shape */
const BODY_GAIN = 2.0

export class GuitarString {
  readonly sr: number
  private bufH: Float32Array
  private bufV: Float32Array
  private mask: number
  private w = 0
  // loss filter memories (previous two Lagrange reads) per polarisation
  private h1 = 0
  private h2 = 0
  private v1 = 0
  private v2 = 0
  // loop parameters (current → smoothed toward targets)
  private period = 100
  private gH = 0.999
  private gV = 0.998
  private gHt = 0.999
  private gVt = 0.998
  private b = 0.1
  private bt = 0.1
  private detuneRatio = 1
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
  }

  reset(): void {
    this.bufH.fill(0)
    this.bufV.fill(0)
    this.h1 = this.h2 = this.v1 = this.v2 = 0
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
  }

  /** Magnetic pickup position (fraction of the string length from the bridge); 0 = acoustic (bridge force). */
  setPickup(pos: number): void {
    this.pickup = pos
    // the comb |1 - e^{-j2πfτ}| peaks at 2; normalise for the low harmonics
    this.pickNorm = pos > 0 ? 1 / Math.max(0.35, 2 * Math.sin(Math.PI * pos)) : 1
  }

  /** Loop decay + brightness targets. */
  setDamping(t60: number, loss: number, immediate = false): void {
    const f = this.freq
    this.gHt = Math.exp(-6.9078 / (f * Math.max(0.005, t60)))
    // the vertical polarisation loses energy faster (it pushes on the bridge / top)
    this.gVt = Math.exp(-6.9078 / (f * Math.max(0.004, t60 * 0.45)))
    this.bt = loss < 0 ? 0 : loss > 0.25 ? 0.25 : loss
    if (immediate) {
      this.gH = this.gHt
      this.gV = this.gVt
      this.b = this.bt
    }
  }

  /** Pluck the string at the current frequency (adds to whatever is already vibrating, like a real re-pluck). */
  pluck(p: PluckSpec): void {
    const sr = this.sr
    this.rnd = (p.seed | 0) || 0x9e3779b9
    this.detuneRatio = Math.pow(2, p.detune / 1200)
    if (p.t60 > 0) this.setDamping(p.t60, p.loss, true)
    const exc = this.exc
    const period = this.period
    const v = p.vel
    // a re-pluck stops most of the old vibration first: the pick meets the moving string
    if (!p.legato) {
      const { bufH, bufV } = this
      for (let i = 0; i < bufH.length; i++) {
        bufH[i] *= 0.25
        bufV[i] *= 0.25
      }
    }
    const P = Math.max(4, Math.round(period))
    const len = Math.min(exc.length, Math.max(P + 8, p.body && p.bodyAmt > 0 && !p.legato ? p.bodyLen : 0))
    exc.fill(0, 0, len)
    const amp = p.legato ? p.legato * 0.6 : 1
    // initial string shape (one period, i.e. the whole string): a triangle with its apex at the pluck point —
    // harmonics fall as sin(nπβ)/n² — with a little noise so no two plucks are identical. The pick's hardness
    // low-passes it (a soft fingertip rounds the corner).
    const beta = Math.min(0.5, Math.max(0.03, p.pluckPos))
    const apex = beta * P
    const fc = Math.min(0.3 * sr, Math.max(120, p.cutoff))
    const pole = Math.exp((-2 * Math.PI * fc) / sr)
    const noiseAmt = p.legato ? 0 : 0.12
    let lp = 0
    let nlp = 0
    for (let i = 0; i < P; i++) {
      const tri = i < apex ? i / apex : (P - i) / (P - apex)
      nlp += (this.random() - nlp) * 0.5
      const x = tri + nlp * noiseAmt
      lp = pole * lp + (1 - pole) * x
      exc[i] += lp * amp
    }
    // the low-pass tail would leave a DC step: ramp it out over a few samples
    for (let i = P, k = 0; k < 16 && i < len; i++, k++) exc[i] += lp * amp * (1 - k / 16)
    // pick scrape: short burst of bright noise
    if (p.scrape > 0 && !p.legato) {
      const n = Math.min(len, Math.round(0.003 * sr))
      let q = 0
      for (let i = 0; i < n; i++) {
        const r = this.random()
        q += (r - q) * 0.35
        exc[i] += (r - q) * p.scrape * 0.5 * (1 - i / n) * (1 - i / n)
      }
    }
    // commuted body: the body's impulse response, low-passed like the pluck
    if (p.body && p.bodyAmt > 0 && !p.legato) {
      const c = 1 - pole
      const g = p.bodyAmt * amp * BODY_GAIN
      let a = 0
      for (let i = 0; i < len; i++) {
        a += (p.body[i] - a) * c
        exc[i] += a * g
      }
    }
    // pick angle → polarisation split; loudness
    const ang = p.angle * Math.PI * 0.5
    const gain = (0.25 + 0.75 * v) * 0.5
    this.excH = Math.cos(ang) * gain
    this.excV = Math.sin(ang) * gain
    this.excLen = len
    this.excT = 0
    this.level = Math.max(this.level, 0.1)
  }

  /** Inject a little energy at the current pitch without re-plucking (hammer-on / pull-off). Keeps the damping. */
  tap(amount: number, seed: number): void {
    this.pluck({ vel: amount, cutoff: 1500, scrape: 0, pluckPos: 0.2, body: null, bodyLen: 0, bodyAmt: 0, t60: 0, loss: 0, angle: 0.2, detune: 0, legato: amount, seed })
  }

  /** Render one sample. */
  process(): number {
    const sm = this.smooth
    this.gH += (this.gHt - this.gH) * sm
    this.gV += (this.gVt - this.gV) * sm
    this.b += (this.bt - this.b) * sm
    const b = this.b
    const c = 1 - 2 * b
    const mask = this.mask
    const w = this.w
    // horizontal polarisation
    const dH = this.period - 1
    let x = lagrange(this.bufH, w, dH, mask)
    let yH = this.gH * (b * x + c * this.h1 + b * this.h2)
    this.h2 = this.h1
    this.h1 = x
    // vertical polarisation (slightly detuned)
    const dV = this.period / this.detuneRatio - 1
    x = lagrange(this.bufV, w, dV, mask)
    let yV = this.gV * (b * x + c * this.v1 + b * this.v2)
    this.v2 = this.v1
    this.v1 = x
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
      out = yH + yV * 0.8
    }
    const o = out - this.dcx + this.dcR * this.dcy
    this.dcx = out
    this.dcy = o
    const a = o < 0 ? -o : o
    this.level = a > this.level ? a : this.level * this.levelCoef
    return o
  }
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
