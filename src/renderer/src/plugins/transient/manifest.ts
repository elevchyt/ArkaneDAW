import type { PluginManifest } from '../sdk/types'

/** Transient: level-independent attack / sustain shaper. */
export const manifest: PluginManifest = {
  id: 'transient',
  name: 'Transient',
  kind: 'effect',
  category: 'Dynamics',
  description: 'Transient shaper: add punch or soften attacks, lengthen or tighten tails — no threshold to set.',
  color: '#ff9f43',
  params: [
    { id: 'attack', name: 'Attack', min: -100, max: 100, default: 0, unit: '%' },
    { id: 'sustain', name: 'Sustain', min: -100, max: 100, default: 0, unit: '%' },
    { id: 'speed', name: 'Speed', min: 0, max: 1, default: 0.5, unit: '%' },
    { id: 'output', name: 'Output', min: -18, max: 12, default: 0, unit: 'dB' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Punchy Drums', category: 'Drums', params: { attack: 50, sustain: 0 } },
    { name: 'Snappy Snare', category: 'Drums', params: { attack: 70, sustain: -20, speed: 0.7 } },
    { name: 'Tight Kick', category: 'Drums', params: { attack: 30, sustain: -50 } },
    { name: 'Room Bloom', category: 'Drums', params: { attack: -10, sustain: 60, speed: 0.3 } },
    { name: 'Soften Attacks', category: 'Mixing', params: { attack: -60, sustain: 0 } },
    { name: 'Pluck Definition', category: 'Synths', params: { attack: 40, sustain: -15, speed: 0.8 } },
    { name: 'Dry Out Reverb', category: 'Mixing', params: { attack: 0, sustain: -70, speed: 0.4 } }
  ]
}
