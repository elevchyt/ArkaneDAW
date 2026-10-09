import type { ParamDef, PluginManifest, Preset } from '../sdk/types'
import { PATCHES, PATCH_NAMES } from './patches'

export const POLYPHONY = 64

/** User-facing params. Defaults = Concert Grand (patch 0) knob values. */
const PARAMS_BASE: ParamDef[] = [
  { id: 'patch', name: 'Patch', min: 0, max: PATCH_NAMES.length - 1, default: 0, options: PATCH_NAMES },
  { id: 'sustain', name: 'Sustain Pedal', min: 0, max: 1, default: 0, step: 1, options: ['Up', 'Down'] },
  { id: 'bright', name: 'Brightness', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'dyn', name: 'Dynamics', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'width', name: 'Stereo Width', min: 0, max: 1, default: 0.7, unit: '%' },
  { id: 'persp', name: 'Perspective', min: 0, max: 1, default: 0, options: ['Player', 'Audience'] },
  { id: 'lid', name: 'Lid', min: 0, max: 1, default: 0.75, unit: '%' },
  { id: 'body', name: 'Body Resonance', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'mech', name: 'Mechanical Noise', min: 0, max: 1, default: 0.4, unit: '%' },
  { id: 'detune', name: 'Detune / Age', min: 0, max: 1, default: 0.2, unit: '%' },
  { id: 'tuning', name: 'Tuning A4', min: 430, max: 450, default: 440, unit: 'Hz', step: 0.1 },
  { id: 'rev', name: 'Reverb', min: 0, max: 1, default: 0.2, unit: '%' },
  { id: 'revSize', name: 'Room Size', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'chorus', name: 'Chorus', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'trem', name: 'Tremolo', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'tremRate', name: 'Trem Rate', min: 0.5, max: 10, default: 4.5, unit: 'Hz', curve: 'exp' },
  { id: 'pad', name: 'Pad Layer', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'tape', name: 'Tape / Lo-fi', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'volume', name: 'Volume', min: 0, max: 1, default: 0.8, unit: '%' },
  { id: 'modyPedal', name: 'Mod Y > 75% = Pedal', min: 0, max: 1, default: 1, step: 1, options: ['Off', 'On'], hidden: true }
]

const first = PATCHES[0].knobs
export const PARAMS: ParamDef[] = PARAMS_BASE.map((p) => (p.id in first ? { ...p, default: first[p.id] } : p))

/** Every patch is a preset: it selects the sound model and sets that patch's knob defaults. */
export const PATCH_PRESETS: Preset[] = PATCHES.map((m, i) => ({ name: m.name, category: m.category, params: { patch: i, ...m.knobs } }))

/** Piano: dedicated physically-modelled piano with grand, upright, electric and character patches. */
export const manifest: PluginManifest = {
  id: 'piano',
  name: 'Piano',
  kind: 'instrument',
  category: 'Synths',
  description: 'Modelled acoustic & electric pianos: grands, uprights, felt, honky-tonk, CP-70, tine & reed EPs, toy, lo-fi and ambient patches, with sustain pedal.',
  color: '#d8b46a',
  params: PARAMS,
  presets: PATCH_PRESETS
}
