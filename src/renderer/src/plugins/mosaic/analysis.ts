// Offline analysis helpers for Mosaic tests (node only; not imported by DSP or UI).

/** In-place radix-2 FFT. re/im length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k + len / 2] = re[i + k] - ar
        im[i + k + len / 2] = im[i + k] - ai
        re[i + k] += ar
        im[i + k] += ai
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** Hann-windowed magnitude spectrum of x[start..start+size). */
export function spectrum(x: Float32Array, start: number, size: number): Float64Array {
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
    re[i] = (x[start + i] ?? 0) * w
  }
  fft(re, im)
  const mag = new Float64Array(size / 2)
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i])
  return mag
}

export function centroid(x: Float32Array, start: number, size: number, sr: number): number {
  const mag = spectrum(x, start, size)
  let num = 0
  let den = 0
  for (let i = 1; i < mag.length; i++) {
    num += mag[i] * ((i * sr) / size)
    den += mag[i]
  }
  return den > 0 ? num / den : 0
}

/** RMS envelope in dB with given window (seconds). */
export function envelopeDb(x: Float32Array, sr: number, win = 0.05): number[] {
  const n = Math.floor(win * sr)
  const out: number[] = []
  for (let i = 0; i + n <= x.length; i += n) {
    let s = 0
    for (let k = 0; k < n; k++) s += x[i + k] * x[i + k]
    out.push(10 * Math.log10(s / n + 1e-20))
  }
  return out
}

/** Peak frequencies (parabolic interpolation) near expected harmonics. */
export function findPeak(mag: Float64Array, sr: number, size: number, f: number, tol = 0.03): { f: number; a: number } {
  const lo = Math.max(1, Math.floor(((f * (1 - tol)) / sr) * size))
  const hi = Math.min(mag.length - 2, Math.ceil(((f * (1 + tol)) / sr) * size))
  let bi = lo
  for (let i = lo; i <= hi; i++) if (mag[i] > mag[bi]) bi = i
  const a = mag[bi - 1]
  const b = mag[bi]
  const c = mag[bi + 1]
  const d = (0.5 * (a - c)) / (a - 2 * b + c || 1)
  return { f: ((bi + d) * sr) / size, a: b }
}
