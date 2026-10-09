// Virtual-analog: up to 7 detuned (super)saws/pulses with stereo spread, second oscillator,
// sub-octave square, noise, PWM and drive. Filtering/envelopes are done by the generic voice.
import { Osc } from '../../sdk/dsp'
import { Noise, clamp, type EngineVoice, type Mods, type PartParams } from './common'

const SHAPE = [2, 3, 3, 1, 0] // ANALOG_WAVES → sdk Osc shapes
const SPREAD = [0, -1, 1, -0.6, 0.6, -0.3, 0.3]

export class AnalogVoice implements EngineVoice {
  stereo = true
  private sr = 48000
  private osc: Osc[] = Array.from({ length: 7 }, () => new Osc())
  private oscB = new Osc()
  private sub = new Osc()
  private noise = new Noise(99)
  private freq = 220
  private nv = 1
  private shape = 2
  private pw = 0.5
  private pwm = 0
  private pwmPh = 0
  private det = new Float64Array(7)
  private panL = new Float64Array(7)
  private panR = new Float64Array(7)
  private bShape = 2
  private bRatio = 1
  private bMix = 0
  private subMix = 0
  private noiseMix = 0
  private drive = 0
  private norm = 1

  start(_key: number, _vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    this.freq = freq
    const nv = clamp(Math.round(p.voices), 1, 7)
    this.nv = nv
    const wave = clamp(p.wave | 0, 0, 4)
    this.shape = SHAPE[wave]
    this.pw = wave === 1 ? 0.5 : p.pw
    this.pwm = p.pwm
    const det = clamp(p.detune + m.detune * 0.5, 0, 1)
    const spread = p.spread
    for (let k = 0; k < 7; k++) {
      const cents = nv > 1 ? SPREAD[k] * det * det * 55 + SPREAD[k] * det * 8 : 0
      this.det[k] = Math.pow(2, cents / 1200)
      const pan = nv > 1 ? SPREAD[k] * spread : 0
      this.panL[k] = Math.min(1, 1 - pan)
      this.panR[k] = Math.min(1, 1 + pan)
      this.osc[k].phase = nv > 1 ? Math.random() : 0
      this.osc[k].pw = this.pw
    }
    this.bShape = SHAPE[clamp(p['b.wave'] | 0, 0, 4)]
    this.bRatio = Math.pow(2, (p['b.semi'] + p['b.fine'] / 100) / 12)
    this.bMix = p['b.mix']
    this.oscB.phase = 0
    this.oscB.pw = this.pw
    this.sub.phase = 0
    this.sub.pw = 0.5
    this.subMix = p.sub
    this.noiseMix = p.noise
    this.drive = clamp(p.drive + m.drive, 0, 1)
    this.norm = 0.33 / Math.sqrt(nv * 0.8 + 0.2 + this.bMix * this.bMix + this.subMix * 0.5)
  }

  setFreq(freq: number): void {
    this.freq = freq
  }

  release(): void {}

  render(l: Float32Array, r: Float32Array, n: number): boolean {
    const sr = this.sr
    const base = this.freq / sr
    const nv = this.nv
    const shape = this.shape
    l.fill(0, 0, n)
    r.fill(0, 0, n)
    // PWM (control rate)
    if (this.pwm > 0 && (shape === 3)) {
      this.pwmPh += (0.7 * n) / sr
      if (this.pwmPh >= 1) this.pwmPh -= 1
      const pw = clamp(this.pw + Math.sin(this.pwmPh * 6.2832) * this.pwm * 0.4, 0.05, 0.95)
      for (let k = 0; k < nv; k++) this.osc[k].pw = pw
      this.oscB.pw = pw
    }
    for (let k = 0; k < nv; k++) {
      const o = this.osc[k]
      const dt = Math.min(0.45, base * this.det[k])
      const sq = shape === 3 ? 0.6 : 1
      const gl = this.panL[k] * sq
      const gr = this.panR[k] * sq
      for (let i = 0; i < n; i++) {
        const x = o.next(shape, dt)
        l[i] += x * gl
        r[i] += x * gr
      }
    }
    if (this.bMix > 0) {
      const dt = Math.min(0.45, base * this.bRatio)
      const g = this.bMix
      for (let i = 0; i < n; i++) {
        const x = this.oscB.next(this.bShape, dt) * g
        l[i] += x
        r[i] += x
      }
    }
    if (this.subMix > 0) {
      const dt = base * 0.5
      const g = this.subMix
      for (let i = 0; i < n; i++) {
        const x = this.sub.next(3, dt) * g
        l[i] += x
        r[i] += x
      }
    }
    if (this.noiseMix > 0) {
      const g = this.noiseMix * 0.6
      for (let i = 0; i < n; i++) {
        const x = this.noise.next() * g
        l[i] += x
        r[i] += x
      }
    }
    const norm = this.norm
    if (this.drive > 0.01) {
      const d = 1 + this.drive * 6
      const c = norm / Math.tanh(d * 0.5) * 0.5
      for (let i = 0; i < n; i++) {
        l[i] = Math.tanh(l[i] * norm * d * 1.5) * c / norm
        r[i] = Math.tanh(r[i] * norm * d * 1.5) * c / norm
      }
    }
    for (let i = 0; i < n; i++) {
      l[i] *= norm
      r[i] *= norm
    }
    return true
  }
}
