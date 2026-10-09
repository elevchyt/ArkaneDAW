// 6-operator FM (DX-style). Operators are evaluated 6 → 1; modulators feed phase offsets
// (in cycles) into the ops below them according to the algorithm. Op6 has self-feedback.
import { ADSR } from '../../sdk/dsp'
import { clamp, sinp, wrap, type EngineVoice, type Mods, type PartParams } from './common'

/** For each algorithm: modulators of op index (0..5) and the carrier list. */
const ALGOS: { mods: number[][]; car: number[] }[] = [
  { mods: [[1], [2], [3], [4], [5], []], car: [0] },
  { mods: [[1], [], [3], [4], [5], []], car: [0, 2] },
  { mods: [[1], [], [3], [], [5], []], car: [0, 2, 4] },
  { mods: [[1], [], [3, 4], [], [5], []], car: [0, 2] },
  { mods: [[1, 2, 4], [], [3], [], [5], []], car: [0] },
  { mods: [[1], [], [5], [5], [5], []], car: [0, 2, 3, 4] },
  { mods: [[1], [2], [], [5], [5], []], car: [0, 3, 4] },
  { mods: [[], [], [], [], [], []], car: [0, 1, 2, 3, 4, 5] }
]

export class FMVoice implements EngineVoice {
  stereo = false
  private sr = 48000
  private env: ADSR[] = []
  private ph = new Float64Array(6)
  private ratio = new Float64Array(6)
  private lvl = new Float64Array(6)
  private out = new Float64Array(6)
  private isCar = new Uint8Array(6)
  private modsFlat = new Int8Array(18) // up to 3 modulators per op, -1 terminated
  private freq = 440
  private fb = 0
  private fb1 = 0
  private fb2 = 0
  private carGain = 0.3
  private carriers: number[] = [0]

  start(key: number, vel: number, freq: number, p: PartParams, m: Mods, sr: number): void {
    this.sr = sr
    this.freq = freq
    if (this.env.length === 0) for (let i = 0; i < 6; i++) this.env.push(new ADSR(sr))
    const algo = ALGOS[clamp(p.algo | 0, 0, ALGOS.length - 1)]
    this.carriers = algo.car
    this.isCar.fill(0)
    for (const c of algo.car) this.isCar[c] = 1
    this.modsFlat.fill(-1)
    for (let o = 0; o < 6; o++) algo.mods[o].forEach((s, k) => (this.modsFlat[o * 3 + k] = s))
    const bright = 1 + m.bright
    for (let o = 0; o < 6; o++) {
      const n = o + 1
      const ratio = p[`o${n}.r`] * Math.pow(2, (p[`o${n}.d`] + (o & 1 ? 1 : -1) * m.detune * 8) / 1200)
      this.ratio[o] = ratio
      const vs = p[`o${n}.v`]
      const velScale = 1 - vs + vs * vel * 1.25
      const ks = p[`o${n}.k`]
      const keyScale = key > 60 ? Math.pow(2, (-ks * (key - 60)) / 18) : 1 + ks * (60 - key) * 0.01
      const L = p[`o${n}.l`]
      if (this.isCar[o]) this.lvl[o] = L * velScale
      else this.lvl[o] = L * L * 2.2 * velScale * keyScale * Math.max(0, bright)
      const e = this.env[o]
      e.set(p[`o${n}.a`], p[`o${n}.dc`], p[`o${n}.s`], p[`o${n}.rl`])
      e.reset()
      e.gate(true)
      this.ph[o] = 0
      this.out[o] = 0
    }
    this.fb = p.fb * 0.45
    this.fb1 = this.fb2 = 0
    this.carGain = 0.32 / Math.sqrt(algo.car.length)
  }

  setFreq(freq: number): void {
    this.freq = freq
  }

  release(): void {
    for (const e of this.env) e.gate(false)
  }

  render(l: Float32Array, _r: Float32Array, n: number): boolean {
    const sr = this.sr
    const base = this.freq / sr
    const ph = this.ph
    const out = this.out
    const lvl = this.lvl
    const ratio = this.ratio
    const mf = this.modsFlat
    const env = this.env
    const isCar = this.isCar
    const cg = this.carGain
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let o = 5; o >= 0; o--) {
        const e = env[o].next() * lvl[o]
        let mod = 0
        const j = o * 3
        let s = mf[j]
        if (s >= 0) {
          mod += out[s]
          s = mf[j + 1]
          if (s >= 0) {
            mod += out[s]
            s = mf[j + 2]
            if (s >= 0) mod += out[s]
          }
        }
        if (o === 5) mod += (this.fb1 + this.fb2) * this.fb
        const y = sinp(wrap(ph[o] + mod)) * e
        out[o] = y
        if (o === 5) {
          this.fb2 = this.fb1
          this.fb1 = y
        }
        if (isCar[o]) sum += y
        let p = ph[o] + base * ratio[o]
        if (p >= 1) p -= Math.floor(p)
        ph[o] = p
      }
      l[i] = sum * cg
    }
    for (const c of this.carriers) if (env[c].active) return true
    return false
  }
}
