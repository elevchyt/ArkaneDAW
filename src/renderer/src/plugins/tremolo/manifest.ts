import type { PluginManifest } from '../sdk/types'
import { DIVISION_NAMES, TEMPO_PARAM, divIndex } from '../fx-common/divisions'

export const SHAPES = ['Sine', 'Triangle', 'Square', 'Saw Down', 'Saw Up']

/** Tremolo / Auto-pan: LFO amplitude or pan modulation, free or tempo-synced. */
export const manifest: PluginManifest = {
  id: 'tremolo',
  name: 'Tremolo',
  kind: 'effect',
  category: 'Modulation',
  description: 'Tremolo and auto-pan with tempo sync, smooth or choppy shapes and stereo offset.',
  color: '#ffb86b',
  params: [
    { id: 'mode', name: 'Mode', min: 0, max: 1, default: 0, options: ['Tremolo', 'Auto-Pan'] },
    { id: 'rate', name: 'Rate', min: 0.05, max: 20, default: 4, unit: 'Hz', curve: 'exp' },
    { id: 'sync', name: 'Tempo Sync', min: 0, max: 1, default: 1, step: 1 },
    { id: 'div', name: 'Rate (sync)', min: 0, max: DIVISION_NAMES.length - 1, default: divIndex('1/8'), options: DIVISION_NAMES },
    { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.6, unit: '%' },
    { id: 'shape', name: 'Shape', min: 0, max: SHAPES.length - 1, default: 0, options: SHAPES },
    { id: 'smooth', name: 'Smooth', min: 0, max: 1, default: 0.3, unit: '%' },
    { id: 'stereo', name: 'Stereo', min: 0, max: 1, default: 0, unit: '%' },
    { ...TEMPO_PARAM }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Vintage Amp Trem', category: 'Tremolo', params: { mode: 0, sync: 0, rate: 5.5, depth: 0.5, shape: 0 } },
    { name: 'Slow Pulse', category: 'Tremolo', params: { mode: 0, div: divIndex('1/4'), depth: 0.7, shape: 1 } },
    { name: 'Hard Chop 1/16', category: 'Gate', params: { mode: 0, div: divIndex('1/16'), depth: 1, shape: 2, smooth: 0.1 } },
    { name: 'Trance Gate 1/8', category: 'Gate', params: { mode: 0, div: divIndex('1/8'), depth: 0.9, shape: 2, smooth: 0.2 } },
    { name: 'Side-chain Pump', category: 'Tremolo', params: { mode: 0, div: divIndex('1/4'), depth: 0.8, shape: 4, smooth: 0.35 } },
    { name: 'Gentle Auto-Pan', category: 'Auto-Pan', params: { mode: 1, div: divIndex('1/2'), depth: 0.6, shape: 0 } },
    { name: 'Ping-Pong Pan 1/8', category: 'Auto-Pan', params: { mode: 1, div: divIndex('1/8'), depth: 1, shape: 2, smooth: 0.3 } },
    { name: 'Stereo Shimmer', category: 'Tremolo', params: { mode: 0, sync: 0, rate: 7, depth: 0.4, stereo: 0.5 } }
  ]
}
