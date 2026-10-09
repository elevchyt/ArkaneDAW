// Physically-modelled bass string: Karplus-Strong / single-delay waveguide with
//  - finger / pick / slap(thumb + pop) / fretless / upright excitation (raised-cosine pulses, pick scrape, fret slap click)
//  - pluck-position comb on the excitation and pickup-position comb on the output
//  - frequency-dependent loop loss (two-point lowpass) + T60 decay, damping on release (finger mute)
//  - fret buzz (displacement limiting against the frets inside the loop) and fretless "mwah" formant
//  - upright body resonances, pop pitch overshoot (tension modulation)
import { BP } from './filters'

export const MODEL = { FINGER: 0, PICK: 1, SLAP: 2, FRETLESS: 3, UPRIGHT: 4 } as const

export interface StringParams {
  model: number
  pickup: number // 0.03..0.5 fraction of string length
  pluck: number // 0.04..0.5
  bright: number // 0..1
  decay: number // T60 seconds at ~41 Hz
  damp: number // 0..1 high-frequency loss
  buzz: number // 0..1
  pop: number // 0..1
  body: number // 0..1
  mwah: number // 0..1
  muteTime: number // release damping T60 (s)
}

export class BassString {
  private buf: Float32Array
  private mask: number
  private w = 0
  private sr: number
  private prev = 0
  private period = 100 // samples
  private loopDelay = 100
  private g = 0.999
  private s = 0.3
  private gHeld = 0.999
  private sHeld = 0.3
  private muted = false
  // excitation
  private excT = 1e9
  private excW = 48
  private excAmp = 0
  private excD2 = 0
  private excLen = 0
  private scrapeT = 1e9
  private scrapeLen = 0
  private scrapeAmp = 0
  private scrapeLp = 0
  // output-side transients
  private click: BP
  private clickEnv = 0
  private clickCoef = 0.99
  private clickAmp = 0
  // fret buzz
  private buzz = 0
  private buzzThr = 0.4
  // pickup comb
  private pickup = 0.18
  private pickNorm = 1
  // fretless mwah
  private mwahBP: BP
  private mwahEnv = 0
  private mwahCoef = 0.999
  private mwah = 0
  // upright body
  private body1: BP
  private body2: BP
  private body3: BP
  private body = 0
  // amp/cab tone: 2-pole lowpass
  private tA = 0
  private tB = 0
  private tCoef = 0.5
  // dc blocker
  private dcx = 0
  private dcy = 0
  private dcR = 0.999
  /** Transient pitch offset in semitones (pop overshoot / upright thump), read by the voice. */
  bend = 0
  private bendCoef = 0.999
  private t60 = 3
  private model = 0
  private gainNorm = 1

  constructor(sr: number) {
    this.sr = sr
    let n = 1
    while (n < sr / 14 + 8) n <<= 1
    this.buf = new Float32Array(n)
    this.mask = n - 1
    this.click = new BP(sr)
    this.mwahBP = new BP(sr)
    this.body1 = new BP(sr)
    this.body2 = new BP(sr)
    this.body3 = new BP(sr)
    this.body1.set(98, 4)
    this.body2.set(196, 3)
    this.body3.set(420, 2)
    this.dcR = Math.exp((-2 * Math.PI * 12) / sr)
  }

  reset(): void {
    this.buf.fill(0)
    this.prev = 0
    this.excT = 1e9
    this.scrapeT = 1e9
    this.clickEnv = 0
    this.mwahEnv = 0
    this.bend = 0
    this.dcx = this.dcy = 0
    this.tA = this.tB = 0
    this.click.reset()
    this.mwahBP.reset()
    this.body1.reset()
    this.body2.reset()
    this.body3.reset()
  }

  /** Update loop tuning (call at control rate while gliding). */
  setFreq(freq: number): void {
    const f = freq < 15 ? 15 : freq > this.sr / 6 ? this.sr / 6 : freq
    this.period = this.sr / f
    this.loopDelay = this.period - this.s
    if (!this.muted) {
      // higher notes decay faster, like a real string
      const t60 = this.t60 * Math.pow(41 / f, 0.35)
      this.g = Math.exp(-6.9078 / (f * t60))
    }
  }

  /** Pluck / slap / pop the string (adds to whatever is already vibrating). */
  excite(p: StringParams, vel: number, freq: number): void {
    const sr = this.sr
    this.model = p.model
    this.muted = false
    this.t60 = p.decay
    const v = 0.25 + 0.75 * vel
    let width = 0.002 // seconds
    let amp = 1
    let damp = p.damp
    let buzz = p.buzz
    this.clickAmp = 0
    this.scrapeAmp = 0
    this.bend = 0
    this.mwah = 0
    this.body = 0
    const bright = p.bright
    const pop = p.model === MODEL.SLAP && vel > 0.9 - p.pop * 0.12
    switch (p.model) {
      case MODEL.FINGER:
        width = 0.0045 - 0.0035 * bright
        amp = 1
        break
      case MODEL.PICK:
        width = 0.0011 - 0.0006 * bright
        amp = 0.95
        this.scrapeAmp = 0.08 + 0.15 * bright
        this.scrapeLen = Math.round(0.004 * sr)
        damp *= 0.8
        break
      case MODEL.SLAP:
        if (pop) {
          // finger pulls the string away from the body and lets it snap onto the frets
          width = 0.0006
          amp = 1.2
          buzz = Math.min(1, buzz + 0.15 + 0.15 * p.pop)
          this.clickAmp = 0.2 + 0.3 * p.pop
          this.bend = 0.35 * p.pop + 0.1
        } else {
          // thumb strike on the low strings
          width = 0.0016 - 0.0006 * bright
          amp = 1.1
          buzz = Math.min(1, buzz + 0.1 + 0.1 * p.pop)
          this.clickAmp = 0.1 + 0.2 * p.pop
          this.bend = 0.12 * p.pop
        }
        this.click.set(pop ? 3200 : 2100, 1.4)
        this.clickCoef = Math.exp(-1 / ((pop ? 0.006 : 0.009) * sr))
        damp *= 0.7
        break
      case MODEL.FRETLESS:
        width = 0.004 - 0.002 * bright
        amp = 1
        this.mwah = p.mwah
        this.mwahEnv = 1
        this.mwahCoef = Math.exp(-1 / (0.45 * sr))
        buzz = Math.min(1, buzz * 0.5 + p.mwah * 0.15)
        break
      case MODEL.UPRIGHT:
        width = 0.006 - 0.003 * bright
        amp = 1.15
        damp = Math.min(1, damp + 0.2)
        this.body = 0.4 + 0.6 * p.body
        this.bend = -0.22
        this.clickAmp = 0.06 + 0.12 * vel * p.pop
        this.click.set(900, 1.1)
        this.clickCoef = Math.exp(-1 / (0.012 * sr))
        break
    }
    if (p.model !== MODEL.UPRIGHT && p.body > 0) this.body = p.body * 0.6
    this.bendCoef = Math.exp(-1 / ((p.model === MODEL.UPRIGHT ? 0.05 : 0.035) * sr))
    // loop lowpass: two-point FIR (1-s)x + s x[-1]; s = 0 (bright, long) .. 0.5 (dull)
    this.s = 0.03 + 0.47 * damp * damp
    this.gHeld = this.g
    this.sHeld = this.s
    this.buzz = buzz
    this.buzzThr = 0.55 - 0.35 * buzz
    this.excW = Math.max(2, width * sr)
    this.excAmp = amp * v
    this.period = sr / Math.max(15, freq)
    this.excD2 = Math.max(1, p.pluck * this.period)
    this.excLen = this.excW + this.excD2
    this.excT = 0
    this.scrapeT = 0
    this.clickEnv = this.clickAmp > 0 ? 1 : 0
    this.pickup = p.pickup
    const toneHz = (p.model === MODEL.UPRIGHT ? 1400 : p.model === MODEL.SLAP ? 3200 : 1800) + 4200 * bright * bright
    this.tCoef = 1 - Math.exp((-2 * Math.PI * toneHz) / sr)
    // pickup comb |1 - e^{-j2πp}| = 2 sin(πp) at the fundamental: normalize it partially
    this.pickNorm = 1 / Math.max(0.45, 2 * Math.sin(Math.PI * p.pickup))
    this.gainNorm = 0.9
    this.setFreq(freq)
  }

  /** Release: finger/palm mutes the string. */
  mute(on: boolean, muteT60: number, freq: number): void {
    if (on) {
      this.muted = true
      const f = Math.max(15, freq)
      this.g = Math.exp(-6.9078 / (f * Math.max(0.02, muteT60)))
      this.s = Math.max(this.sHeld, 0.42)
    } else {
      this.muted = false
      this.s = this.sHeld
      this.g = this.gHeld
    }
  }

  private pulse(t: number): number {
    if (t < 0 || t >= this.excW) return 0
    return 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / this.excW)
  }

  tick(): void {
    this.bend *= Math.pow(this.bendCoef, 8)
  }

  process(): number {
    const buf = this.buf
    const mask = this.mask
    // fractional read of the loop delay
    const d = this.loopDelay < 2 ? 2 : this.loopDelay
    const di = d | 0
    const fr = d - di
    const a = buf[(this.w - di) & mask]
    const b = buf[(this.w - di - 1) & mask]
    const r = a + (b - a) * fr
    let y = (1 - this.s) * r + this.s * this.prev
    this.prev = r
    y *= this.g
    // fret buzz: string displacement limited by the frets -> rattle
    let rattle = 0
    if (this.buzz > 0) {
      const ay = y < 0 ? -y : y
      if (ay > this.buzzThr) {
        const ex = (ay - this.buzzThr) * this.buzz
        rattle = y > 0 ? ex : -ex
        y -= rattle * 0.6
      }
    }
    // excitation
    if (this.excT < this.excLen) {
      y += this.excAmp * (this.pulse(this.excT) - 0.85 * this.pulse(this.excT - this.excD2))
      this.excT++
    }
    if (this.scrapeT < this.scrapeLen && this.scrapeAmp > 0) {
      const n = Math.random() * 2 - 1
      this.scrapeLp += (n - this.scrapeLp) * 0.5
      y += (n - this.scrapeLp) * this.scrapeAmp * this.excAmp * (1 - this.scrapeT / this.scrapeLen)
      this.scrapeT++
    }
    buf[this.w] = y
    this.w = (this.w + 1) & mask
    // pickup comb
    const pd = this.pickup * this.period
    const pdi = pd | 0
    const pf = pd - pdi
    const pa = buf[(this.w - 1 - pdi) & mask]
    const pb = buf[(this.w - 2 - pdi) & mask]
    let out = (y - (pa + (pb - pa) * pf)) * this.pickNorm
    out += rattle * 1.5
    // output transients
    if (this.clickEnv > 0.0005) {
      out += this.click.process(Math.random() * 2 - 1) * this.clickEnv * this.clickAmp * 2
      this.clickEnv *= this.clickCoef
    }
    if (this.mwah > 0) {
      this.mwahEnv *= this.mwahCoef
      out += this.mwahBP.process(out) * this.mwah * (0.6 + 1.2 * this.mwahEnv)
    }
    if (this.body > 0) {
      out += (this.body1.process(out) * 1.1 + this.body2.process(out) * 0.6 + this.body3.process(out) * 0.35) * this.body
    }
    // tone
    this.tA += (out - this.tA) * this.tCoef
    this.tB += (this.tA - this.tB) * this.tCoef
    out = this.tB
    // dc block
    const o = out - this.dcx + this.dcR * this.dcy
    this.dcx = out
    this.dcy = o
    return o * this.gainNorm
  }

  /** Called per control tick by the voice to track the mwah formant. */
  updateMwah(freq: number): void {
    if (this.mwah > 0) this.mwahBP.set(Math.min(2400, freq * 6 + 500 + 900 * this.mwahEnv), 2.2)
  }
}
