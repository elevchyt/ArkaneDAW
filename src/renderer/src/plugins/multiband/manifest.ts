import type { ParamDef, PluginManifest } from '../sdk/types'

export const BANDS = ['low', 'mid', 'high'] as const
const band = (b: string, name: string, thr: number, ratio: number): ParamDef[] => [
  { id: `${b}.thr`, name: `${name} Threshold`, min: -60, max: 0, default: thr, unit: 'dB' },
  { id: `${b}.ratio`, name: `${name} Ratio`, min: 1, max: 20, default: ratio, curve: 'exp', unit: ':1' },
  { id: `${b}.gain`, name: `${name} Gain`, min: -12, max: 12, default: 0, unit: 'dB' }
]

/** Multiband Compressor: 3-band compressor with Linkwitz-Riley crossovers. */
export const manifest: PluginManifest = {
  id: 'multiband',
  name: 'Multiband Compressor',
  kind: 'effect',
  category: 'Dynamics',
  description: 'Three-band compressor (LR4 crossovers) for controlling lows, mids and highs independently.',
  color: '#e86fa0',
  params: [
    { id: 'xlow', name: 'Low / Mid', min: 40, max: 1000, default: 200, unit: 'Hz', curve: 'exp' },
    { id: 'xhigh', name: 'Mid / High', min: 1000, max: 12000, default: 2500, unit: 'Hz', curve: 'exp' },
    ...band('low', 'Low', -20, 3),
    ...band('mid', 'Mid', -20, 2.5),
    ...band('high', 'High', -22, 3),
    { id: 'attack', name: 'Attack', min: 0.1, max: 100, default: 10, unit: 'ms', curve: 'exp' },
    { id: 'release', name: 'Release', min: 10, max: 1000, default: 150, unit: 'ms', curve: 'exp' },
    { id: 'output', name: 'Output', min: -12, max: 12, default: 0, unit: 'dB' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Gentle Master', category: 'Master', params: { 'low.thr': -14, 'low.ratio': 2, 'mid.thr': -14, 'mid.ratio': 1.6, 'high.thr': -16, 'high.ratio': 2, attack: 20, release: 200 } },
    { name: 'Tame the Lows', category: 'Mixing', params: { xlow: 150, 'low.thr': -28, 'low.ratio': 5, 'mid.ratio': 1, 'high.ratio': 1, attack: 15, release: 120 } },
    { name: 'De-Harsh', category: 'Mixing', params: { xhigh: 3500, 'high.thr': -30, 'high.ratio': 4, 'low.ratio': 1, 'mid.ratio': 1, attack: 2, release: 80 } },
    { name: 'Upfront Mids', category: 'Vocal', params: { 'mid.thr': -26, 'mid.ratio': 3, 'mid.gain': 3, 'low.ratio': 1.5, 'high.ratio': 1.5 } },
    { name: 'Squashed Everything', category: 'Creative', params: { 'low.thr': -40, 'low.ratio': 10, 'low.gain': 8, 'mid.thr': -40, 'mid.ratio': 10, 'mid.gain': 8, 'high.thr': -40, 'high.ratio': 10, 'high.gain': 9, attack: 1, release: 60, mix: 0.6, output: -3 } },
    { name: 'Drum Bus Control', category: 'Bus', params: { xlow: 120, xhigh: 4000, 'low.thr': -22, 'low.ratio': 4, 'mid.thr': -18, 'mid.ratio': 3, 'high.thr': -24, 'high.ratio': 2, attack: 8, release: 90 } },
    { name: 'Bass Tightener', category: 'Bass', params: { xlow: 100, xhigh: 1500, 'low.thr': -24, 'low.ratio': 4, 'mid.thr': -20, 'mid.ratio': 3, 'high.ratio': 1, attack: 10, release: 120 } }
  ]
}
