// Synthesised source material for the granular layer. Each texture is TEX_LEN samples at TEX_SR,
// tuned (when tonal) to C4, generated lazily on first use, seamlessly loopable, and shared by all instances.
import { Rng, SmoothRand, Svf, TAU } from './util'

export const TEXTURE_NAMES = ['Bowed Glass', 'Breath', 'Choir', 'Metal Shimmer', 'Vinyl Air', 'String Swarm', 'Ocean Rumble', 'Crystal Chimes']
export const TEX_SR = 48000
export const TEX_LEN = Math.round(TEX_SR * 2.5)
export const TEX_ROOT = 60
const F0 = 261.6256
const XF = Math.round(TEX_SR * 0.3)

const cache: (Float32Array | undefined)[] = []

/** Returns TEX_LEN + 1 samples (last = first, guard for interpolation). */
export function getTexture(i: number): Float32Array {
  const c = cache[i]
  if (c) return c
  const n = TEX_LEN + XF
  const g = new Float32Array(n)
  GEN[i] ? GEN[i](g, new Rng(777 + i * 101)) : GEN[0](g, new Rng(1))
  const out = new Float32Array(TEX_LEN + 1)
  for (let k = 0; k < TEX_LEN; k++) out[k] = g[k]
  // crossfade the overrun into the head so the loop point is seamless
  for (let k = 0; k < XF; k++) {
    const w = k / XF
    const a = Math.sin(w * Math.PI * 0.5)
    const b = Math.cos(w * Math.PI * 0.5)
    out[k] = g[k] * a + g[TEX_LEN + k] * b
  }
  let sum = 0
  for (let k = 0; k < TEX_LEN; k++) sum += out[k] * out[k]
  const rms = Math.sqrt(sum / TEX_LEN)
  const scale = 0.3 / Math.max(1e-6, rms)
  for (let k = 0; k < TEX_LEN; k++) out[k] *= scale
  out[TEX_LEN] = out[0]
  cache[i] = out
  return out
}

const SR = TEX_SR
type Gen = (g: Float32Array, r: Rng) => void

function partials(g: Float32Array, r: Rng, ratios: number[], amps: number[], opts: { vib: number; wobble: number; wobRate: number; beat?: number }): void {
  const n = g.length
  const ph = ratios.map(() => r.uni())
  const mods = ratios.map(() => new SmoothRand(r))
  const beat = opts.beat ?? 0
  let vib = 0
  for (let k = 0; k < n; k++) {
    if ((k & 63) === 0) vib = Math.sin((TAU * 5.2 * k) / SR) * opts.vib
    let s = 0
    for (let j = 0; j < ratios.length; j++) {
      const m = (k & 63) === 0 ? mods[j].step((opts.wobRate * 64) / SR) : mods[j].a + (mods[j].b - mods[j].a) * (0.5 - 0.5 * Math.cos(Math.PI * mods[j].t))
      const amp = amps[j] * (1 - opts.wobble * 0.5 + opts.wobble * 0.5 * m)
      const f = F0 * ratios[j] * (1 + vib) + (j & 1 ? beat : -beat)
      ph[j] += f / SR
      if (ph[j] >= 1) ph[j] -= 1
      s += Math.sin(TAU * ph[j]) * amp
    }
    g[k] = s
  }
}

const GEN: Gen[] = [
  // Bowed Glass: slightly inharmonic glass partials with bowing pressure wobble + bow noise
  (g, r) => {
    partials(g, r, [1, 2.0, 2.99, 4.01, 5.43, 6.8, 8.97], [1, 0.45, 0.3, 0.22, 0.12, 0.08, 0.05], { vib: 0.0015, wobble: 0.7, wobRate: 1.3 })
    const bp = new Svf()
    bp.set(3200, 2, SR)
    for (let k = 0; k < g.length; k++) g[k] += bp.bp(r.next()) * 0.04
  },
  // Breath: noise through drifting vowel formants, slow in/out breathing, faint whispered tone
  (g, r) => {
    const f = [new Svf(), new Svf(), new Svf()]
    const m = [new SmoothRand(r), new SmoothRand(r), new SmoothRand(r)]
    const breath = new SmoothRand(r)
    let ph = 0
    let a = 0
    for (let k = 0; k < g.length; k++) {
      if ((k & 31) === 0) {
        const t = 32 / SR
        f[0].set(600 * (1 + 0.3 * m[0].step(0.4 * t)), 5, SR)
        f[1].set(1400 * (1 + 0.3 * m[1].step(0.3 * t)), 6, SR)
        f[2].set(2700 * (1 + 0.2 * m[2].step(0.5 * t)), 7, SR)
        const b = breath.step(0.45 * t)
        a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin((TAU * k) / (SR * 2.5))) * (0.7 + 0.3 * b)
      }
      const n = r.next()
      ph += F0 / SR
      if (ph >= 1) ph -= 1
      g[k] = (f[0].bp(n) + f[1].bp(n) * 0.7 + f[2].bp(n) * 0.45) * a + Math.sin(TAU * ph) * 0.03 * a
    }
  },
  // Choir: detuned saw voices with vibrato into "ah→oh" formants
  (g, r) => {
    const V = 6
    const ph = new Float64Array(V)
    const det = new Float64Array(V)
    const vr = new Float64Array(V)
    for (let v = 0; v < V; v++) {
      ph[v] = r.uni()
      det[v] = Math.pow(2, (r.next() * 14) / 1200)
      vr[v] = 4.8 + r.uni() * 1.2
    }
    const fs = [new Svf(), new Svf(), new Svf(), new Svf()]
    const vow = new SmoothRand(r)
    for (let k = 0; k < g.length; k++) {
      if ((k & 31) === 0) {
        const x = 0.5 + 0.5 * vow.step((0.25 * 32) / SR)
        fs[0].set(730 - 160 * x, 7, SR)
        fs[1].set(1090 - 250 * x, 8, SR)
        fs[2].set(2440, 9, SR)
        fs[3].set(3300, 6, SR)
      }
      let s = 0
      for (let v = 0; v < V; v++) {
        const f = F0 * det[v] * (1 + 0.004 * Math.sin((TAU * vr[v] * k) / SR + v))
        ph[v] += f / SR
        if (ph[v] >= 1) ph[v] -= 1
        s += 1 - 2 * ph[v]
      }
      s = s / V + r.next() * 0.05
      g[k] = fs[0].bp(s) + fs[1].bp(s) * 0.6 + fs[2].bp(s) * 0.35 + fs[3].bp(s) * 0.15
    }
  },
  // Metal Shimmer: bell partials with beating pairs
  (g, r) => partials(g, r, [1, 2.76, 5.4, 8.93, 13.34, 2.0, 3.01, 4.17], [0.7, 0.6, 0.45, 0.35, 0.22, 0.4, 0.3, 0.25], { vib: 0, wobble: 0.9, wobRate: 2.2, beat: 1.3 }),
  // Vinyl Air: hiss + crackle + soft hum
  (g, r) => {
    const lp = new Svf()
    lp.set(7000, 0.6, SR)
    const hp = new Svf()
    hp.set(300, 0.7, SR)
    const crk = new Svf()
    crk.set(2500, 1.5, SR)
    let ph = 0
    for (let k = 0; k < g.length; k++) {
      let s = hp.hp(lp.lp(r.next())) * 0.5
      const c = r.uni() < 0.0006 ? r.next() * 6 : 0
      s += crk.bp(c) * 0.8
      ph += (F0 * 0.25) / SR
      if (ph >= 1) ph -= 1
      s += Math.sin(TAU * ph) * 0.06
      g[k] = s
    }
  },
  // String Swarm: many detuned saws, softly filtered
  (g, r) => {
    const V = 9
    const ph = new Float64Array(V)
    const det = new Float64Array(V)
    const am = Array.from({ length: V }, () => new SmoothRand(r))
    for (let v = 0; v < V; v++) {
      ph[v] = r.uni()
      det[v] = Math.pow(2, ((v / (V - 1) - 0.5) * 30 + r.next() * 3) / 1200) * (v % 4 === 0 ? 0.5 : 1)
    }
    const lp = new Svf()
    lp.set(2800, 0.8, SR)
    const amps = new Float64Array(V)
    for (let k = 0; k < g.length; k++) {
      if ((k & 63) === 0) for (let v = 0; v < V; v++) amps[v] = 0.6 + 0.4 * am[v].step((0.8 * 64) / SR)
      let s = 0
      for (let v = 0; v < V; v++) {
        ph[v] += (F0 * det[v]) / SR
        if (ph[v] >= 1) ph[v] -= 1
        s += (1 - 2 * ph[v]) * amps[v]
      }
      g[k] = lp.lp(s / V)
    }
  },
  // Ocean Rumble: brown noise with slow swells + sub tone
  (g, r) => {
    const lp = new Svf()
    lp.set(700, 0.7, SR)
    const sw = new SmoothRand(r)
    let brown = 0
    let ph = 0
    let a = 0
    for (let k = 0; k < g.length; k++) {
      if ((k & 63) === 0) a = 0.4 + 0.6 * (0.5 + 0.5 * sw.step((0.6 * 64) / SR))
      brown = brown * 0.995 + r.next() * 0.1
      ph += (F0 * 0.5) / SR
      if (ph >= 1) ph -= 1
      g[k] = lp.lp(brown) * a + Math.sin(TAU * ph) * 0.08
    }
  },
  // Crystal Chimes: sparse decaying sine plinks on a pentatonic set
  (g, r) => {
    const ratios = [1, 1.125, 1.25, 1.5, 1.667, 2, 2.25, 2.5, 3, 4]
    const MAXV = 10
    const f = new Float64Array(MAXV)
    const ph = new Float64Array(MAXV)
    const amp = new Float64Array(MAXV)
    const dec = Math.exp(-1 / (SR * 0.6))
    let next = 0
    let vi = 0
    for (let k = 0; k < g.length; k++) {
      if (k >= next) {
        f[vi] = F0 * ratios[Math.floor(r.uni() * ratios.length)] * (r.uni() < 0.3 ? 2 : 1)
        amp[vi] = 0.4 + 0.6 * r.uni()
        ph[vi] = 0
        vi = (vi + 1) % MAXV
        next = k + Math.round(SR * (0.06 + 0.25 * r.uni()))
      }
      let s = 0
      for (let v = 0; v < MAXV; v++) {
        if (amp[v] < 1e-4) continue
        ph[v] += f[v] / SR
        if (ph[v] >= 1) ph[v] -= 1
        s += (Math.sin(TAU * ph[v]) + 0.15 * Math.sin(TAU * 3 * ph[v])) * amp[v]
        amp[v] *= dec
      }
      g[k] = s
    }
  }
]
