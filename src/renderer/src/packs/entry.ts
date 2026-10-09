// Pack info attached to plugin catalogue entries (menus show a download badge for not-installed packs).
import { packForPlugin } from './registry'
import { isUsable, type PackStatus } from './status'

export interface EntryPack {
  id: string
  installed: boolean
  sizeBytes: number
}

/**
 * Pack info for a plugin entry, or undefined when the plugin needs no pack or packs can't be downloaded here
 * (browser mode / old main process — the plugin then behaves as before). Unknown status counts as installed
 * so menus don't flash a badge before the first disk check.
 */
export function entryPack(pluginId: string, status: Record<string, PackStatus>, supported: boolean): EntryPack | undefined {
  const def = packForPlugin(pluginId)
  if (!def || !supported) return undefined
  const st = status[def.id]
  return { id: def.id, installed: !st || st.state === 'unknown' || isUsable(st), sizeBytes: def.sizeBytes }
}
