// Collected inside the AudioWorklet bundle. Each plugins/<id>/dsp.ts default-exports a DSPFactory
// (or an array of them, for packs that ship several plugins from one file).
import type { DSPFactory } from './sdk/types'

const modules = import.meta.glob<{ default: DSPFactory | DSPFactory[] }>('./*/dsp.ts', { eager: true })

export const dspFactories: Record<string, DSPFactory> = {}
for (const mod of Object.values(modules)) {
  const list = Array.isArray(mod.default) ? mod.default : [mod.default]
  for (const f of list) if (f && f.id) dspFactories[f.id] = f
}
