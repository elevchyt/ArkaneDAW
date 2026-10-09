import type { ParamDef, PluginManifest } from '../sdk/types'

const SHAPES = ['Sine', 'Tri', 'Saw', 'Square', 'Noise']
const osc = (n: number, shape: number, vol: number, coarse = 0): ParamDef[] => [
  { id: `osc${n}.shape`, name: 'Shape', min: 0, max: 4, default: shape, options: SHAPES },
  { id: `osc${n}.vol`, name: 'Volume', min: 0, max: 1, default: vol, unit: '%' },
  { id: `osc${n}.pan`, name: 'Pan', min: -1, max: 1, default: 0 },
  { id: `osc${n}.coarse`, name: 'Coarse', min: -24, max: 24, default: coarse, step: 1, unit: 'st' },
  { id: `osc${n}.fine`, name: 'Fine', min: -100, max: 100, default: 0, unit: 'ct' },
  { id: `osc${n}.pw`, name: 'PW', min: 0.05, max: 0.95, default: 0.5 }
]

/** "Triple Osc": the classic three-oscillator starter synth (FL's 3x Osc equivalent). */
export const manifest: PluginManifest = {
  id: 'triosc',
  name: 'Triple Osc',
  kind: 'instrument',
  category: 'Synths',
  description: 'Three oscillators, a filter and an envelope. The default channel synth.',
  color: '#7fb8e0',
  params: [
    ...osc(1, 2, 1),
    ...osc(2, 3, 0.5, -12),
    ...osc(3, 0, 0.3, -24),
    { id: 'amp.attack', name: 'Attack', min: 0.001, max: 4, default: 0.003, unit: 's', curve: 'exp' },
    { id: 'amp.decay', name: 'Decay', min: 0.01, max: 6, default: 0.4, unit: 's', curve: 'exp' },
    { id: 'amp.sustain', name: 'Sustain', min: 0, max: 1, default: 0.7, unit: '%' },
    { id: 'amp.release', name: 'Release', min: 0.005, max: 8, default: 0.15, unit: 's', curve: 'exp' },
    { id: 'filter.cutoff', name: 'Cutoff', min: 40, max: 20000, default: 12000, unit: 'Hz', curve: 'exp' },
    { id: 'filter.res', name: 'Reso', min: 0.5, max: 12, default: 0.8, curve: 'exp' },
    { id: 'filter.env', name: 'Env Amt', min: -1, max: 1, default: 0 },
    { id: 'master.gain', name: 'Gain', min: 0, max: 1, default: 0.5, unit: '%' },
    { id: 'master.glide', name: 'Glide', min: 0, max: 1, default: 0, unit: 's' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Soft Pad', category: 'Pad', params: { 'osc1.shape': 2, 'osc2.shape': 2, 'osc2.coarse': 0, 'osc2.fine': 9, 'osc3.vol': 0, 'amp.attack': 0.6, 'amp.release': 1.4, 'filter.cutoff': 2400 } },
    { name: 'Square Lead', category: 'Lead', params: { 'osc1.shape': 3, 'osc2.shape': 3, 'osc2.coarse': 12, 'osc2.vol': 0.3, 'osc3.vol': 0, 'filter.cutoff': 6000 } },
    { name: 'Sub Bass', category: 'Bass', params: { 'osc1.shape': 0, 'osc1.coarse': -12, 'osc2.vol': 0, 'osc3.vol': 0.6, 'osc3.shape': 1, 'amp.release': 0.08 } },
    { name: 'Pluck', category: 'Pluck', params: { 'amp.sustain': 0, 'amp.decay': 0.35, 'filter.cutoff': 900, 'filter.env': 0.7, 'filter.res': 2 } }
  ]
}
