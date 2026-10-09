import type { PluginManifest } from '../sdk/types'

/** Flanger: short modulated delay with feedback. */
export const manifest: PluginManifest = {
  id: 'flanger',
  name: 'Flanger',
  kind: 'effect',
  category: 'Modulation',
  description: 'Jet-plane flanger: short swept delay with positive or negative feedback.',
  color: '#ff8ad8',
  params: [
    { id: 'rate', name: 'Rate', min: 0.02, max: 10, default: 0.25, unit: 'Hz', curve: 'exp' },
    { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.7, unit: '%' },
    { id: 'manual', name: 'Delay', min: 0.1, max: 10, default: 1, unit: 'ms', curve: 'exp' },
    { id: 'feedback', name: 'Feedback', min: -0.95, max: 0.95, default: 0.6, unit: '%' },
    { id: 'stereo', name: 'Stereo', min: 0, max: 1, default: 0.25, unit: '%' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.5, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Jet Plane', category: 'Classic', params: { rate: 0.1, depth: 0.9, manual: 0.6, feedback: 0.85, stereo: 0 } },
    { name: 'Gentle Sweep', category: 'Subtle', params: { rate: 0.2, depth: 0.5, manual: 1.5, feedback: 0.3, mix: 0.4 } },
    { name: 'Metallic Negative', category: 'Creative', params: { rate: 0.15, depth: 0.7, manual: 0.8, feedback: -0.85 } },
    { name: 'Stereo Swirl', category: 'Classic', params: { rate: 0.35, depth: 0.7, manual: 1.2, feedback: 0.6, stereo: 0.75 } },
    { name: 'Fast Warble', category: 'Creative', params: { rate: 5, depth: 0.25, manual: 2, feedback: 0.2, mix: 0.5 } },
    { name: 'Static Comb', category: 'Creative', params: { rate: 0.02, depth: 0, manual: 2.2, feedback: 0.8 } },
    { name: 'Hi-Hat Shimmer', category: 'Drums', params: { rate: 0.5, depth: 0.8, manual: 0.3, feedback: 0.7, stereo: 0.5, mix: 0.45 } }
  ]
}
