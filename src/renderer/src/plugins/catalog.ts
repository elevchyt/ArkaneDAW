// One list of everything that can go in a channel or an FX slot: built-in plugins + scanned
// VST3/VST2/CLAP plugins. Pickers, menus and the browser use this so external plugins show up everywhere.
import { listPlugins, getPlugin } from './registry'
import { getExternalPluginInfo, listExternalPlugins, useExternalPlugins, type ExternalPluginInfo } from '../audio/vst'

export interface PluginEntry {
  id: string
  name: string
  kind: 'instrument' | 'effect'
  /** grouping label for menus */
  category: string
  description?: string
  color?: string
  external: boolean
  favorite?: boolean
}

function fromExternal(p: ExternalPluginInfo): PluginEntry {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    category: `${p.format.toUpperCase()}${p.vendor ? ` · ${p.vendor}` : ''}`,
    description: `${p.vendor} ${p.category}`.trim(),
    external: true,
    favorite: p.favorite
  }
}

function builtins(kind?: 'instrument' | 'effect'): PluginEntry[] {
  return listPlugins(kind).map((m) => ({
    id: m.manifest.id,
    name: m.manifest.name,
    kind: m.manifest.kind,
    category: m.manifest.category,
    description: m.manifest.description,
    color: m.manifest.color,
    external: false
  }))
}

/** Non-reactive list (menus built on open). */
export function allPlugins(kind?: 'instrument' | 'effect'): PluginEntry[] {
  return [...builtins(kind), ...listExternalPlugins(kind).map(fromExternal)]
}

/** Reactive list: re-renders when the VST catalogue changes (scan finished). */
export function useAllPlugins(kind?: 'instrument' | 'effect'): PluginEntry[] {
  const ext = useExternalPlugins(kind)
  return [...builtins(kind), ...ext.map(fromExternal)]
}

/** Categories in display order: built-in groups alphabetically, then external formats/vendors. */
export function groupPlugins(list: PluginEntry[]): [string, PluginEntry[]][] {
  const map = new Map<string, PluginEntry[]>()
  for (const p of list) {
    if (!map.has(p.category)) map.set(p.category, [])
    map.get(p.category)!.push(p)
  }
  const keys = [...map.keys()].sort((a, b) => {
    const ea = map.get(a)![0].external
    const eb = map.get(b)![0].external
    return ea === eb ? a.localeCompare(b) : ea ? 1 : -1
  })
  return keys.map((k) => [k, map.get(k)!.sort((a, b) => a.name.localeCompare(b.name))])
}

/** Display name for any plugin id. */
export function pluginName(id: string): string {
  return getPlugin(id)?.manifest.name ?? getExternalPluginInfo(id)?.name ?? id.split(/[/:]/).pop() ?? id
}
