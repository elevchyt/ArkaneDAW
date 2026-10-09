import type { PluginManifest } from '../sdk/types'

/** The channel sampler: what you get when you drop an audio file in the channel rack. */
export const manifest: PluginManifest = {
  id: 'sampler',
  name: 'Sampler',
  kind: 'instrument',
  category: 'Sampler',
  description: 'Plays an audio sample, pitched by the piano roll.',
  color: '#9fd27a',
  params: [
    { id: 'root', name: 'Root note', min: 0, max: 127, default: 60, step: 1 },
    { id: 'pitchToKey', name: 'Key tracking', min: 0, max: 1, default: 1, options: ['Off', 'On'] },
    { id: 'oneShot', name: 'One shot', min: 0, max: 1, default: 1, options: ['Off', 'On'] },
    { id: 'reverse', name: 'Reverse', min: 0, max: 1, default: 0, options: ['Off', 'On'] },
    { id: 'loop', name: 'Loop', min: 0, max: 1, default: 0, options: ['Off', 'On'] },
    { id: 'start', name: 'Start', min: 0, max: 1, default: 0, unit: '%' },
    { id: 'attack', name: 'Attack', min: 0, max: 2, default: 0, unit: 's', curve: 'exp' },
    { id: 'decay', name: 'Decay', min: 0.01, max: 8, default: 8, unit: 's', curve: 'exp' },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 1, unit: '%' },
    { id: 'release', name: 'Release', min: 0.003, max: 4, default: 0.02, unit: 's', curve: 'exp' },
    { id: 'cutoff', name: 'Cutoff', min: 40, max: 20000, default: 20000, unit: 'Hz', curve: 'exp' },
    { id: 'res', name: 'Reso', min: 0.5, max: 10, default: 0.7, curve: 'exp' },
    { id: 'gain', name: 'Amp', min: 0, max: 2, default: 1, unit: '%' }
  ],
  defaultData: { sampleId: null }
}
