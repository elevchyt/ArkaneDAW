// Procedural wavetables for Atmos. Pure TS (shared by the worklet and the editor's display).
// Each table has FRAMES single-cycle frames defined as harmonic spectra; the DSP builds band-limited
// mip levels (one per octave) with an inverse FFT, lazily, once per table, shared by every instance.
import { Rng, TAU } from './util'

export const TABLE_NAMES = ['Analog Morph', 'Harmonic Sweep', 'Vocal', 'Glass', 'PWM', 'Spectral Dust', 'Dark Hollow', 'Bowed', 'Wavefold', 'Warm Sub']
export const FRAMES = 8
export const TSIZE = 1024
export const STRIDE = TSIZE + 1 // guard sample for interpolation
export const LEVELS = 8 // max harmonics per level: 512 >> level
export const MAXH = 512

// ─── FFT (radix-2, in place) ─────────────────────────────────────────────────
export function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = ((inverse ? 2 : -2) * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const br = re[b] * cr - im[b] * ci
        const bi = re[b] * ci + im[b] * cr
        re[b] = re[a] - br
        im[b] = im[a] - bi
        re[a] += br
        im[a] += bi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = ncr
      }
    }
  }
}

/** Harmonic spectrum: amp[h], phase[h] for h = 1..MAXH (signal = Σ amp·sin(2πht + phase)). */
export interface Spectrum {
  amp: Float64Array
  ph: Float64Array
}

function newSpec(): Spectrum {
  return { amp: new Float64Array(MAXH + 1), ph: new Float64Array(MAXH + 1) }
}

/** Spectrum of a time-domain single cycle g(t), t in [0,1). */
function specFromTime(g: (t: number) => number): Spectrum {
  const M = 4096
  const re = new Float64Array(M)
  const im = new Float64Array(M)
  for (let i = 0; i < M; i++) re[i] = g(i / M)
  fft(re, im, false)
  const s = newSpec()
  for (let h = 1; h <= MAXH; h++) {
    s.amp[h] = (2 * Math.hypot(re[h], im[h])) / M
    s.ph[h] = Math.atan2(im[h], re[h]) + Math.PI / 2
  }
  return s
}

const VOWELS: [number, number, number][] = [
  [300, 870, 2240], // U
  [570, 840, 2410], // O
  [730, 1090, 2440], // A
  [660, 1700, 2400], // AE
  [530, 1840, 2480], // E
  [270, 2290, 3010], // I
  [440, 1020, 2240], // ER
  [250, 1200, 2600] // M-ish hum
]

function formantGain(f: number, fm: [number, number, number], bw = 90): number {
  let g = 0.02
  const w = [1, 0.55, 0.3]
  for (let i = 0; i < 3; i++) {
    const b = bw * (1 + i * 0.6)
    const d = (f - fm[i]) / b
    g += w[i] / (1 + d * d)
  }
  return g
}

/** Spectrum of frame k (0..FRAMES-1) of table `t`. */
export function frameSpectrum(t: number, k: number): Spectrum {
  const x = k / (FRAMES - 1)
  const rng = new Rng(1234 + t * 977 + k * 31)
  const s = newSpec()
  switch (t) {
    case 0: {
      // sine → tri → saw → square → narrow pulse
      const shapes = [
        (u: number) => Math.sin(TAU * u),
        (u: number) => 1 - 4 * Math.abs(((u + 0.25) % 1) - 0.5),
        (u: number) => 0.5 * (1 - 4 * Math.abs(((u + 0.25) % 1) - 0.5)) + 0.5 * (1 - 2 * u),
        (u: number) => 1 - 2 * u,
        (u: number) => 0.5 * (1 - 2 * u) + 0.5 * (u < 0.5 ? 1 : -1),
        (u: number) => (u < 0.5 ? 1 : -1),
        (u: number) => (u < 0.25 ? 1 : -0.33),
        (u: number) => (u < 0.1 ? 1 : -0.11)
      ]
      return specFromTime(shapes[k])
    }
    case 1: {
      // a spectral bump sweeping up the harmonic series
      const c = Math.pow(2, x * 5) // 1..32
      const w = 0.5 + x * 1.2
      for (let h = 1; h <= MAXH; h++) {
        const d = Math.log2(h / c) / w
        s.amp[h] = Math.exp(-d * d) / Math.sqrt(h) + (h === 1 ? 0.6 : 0)
        s.ph[h] = 0
      }
      return s
    }
    case 2: {
      const fm = VOWELS[k]
      const f0 = 130
      for (let h = 1; h <= MAXH; h++) {
        s.amp[h] = (formantGain(h * f0, fm) / Math.pow(h, 0.7)) * (h * f0 > 5000 ? Math.exp(-(h * f0 - 5000) / 1500) : 1)
        s.ph[h] = rng.next() * 0.3
      }
      return s
    }
    case 3: {
      // sparse glassy partials that brighten across the table
      const parts = [1, 2, 4, 7, 11, 16, 22, 29, 37, 46, 56, 67]
      for (let i = 0; i < parts.length; i++) {
        const h = parts[i]
        const tilt = Math.exp(-i * (1.1 - x * 0.85))
        s.amp[h] = (i === 0 ? 1 : 0.8) * tilt
        s.ph[h] = rng.next() * Math.PI
      }
      return s
    }
    case 4: {
      const pw = 0.5 - x * 0.47
      return specFromTime((u) => (u < pw ? 1 - pw : -pw) * 1.6)
    }
    case 5: {
      // seeded random sparse spectra, denser and brighter per frame
      const n = 6 + Math.floor(x * 40)
      s.amp[1] = 0.8
      for (let i = 0; i < n; i++) {
        const h = 2 + Math.floor(Math.pow(rng.uni(), 1.6 - x) * (24 + x * 100))
        s.amp[h] += (0.3 + 0.7 * rng.uni()) / Math.pow(h, 0.55)
        s.ph[h] = rng.next() * Math.PI
      }
      return s
    }
    case 6: {
      // odd harmonics behind a steep low-pass that opens across the table
      const cut = 2 + x * x * 40
      for (let h = 1; h <= MAXH; h++) {
        const odd = h & 1 ? 1 : 0.12 * x
        s.amp[h] = (odd / h) / (1 + Math.pow(h / cut, 4))
        s.ph[h] = 0
      }
      return s
    }
    case 7: {
      // saw through moving body resonances
      const body = [280 * (1 + x * 0.6), 1000 * (1 + x * 0.4), 2600 * (1 - x * 0.2)]
      const f0 = 110
      for (let h = 1; h <= MAXH; h++) {
        const f = h * f0
        let g = 0.25
        for (let i = 0; i < 3; i++) {
          const d = (f - body[i]) / (body[i] * 0.25)
          g += 1 / (1 + d * d)
        }
        s.amp[h] = (g / h) * (f > 6000 ? Math.exp(-(f - 6000) / 2500) : 1)
        s.ph[h] = 0
      }
      return s
    }
    case 8: {
      const gain = 1 + x * 6
      return specFromTime((u) => {
        const v = Math.sin(TAU * u) * gain
        return Math.sin(v * 1.2) // sine fold
      })
    }
    default: {
      // warm sine, progressively saturated
      const drive = 1 + x * x * 7
      const norm = Math.tanh(drive)
      return specFromTime((u) => Math.tanh(Math.sin(TAU * u) * drive + 0.15 * x * Math.sin(2 * TAU * u)) / norm)
    }
  }
}

// ─── DSP-side mip-mapped tables (lazy, cached per table) ───────────────────────
const cache: (Float32Array | undefined)[] = []

/** Layout: [level][frame][STRIDE]. */
export function getTable(t: number): Float32Array {
  const c = cache[t]
  if (c) return c
  const data = new Float32Array(LEVELS * FRAMES * STRIDE)
  const re = new Float64Array(TSIZE)
  const im = new Float64Array(TSIZE)
  for (let k = 0; k < FRAMES; k++) {
    const sp = frameSpectrum(t, k)
    let scale = 1
    for (let l = 0; l < LEVELS; l++) {
      const H = Math.min(MAXH >> l, TSIZE / 2 - 1)
      re.fill(0)
      im.fill(0)
      for (let h = 1; h <= H; h++) {
        re[h] = sp.amp[h] * Math.cos(sp.ph[h])
        im[h] = sp.amp[h] * Math.sin(sp.ph[h])
      }
      fft(re, im, true)
      if (l === 0) {
        let peak = 0
        let sum = 0
        for (let i = 0; i < TSIZE; i++) {
          const v = im[i]
          if (Math.abs(v) > peak) peak = Math.abs(v)
          sum += v * v
        }
        const rms = Math.sqrt(sum / TSIZE)
        scale = 1 / Math.max(1e-9, peak, rms * 2)
      }
      const base = (l * FRAMES + k) * STRIDE
      for (let i = 0; i < TSIZE; i++) data[base + i] = im[i] * scale
      data[base + TSIZE] = data[base]
    }
  }
  cache[t] = data
  return data
}

/** Low-resolution frame shapes for drawing (UI thread). */
export function frameShapes(t: number, points = 96, maxH = 40): Float32Array[] {
  const out: Float32Array[] = []
  for (let k = 0; k < FRAMES; k++) {
    const sp = frameSpectrum(t, k)
    const a = new Float32Array(points)
    let peak = 1e-9
    for (let i = 0; i < points; i++) {
      const u = i / (points - 1)
      let v = 0
      for (let h = 1; h <= maxH; h++) if (sp.amp[h] > 1e-5) v += sp.amp[h] * Math.sin(TAU * h * u + sp.ph[h])
      a[i] = v
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    for (let i = 0; i < points; i++) a[i] /= peak
    out.push(a)
  }
  return out
}
