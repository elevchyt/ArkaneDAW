import type { PluginManifest } from '../sdk/types'

/** Limiter: look-ahead brickwall peak limiter. */
export const manifest: PluginManifest = {
  id: 'limiter',
  name: 'Limiter',
  kind: 'effect',
  category: 'Dynamics',
  description: 'Look-ahead brickwall limiter: drive it for loudness, the ceiling is never exceeded.',
  color: '#ff6b5e',
  params: [
    { id: 'gain', name: 'Gain', min: -6, max: 24, default: 0, unit: 'dB' },
    { id: 'ceiling', name: 'Ceiling', min: -12, max: 0, default: -0.3, unit: 'dB' },
    { id: 'release', name: 'Release', min: 1, max: 1000, default: 60, unit: 'ms', curve: 'exp' },
    { id: 'lookahead', name: 'Look-ahead', min: 0.5, max: 5, default: 2, unit: 'ms' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Transparent Safety', category: 'Master', params: { gain: 0, ceiling: -1, release: 120, lookahead: 3 } },
    { name: 'Loud Master', category: 'Master', params: { gain: 6, ceiling: -0.3, release: 80, lookahead: 2 } },
    { name: 'Maximizer', category: 'Master', params: { gain: 10, ceiling: -0.1, release: 40, lookahead: 1.5 } },
    { name: 'Smooth Pump', category: 'Creative', params: { gain: 12, ceiling: -1, release: 300, lookahead: 5 } },
    { name: 'Drum Bus Squash', category: 'Bus', params: { gain: 8, ceiling: -3, release: 15, lookahead: 1 } },
    { name: 'Streaming -1 dBTP', category: 'Master', params: { gain: 3, ceiling: -1, release: 100, lookahead: 4 } },
    { name: 'Fast Transient Catch', category: 'Bus', params: { gain: 2, ceiling: -0.5, release: 5, lookahead: 0.5 } }
  ]
}
