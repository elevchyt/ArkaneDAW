import type { PluginManifest } from '../sdk/types'

export const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** Scale name + semitone intervals above the key. */
export const SCALES: { name: string; short: string; steps: number[] }[] = [
  { name: 'Chromatic', short: 'Chromatic', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { name: 'Major', short: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  { name: 'Minor', short: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Harmonic Minor', short: 'Harm. Min', steps: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'Major Pentatonic', short: 'Maj Pent', steps: [0, 2, 4, 7, 9] },
  { name: 'Minor Pentatonic', short: 'Min Pent', steps: [0, 3, 5, 7, 10] },
  { name: 'Blues', short: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  { name: 'Dorian', short: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Mixolydian', short: 'Mixolyd.', steps: [0, 2, 4, 5, 7, 9, 10] }
]

/** 12-entry allow-list (index = pitch class, C = 0) for a key + scale. Writes into `out` when given. */
export function scaleMask(key: number, scale: number, out: Uint8Array = new Uint8Array(12)): Uint8Array {
  out.fill(0)
  const s = SCALES[Math.max(0, Math.min(SCALES.length - 1, Math.round(scale)))]
  const k = ((Math.round(key) % 12) + 12) % 12
  for (const st of s.steps) out[(k + st) % 12] = 1
  return out
}

/** Nearest allowed MIDI note to a (fractional) MIDI pitch. */
export function nearestNote(midi: number, mask: Uint8Array): number {
  const base = Math.round(midi)
  let best = base
  let bestD = 1e9
  for (let k = -7; k <= 7; k++) {
    const n = base + k
    if (!mask[((n % 12) + 12) % 12]) continue
    const d = Math.abs(midi - n)
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return best
}

export const freqToMidi = (f: number): number => 69 + 12 * Math.log2(f / 440)
export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)
export const noteName = (m: number): string => `${KEYS[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`

/** VocalTune: dead-simple pitch correction (key + scale + how hard it snaps). */
export const manifest: PluginManifest = {
  id: 'vocaltune',
  name: 'VocalTune',
  kind: 'effect',
  category: 'Vocal',
  description: 'Simple auto-tune: pick a key and scale, set how hard it snaps. From gentle natural fixes to the robotic hard-tune effect.',
  color: '#ff3d7f',
  params: [
    { id: 'key', name: 'Key', min: 0, max: 11, default: 0, options: KEYS },
    { id: 'scale', name: 'Scale', min: 0, max: SCALES.length - 1, default: 0, options: SCALES.map((s) => s.name) },
    { id: 'speed', name: 'Retune Speed', min: 0, max: 400, default: 25, unit: 'ms', curve: 'exp' },
    { id: 'humanize', name: 'Humanize', min: 0, max: 1, default: 0.2, unit: '%' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Natural Pop', category: 'Natural', params: { scale: 1, speed: 70, humanize: 0.5 } },
    { name: 'Hard Tune (Robot)', category: 'Effect', params: { scale: 0, speed: 0, humanize: 0 } },
    { name: 'Gentle Fix', category: 'Natural', params: { scale: 0, speed: 160, humanize: 0.75, mix: 1 } },
    { name: 'Chromatic Snap', category: 'Effect', params: { scale: 0, speed: 8, humanize: 0.1 } },
    { name: 'Minor Key Trap', category: 'Effect', params: { key: 9, scale: 2, speed: 2, humanize: 0 } }
  ]
}
