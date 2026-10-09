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
}

export interface PluginModule {
  manifest: PluginManifest
  /** Optional custom editor. Without one, a generic knob panel is generated from params. */
  Editor?: ComponentType<PluginEditorProps>
  /** Editor content size in px (excluding the window chrome). */
  editorSize?: { width: number; height: number }
  /** Compile wasm on the main thread; the module is handed to the DSP via ctx.wasm. */
  loadWasm?: () => Promise<WebAssembly.Module>
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
