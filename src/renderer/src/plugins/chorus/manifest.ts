import type { PluginManifest } from '../sdk/types'

/** Chorus: multi-voice stereo chorus. */
export const manifest: PluginManifest = {
  id: 'chorus',
  name: 'Chorus',
  kind: 'effect',
  category: 'Modulation',
  description: 'Lush multi-voice stereo chorus: thickens synths, guitars and vocals.',
  color: '#4dd4c6',
  params: [
    { id: 'rate', name: 'Rate', min: 0.05, max: 8, default: 0.6, unit: 'Hz', curve: 'exp' },
    { id: 'depth', name: 'Depth', min: 0, max: 1, default: 0.45, unit: '%' },
    { id: 'delay', name: 'Delay', min: 2, max: 30, default: 11, unit: 'ms', curve: 'exp' },
    { id: 'voices', name: 'Voices', min: 1, max: 4, default: 3, step: 1 },
    { id: 'width', name: 'Width', min: 0, max: 1, default: 1, unit: '%' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.5, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Subtle Thickener', category: 'Subtle', params: { rate: 0.35, depth: 0.25, delay: 9, voices: 2, mix: 0.35 } },
    { name: 'Classic Juno', category: 'Vintage', params: { rate: 0.5, depth: 0.5, delay: 7, voices: 2, width: 1, mix: 0.5 } },
    { name: 'Juno Fast', category: 'Vintage', params: { rate: 0.85, depth: 0.45, delay: 6, voices: 2, width: 1, mix: 0.5 } },
    { name: 'Lush Ensemble', category: 'Wide', params: { rate: 0.25, depth: 0.7, delay: 16, voices: 4, width: 1, mix: 0.55 } },
    { name: 'Vocal Doubler', category: 'Vocal', params: { rate: 0.2, depth: 0.2, delay: 22, voices: 2, width: 1, mix: 0.4 } },
    { name: 'Guitar 80s', category: 'Guitar', params: { rate: 1.1, depth: 0.55, delay: 8, voices: 1, width: 0.9, mix: 0.5 } },
    { name: 'Wobbly Tape', category: 'Creative', params: { rate: 3.5, depth: 0.35, delay: 5, voices: 1, width: 0.4, mix: 0.6 } },
    { name: 'Mono Chorus', category: 'Subtle', params: { rate: 0.6, depth: 0.4, delay: 10, voices: 3, width: 0, mix: 0.45 } }
  ]
}
