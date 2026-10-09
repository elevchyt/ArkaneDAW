// Piano voice: wraps the Mosaic engines (modal acoustic piano, tine/reed/FM EP) and the
// toy-piano rods (toy.ts, on Mosaic's ModalBank) with the state a real piano needs — key held / held by pedal / damped — plus a
// click-free steal fade and an optional analog pad layer. Allocation-free after construction.
import { ADSR } from '../sdk/dsp'
import { PianoVoice } from '../mosaic/engines/piano'
import { EPVoice } from '../mosaic/engines/epiano'
import type { EngineVoice } from '../mosaic/engines/common'
import { ToyVoice } from './toy'

/** Soft two-saw string pad (slow attack/release, gentle 12 dB lowpass) layered under a note. ADDs into l/r.
 *  Oscillators (polyBLEP saws + triangle sub) and the TPT lowpass are inlined: it runs per voice. */
export class PadLayer {
  private p1 = 0.13
  private p2 = 0.61
  private p3 = 0
  private env: ADSR
  // TPT state-variable lowpass, one per side
  private g = 0
  private k = 1.6
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private l1 = 0
  private l2 = 0
  private r1 = 0
  private r2 = 0
  private freq = 440
  private level = 0
  constructor(private sr: number) {
    this.env = new ADSR(sr)
  }
  start(freq: number, vel: number, level: number): void {
    this.freq = freq
    this.level = level * 0.16 * (0.55 + 0.45 * vel)
    this.env.set(0.9, 3, 0.7, 1.8)
    this.env.reset()
    this.env.gate(true)
    this.p1 = 0.13
    this.p2 = 0.61
    this.p3 = 0
    const fc = Math.min(5200, 900 + freq * 2.2) * (0.8 + 0.4 * vel)
    this.g = Math.tan((Math.PI * Math.min(fc, this.sr * 0.45)) / this.sr)
    this.a1 = 1 / (1 + this.g * (this.g + this.k))
    this.a2 = this.g * this.a1
    this.a3 = this.g * this.a2
    this.l1 = this.l2 = this.r1 = this.r2 = 0
  }
  setFreq(freq: number): void {
    this.freq = freq
  }
  release(): void {
    this.env.gate(false)
  }
  kill(): void {
    this.env.reset()
  }
  render(l: Float32Array, r: Float32Array, n: number): boolean {
    const env = this.env
    if (!env.active) return false
    const dt = this.freq / this.sr
    const d1 = Math.min(0.45, dt * 1.0046)
    const d2 = Math.min(0.45, dt * 0.9954)
    const d3 = dt * 0.5
    const lv = this.level
    const a1 = this.a1
    const a2 = this.a2
    const a3 = this.a3
    let p1 = this.p1
    let p2 = this.p2
    let p3 = this.p3
    let l1 = this.l1
    let l2 = this.l2
    let r1 = this.r1
    let r2 = this.r2
    for (let i = 0; i < n; i++) {
      const e = env.next() * lv
      // polyBLEP saws
      let a = 2 * p1 - 1
      if (p1 < d1) {
        const t = p1 / d1
        a -= t + t - t * t - 1
      } else if (p1 > 1 - d1) {
        const t = (p1 - 1) / d1
        a -= t * t + t + t + 1
      }
      let b = 2 * p2 - 1
      if (p2 < d2) {
        const t = p2 / d2
        b -= t + t - t * t - 1
      } else if (p2 > 1 - d2) {
        const t = (p2 - 1) / d2
        b -= t * t + t + t + 1
      }
      const sub = (1 - 4 * Math.abs(p3 - 0.5)) * 0.35
      p1 += d1
      if (p1 >= 1) p1 -= 1
      p2 += d2
      if (p2 >= 1) p2 -= 1
      p3 += d3
      if (p3 >= 1) p3 -= 1
      // lowpass L
      let x = a * 0.8 + b * 0.35 + sub
      let v3 = x - l2
      let v1 = a1 * l1 + a2 * v3
      let v2 = l2 + a2 * l1 + a3 * v3
      l1 = 2 * v1 - l1
      l2 = 2 * v2 - l2
      l[i] += v2 * e
      // lowpass R
      x = b * 0.8 + a * 0.35 + sub
      v3 = x - r2
      v1 = a1 * r1 + a2 * v3
      v2 = r2 + a2 * r1 + a3 * v3
      r1 = 2 * v1 - r1
      r2 = 2 * v2 - r2
      r[i] += v2 * e
    }
    this.p1 = p1
    this.p2 = p2
    this.p3 = p3
    this.l1 = l1
    this.l2 = l2
    this.r1 = r1
    this.r2 = r2
    return env.active
  }
}

export class Voice {
  readonly piano = new PianoVoice()
  readonly ep = new EPVoice()
  readonly toy = new ToyVoice()
  ev: EngineVoice = this.piano
  readonly pad: PadLayer
  padOn = false
  engineAlive = false

  active = false
  noteId = -1
  key = 0
  age = 0
  /** key physically down */
  held = false
  /** key up but held by the sustain pedal (or a modY pedal note) */
  sustained = false
  /** dampers down / released */
  releasing = false
  /** started with modY > 0.75: behaves as if the pedal were down for this note */
  pedalNote = false
  /** steal / restrike fade-out */
  fading = false
  fade = 1
  fadeStep = 0

  gain = 1
  gl = 1
  gr = 1
  /** frequency at note-on (before pitch bend) */
  freq = 440

  constructor(sr: number) {
    this.pad = new PadLayer(sr)
  }

  /** Release the dampers (key up with pedal up, or pedal lifted). */
  release(relVel: number): void {
    if (!this.active || this.releasing) return
    this.releasing = true
    this.held = false
    this.sustained = false
    this.ev.release(relVel)
    this.pad.release()
  }

  /** Click-free fade-out over `seconds` (voice stealing, same-key restrike). */
  startFade(seconds: number, sr: number): void {
    if (!this.active) return
    const step = 1 / Math.max(16, seconds * sr)
    if (this.fading) {
      this.fadeStep = Math.max(this.fadeStep, step)
      return
    }
    this.fading = true
    this.fadeStep = step
    this.held = false
    this.sustained = false
  }

  kill(): void {
    this.active = false
    this.fading = false
    this.padOn = false
    this.pad.kill()
  }
}
