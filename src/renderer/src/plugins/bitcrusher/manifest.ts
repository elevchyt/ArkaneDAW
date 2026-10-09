import type { PluginManifest } from '../sdk/types'

/** Bitcrusher: bit-depth and sample-rate reduction. */
export const manifest: PluginManifest = {
  id: 'bitcrusher',
  name: 'Bitcrusher',
  kind: 'effect',
  category: 'Distortion',
  description: 'Lo-fi bit depth and sample-rate reduction, from subtle grit to 8-bit crunch.',
  color: '#9be15d',
  params: [
    { id: 'bits', name: 'Bits', min: 1, max: 16, default: 8, unit: 'bit' },
    { id: 'rate', name: 'Sample Rate', min: 200, max: 48000, default: 11025, unit: 'Hz', curve: 'exp' },
    { id: 'output', name: 'Output', min: -24, max: 12, default: 0, unit: 'dB' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 1, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: '12-bit Sampler', category: 'Vintage', params: { bits: 12, rate: 26040 } },
    { name: 'SP-1200 Grit', category: 'Vintage', params: { bits: 12, rate: 26040, mix: 0.8 } },
    { name: '8-bit Console', category: 'Retro', params: { bits: 8, rate: 16000 } },
    { name: 'Telephone Crush', category: 'Retro', params: { bits: 6, rate: 8000 } },
    { name: 'Destroyed', category: 'Extreme', params: { bits: 3, rate: 3000, output: -6 } },
    { name: 'Subtle Grit', category: 'Subtle', params: { bits: 10, rate: 32000, mix: 0.4 } },
    { name: 'Robot Voice', category: 'Extreme', params: { bits: 5, rate: 1500, mix: 0.7 } },
    { name: 'Parallel Crunch', category: 'Drums', params: { bits: 4, rate: 9000, mix: 0.3 } }
  ]
}
