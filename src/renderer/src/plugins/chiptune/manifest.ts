import type { PluginManifest } from '../sdk/types'
import { defaultChipData } from './data'
import { PARAMS } from './params'
import { PRESETS } from './presets'

/** "Chiptune": homage to YMCK's Magical 8bit Plug 2 — NES/GB channels, sequences, sweep, arp + retro drums. */
export const manifest: PluginManifest = {
  id: 'chiptune',
  name: 'Chiptune',
  kind: 'instrument',
  category: 'Synth',
  description: 'NES / Game Boy style 8-bit synth: pulse, triangle, noise and GB wave channels with Famitracker-style sequences, sweep, vibrato, arpeggio and a retro drum mode.',
  color: '#f83800',
  params: PARAMS,
  presets: PRESETS,
  defaultData: defaultChipData()
}
