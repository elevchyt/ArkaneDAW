import type { PluginManifest } from '../sdk/types'

export const STAGES = [4, 6, 8, 10, 12]

/** Phaser: classic allpass-cascade phaser with feedback. */
export const manifest: PluginManifest = {
  id: 'phaser',
  name: 'Phaser',
  kind: 'effect',
  category: 'Modulation',
  description: 'Classic 4-12 stage phaser with feedback and stereo LFO offset.',
  color: '#c48bff',
  params: [
    { id: 'rate', name: 'Rate', min: 0.02, max: 10, default: 0.4, unit: 'Hz', curve: 'exp' },
    { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.7, unit: '%' },
    { id: 'freq', name: 'Frequency', min: 100, max: 5000, default: 700, unit: 'Hz', curve: 'exp' },
    { id: 'feedback', name: 'Feedback', min: -0.95, max: 0.95, default: 0.5, unit: '%' },
    { id: 'stages', name: 'Stages', min: 0, max: 4, default: 1, options: STAGES.map(String) },
    { id: 'stereo', name: 'Stereo', min: 0, max: 1, default: 0.5, unit: '%' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.5, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Slow Swirl', category: 'Classic', params: { rate: 0.15, depth: 0.8, freq: 600, feedback: 0.4, stages: 2 } },
    { name: 'Phase 90', category: 'Classic', params: { rate: 0.6, depth: 0.6, freq: 900, feedback: 0.2, stages: 0, stereo: 0 } },
    { name: 'Deep Jet', category: 'Intense', params: { rate: 0.1, depth: 1, freq: 500, feedback: 0.85, stages: 4, stereo: 0.5 } },
    { name: 'Fast Bubbles', category: 'Intense', params: { rate: 4.5, depth: 0.5, freq: 1200, feedback: 0.6, stages: 1 } },
    { name: 'Negative Hollow', category: 'Creative', params: { rate: 0.3, depth: 0.7, freq: 1500, feedback: -0.75, stages: 3 } },
    { name: 'Wide Stereo Sweep', category: 'Classic', params: { rate: 0.25, depth: 0.75, freq: 800, feedback: 0.5, stages: 2, stereo: 1 } },
    { name: 'Subtle Motion', category: 'Subtle', params: { rate: 0.2, depth: 0.4, freq: 1000, feedback: 0.2, stages: 0, mix: 0.35 } }
  ]
}
