import { useUI } from '@/store/ui'
import { editProject, getProject } from '@/store/project'
import { newPluginState } from '@/store/actions'
import { getPlugin } from '@/plugins/registry'
import { pluginName } from '@/plugins/catalog'

const CHROME_H = 22 + 26 // title + preset strip

function size(pluginId: string | undefined): { w: number; h: number } {
  const m = pluginId ? getPlugin(pluginId) : undefined
  const s = m?.editorSize ?? { width: 560, height: 300 }
  return { w: s.width + 2, h: s.height + CHROME_H + 2 }
}

/**
 * Audio clip / recording channels start without a plugin. Like FL (where they are samplers too), they get a
 * Sampler playing their sample the first time their settings are opened.
 */
function ensureSampler(channelId: string): void {
  const ch = getProject().channels.find((c) => c.id === channelId)
  if (!ch || ch.plugin || !ch.sampler?.sampleId) return
  const state = newPluginState('sampler')
  state.data = { sampleId: ch.sampler.sampleId }
  editProject('Sampler settings', (d) => {
    const c = d.channels.find((x) => x.id === channelId)
    if (c && !c.plugin) c.plugin = state
  }, { undoable: false })
}

/** Open (or focus) an instrument channel's plugin window. */
export function openChannelPlugin(channelId: string): void {
  ensureSampler(channelId)
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
    title: `${pluginName(s.plugin.pluginId)} (${t.name})`,
    mixerTrack: track,
    slot,
    w,
    h
  })
}
