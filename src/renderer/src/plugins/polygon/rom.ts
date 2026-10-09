// Polygon "virtual ROM": procedurally synthesized PCM multisamples in the spirit of early-90s ROMplers.
//
// Each waveform is a set of multisamples (one per root key). A multisample is:
//   [ attack section (A samples) | sustain loop (L samples) ]  (or a one-shot without a loop)
// The loop is built in the frequency domain (one inverse FFT over L bins), so every component is an integer
// number of cycles per loop -> perfectly seamless loops, even for detuned "ensemble" partials, breath noise and
// inharmonic bells (exactly how ROM loops of noise/ensembles behave). The attack section adds time-varying
// layers (the same loop bins with decaying envelopes, so they vanish exactly at the loop point) plus
// time-domain transients (hammer/pick/chiff noise, FM tine barks...).
//
// Data is stored at ROM_SR (32 kHz), band-limited to ~12.5 kHz, peak/RMS normalized and quantized to 16 bit.
// Generation is lazy (per multisample) and cached for the lifetime of the JS realm (worklet global scope).
// Pure TS, no DOM: runs in the AudioWorklet and on the UI thread (waveform previews).
import { SVF } from '../sdk/dsp'
import { WAVE_NAMES } from './waves'

export const ROM_SR = 32000
const FMAX = 12500
const ROLL = 9000

export interface Multi {
  /** MIDI key (fractional) at which the data plays back at its natural pitch. */
  root: number
  /** PCM at ROM_SR. One guard sample after loopEnd (copy of loopStart) for interpolation. */
  data: Float32Array
  loopStart: number
  loopEnd: number
  oneShot: boolean
}

// ─── utilities ────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface FFTTables {
  rev: Uint32Array
  cos: Float64Array
  sin: Float64Array
}
const fftTables = new Map<number, FFTTables>()
function tables(n: number): FFTTables {
  let t = fftTables.get(n)
  if (t) return t
  const bits = Math.round(Math.log2(n))
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k++) {
    cos[k] = Math.cos((2 * Math.PI * k) / n)
    sin[k] = Math.sin((2 * Math.PI * k) / n)
  }
  t = { rev, cos, sin }
  fftTables.set(n, t)
  return t
}

/** In-place unnormalized inverse DFT (positive exponent), radix-2. */
function ifft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  const { rev, cos, sin } = tables(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j
        const b = a + half
        const c = cos[k], s = sin[k]
        const tr = re[b] * c - im[b] * s
        const ti = re[b] * s + im[b] * c
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
}

/** Sum of resonance humps: [centerHz, bandwidthHz, gain][] */
function fm(f: number, list: number[][]): number {
  let s = 0
  for (const [c, bw, g] of list) {
    const x = (f - c) / bw
    s += g / (1 + x * x)
  }
  return s
}

const ex = (tau: number) => (t: number): number => Math.exp(-t / tau)
/** attack-decay hump peaking at `peak` seconds */
const hump = (peak: number) => (t: number): number => (t / peak) * Math.exp(1 - t / peak)

// ─── generation context ───────────────────────────────────────────────────────

type Spectrum = Float64Array

class G {
  readonly binHz: number
  readonly f0: number
  readonly ph: Float64Array
  readonly rng: () => number
  constructor(readonly L: number, readonly C: number, seed: number) {
    this.binHz = ROM_SR / L
    this.f0 = C * this.binHz
    this.rng = mulberry32(seed)
    this.ph = new Float64Array(L / 2)
    for (let k = 0; k < L / 2; k++) this.ph[k] = this.rng() * Math.PI * 2
  }
  spec(): Spectrum {
    return new Float64Array(this.L / 2)
  }
  /** Add a partial at `f` Hz. spread = ensemble width in bins (each bin ≤ ~12 cents, else narrowed). */
  p(m: Spectrum, f: number, amp: number, spread = 0): void {
    if (f <= 0 || f >= FMAX || amp === 0) return
    if (f > ROLL) amp *= 0.5 + 0.5 * Math.cos((Math.PI * (f - ROLL)) / (FMAX - ROLL))
    const b = f / this.binHz
    const k = Math.round(b)
    if (k < 1 || k >= this.L / 2 - 4) return
    const s = Math.min(spread, Math.floor(b / 144))
    if (s <= 0) {
      m[k] += amp
      return
    }
    let norm = 0
    const w: number[] = []
    for (let j = -s; j <= s; j++) {
      const x = j === 0 ? 1 : 0.35 + 0.6 * this.rng()
      w.push(x)
      norm += x * x
    }
    norm = 1 / Math.sqrt(norm)
    for (let j = -s; j <= s; j++) if (k + j >= 1) m[k + j] += amp * w[j + s] * norm
  }
  /** Harmonic series: amp(h, freqHz) for h = 1.. up to FMAX. */
  harm(m: Spectrum, amp: (h: number, f: number) => number, spread = 0, fmax = FMAX): void {
    for (let h = 1; h * this.f0 < Math.min(FMAX, fmax); h++) this.p(m, h * this.f0, amp(h, h * this.f0), spread)
  }
  /** Explicit partial list: [ratio, amp][] relative to f0. */
  parts(m: Spectrum, list: number[][], spread = 0): void {
    for (const [r, a] of list) this.p(m, r * this.f0, a, spread)
  }
  /** Band of noise bins. amp ≈ level of one partial per 1 kHz of bandwidth. */
  noise(m: Spectrum, lo: number, hi: number, amp: number, shape?: (f: number) => number): void {
    const q = amp * Math.sqrt(this.binHz / 1000)
    const k0 = Math.max(1, Math.ceil(lo / this.binHz))
    const k1 = Math.min(this.L / 2 - 4, Math.floor(Math.min(hi, FMAX) / this.binHz))
    for (let k = k0; k <= k1; k++) {
      const f = k * this.binHz
      let a = q * (0.25 + 1.1 * this.rng()) * (shape ? shape(f) : 1)
      if (f > ROLL) a *= 0.5 + 0.5 * Math.cos((Math.PI * (f - ROLL)) / (FMAX - ROLL))
      m[k] += a
    }
  }
  /** Noise hugging each harmonic (breathiness of flutes etc.). */
  breathHarm(m: Spectrum, width: number, amp: number, nh = 6): void {
    for (let h = 1; h <= nh; h++) this.noise(m, h * this.f0 - width, h * this.f0 + width, amp / h)
  }
  loop(m: Spectrum): Float32Array {
    const L = this.L
    const re = new Float64Array(L)
    const im = new Float64Array(L)
    for (let k = 1; k < L / 2; k++) {
      if (m[k] === 0) continue
      const a = m[k] * 0.5
      re[k] = a * Math.cos(this.ph[k])
      im[k] = a * Math.sin(this.ph[k])
      re[L - k] = re[k]
      im[L - k] = -im[k]
    }
    ifft(re, im)
    const out = new Float32Array(L)
    for (let i = 0; i < L; i++) out[i] = re[i]
    return out
  }
  buf(sec: number): Float32Array {
    return new Float32Array(Math.max(1, Math.round(sec * ROM_SR)))
  }
  // ── time-domain transients ──
  /** Sine partial with linear attack and exponential decay. */
  tdSine(buf: Float32Array, f: number, amp: number, att: number, dec: number): void {
    if (f >= FMAX) return
    const w = (2 * Math.PI * f) / ROM_SR
    const c = Math.cos(w), s = Math.sin(w)
    let x = 1, y = 0
    const na = Math.max(1, att * ROM_SR)
    const g = Math.exp(-1 / (dec * ROM_SR))
    let e = amp
    for (let t = 0; t < buf.length; t++) {
      const a = t < na ? t / na : 1
      buf[t] += e * a * y
      const nx = x * c - y * s
      y = x * s + y * c
      x = nx
      if (t >= na) e *= g
      if (e < 1e-5) break
    }
  }
  /** Filtered noise burst. mode 0 LP, 1 HP, 2 BP. Cutoff sweeps f -> fEnd exponentially over `dec`. */
  tdNoise(buf: Float32Array, amp: number, att: number, dec: number, mode: number, f: number, q = 0.8, fEnd = f): void {
    const flt = new SVF(ROM_SR)
    flt.mode = mode
    const na = Math.max(1, att * ROM_SR)
    const g = Math.exp(-1 / (dec * ROM_SR))
    let e = amp
    for (let t = 0; t < buf.length; t++) {
      if ((t & 31) === 0) flt.set(f * Math.pow(fEnd / f, Math.min(1, t / (dec * 3 * ROM_SR))), q)
      const a = t < na ? t / na : 1
      buf[t] += flt.process(this.rng() * 2 - 1) * e * a
      if (t >= na) e *= g
      if (e < 1e-5) break
    }
  }
  /** 2-op FM burst: carrier fc, modulator ratio, decaying index & amplitude. */
  tdFM(buf: Float32Array, fc: number, ratio: number, index: number, idxDec: number, amp: number, dec: number): void {
    const wc = (2 * Math.PI * fc) / ROM_SR
    const wm = wc * ratio
    const gi = Math.exp(-1 / (idxDec * ROM_SR))
    const ga = Math.exp(-1 / (dec * ROM_SR))
    let I = index, e = amp
    for (let t = 0; t < buf.length; t++) {
      const a = t < 32 ? t / 32 : 1
      buf[t] += e * a * Math.sin(wc * t + I * Math.sin(wm * t))
      I *= gi
      e *= ga
      if (e < 1e-5) break
    }
  }
}

// ─── assembly ─────────────────────────────────────────────────────────────────

interface Result {
  /** attack section length in seconds (one-shots: total length) */
  A: number
  base?: Float32Array
  /** gain curve of the base loop during the attack section (cross-faded to 1 at the loop point) */
  baseEnv?: (t: number) => number
  layers?: { loop: Float32Array; env: (t: number) => number }[]
  td?: Float32Array
  oneShot?: boolean
}

function assemble(g: G, r: Result): Multi {
  const L = g.L
  const A = Math.round(r.A * ROM_SR)
  const one = !!r.oneShot
  const len = one ? A : A + L
  const data = new Float32Array(len + 1)
  const fs = one ? len : Math.floor(A * 0.7) // tail-fade start (attack layers must vanish at the loop point)
  for (let t = 0; t < len; t++) {
    const li = (((t - A) % L) + L) % L
    const ts = t / ROM_SR
    let fade = 1
    if (!one && t >= fs) fade = t >= A ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * (t - fs)) / (A - fs))
    let v = 0
    if (r.base) {
      let bg = 1
      if (r.baseEnv && t < A) bg = one ? r.baseEnv(ts) : 1 + (r.baseEnv(ts) - 1) * fade
      v = r.base[li] * bg
    }
    if (t < A) {
      if (r.layers) for (const l of r.layers) v += l.loop[li] * l.env(ts) * fade
      if (r.td && t < r.td.length) v += r.td[t] * fade
    }
    data[t] = v
  }
  if (one) {
    const nf = Math.min(len, Math.round(0.03 * ROM_SR))
    for (let i = 0; i < nf; i++) data[len - 1 - i] *= i / nf
  }
  // normalize: loop RMS ~0.3 (so waves layer predictably), capped by peak
  let peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]))
  let scale = 0.9 / Math.max(1e-9, peak)
  if (!one && L > 0) {
    let s = 0
    for (let i = A; i < len; i++) s += data[i] * data[i]
    const rms = Math.sqrt(s / L)
    scale = Math.min(0.3 / Math.max(1e-9, rms), 0.97 / Math.max(1e-9, peak))
  }
  for (let i = 0; i < len; i++) data[i] = Math.round(data[i] * scale * 32767) / 32767 // 16-bit ROM
  data[len] = one ? 0 : data[A]
  return {
    root: 69 + 12 * Math.log2(g.f0 / 440),
    data,
    loopStart: one ? len : A,
    loopEnd: len,
    oneShot: one
  }
}

// ─── recipes ──────────────────────────────────────────────────────────────────

interface Recipe {
  L?: number
  roots?: number[]
  gen: (g: G) => Result
}

const BASS_ROOTS = [41.2, 98, 233, 554]
const DEF_ROOTS = [65.4, 261.6, 1046.5]

const R: Record<string, Recipe> = {
  Saw: { gen: (g) => { const m = g.spec(); g.harm(m, (h) => 1 / h); return { A: 0, base: g.loop(m) } } },
  Square: { gen: (g) => { const m = g.spec(); g.harm(m, (h) => (h & 1 ? 1 / h : 0.012 / h)); return { A: 0, base: g.loop(m) } } },
  'Pulse 25': { gen: (g) => { const m = g.spec(); g.harm(m, (h) => Math.abs(Math.sin(Math.PI * h * 0.25)) / h); return { A: 0, base: g.loop(m) } } },
  Sine: { gen: (g) => { const m = g.spec(); g.parts(m, [[1, 1], [2, 0.015], [3, 0.008]]); return { A: 0, base: g.loop(m) } } },
  Spectrum: {
    gen: (g) => {
      const m = g.spec()
      g.parts(m, [[1, 1], [2, 0.3], [3, 0.55], [5, 0.62], [8, 0.5], [13, 0.4], [21, 0.3], [34, 0.2], [55, 0.12]], 1)
      g.harm(m, (h) => 0.02 / h)
      return { A: 0, base: g.loop(m) }
    }
  },
  'Saw Ens': { L: 16384, gen: (g) => { const m = g.spec(); g.harm(m, (h) => 1 / h, 3); return { A: 0, base: g.loop(m) } } },
  'Warm Pad': {
    L: 16384,
    gen: (g) => {
      const m = g.spec()
      g.harm(m, (h, f) => (1 / Math.pow(h, 1.5)) * (1 + fm(f, [[800, 300, 0.6]])), 2)
      g.noise(m, 2000, 8000, 0.004)
      return { A: 0, base: g.loop(m) }
    }
  },
  'Digital Bell': {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2.76, 0.22], [5.4, 0.08]])
      const l = g.spec(); g.parts(l, [[2.76, 0.7], [5.4, 0.5], [8.93, 0.4], [13.34, 0.25], [18.64, 0.15]])
      const td = g.buf(0.8); g.tdFM(td, g.f0, 3.5, 4, 0.08, 0.45, 0.3)
      return { A: 0.8, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.35) }], td }
    }
  },
  'Glass Atk': {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 0.6], [3.01, 0.8], [4.98, 0.4], [7.2, 0.6], [11.3, 0.35], [15.1, 0.2]])
      const td = g.buf(0.45)
      g.tdNoise(td, 0.3, 0.0005, 0.012, 1, 6000)
      g.tdFM(td, g.f0 * 2, 7.1, 2, 0.05, 0.4, 0.08)
      return { A: 0.45, base: g.loop(b), baseEnv: (t) => Math.min(1, t / 0.001) * Math.exp(-t / 0.11), td, oneShot: true }
    }
  },
  'Bell Loop': {
    gen: (g) => {
      const m = g.spec()
      g.parts(m, [[1, 1], [2, 0.4], [2.97, 0.35], [4.24, 0.3], [5.4, 0.25], [6.8, 0.2], [8.1, 0.15], [9.6, 0.1]], 1)
      return { A: 0, base: g.loop(m) }
    }
  },
  Vibes: {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [4, 0.07]])
      const l = g.spec(); g.parts(l, [[4, 0.5], [10, 0.22]])
      const td = g.buf(0.1); g.tdNoise(td, 0.15, 0.0005, 0.008, 2, 3000, 1.5)
      return { A: 0.6, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.25) }], td }
    }
  },
  Marimba: {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [3.9, 0.04]])
      const l = g.spec(); g.parts(l, [[3.9, 0.6], [9.2, 0.3]])
      const td = g.buf(0.1); g.tdNoise(td, 0.25, 0.0005, 0.01, 0, 900)
      return { A: 0.3, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.06) }], td }
    }
  },
  Glocken: {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2.76, 0.15]])
      const l = g.spec(); g.parts(l, [[2.76, 0.7], [5.4, 0.5], [8.93, 0.3]])
      const td = g.buf(0.05); g.tdNoise(td, 0.2, 0.0003, 0.005, 1, 5000)
      return { A: 0.7, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.4) }], td }
    }
  },
  'Piano Atk': {
    gen: (g) => {
      const b = g.spec()
      g.harm(b, (h) => (Math.abs(Math.sin((Math.PI * h) / 7)) + 0.08) / Math.pow(h, 0.9))
      const td = g.buf(0.35)
      g.tdNoise(td, 0.4, 0.0005, 0.02, 0, 2500)
      g.tdSine(td, g.f0, 0.3, 0.001, 0.1)
      return { A: 0.35, base: g.loop(b), baseEnv: (t) => Math.min(1, t / 0.0015) * Math.exp(-t / 0.08), td, oneShot: true }
    }
  },
  'M1 Piano': {
    gen: (g) => {
      const B = 0.00025
      const pos = (h: number) => Math.abs(Math.sin((Math.PI * h) / 7)) + 0.08
      const st = (h: number) => h * Math.sqrt(1 + B * h * h)
      const b = g.spec(), l1 = g.spec(), l2 = g.spec()
      for (let h = 1; h * g.f0 < FMAX; h++) {
        const f = st(h) * g.f0
        if (f < 4000) g.p(b, f, pos(h) / Math.pow(h, 1.6), 1)
        g.p(l1, f, pos(h) / Math.pow(h, 0.9), 1)
        if (f < 6000) g.p(l2, f, pos(h) / Math.pow(h, 1.2), 1)
      }
      const td = g.buf(0.1)
      g.tdNoise(td, 0.25, 0.0005, 0.015, 0, 1800)
      g.tdNoise(td, 0.06, 0.0002, 0.005, 2, 4000)
      return { A: 1.4, base: g.loop(b), layers: [{ loop: g.loop(l1), env: ex(0.25) }, { loop: g.loop(l2), env: ex(0.9) }], td }
    }
  },
  'DX EP': {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.12], [3, 0.03]])
      const l = g.spec(); g.parts(l, [[2, 0.35], [3, 0.15], [4, 0.08], [14, 0.3]])
      const td = g.buf(0.2); g.tdFM(td, g.f0, 14, 1.5, 0.03, 0.3, 0.05)
      return { A: 1.0, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.5) }], td }
    }
  },
  Organ: {
    gen: (g) => {
      const m = g.spec()
      g.parts(m, [[1, 1], [2, 0.75], [3, 0.55], [4, 0.5], [6, 0.3], [8, 0.35], [10, 0.1], [12, 0.12], [16, 0.08]])
      const td = g.buf(0.05); g.tdNoise(td, 0.2, 0.0002, 0.004, 2, 2500, 0.5)
      return { A: 0.05, base: g.loop(m), td }
    }
  },
  'Strings Sus': {
    L: 16384,
    gen: (g) => {
      const body = (f: number) => 0.4 + fm(f, [[450, 150, 1], [1400, 400, 0.7], [3000, 800, 0.5]])
      const b = g.spec(); g.harm(b, (h, f) => body(f) / Math.pow(h, 0.9), 3, 9000); g.noise(b, 2000, 7000, 0.012)
      const l = g.spec(); g.harm(l, (h) => (h > 1 ? 0.3 / h : 0), 2, 6000)
      const td = g.buf(0.3); g.tdNoise(td, 0.1, 0.02, 0.08, 2, 2000, 0.6)
      return { A: 0.3, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.08) }], td }
    }
  },
  Pizz: {
    L: 16384,
    gen: (g) => {
      const body = (f: number) => 0.4 + fm(f, [[450, 150, 1], [1400, 400, 0.7]])
      const b = g.spec(); g.harm(b, (h, f) => body(f) / Math.pow(h, 1.1), 2, 8000)
      const l = g.spec(); g.harm(l, (h) => 0.5 / Math.pow(h, 0.7), 2)
      const td = g.buf(0.1); g.tdNoise(td, 0.15, 0.0005, 0.01, 2, 1500)
      return {
        A: 0.7, oneShot: true, base: g.loop(b), td,
        baseEnv: (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.22),
        layers: [{ loop: g.loop(l), env: (t) => Math.min(1, t / 0.002) * Math.exp(-t / 0.05) }]
      }
    }
  },
  'Choir Aah': {
    L: 16384,
    gen: (g) => {
      const F = [[730, 90, 1], [1090, 110, 0.5], [2440, 160, 0.25], [3400, 250, 0.12]]
      const m = g.spec()
      g.harm(m, (h, f) => (fm(f, F) + 0.004) / Math.pow(h, 0.3), 3)
      g.noise(m, 500, 4000, 0.03, (f) => fm(f, F))
      return { A: 0, base: g.loop(m) }
    }
  },
  Vox: {
    L: 16384,
    gen: (g) => {
      const F = [[300, 60, 1], [870, 100, 0.25], [2240, 150, 0.08]]
      const m = g.spec()
      g.harm(m, (h, f) => (fm(f, F) + 0.003) / Math.pow(h, 0.3), 3)
      g.noise(m, 200, 3000, 0.02, (f) => fm(f, F))
      return { A: 0, base: g.loop(m) }
    }
  },
  'Brass Sus': {
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h, f) => (0.3 + fm(f, [[1200, 500, 1], [2500, 700, 0.5]])) / Math.pow(h, 0.6), 1, 7000)
      const l = g.spec(); g.harm(l, (h) => (h <= 3 ? 0.5 / h : 0))
      const td = g.buf(0.25); g.tdNoise(td, 0.08, 0.005, 0.05, 2, 1500, 0.7)
      return { A: 0.25, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.06) }], td }
    }
  },
  Horn: {
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h, f) => (0.5 + fm(f, [[500, 200, 1], [900, 250, 0.4]])) / Math.pow(h, 1.4), 1, 3500)
      const td = g.buf(0.15); g.tdNoise(td, 0.05, 0.01, 0.05, 0, 800)
      return { A: 0.15, base: g.loop(b), td }
    }
  },
  Flute: {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.25], [3, 0.12], [4, 0.04], [5, 0.02]])
      g.breathHarm(b, 25, 0.06); g.noise(b, 1000, 8000, 0.012)
      const l = g.spec(); g.parts(l, [[2, 0.4], [3, 0.3]])
      const td = g.buf(0.2); g.tdNoise(td, 0.25, 0.005, 0.04, 2, 2500, 1.2)
      return { A: 0.2, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.05) }], td }
    }
  },
  'Pan Flute': {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.08], [3, 0.05]])
      g.breathHarm(b, 30, 0.1, 3); g.noise(b, 500, 6000, 0.025)
      const td = g.buf(0.25)
      g.tdNoise(td, 0.45, 0.003, 0.05, 2, 1800, 1)
      g.tdSine(td, g.f0 * 2, 0.2, 0.002, 0.04)
      return { A: 0.25, base: g.loop(b), td }
    }
  },
  Ocarina: {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.04], [3, 0.03]])
      g.breathHarm(b, 20, 0.05, 1); g.noise(b, 800, 3000, 0.008)
      const td = g.buf(0.15); g.tdNoise(td, 0.2, 0.004, 0.03, 2, 1200, 1)
      return { A: 0.15, base: g.loop(b), td }
    }
  },
  Reed: {
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h, f) => (h === 1 ? 0.3 : 1 / Math.sqrt(h)) * (0.2 + fm(f, [[1100, 250, 1], [2700, 400, 0.6]])), 0, 8000)
      const td = g.buf(0.1); g.tdNoise(td, 0.05, 0.005, 0.03, 2, 3000)
      return { A: 0.1, base: g.loop(b), td }
    }
  },
  Breath: {
    roots: [261.6],
    L: 16384,
    gen: (g) => {
      const m = g.spec(); g.noise(m, 200, 9000, 0.5, (f) => 0.3 + fm(f, [[900, 500, 1], [2500, 800, 0.6]]))
      return { A: 0, base: g.loop(m) }
    }
  },
  Slap: {
    roots: BASS_ROOTS,
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h, f) => (0.6 + fm(f, [[900, 500, 0.6], [2500, 900, 0.4]])) / Math.pow(h, 1.3), 0, 6000)
      const l = g.spec(); g.harm(l, (h) => 1 / Math.sqrt(h))
      const l2 = g.spec(); g.parts(l2, [[1, 0.6], [2, 0.4]])
      const td = g.buf(0.1)
      g.tdNoise(td, 0.4, 0.0005, 0.012, 2, 2800, 1)
      g.tdNoise(td, 0.3, 0.0005, 0.02, 0, 300)
      return { A: 0.4, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.06) }, { loop: g.loop(l2), env: ex(0.12) }], td }
    }
  },
  'Pick Bass': {
    roots: BASS_ROOTS,
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h) => 1 / Math.pow(h, 1.5), 0, 2500)
      const l = g.spec(); g.harm(l, (h) => 1 / Math.pow(h, 0.8), 0, 8000)
      const td = g.buf(0.05); g.tdNoise(td, 0.3, 0.0003, 0.006, 1, 2000)
      return { A: 0.4, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.12) }], td }
    }
  },
  Fretless: {
    roots: BASS_ROOTS,
    gen: (g) => {
      const b = g.spec()
      for (const [h, a] of [[1, 1], [2, 0.5], [3, 0.28], [4, 0.15], [5, 0.1], [6, 0.06]]) g.p(b, h * g.f0, a * (1 + fm(h * g.f0, [[700, 250, 0.6]])))
      const l = g.spec(); g.harm(l, (h, f) => (h >= 2 ? fm(f, [[1100, 300, 0.6]]) : 0), 0, 4000)
      return { A: 0.5, base: g.loop(b), layers: [{ loop: g.loop(l), env: hump(0.06) }] }
    }
  },
  'Digi Bass': {
    roots: BASS_ROOTS,
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.7], [3, 0.45], [4, 0.3], [5, 0.2], [6, 0.1], [7, 0.05]])
      const l = g.spec(); g.harm(l, (h) => 1 / Math.pow(h, 0.6), 0, 6000)
      const td = g.buf(0.3); g.tdFM(td, g.f0, 1, 3, 0.05, 0.3, 0.1)
      return { A: 0.3, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.08) }], td }
    }
  },
  Harp: {
    gen: (g) => {
      const pos = (h: number) => Math.abs(Math.sin(Math.PI * h * 0.12)) + 0.05
      const b = g.spec(); g.harm(b, (h) => pos(h) / Math.pow(h, 1.6))
      const l = g.spec(); g.harm(l, (h) => pos(h) / h)
      const td = g.buf(0.05); g.tdNoise(td, 0.05, 0.0005, 0.006, 2, 1500)
      return { A: 0.6, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.2) }], td }
    }
  },
  'Nylon Gtr': {
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h, f) => ((Math.abs(Math.sin((Math.PI * h) / 5)) + 0.1) * (1 + fm(f, [[220, 80, 0.8], [500, 200, 0.3]]))) / Math.pow(h, 1.5))
      const l = g.spec(); g.harm(l, (h) => (Math.abs(Math.sin((Math.PI * h) / 5)) + 0.1) / Math.pow(h, 0.9))
      const td = g.buf(0.05); g.tdNoise(td, 0.08, 0.0005, 0.008, 2, 2500)
      return { A: 0.6, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.15) }], td }
    }
  },
  Sitar: {
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h, f) => (0.3 + fm(f, [[2500, 1200, 1]])) / Math.pow(h, 0.8), 1, 8000)
      const l = g.spec(); g.harm(l, (h, f) => (h >= 4 ? fm(f, [[3500, 1500, 1]]) / Math.pow(h, 0.4) : 0))
      const l2 = g.spec(); g.harm(l2, (h, f) => (h >= 3 ? fm(f, [[1800, 600, 0.8]]) / Math.pow(h, 0.5) : 0))
      const td = g.buf(0.05); g.tdNoise(td, 0.1, 0.0005, 0.01, 2, 3000)
      return { A: 1.0, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.6) }, { loop: g.loop(l2), env: hump(0.15) }], td }
    }
  },
  Koto: {
    gen: (g) => {
      const b = g.spec(); g.harm(b, (h) => (Math.abs(Math.sin(Math.PI * h * 0.1)) + 0.1) / Math.pow(h, 1.2))
      const l = g.spec(); g.harm(l, (h, f) => (0.2 + fm(f, [[2500, 1000, 1]])) / Math.pow(h, 0.6))
      const td = g.buf(0.05); g.tdNoise(td, 0.15, 0.0003, 0.01, 2, 3500)
      return { A: 0.6, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.18) }], td }
    }
  },
  Kalimba: {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.02]])
      const l = g.spec(); g.parts(l, [[5.9, 0.4], [11.5, 0.15], [2, 0.1]])
      const td = g.buf(0.05); g.tdNoise(td, 0.2, 0.0003, 0.006, 2, 1000)
      return { A: 0.4, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.1) }], td }
    }
  },
  'Steel Drum': {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.6], [3, 0.25], [4, 0.1]])
      const l = g.spec(); g.parts(l, [[2, 0.3], [2.7, 0.25], [4.2, 0.15], [5.3, 0.1]])
      const td = g.buf(0.05); g.tdNoise(td, 0.15, 0.0005, 0.008, 2, 1500)
      return { A: 0.5, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.15) }], td }
    }
  },
  Accordion: {
    L: 16384,
    gen: (g) => {
      const b = g.spec()
      const amp = (h: number, f: number) => (0.3 + fm(f, [[1500, 600, 1]])) / Math.pow(h, 0.4)
      for (let h = 1; h * g.f0 < 7000; h++) {
        g.p(b, h * g.f0, amp(h, h * g.f0))
        g.p(b, h * g.f0 * 1.006, amp(h, h * g.f0) * 0.8) // musette reed
      }
      return { A: 0.05, base: g.loop(b) }
    }
  },
  Shakuhachi: {
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [2, 0.18], [3, 0.06]])
      g.breathHarm(b, 40, 0.16, 3); g.noise(b, 400, 6000, 0.04, (f) => 0.3 + fm(f, [[1500, 700, 1]]))
      const td = g.buf(0.3); g.tdNoise(td, 0.5, 0.01, 0.08, 2, 1500, 0.8)
      return { A: 0.3, base: g.loop(b), td }
    }
  },
  'Orch Hit': {
    L: 16384,
    gen: (g) => {
      const b = g.spec()
      for (const [r, w] of [[1, 1], [1.5, 0.7], [2, 0.8], [3, 0.5], [4, 0.4], [6, 0.25]]) {
        for (let h = 1; h * r * g.f0 < 9000; h++) g.p(b, h * r * g.f0, (w * (0.4 + fm(h * r * g.f0, [[1200, 600, 1]]))) / Math.pow(h, 0.8), 2)
      }
      const td = g.buf(0.9)
      g.tdNoise(td, 0.3, 0.001, 0.06, 0, 3000)
      g.tdSine(td, g.f0 * 0.5, 0.4, 0.002, 0.15)
      return { A: 0.9, oneShot: true, base: g.loop(b), baseEnv: (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.28), td }
    }
  },
  Timpani: {
    roots: [55, 110, 220],
    gen: (g) => {
      const b = g.spec(); g.parts(b, [[1, 1], [1.5, 0.5], [1.98, 0.35], [2.44, 0.2], [2.9, 0.12]])
      const l = g.spec(); g.parts(l, [[1.5, 0.4], [1.98, 0.3], [2.44, 0.3], [2.9, 0.25], [3.6, 0.2], [4.1, 0.15], [4.7, 0.1]])
      const td = g.buf(0.1); g.tdNoise(td, 0.5, 0.0005, 0.03, 0, 500)
      return { A: 0.6, base: g.loop(b), layers: [{ loop: g.loop(l), env: ex(0.15) }], td }
    }
  },
  Noise: { roots: [261.6], L: 16384, gen: (g) => { const m = g.spec(); g.noise(m, 20, 12000, 1); return { A: 0, base: g.loop(m) } } },
  Metal: {
    gen: (g) => {
      const m = g.spec()
      for (let i = 0; i < 60; i++) {
        const r = 1 + g.rng() * 13
        g.p(m, r * g.f0, (0.3 + g.rng()) / Math.sqrt(r))
      }
      return { A: 0, base: g.loop(m) }
    }
  },
  'Ice Wave': {
    L: 16384,
    gen: (g) => {
      const m = g.spec()
      g.p(m, g.f0, 0.5)
      for (let i = 0; i < 40; i++) g.p(m, g.f0 * (2 + g.rng() * 10), 0.1 + g.rng() * 0.3, 2)
      return { A: 0, base: g.loop(m) }
    }
  }
}

// ─── lazy cache / public API ──────────────────────────────────────────────────

interface Slot {
  roots: number[] // MIDI
  Cs: number[]
  L: number
  multis: (Multi | null)[]
}
const slots: (Slot | null)[] = WAVE_NAMES.map(() => null)

function slot(wi: number): Slot {
  let s = slots[wi]
  if (s) return s
  const rec = R[WAVE_NAMES[wi]]
  if (!rec) throw new Error(`Polygon ROM: no recipe for ${WAVE_NAMES[wi]}`)
  const L = rec.L ?? 8192
  const Cs = (rec.roots ?? DEF_ROOTS).map((f) => Math.max(1, Math.round((f * L) / ROM_SR)))
  s = { L, Cs, roots: Cs.map((C) => 69 + 12 * Math.log2((C * ROM_SR) / L / 440)), multis: Cs.map(() => null) }
  slots[wi] = s
  return s
}

function build(wi: number, mi: number): Multi {
  const s = slot(wi)
  let m = s.multis[mi]
  if (!m) {
    const g = new G(s.L, s.Cs[mi], 1013 * (wi + 1) + 7 * mi)
    m = assemble(g, R[WAVE_NAMES[wi]].gen(g))
    s.multis[mi] = m
  }
  return m
}

export function hasRecipe(name: string): boolean {
  return !!R[name]
}

/** Index of the multisample to use for `key` (nearest root). */
export function multiIndexFor(wi: number, key: number): number {
  const s = slot(wi)
  let best = 0
  for (let i = 1; i < s.roots.length; i++) if (Math.abs(s.roots[i] - key) < Math.abs(s.roots[best] - key)) best = i
  return best
}

/** Get (generating if needed) the multisample of wave `wi` for MIDI key `key`. */
export function getMulti(wi: number, key: number): Multi {
  wi = Math.max(0, Math.min(WAVE_NAMES.length - 1, wi | 0))
  return build(wi, multiIndexFor(wi, key))
}

export function multiCount(wi: number): number {
  return slot(wi).roots.length
}

export function getMultiByIndex(wi: number, mi: number): Multi {
  return build(wi, mi)
}

/** Generate at most one missing multisample of wave `wi`. Returns true if work was done. */
export function prepareStep(wi: number): boolean {
  const s = slot(wi)
  for (let i = 0; i < s.multis.length; i++) {
    if (!s.multis[i]) {
      build(wi, i)
      return true
    }
  }
  return false
}
