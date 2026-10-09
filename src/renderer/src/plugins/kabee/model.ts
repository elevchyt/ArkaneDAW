// Kabee board model in TypeScript: mirrors the helpers in upstream Params.hpp / Presets.hpp (decodeChain,
// encodeChain, normalize, formatValue, presetMatches...). Pure data + functions: safe for the UI, the DSP and tests.
import {
  KABEE_BOARDS,
  KABEE_NEW_BOARDS,
  KABEE_PARAMS,
  KABEE_PEDALS,
  KABEE_PRESETS,
  KABEE_USER_PRESET_PARAMS,
  MAX_SLOTS,
  PF_BOOL,
  PF_HIDDEN,
  PF_INT,
  PF_LOG,
  PF_OUTPUT,
  PF_TRIGGER,
  PRESET_NEW,
  PRESET_USER,
  type KabeeFactoryPreset,
  type KabeeParamInfo
} from './table.gen'

export { KABEE_BOARDS, KABEE_PARAMS, KABEE_PEDALS, KABEE_PRESETS, MAX_SLOTS, PRESET_NEW, PRESET_USER, PF_BOOL, PF_INT, PF_LOG, PF_OUTPUT, PF_TRIGGER, PF_HIDDEN }
export type { KabeeFactoryPreset, KabeeParamInfo }

export const MODE_GUITAR = 0
export const MODE_BASS = 1

export const PARAM_BY_SYMBOL: Record<string, KabeeParamInfo> = Object.fromEntries(KABEE_PARAMS.map((p) => [p.symbol, p]))
export const sym = (index: number): string => KABEE_PARAMS[index].symbol
export const SLOT_IDS = Array.from({ length: MAX_SLOTS }, (_, i) => `slot_${i + 1}`)

/** Parameters ArkaneDAW exposes: every Kabee input except the gate-learn trigger (a message instead). */
export const isHostParam = (p: KabeeParamInfo): boolean => !(p.flags & (PF_OUTPUT | PF_TRIGGER))

export type Values = Record<string, number>

export function value(values: Values, symbol: string): number {
  return values[symbol] ?? PARAM_BY_SYMBOL[symbol]?.pluginDefault ?? 0
}

export const modeOf = (values: Values): number => (value(values, 'mode') > 0.5 ? MODE_BASS : MODE_GUITAR)

export function pedalAllowed(pedal: number, mode: number): boolean {
  return KABEE_BOARDS[mode].includes(pedal)
}

/** Reads the chain from slot values, skipping empty, unknown, duplicate and wrong-mode entries. */
export function decodeChain(values: Values, mode = modeOf(values)): number[] {
  const out: number[] = []
  for (const s of SLOT_IDS) {
    const id = Math.floor(value(values, s) + 0.5) - 1
    if (id < 0 || id >= KABEE_PEDALS.length || out.includes(id) || !pedalAllowed(id, mode)) continue
    out.push(id)
  }
  return out
}

/** Slot values for a chain, packed from the first slot. */
export function encodeChain(ids: number[]): Values {
  const out: Values = {}
  SLOT_IDS.forEach((s, i) => (out[s] = i < ids.length ? ids[i] + 1 : 0))
  return out
}

/** Pedals of the mode that aren't on the board. */
export function availablePedals(values: Values): number[] {
  const chain = decodeChain(values)
  return KABEE_BOARDS[modeOf(values)].filter((id) => !chain.includes(id))
}

export function normalize(p: KabeeParamInfo, v: number): number {
  if (p.flags & PF_LOG) return Math.log(v / p.min) / Math.log(p.max / p.min)
  return (v - p.min) / (p.max - p.min)
}

export function denormalize(p: KabeeParamInfo, t: number): number {
  t = Math.min(1, Math.max(0, t))
  let v = p.flags & PF_LOG ? p.min * Math.pow(p.max / p.min, t) : p.min + t * (p.max - p.min)
  if (p.flags & (PF_INT | PF_BOOL | PF_TRIGGER)) v = Math.floor(v + 0.5)
  return v
}

/** Human-readable value, e.g. "6.5", "+3.0 dB", "380 ms", "Fast" (formatValue in Params.hpp). */
export function formatValue(p: KabeeParamInfo, v: number): string {
  if (p.symbol === 'rotary_fast') return v > 0.5 ? 'Fast' : 'Slow'
  if (p.flags & PF_BOOL) return v > 0.5 ? 'On' : 'Off'
  if (p.unit.startsWith('d')) return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)} dB`
  if (p.unit.startsWith('m')) return `${v.toFixed(0)} ms`
  return v.toFixed(1)
}

// ---- presets ---------------------------------------------------------------------------------------------------------

export const factoryPresetsFor = (mode: number): KabeeFactoryPreset[] => KABEE_PRESETS.filter((p) => p.mode === mode)
export const firstFactoryPreset = (mode: number): KabeeFactoryPreset => factoryPresetsFor(mode)[0]
export const newBoardValues = (mode: number): Values => ({ ...KABEE_NEW_BOARDS[mode] })
export const userPresetParams = (mode: number): string[] => KABEE_USER_PRESET_PARAMS[mode]

/** Host-visible preset name ("Guitar Clean", "Bass Punch"), unique across modes. */
export const factoryPresetLabel = (p: KabeeFactoryPreset): string => `${p.mode === MODE_BASS ? 'Bass' : 'Guitar'} ${p.name}`

/** True when `current` equals `reference` on every parameter it owns (the preset index is ignored). */
export function stateMatches(current: Values, reference: Values): boolean {
  for (const k in reference) if (k !== 'preset' && Math.abs(value(current, k) - reference[k]) > 0.001) return false
  return true
}

export interface UserPreset {
  name: string
  mode: number
  values: Values
}

/** Trims, drops control characters and limits the length (PresetLibrary::cleanName). */
export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return [...name].slice(0, 40).join('')
}

export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function makeUserPreset(name: string, values: Values): UserPreset {
  const mode = modeOf(values)
  const out: Values = {}
  for (const s of userPresetParams(mode)) out[s] = value(values, s)
  return { name, mode, values: out }
}
