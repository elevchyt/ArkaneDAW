import type { ParamDef, PluginManifest, Preset } from '../sdk/types'
import { FACTORY } from './factory'
import { MASTER_PARAMS, VOICE_PARAMS, voiceToParams } from './voice'

/** Factory voices as host presets (full voice param maps + optional performance params). */
export const FACTORY_PRESETS: Preset[] = FACTORY.map((f) => ({
  name: f.name,
  category: f.category,
  params: { ...voiceToParams(f.voice), ...(f.extra ?? {}) }
}))

// A new Hexa instance starts on the first factory voice rather than a bare sine.
const first = voiceToParams(FACTORY[0].voice)
const params: ParamDef[] = [...VOICE_PARAMS.map((p) => ({ ...p.def, default: first[p.def.id] ?? p.def.default })), ...MASTER_PARAMS]

/** Hexa: DX7-style 6-operator FM synthesizer with DX7 sysex cartridge support. */
export const manifest: PluginManifest = {
  id: 'hexa',
  name: 'Hexa',
  kind: 'instrument',
  category: 'Synths',
  description: '6-operator FM synthesizer in the spirit of the DX7: 32 algorithms, loads DX7 .syx voices and cartridges.',
  color: '#c8553d',
  params,
  presets: FACTORY_PRESETS,
  defaultData: { cartIndex: 0 }
}
