// UI-side plugin registry (main thread). Collects plugins/<id>/index.tsx.
// Plugins load individually at startup (loadPlugins), so one broken plugin is skipped and logged
// instead of taking the whole app down.
import type { PluginModule } from './sdk/module'

const loaders = import.meta.glob<{ default: PluginModule | PluginModule[] }>('./*/index.tsx')

export const pluginModules: Record<string, PluginModule> = {}
export const pluginLoadErrors: Record<string, string> = {}

let loading: Promise<void> | null = null

export function loadPlugins(): Promise<void> {
  if (!loading) {
    loading = Promise.allSettled(
      Object.entries(loaders).map(async ([path, load]) => {
        try {
          const mod = await load()
          const list = Array.isArray(mod.default) ? mod.default : [mod.default]
          for (const m of list) if (m?.manifest?.id) pluginModules[m.manifest.id] = m
        } catch (e) {
          pluginLoadErrors[path] = String(e)
          console.error(`[plugins] failed to load ${path}`, e)
        }
      })
    ).then(() => undefined)
  }
  return loading
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
