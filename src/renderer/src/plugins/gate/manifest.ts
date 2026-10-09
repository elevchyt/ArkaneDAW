import type { PluginManifest } from '../sdk/types'

/** Gate: noise gate / expander with hold, hysteresis and side-chain. */
export const manifest: PluginManifest = {
  id: 'gate',
  name: 'Gate',
  kind: 'effect',
  category: 'Dynamics',
  description: 'Noise gate with hold, range and side-chain input. Tightens drums, removes hiss and bleed.',
  color: '#5ad1a8',
  sidechain: true,
  params: [
    { id: 'threshold', name: 'Threshold', min: -80, max: 0, default: -40, unit: 'dB' },
    { id: 'range', name: 'Range', min: -80, max: 0, default: -80, unit: 'dB' },
    { id: 'attack', name: 'Attack', min: 0.05, max: 50, default: 0.5, unit: 'ms', curve: 'exp' },
    { id: 'hold', name: 'Hold', min: 0, max: 500, default: 40, unit: 'ms', curve: 'exp' },
    { id: 'release', name: 'Release', min: 5, max: 2000, default: 150, unit: 'ms', curve: 'exp' },
    { id: 'sidechain', name: 'Side-chain', min: 0, max: 1, default: 0, step: 1 }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Noise Cleanup', category: 'Clean', params: { threshold: -55, range: -30, attack: 2, hold: 60, release: 300 } },
    { name: 'Tight Kick', category: 'Drums', params: { threshold: -30, range: -80, attack: 0.1, hold: 30, release: 60 } },
    { name: 'Snare Gate', category: 'Drums', params: { threshold: -26, range: -60, attack: 0.1, hold: 50, release: 120 } },
    { name: 'Tom Bleed Removal', category: 'Drums', params: { threshold: -32, range: -40, attack: 0.5, hold: 120, release: 400 } },
    { name: 'Vocal Breaths', category: 'Vocal', params: { threshold: -45, range: -15, attack: 3, hold: 80, release: 250 } },
    { name: 'Gated Reverb Chop', category: 'Creative', params: { threshold: -24, range: -80, attack: 0.1, hold: 180, release: 20 } },
    { name: 'Side-chain Trance Gate', category: 'Creative', params: { threshold: -30, range: -80, attack: 1, hold: 20, release: 40, sidechain: 1 } },
    { name: 'Gentle Expander', category: 'Clean', params: { threshold: -40, range: -12, attack: 5, hold: 20, release: 500 } }
  ]
}
