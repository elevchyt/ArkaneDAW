import type { PluginManifest } from '../sdk/types'
import { DIVISION_NAMES, TEMPO_PARAM, divIndex } from '../fx-common/divisions'

export const TYPES = ['Low Pass', 'High Pass', 'Band Pass', 'Notch']
export const SLOPES = ['12 dB', '24 dB']
export const SHAPES = ['Sine', 'Triangle', 'Saw', 'Square', 'S&H']

/** Resonance 0..1 -> SVF Q. */
export const resToQ = (res: number): number => 0.5 * Math.pow(36, Math.max(0, Math.min(1, res)))

/** Filter: resonant multimode filter with drive and an LFO (free or tempo-synced). */
export const manifest: PluginManifest = {
  id: 'filter',
  name: 'Filter',
  kind: 'effect',
  category: 'EQ & Filter',
  description: 'Resonant 12/24 dB multimode filter with drive and a syncable LFO for sweeps and wobbles.',
  color: '#ffd166',
  params: [
    { id: 'type', name: 'Type', min: 0, max: 3, default: 0, options: TYPES },
    { id: 'slope', name: 'Slope', min: 0, max: 1, default: 1, options: SLOPES },
    { id: 'cutoff', name: 'Cutoff', min: 20, max: 20000, default: 2000, unit: 'Hz', curve: 'exp' },
    { id: 'res', name: 'Resonance', min: 0, max: 1, default: 0.25, unit: '%' },
    { id: 'drive', name: 'Drive', min: 0, max: 24, default: 0, unit: 'dB' },
    { id: 'lfoAmt', name: 'LFO Amount', min: -1, max: 1, default: 0, unit: '%' },
    { id: 'lfoRate', name: 'LFO Rate', min: 0.02, max: 20, default: 1, unit: 'Hz', curve: 'exp' },
    { id: 'lfoShape', name: 'LFO Shape', min: 0, max: SHAPES.length - 1, default: 0, options: SHAPES },
    { id: 'lfoSync', name: 'LFO Sync', min: 0, max: 1, default: 0, step: 1 },
    { id: 'lfoDiv', name: 'LFO Rate (sync)', min: 0, max: DIVISION_NAMES.length - 1, default: divIndex('1/4'), options: DIVISION_NAMES },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' },
    { ...TEMPO_PARAM }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Warm Low Pass', category: 'Static', params: { type: 0, slope: 0, cutoff: 3500, res: 0.15 } },
    { name: 'Radio High Pass', category: 'Static', params: { type: 1, slope: 1, cutoff: 600, res: 0.2 } },
    { name: 'Acid Squelch', category: 'Resonant', params: { type: 0, slope: 1, cutoff: 600, res: 0.8, drive: 9 } },
    { name: 'Slow Sweep', category: 'Moving', params: { type: 0, slope: 1, cutoff: 1200, res: 0.45, lfoAmt: 0.6, lfoRate: 0.12, lfoShape: 1 } },
    { name: 'Dubstep Wobble 1/8', category: 'Moving', params: { type: 0, slope: 1, cutoff: 400, res: 0.55, drive: 6, lfoAmt: 0.7, lfoSync: 1, lfoDiv: divIndex('1/8'), lfoShape: 0 } },
    { name: 'Triplet Wobble', category: 'Moving', params: { type: 0, slope: 1, cutoff: 500, res: 0.5, lfoAmt: 0.65, lfoSync: 1, lfoDiv: divIndex('1/8T'), lfoShape: 1 } },
    { name: 'Band Pass Phone', category: 'Static', params: { type: 2, slope: 0, cutoff: 1500, res: 0.35 } },
    { name: 'Notch Sweep', category: 'Moving', params: { type: 3, slope: 0, cutoff: 1000, res: 0.3, lfoAmt: 0.7, lfoRate: 0.3 } },
    { name: 'S&H Robot', category: 'Moving', params: { type: 2, slope: 0, cutoff: 1200, res: 0.6, lfoAmt: 0.6, lfoShape: 4, lfoSync: 1, lfoDiv: divIndex('1/16') } },
    { name: 'Rising High Pass Build', category: 'Moving', params: { type: 1, slope: 1, cutoff: 200, res: 0.4, lfoAmt: 0.8, lfoShape: 2, lfoSync: 1, lfoDiv: divIndex('1 bar') } }
  ]
}
