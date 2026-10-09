import type { PluginManifest } from '../sdk/types'
import { ALL_PARAMS } from './params'
import { PRESETS } from './presets'

/** "Polygon": 90s Japanese digital synth / ROMpler homage (JV-1080, D-50, SC-55, M1, SY77 era). */
export const manifest: PluginManifest = {
  id: 'polygon',
  name: 'Polygon',
  kind: 'instrument',
  category: 'Synth',
  description: '4-tone 90s ROMpler: procedural virtual ROM, JV-style TVF/TVA, chorus and lo-fi digital reverb. The PS1 soundtrack sound.',
  color: '#5fd0c0',
  params: ALL_PARAMS,
  presets: PRESETS
}
