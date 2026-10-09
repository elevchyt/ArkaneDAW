import type { ComponentType } from 'react'
import type { PluginManifest, Preset } from './types'

export interface PluginInstanceView {
  params: Record<string, number>
  data: unknown
  presetName?: string
}

export interface PluginEditorProps {
  manifest: PluginManifest
  instance: PluginInstanceView
  /** Live (non-undoable while dragging; the host coalesces history). */
  setParam: (id: string, value: number) => void
  setParams: (values: Record<string, number>) => void
  setData: (data: unknown) => void
  loadPreset: (preset: Preset) => void
  /** Messages from the DSP (ctx.post) */
  onDSPMessage: (cb: (msg: unknown) => void) => () => void
  /** Send to DSP onMessage() */
  postToDSP: (msg: unknown) => void
  /** Audition a note on this instrument (instrument editors only). */
  previewNote?: (key: number, velocity: number, on: boolean) => void
  /** Report a hovered control for the main window hint bar. */
  hint: (text: string) => void
  /**
   * Instruments only: write notes into the CURRENT pattern for this channel (e.g. drag a groove from a
   * drum plugin). pos/len in ticks (PPQ 96). mode 'replace' clears this channel's notes in the pattern first.
   */
  insertNotes?: (notes: { key: number; pos: number; len: number; vel?: number; pan?: number }[], mode?: 'replace' | 'merge') => void
}

/** A named key, shown on the piano roll keyboard (drum maps, keyswitches). */
export interface KeyName {
  name: string
  /** optional group label (e.g. 'Kick', 'Snare', 'Toms', 'Cymbals', 'Perc', 'SFX') */
  group?: string
}

export interface PluginModule {
  manifest: PluginManifest
  /** Optional custom editor. Without one, a generic knob panel is generated from params. */
  Editor?: ComponentType<PluginEditorProps>
  /** Editor content size in px (excluding the window chrome). */
  editorSize?: { width: number; height: number }
  /** Compile wasm on the main thread; the module is handed to the DSP via ctx.wasm. */
  loadWasm?: () => Promise<WebAssembly.Module>
  /**
   * Key names for the piano roll (drum maps). Depends on instance state (e.g. selected kit).
   * When defined, the piano roll labels these keys and can switch to a "drum view" listing only named keys.
   */
  keyNames?: (instance: PluginInstanceView) => Record<number, KeyName> | undefined
  /**
   * Piano roll keyboard view when keyNames is defined: 'names' (drum-style rows of named keys, default)
   * or 'piano' (normal keyboard with names as labels — e.g. melodic instruments with keyswitches).
   */
  defaultKeyView?: 'names' | 'piano'
  /**
   * Main-thread hook to enrich `data` before it is sent to the DSP (e.g. load & decode sample files and
   * attach PCM as Float32Arrays). `ctx` identifies the AudioContext so a plugin can avoid re-sending
   * large buffers it already shipped to that context's worklet (worklet module globals are shared per context).
   */
  resolveData?: (data: unknown, ctx: BaseAudioContext) => Promise<unknown>
}

export function definePlugin(m: PluginModule): PluginModule {
  return m
}

export function defaultParams(manifest: PluginManifest): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of manifest.params) out[p.id] = p.default
  return out
}

export function presetParams(manifest: PluginManifest, preset: Preset): Record<string, number> {
  return { ...defaultParams(manifest), ...preset.params }
}
