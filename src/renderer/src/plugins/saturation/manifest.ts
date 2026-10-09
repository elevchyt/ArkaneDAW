import type { PluginManifest } from '../sdk/types'

export const MODES = ['Tape', 'Tube', 'Transistor', 'Console']

/**
 * Static part of each saturation curve (the DSP adds tape memory / filtering around it).
 * `x` is already driven; `asym` 0..1 adds even-harmonic asymmetry.
 */
export function satCurve(mode: number, x: number, asym: number): number {
  switch (mode) {
    case 1: { // tube: soft, asymmetric (even harmonics)
      const t = Math.tanh(x)
      return t + (0.15 + 0.45 * asym) * t * t * 0.6
    }
    case 2: { // transistor: firmer knee, mostly odd harmonics
      const a = Math.abs(x)
      const y = x / Math.pow(1 + a * a * a * a, 0.25)
      return y + 0.25 * asym * y * y
    }
    case 3: { // console: very gentle cubic soft clip
      const c = x > 1.5 ? 1.5 : x < -1.5 ? -1.5 : x
      const y = c - (4 / 27) * c * c * c
      return y + 0.2 * asym * y * y
    }
    default: { // tape: smooth symmetric knee (asymmetry from bias)
      const y = Math.tanh(x * 0.9 + 0.15 * asym) - Math.tanh(0.15 * asym)
      return y * 1.05
    }
  }
}

/** Saturation: musical drive & warmth for single sounds and buses. */
export const manifest: PluginManifest = {
  id: 'saturation',
  name: 'Saturation',
  kind: 'effect',
  category: 'Distortion',
  description: 'Musical warmth: tape, tube, transistor and console saturation with auto-gain so louder is not mistaken for better.',
  color: '#f4a259',
  params: [
    { id: 'mode', name: 'Mode', min: 0, max: MODES.length - 1, default: 0, options: MODES },
    { id: 'drive', name: 'Drive', min: 0, max: 30, default: 8, unit: 'dB' },
    { id: 'tone', name: 'Tone', min: -1, max: 1, default: 0, unit: '%' },
    { id: 'bias', name: 'Character', min: 0, max: 1, default: 0.3, unit: '%' },
    { id: 'output', name: 'Output', min: -18, max: 18, default: 0, unit: 'dB' },
    { id: 'auto', name: 'Auto Gain', min: 0, max: 1, default: 1, step: 1 },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Gentle Warmth', category: 'Subtle', params: { mode: 3, drive: 6, tone: -0.1, bias: 0.2 } },
    { name: 'Tape Glue', category: 'Bus', params: { mode: 0, drive: 10, tone: -0.15, bias: 0.25, mix: 1 } },
    { name: 'Tube Push', category: 'Drive', params: { mode: 1, drive: 14, tone: 0.05, bias: 0.6 } },
    { name: 'Drum Bus Crunch', category: 'Bus', params: { mode: 2, drive: 18, tone: 0.15, bias: 0.3, mix: 0.6 } },
    { name: 'Bass Grit', category: 'Drive', params: { mode: 2, drive: 16, tone: -0.2, bias: 0.5, mix: 0.75 } },
    { name: 'Vocal Air', category: 'Subtle', params: { mode: 1, drive: 7, tone: 0.45, bias: 0.35, mix: 0.7 } },
    { name: 'Hot Console', category: 'Bus', params: { mode: 3, drive: 20, tone: 0.1, bias: 0.4 } }
  ]
}
