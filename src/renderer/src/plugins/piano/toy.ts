// Toy piano voice: a hammer striking a clamped–free metal rod (cantilever modes 1 : 6.27 : 17.55 :
// 34.4), each mode split into a slightly mistuned doublet (the rod bends in two planes → shimmer),
// with a hard plastic hammer whose brightness follows velocity, a contact click and no dampers.
// Built on Mosaic's ModalBank (same 2-multiply recursive oscillators as the acoustic piano).
import { ModalBank, Noise, Reson, clamp, type EngineVoice, type Mods, type PartParams } from '../mosaic/engines/common'

const RATIOS = [1, 6.267, 17.55, 34.39]
const AMPS = [1, 0.55, 0.28, 0.12]
const DMUL = [1, 2.6, 6, 11]

export class ToyVoice implements EngineVoice {
  stereo = true
  private bank = new ModalBank(RATIOS.length * 2)
  private sr = 48000
  private startFreq = 440
  private noise = new Noise(9091)
  private click = new Reson()
  private cEnv = 0
  private cDec = 0
  private cLvl = 0

  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    this.startFreq = freq
    const h = clamp(p.hard + m.bright * 0.5, 0, 1)
    // fundamental T60: ~2.2 s at C5, shorter up high
    const t60 = 2.2 * Math.pow(0.72, (key - 72) / 12) * p.decay
    const sigma = 6.9078 / clamp(t60, 0.15, 3)
    // hammer contact spectrum: corner rises steeply with velocity and hardness
    const fc = freq * (1.5 + 18 * h * h * vel * vel + 3 * vel)
    const inh = p.detune
    const bank = this.bank
    bank.begin(sr)
    // normalise on the audible part: in the bass the rod fundamental sits below the little box's
    // range, so the upper modes carry the note (otherwise low keys would be near-silent)
    let sum = 0
    for (let k = 0; k < RATIOS.length; k++) {
      const f = freq * RATIOS[k]
      sum += (AMPS[k] / (1 + Math.pow(f / fc, 2))) * ((f * f) / (f * f + 150 * 150))
    }
    const norm = Math.min(1.2, 0.4 / Math.max(0.3, sum))
    for (let k = 0; k < RATIOS.length; k++) {
      const f = freq * RATIOS[k] * (1 + inh * 0.015 * k)
      const w = 1 / (1 + Math.pow(f / fc, 2))
      const a = AMPS[k] * w * norm
      const s = sigma * DMUL[k]
      const split = Math.pow(2, (1.5 + 3 * inh) / 1200)
      bank.add(f / split, a * 0.55, s, 0)
      bank.add(f * split, a * 0.45, s * 1.15, 1)
    }
    this.click.reset()
    this.click.set(clamp(freq * 8, 2500, 9500), 3500, sr)
    this.cEnv = 1
    this.cDec = Math.exp(-1 / (sr * 0.0018))
    this.cLvl = p.noise * vel * (0.35 + h) * 0.9
  }

  setFreq(freq: number): void {
    this.bank.retune(freq / this.startFreq)
  }

  /** Toy pianos have no dampers: the rods ring out. */
  release(): void {}

  render(l: Float32Array, r: Float32Array, n: number): boolean {
    l.fill(0, 0, n)
    r.fill(0, 0, n)
    this.bank.render(l, r, n, true)
    if (this.cEnv > 1e-4) {
      for (let i = 0; i < n; i++) {
        const s = this.click.process(this.noise.next()) * this.cEnv * this.cLvl
        this.cEnv *= this.cDec
        l[i] += s
        r[i] += s
      }
    }
    for (let i = 0; i < n; i++) {
      const a = l[i]
      const b = r[i]
      l[i] = a + b * 0.5
      r[i] = b + a * 0.5
    }
    return this.bank.alive || this.cEnv > 1e-4
  }
}
