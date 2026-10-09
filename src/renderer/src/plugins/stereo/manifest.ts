import type { PluginManifest } from '../sdk/types'

/** Stereo: width / pan / swap / phase / bass-mono utility. */
export const manifest: PluginManifest = {
  id: 'stereo',
  name: 'Stereo',
  kind: 'effect',
  category: 'Utility',
  description: 'Stereo utility: width, balance, channel swap, phase invert and mono bass, with a vectorscope.',
  color: '#7fd4ff',
  params: [
    { id: 'width', name: 'Width', min: 0, max: 200, default: 100, unit: '%' },
    { id: 'pan', name: 'Pan', min: -100, max: 100, default: 0, unit: '%' },
    { id: 'monoBass', name: 'Mono Bass', min: 0, max: 500, default: 0, unit: 'Hz', curve: 'exp' },
    { id: 'gain', name: 'Gain', min: -24, max: 12, default: 0, unit: 'dB' },
    { id: 'swap', name: 'Swap L/R', min: 0, max: 1, default: 0, step: 1 },
    { id: 'invL', name: 'Invert L', min: 0, max: 1, default: 0, step: 1 },
    { id: 'invR', name: 'Invert R', min: 0, max: 1, default: 0, step: 1 }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Mono', category: 'Width', params: { width: 0 } },
    { name: 'Wide', category: 'Width', params: { width: 150 } },
    { name: 'Extra Wide', category: 'Width', params: { width: 200, monoBass: 150 } },
    { name: 'Tight Low End (120 Hz)', category: 'Mixing', params: { monoBass: 120 } },
    { name: 'Master Width Polish', category: 'Mixing', params: { width: 115, monoBass: 100 } },
    { name: 'Narrow Pad', category: 'Width', params: { width: 50 } },
    { name: 'Swap Channels', category: 'Utility', params: { swap: 1 } },
    { name: 'Fix Phase (Invert R)', category: 'Utility', params: { invR: 1 } },
    { name: 'Side Only', category: 'Utility', params: { width: 200, monoBass: 0, gain: -6 } }
  ]
}
