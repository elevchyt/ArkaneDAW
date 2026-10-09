import type { PluginManifest } from '../sdk/types'

/** Compressor: classic feed-forward compressor with soft knee, auto make-up and side-chain. */
export const manifest: PluginManifest = {
  id: 'compressor',
  name: 'Compressor',
  kind: 'effect',
  category: 'Dynamics',
  description: 'Smooth feed-forward compressor with soft knee, auto make-up, parallel mix and side-chain input.',
  color: '#f2b84b',
  sidechain: true,
  params: [
    { id: 'threshold', name: 'Threshold', min: -60, max: 0, default: -18, unit: 'dB' },
    { id: 'ratio', name: 'Ratio', min: 1, max: 20, default: 4, curve: 'exp', unit: ':1' },
    { id: 'attack', name: 'Attack', min: 0.05, max: 200, default: 10, unit: 'ms', curve: 'exp' },
    { id: 'release', name: 'Release', min: 5, max: 2000, default: 120, unit: 'ms', curve: 'exp' },
    { id: 'knee', name: 'Knee', min: 0, max: 24, default: 6, unit: 'dB' },
    { id: 'makeup', name: 'Make-up', min: -12, max: 24, default: 0, unit: 'dB' },
    { id: 'auto', name: 'Auto Make-up', min: 0, max: 1, default: 1, step: 1 },
    { id: 'detector', name: 'Detector', min: 0, max: 1, default: 1, options: ['Peak', 'RMS'] },
    { id: 'sidechain', name: 'Side-chain', min: 0, max: 1, default: 0, step: 1 },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Gentle Glue', category: 'Bus', params: { threshold: -14, ratio: 2, attack: 30, release: 200, knee: 12, detector: 1 } },
    { name: 'Drum Bus Punch', category: 'Bus', params: { threshold: -20, ratio: 4, attack: 25, release: 90, knee: 6, detector: 0 } },
    { name: 'Vocal Leveler', category: 'Vocal', params: { threshold: -24, ratio: 3, attack: 5, release: 150, knee: 10, detector: 1 } },
    { name: 'Vocal Upfront', category: 'Vocal', params: { threshold: -28, ratio: 6, attack: 2, release: 80, knee: 6, detector: 0 } },
    { name: 'Kick Snap', category: 'Drums', params: { threshold: -18, ratio: 5, attack: 15, release: 60, knee: 3, detector: 0 } },
    { name: 'Snare Smack', category: 'Drums', params: { threshold: -22, ratio: 8, attack: 8, release: 70, knee: 3, detector: 0 } },
    { name: 'Bass Control', category: 'Bass', params: { threshold: -20, ratio: 4, attack: 10, release: 160, knee: 8, detector: 1 } },
    { name: 'Parallel Smash', category: 'Bus', params: { threshold: -40, ratio: 20, attack: 0.5, release: 60, knee: 0, detector: 0, mix: 0.35 } },
    { name: 'Master Gentle', category: 'Master', params: { threshold: -10, ratio: 1.5, attack: 30, release: 300, knee: 12, detector: 1 } },
    { name: 'Side-chain Pump', category: 'Side-chain', params: { threshold: -30, ratio: 10, attack: 0.5, release: 180, knee: 3, detector: 0, sidechain: 1, auto: 0 } },
    { name: 'Brickwall-ish', category: 'Master', params: { threshold: -8, ratio: 20, attack: 0.1, release: 50, knee: 2, detector: 0 } }
  ]
}

export { compGain, autoMakeup } from '../fx-common/dynamics'
