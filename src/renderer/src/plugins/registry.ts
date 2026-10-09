// UI-side plugin registry (main thread). Collects plugins/<id>/index.tsx.
import type { PluginModule } from './sdk/module'

const modules = import.meta.glob<{ default: PluginModule | PluginModule[] }>('./*/index.tsx', { eager: true })

export const pluginModules: Record<string, PluginModule> = {}
for (const mod of Object.values(modules)) {
  const list = Array.isArray(mod.default) ? mod.default : [mod.default]
  for (const m of list) if (m?.manifest?.id) pluginModules[m.manifest.id] = m
}

export function getPlugin(id: string): PluginModule | undefined {
  return pluginModules[id]
}

export function listPlugins(kind?: 'instrument' | 'effect'): PluginModule[] {
  return Object.values(pluginModules)
    .filter((m) => !kind || m.manifest.kind === kind)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
}

const wasmCache = new Map<string, Promise<WebAssembly.Module>>()
export function getWasm(id: string): Promise<WebAssembly.Module | undefined> {
  const m = pluginModules[id]
  if (!m?.loadWasm) return Promise.resolve(undefined)
  if (!wasmCache.has(id)) wasmCache.set(id, m.loadWasm())
  return wasmCache.get(id)!
}
