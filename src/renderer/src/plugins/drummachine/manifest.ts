import type { PluginManifest, Preset } from '../sdk/types'
import { DEFAULT_DATA, KITS } from './data'

const KIT_PARAMS: Record<string, Record<string, number>> = {
  'Lo-fi': { character: 1, drive: 0.25 },
  Techno: { drive: 0.2, comp: 0.35 },
  Trap: { comp: 0.2 }
}

const presets: Preset[] = KITS.map((k): Preset => ({
  name: k.name,
  category: k.category === 'Analog' ? 'Analog machines' : k.category === 'Digital' ? 'Sample-era machines' : 'Modern',
  params: KIT_PARAMS[k.id] ?? {},
  data: { kit: k.id, pads: {} }
}))

/** Drum Machine: classic drum machine kits (808, 909, Linn, DMX, ...) on a General MIDI key map. */
export const manifest: PluginManifest = {
  id: 'drummachine',
  name: 'Classic Drum Machines',
  kind: 'instrument',
  category: 'Drums',
  description: 'Classic drum machines: 808, 909, 606, CR-78, Simmons, Linn, LM-1, DMX, Drumulator, 707, SP-12 and more. GM key map (36 kick, 38 snare, 39 clap, 42 hat...).',
  color: '#ff7a3d',
  params: [
    { id: 'tune', name: 'Master Tune', min: -12, max: 12, default: 0, unit: 'st' },
    { id: 'drive', name: 'Drive', min: 0, max: 1, default: 0, unit: '%' },
    { id: 'comp', name: 'Bus Comp', min: 0, max: 1, default: 0, unit: '%' },
    { id: 'character', name: 'Character', min: 0, max: 1, default: 0.8, unit: '%' },
    { id: 'vel', name: 'Velocity', min: 0, max: 1, default: 0.7, unit: '%' },
    { id: 'gate', name: 'Trigger', min: 0, max: 1, default: 0, options: ['One-shot', 'Gated'] },
    { id: 'gain', name: 'Output', min: -24, max: 6, default: 0, unit: 'dB' }
  ],
  presets,
  defaultData: { kit: DEFAULT_DATA.kit, pads: {} }
}
