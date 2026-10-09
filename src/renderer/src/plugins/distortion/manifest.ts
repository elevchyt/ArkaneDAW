import type { PluginManifest } from '../sdk/types'

export const MODES = ['Soft', 'Hard', 'Tube', 'Fuzz', 'Fold', 'Rectify']

/** Waveshaper per mode (input already multiplied by drive). Shared by DSP and the curve display. */
export function shape(mode: number, x: number): number {
  switch (mode) {
    case 1: // hard clip
      return x > 1 ? 1 : x < -1 ? -1 : x
    case 2: // tube: asymmetric, biased tanh (even harmonics)
      return (Math.tanh(x + 0.35) - 0.3364) / (x >= -0.35 ? 1 : 1.25)
    case 3: { // fuzz: hard-knee asymmetric exponential clipper
      const y = x >= 0 ? 1 - Math.exp(-2.5 * x) : -0.8 * (1 - Math.exp(1.6 * x))
      return y * 1.08
    }
    case 4: // sine wavefolder
      return Math.sin(x * 1.25)
    case 5: // full-wave rectifier (octave up); folds at extreme drive instead of collapsing to DC
      return Math.abs(Math.sin(x)) * 1.4 - 0.45
    default: // soft
      return Math.tanh(x)
  }
}

/** Distortion: six oversampled waveshaper flavours with tone and mix. */
export const manifest: PluginManifest = {
  id: 'distortion',
  name: 'Distortion',
  kind: 'effect',
  category: 'Distortion',
  description: 'Warm to wild: soft/hard clip, tube, fuzz, wavefold and rectify, 4x oversampled.',
  color: '#ff7a3d',
  params: [
    { id: 'mode', name: 'Mode', min: 0, max: MODES.length - 1, default: 0, options: MODES },
    { id: 'drive', name: 'Drive', min: 0, max: 48, default: 12, unit: 'dB' },
    { id: 'tone', name: 'Tone', min: 500, max: 20000, default: 9000, unit: 'Hz', curve: 'exp' },
    { id: 'output', name: 'Output', min: -24, max: 12, default: 0, unit: 'dB' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Gentle Warmth', category: 'Subtle', params: { mode: 2, drive: 6, tone: 12000, mix: 1 } },
    { name: 'Tape Saturation', category: 'Subtle', params: { mode: 0, drive: 9, tone: 9000, mix: 0.8 } },
    { name: 'Tube Crunch', category: 'Drive', params: { mode: 2, drive: 20, tone: 6000 } },
    { name: 'Hard Clipper', category: 'Drive', params: { mode: 1, drive: 10, tone: 20000 } },
    { name: 'Fuzz Box', category: 'Heavy', params: { mode: 3, drive: 34, tone: 4000, output: -3 } },
    { name: 'Bass Grit', category: 'Drive', params: { mode: 0, drive: 18, tone: 3500, mix: 0.6 } },
    { name: 'Wavefolder', category: 'Creative', params: { mode: 4, drive: 16, tone: 9000 } },
    { name: 'Octave Rectifier', category: 'Creative', params: { mode: 5, drive: 8, tone: 7000, mix: 0.7 } },
    { name: 'Parallel Drum Smash', category: 'Drums', params: { mode: 1, drive: 30, tone: 8000, mix: 0.35 } },
    { name: 'Broken Speaker', category: 'Heavy', params: { mode: 3, drive: 44, tone: 1500, output: -4 } }
  ]
}

/** Automatic level compensation (dB) for a drive setting. */
export const driveComp = (driveDb: number): number => -0.32 * driveDb
