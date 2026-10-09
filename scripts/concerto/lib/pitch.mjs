// Pitch detection for build-time sanity checks (YIN, de Cheveigné & Kawahara 2002). Used to verify / correct
// sample root keys (octave naming conventions differ between libraries) and to measure fine tuning.
import { SR } from './audio.mjs'

/** f0 of one frame (Hz), or 0 when unvoiced. */
function yinFrame(x, start, W, tauMin, tauMax, threshold = 0.15) {
  const d = new Float64Array(tauMax + 2)
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let s = 0
    for (let i = start; i < start + W; i++) {
      const v = x[i] - x[i + tau]
      s += v * v
    }
    d[tau] = s
  }
  // cumulative mean normalised difference
  const cm = new Float64Array(tauMax + 2)
  cm[0] = 1
  let run = 0
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    run += d[tau]
    cm[tau] = run > 0 ? (d[tau] * tau) / run : 1
  }
  let best = -1
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cm[tau] < threshold) {
      while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++
      best = tau
      break
    }
  }
  if (best < 0) {
    // no dip under the threshold: global minimum if it is reasonably deep
    let m = Infinity
    for (let tau = tauMin; tau <= tauMax; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau }
    if (m > 0.35) return { f0: 0, conf: 0 }
  }
  const a = cm[best - 1] ?? cm[best], b = cm[best], c = cm[best + 1] ?? cm[best]
  const den = a - 2 * b + c
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0
  return { f0: SR / (best + Math.max(-1, Math.min(1, shift))), conf: 1 - b }
}

/**
 * Median f0 over several frames of the sample (from `fromSec`), searching 35 Hz..2.2 kHz (or around `hintHz`).
 * Returns { hz, midi, spread (cents MAD), voiced } — hz = 0 when the pitch is unclear.
 */
export function detectPitch(x, { fromSec = 0.25, frames = 9, hintHz = 0 } = {}) {
  const fmin = hintHz ? hintHz / 2.2 : 35
  const fmax = hintHz ? hintHz * 2.2 : 2200
  const tauMax = Math.min(Math.ceil(SR / fmin), 4000)
  const tauMin = Math.max(2, Math.floor(SR / fmax))
  const W = Math.max(1024, Math.min(4096, tauMax * 2))
  const first = Math.round(fromSec * SR)
  const last = x.length - W - tauMax - 2
  if (last <= first) return { hz: 0, midi: 0, spread: Infinity, voiced: 0 }
  const step = Math.max(1, Math.floor((last - first) / frames))
  const res = []
  for (let k = 0; k < frames; k++) {
    const s = first + k * step
    if (s > last) break
    const r = yinFrame(x, s, W, tauMin, tauMax)
    if (r.f0 > 0) res.push(r.f0)
  }
  if (res.length < Math.max(2, frames / 3)) return { hz: 0, midi: 0, spread: Infinity, voiced: res.length / frames }
  const midis = res.map((f) => 69 + 12 * Math.log2(f / 440)).sort((a, b) => a - b)
  const med = midis[midis.length >> 1]
  const dev = midis.map((m) => Math.abs(m - med) * 100).sort((a, b) => a - b)
  return { hz: 440 * Math.pow(2, (med - 69) / 12), midi: med, spread: dev[dev.length >> 1], voiced: res.length / frames }
}

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
/** "A#3" / "Db4" / "C-1" → MIDI (scientific: C4 = 60). */
export function noteToMidi(name) {
  const m = String(name).match(/^([A-Ga-g])([#b]?)(-?\d+)$/)
  if (!m) return null
  const pc = PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
  return 12 * (Number(m[3]) + 1) + pc
}
