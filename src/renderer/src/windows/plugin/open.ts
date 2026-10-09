import { useUI } from '@/store/ui'
import { getProject } from '@/store/project'
import { getPlugin } from '@/plugins/registry'

const CHROME_H = 22 + 26 // title + preset strip

function size(pluginId: string | undefined): { w: number; h: number } {
  const m = pluginId ? getPlugin(pluginId) : undefined
  const s = m?.editorSize ?? { width: 560, height: 300 }
  return { w: s.width + 2, h: s.height + CHROME_H + 2 }
}

/** Open (or focus) an instrument channel's plugin window. */
export function openChannelPlugin(channelId: string): void {
  const ch = getProject().channels.find((c) => c.id === channelId)
  if (!ch) return
  const { w, h } = size(ch.plugin?.pluginId)
  useUI.getState().openWindow(`plugin:${channelId}`, { kind: 'plugin', title: ch.name, channelId, w, h })
}

export function toggleChannelPlugin(channelId: string): void {
  const ui = useUI.getState()
  const id = `plugin:${channelId}`
  if (ui.windows[id]?.open && ui.focused === id) ui.closeWindow(id)
  else openChannelPlugin(channelId)
}

/** Open (or focus) a mixer effect slot's plugin window. */
export function openFxPlugin(track: number, slot: number): void {
  const s = getProject().mixer[track]?.slots[slot]
  if (!s) return
  const mod = getPlugin(s.plugin.pluginId)
  const { w, h } = size(s.plugin.pluginId)
  const t = getProject().mixer[track]
  useUI.getState().openWindow(`fx:${track}:${slot}`, {
    kind: 'plugin',
    title: `${mod?.manifest.name ?? s.plugin.pluginId} (${t.name})`,
    mixerTrack: track,
    slot,
    w,
    h
  })
}
