import { useUI } from '@/store/ui'
import { getProject } from '@/store/project'

/** Show the piano roll for a channel (F7 / channel context menu). */
export function openPianoRoll(channelId?: string): void {
  const ui = useUI.getState()
  const id = channelId ?? ui.pianoRollChannel ?? ui.selectedChannels[0] ?? getProject().channels[0]?.id ?? null
  ui.set({ pianoRollChannel: id })
  ui.openWindow('pianoRoll', { kind: 'pianoRoll', title: 'Piano roll' })
}
