// Guitar amp + cabinet for the Guitar plugin (mono, per guitarist so double-tracked parts distort separately).
//   noise gate → input filter (tightness / mid push) → preamp stage 1 → interstage filter → preamp stage 2
//   → tone stack (bass / mid / treble) → power amp (soft) → speaker cabinet (resonance, presence, steep top cut)
// The clippers are tanh with first-order antiderivative anti-aliasing (ADAA), so high gain stays smooth
// without oversampling.
import { Biquad } from '../sdk/dsp'
import { AMP } from './manifest'

/** log(cosh(x)), the antiderivative of tanh, overflow-safe. */
function lncosh(x: number): number {
  const a = x < 0 ? -x : x
  return a > 12 ? a - 0.6931471805599453 : Math.log(Math.cosh(a))
}

/** tanh with ADAA (1st order); `bias` makes it asymmetric (even harmonics, like a triode). */
class Clipper {
  private x1 = 0
  private f1 = 0
  bias = 0
  process(x: number): number {
    x += this.bias
    const f = lncosh(x)
    const d = x - this.x1
    let y: number
    if (d > 1e-5 || d < -1e-5) y = (f - this.f1) / d
    else y = Math.tanh(0.5 * (x + this.x1))
    this.x1 = x
    this.f1 = f
    return y - Math.tanh(this.bias)
  }
  reset(): void {
    this.x1 = this.f1 = 0
  }
}

interface Voicing {
  drive: [number, number] // input gain at gain=0 and gain=1
  stage2: number // second stage gain (0 = single stage)
  inHp: number // input high-pass (tightness), Hz
  push: [number, number, number] // input mid push: freq, Q, dB
  inter: number // interstage low-pass, Hz
  bias: number
  presence: number // dB at 3.8 kHz
  cabLp: number
  cabPeak: number // dB of the 2-3 kHz speaker peak
  level: number // output trim
}

const VOICINGS: Record<number, Voicing> = {
  [AMP.CLEAN]: { drive: [0.8, 3], stage2: 0, inHp: 60, push: [800, 0.7, 0], inter: 9000, bias: 0.05, presence: 1, cabLp: 6800, cabPeak: 2, level: 0.75 },
  [AMP.CRUNCH]: { drive: [3, 30], stage2: 1.6, inHp: 110, push: [900, 0.8, 3], inter: 6500, bias: 0.15, presence: 2, cabLp: 5600, cabPeak: 3, level: 0.42 },
  [AMP.LEAD]: { drive: [10, 110], stage2: 3, inHp: 150, push: [850, 0.7, 6], inter: 5200, bias: 0.12, presence: 3, cabLp: 5200, cabPeak: 3.5, level: 0.33 },
  [AMP.METAL]: { drive: [25, 260], stage2: 4, inHp: 420, push: [780, 0.6, 7], inter: 5600, bias: 0.08, presence: 4, cabLp: 5000, cabPeak: 4, level: 0.32 }
}

export class Amp {
  private sr: number
  private model: number = AMP.OFF
  private v: Voicing = VOICINGS[AMP.CLEAN]
  private drive = 1
  private inHp1: Biquad
  private inHp2: Biquad
  private push: Biquad
  private inter: Biquad
  private c1 = new Clipper()
  private c2 = new Clipper()
  private dc: Biquad
  private bass: Biquad
  private mid: Biquad
  private treble: Biquad
  private presence: Biquad
  private cabHp: Biquad
  private cabRes: Biquad
  private cabDip: Biquad
  private cabPeak: Biquad
  private cabLp1: Biquad
  private cabLp2: Biquad
  // gate
  private gateThr = 0
  private gateEnv = 0
  private gateGain = 1
  private gateAtt: number
  private gateRel: number
  private gateSmooth: number

  constructor(sr: number) {
    this.sr = sr
    const B = (): Biquad => new Biquad(sr)
    this.inHp1 = B()
    this.inHp2 = B()
    this.push = B()
    this.inter = B()
    this.dc = B()
    this.bass = B()
    this.mid = B()
    this.treble = B()
    this.presence = B()
    this.cabHp = B()
    this.cabRes = B()
    this.cabDip = B()
    this.cabPeak = B()
    this.cabLp1 = B()
    this.cabLp2 = B()
    this.dc.set('hp', 25, 0.7)
    this.gateAtt = 1 - Math.exp(-1 / (0.0005 * sr))
    this.gateRel = 1 - Math.exp(-1 / (0.06 * sr))
    this.gateSmooth = 1 - Math.exp(-1 / (0.004 * sr))
  }

  get active(): boolean {
    return this.model !== AMP.OFF
  }

  set(model: number, gain: number, bass: number, mid: number, treble: number, gate: number): void {
    const changed = model !== this.model
    this.model = model
    if (model === AMP.OFF) return
    const v = (this.v = VOICINGS[model] ?? VOICINGS[AMP.CLEAN])
    this.drive = v.drive[0] * Math.pow(v.drive[1] / v.drive[0], gain)
    this.inHp1.set('hp', v.inHp, 0.7)
    this.inHp2.set('hp', v.inHp * 0.6, 0.5)
    this.push.set('peak', v.push[0], v.push[1], v.push[2])
    this.inter.set('lp', v.inter, 0.6)
    this.c1.bias = v.bias
    this.c2.bias = -v.bias * 0.5
    this.bass.set('lowshelf', 110, 0.7, bass)
    this.mid.set('peak', 650, 0.8, mid)
    this.treble.set('highshelf', 2600, 0.7, treble)
    this.presence.set('peak', 3800, 0.9, v.presence)
    this.cabHp.set('hp', 75, 0.75)
    this.cabRes.set('peak', 115, 1.4, 3.5)
    this.cabDip.set('peak', 480, 1.0, -2.5)
    this.cabPeak.set('peak', 2400, 1.1, v.cabPeak)
    this.cabLp1.set('lp', v.cabLp, 0.55)
    this.cabLp2.set('lp', v.cabLp * 1.15, 1.25)
    // gate threshold: −75 dB … −38 dB of the DI signal (only meaningful with drive)
    this.gateThr = gate <= 0 ? 0 : Math.pow(10, (-75 + 37 * gate) / 20)
    if (changed) this.reset()
  }

  reset(): void {
    for (const b of [this.inHp1, this.inHp2, this.push, this.inter, this.dc, this.bass, this.mid, this.treble, this.presence, this.cabHp, this.cabRes, this.cabDip, this.cabPeak, this.cabLp1, this.cabLp2]) b.reset()
    this.c1.reset()
    this.c2.reset()
    this.gateEnv = 0
    this.gateGain = 1
  }

  /** Process `buf[o, o+n)` in place. */
  process(buf: Float32Array, o: number, n: number): void {
    if (this.model === AMP.OFF) return
    const v = this.v
    const drive = this.drive
    const s2 = v.stage2
    const thr = this.gateThr
    for (let i = o; i < o + n; i++) {
      let x = buf[i]
      // noise gate (expander) on the clean signal: keeps stops tight at high gain
      if (thr > 0) {
        const a = x < 0 ? -x : x
        this.gateEnv += (a - this.gateEnv) * (a > this.gateEnv ? this.gateAtt : this.gateRel)
        const target = this.gateEnv > thr ? 1 : Math.pow(this.gateEnv / thr, 3)
        this.gateGain += (target - this.gateGain) * this.gateSmooth
        x *= this.gateGain
      }
      x = this.inHp2.process(this.inHp1.process(x))
      x = this.push.process(x)
      x = this.c1.process(x * drive)
      x = this.inter.process(x)
      if (s2 > 0) x = this.c2.process(x * s2) * 0.9
      x = this.dc.process(x)
      x = this.treble.process(this.mid.process(this.bass.process(x)))
      // power amp: gentle
      x = x / (1 + Math.abs(x) * 0.35)
      x = this.presence.process(x)
      x = this.cabHp.process(x)
      x = this.cabRes.process(x)
      x = this.cabDip.process(x)
      x = this.cabPeak.process(x)
      x = this.cabLp2.process(this.cabLp1.process(x))
      buf[i] = x * v.level
    }
  }
}
