// Chip oscillator cores (NES 2A03 / Game Boy DMG flavoured). Allocation-free, AudioWorklet-safe.
import { polyBlep } from '../sdk/dsp'

/** Waveform ids (index into WAVE_NAMES, also the `osc.wave` param value). */
export const W = { P12: 0, P25: 1, P50: 2, TRI: 3, TRIS: 4, NL: 5, NS: 6, N4: 7, GB: 8 } as const
export const WAVE_NAMES = ['Pulse 12.5%', 'Pulse 25%', 'Pulse 50%', 'Triangle FC', 'Triangle', 'Noise Long', 'Noise Short', 'Noise 4-bit', 'GB Wave']
export const WAVE_SHORT = ['12.5%', '25%', '50%', 'FC TRI', 'TRI', 'NOISE', 'METAL', '4BIT', 'GB WAV']
/** NES duty cycles (duty sequence values 0..3). */
export const DUTIES = [0.125, 0.25, 0.5, 0.75]
export const isNoise = (w: number): boolean => w === W.NL || w === W.NS || w === W.N4
export const isPulse = (w: number): boolean => w <= W.P50

/** NES triangle: 32-step 4-bit sequence 15..0,0..15 normalised to -1..1. */
export const FC_TRI = new Float32Array(32)
for (let i = 0; i < 32; i++) FC_TRI[i] = (i < 16 ? 15 - i : i - 16) / 7.5 - 1

/** 4-bit table (0..15) -> zero-mean float table. */
export function waveTable(values: number[], out = new Float32Array(32)): Float32Array {
  let mean = 0
  for (let i = 0; i < 32; i++) mean += values[i] ?? 8
  mean /= 32
  let peak = 1e-6
  for (let i = 0; i < 32; i++) peak = Math.max(peak, Math.abs((values[i] ?? 8) - mean))
  // keep the 4-bit loudness (a flat-ish wave stays quiet) but never exceed ±1
  const scale = 1 / Math.max(7.5, peak)
  for (let i = 0; i < 32; i++) out[i] = ((values[i] ?? 8) - mean) * scale
  return out
}

// NES NTSC noise periods (CPU cycles). LFSR clock = 1.789773 MHz / period.
const NES_CPU = 1789773
const NES_NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068]
const NES_NOISE_LOG = NES_NOISE_PERIODS.map((p) => Math.log(NES_CPU / p))

/** LFSR shift rate (Hz) for a noise "pitch". Authentic snaps to the 16 NES noise periods. */
export function noiseRate(pitch: number, authentic: boolean): number {
  const r = 440 * Math.pow(2, (pitch - 69) / 12) * 64
  if (!authentic) return r
  const lr = Math.log(r)
  let best = 0
  let bd = 1e9
  for (let i = 0; i < 16; i++) {
    const d = Math.abs(NES_NOISE_LOG[i] - lr)
    if (d < bd) {
      bd = d
      best = i
    }
  }
  return NES_CPU / NES_NOISE_PERIODS[best]
}

export class ChipOsc {
  phase = 0
  lfsr = 1
  nAcc = 0
  nVal = 1
  rnd = 0x9e3779b9
  reset(phase = 0, seed = 1): void {
    this.phase = phase
    this.lfsr = seed & 0x7fff || 1
    this.nAcc = 0
    this.nVal = 1
  }
  private shift(wave: number): number {
    if (wave === W.N4) {
      let x = this.rnd | 0
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      this.rnd = x
      return ((x >>> 0) % 16) / 7.5 - 1
    }
    const l = this.lfsr
    const fb = (l & 1) ^ ((l >> (wave === W.NS ? 6 : 1)) & 1)
    this.lfsr = (l >> 1) | (fb << 14)
    return this.lfsr & 1 ? -1 : 1
  }
  /**
   * One sample. `dt` = cycles per sample (tonal) or LFSR shifts per sample (noise).
   * `bl` = band-limit (polyBLEP / box-filtered noise) instead of the naive, aliasing "authentic" shapes.
   */
  next(wave: number, dt: number, duty: number, bl: boolean, table: Float32Array): number {
    let out: number
    if (wave >= W.NL && wave <= W.N4) {
      this.nAcc += dt
      let n = this.nAcc | 0
      if (n > 0) {
        this.nAcc -= n
        if (n > 48) n = 48
        if (bl && n > 1) {
          let sum = this.nVal
          for (let k = 0; k < n; k++) sum += this.nVal = this.shift(wave)
          return sum / (n + 1)
        }
        for (let k = 0; k < n; k++) this.nVal = this.shift(wave)
      }
      return this.nVal
    }
    const t = this.phase
    if (wave <= W.P50 || wave > W.GB) {
      out = t < duty ? 1 : -1
      if (bl && dt < 0.25) out += polyBlep(t, dt) - polyBlep(t + 1 - duty >= 1 ? t - duty : t + 1 - duty, dt)
      out += 1 - 2 * duty // remove DC (hardware is unipolar + output capacitor)
    } else if (wave === W.TRIS) {
      out = 4 * Math.abs(t - 0.5) - 1
    } else {
      const tab = wave === W.GB ? table : FC_TRI
      const x = t * 32
      const k = x | 0
      const u = x - k
      out = tab[k & 31]
      if (bl) {
        const ds = dt * 32
        if (ds < 0.5) {
          if (u < ds) {
            const j = tab[k & 31] - tab[(k + 31) & 31]
            const s = u / ds
            out += j * 0.5 * (s + s - s * s - 1)
          } else if (u > 1 - ds) {
            const j = tab[(k + 1) & 31] - tab[k & 31]
            const s = (u - 1) / ds
            out += j * 0.5 * (s * s + s + s + 1)
          }
        }
      }
    }
    this.phase = t + dt
    if (this.phase >= 1) this.phase -= 1
    return out
  }
}
