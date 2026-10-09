import type { ParamDef, PluginManifest, Preset } from '../sdk/types'
import { KABEE_PARAMS, KABEE_PRESETS, PF_BOOL, PF_HIDDEN, PF_INT, PF_LOG, factoryPresetLabel, isHostParam } from './model'

// Param ids are Kabee's own parameter symbols (Params.hpp), so presets/automation line up with the VST/CLAP build.
const OPTIONS: Record<string, string[]> = {
  mode: ['Guitar', 'Bass'],
  rotary_fast: ['Slow', 'Fast']
}

const params: ParamDef[] = KABEE_PARAMS.filter(isHostParam).map((p) => {
  const def: ParamDef = { id: p.symbol, name: p.name, min: p.min, max: p.max, default: p.pluginDefault }
  if (p.unit) def.unit = p.unit
  if (p.flags & PF_LOG) def.curve = 'exp'
  if (p.flags & (PF_INT | PF_BOOL)) def.step = 1
  if (OPTIONS[p.symbol]) def.options = OPTIONS[p.symbol]
  else if (p.flags & PF_BOOL) def.options = ['Off', 'On']
  if (p.flags & PF_HIDDEN) def.hidden = true
  return def
})

/** Factory presets own the board (mode, order, every pedal of the mode, mic, presence), like in Kabee. */
const presets: Preset[] = KABEE_PRESETS.map((p) => ({
  name: factoryPresetLabel(p),
  category: p.mode === 1 ? 'Bass' : 'Guitar',
  params: { ...p.values }
}))

export interface KabeeData {
  /** Name of the user preset the board came from (Kabee's "preset_name" state). */
  presetName?: string
}

/** Kabee: guitar & bass amp + pedalboard (github.com/elevchyt/kabee), DSP compiled to WebAssembly. */
export const manifest: PluginManifest = {
  id: 'kabee',
  name: 'Kabee',
  kind: 'effect',
  category: 'Guitar & Amp',
  description: 'Guitar and bass pedalboard with a built-in amp and cabinet. Drag pedals to reorder, add/remove, tuner, gate learn.',
  color: '#f0f0f0',
  params,
  presets,
  defaultData: { presetName: '' } satisfies KabeeData
}
