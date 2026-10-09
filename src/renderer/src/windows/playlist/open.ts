import { useUI } from '@/store/ui'
import { getPl } from './state'

/** Double-click a pattern clip: make it current and show it in the Channel rack (FL behaviour). */
export function openPatternEditor(patternId: string): void {
  const ui = useUI.getState()
  ui.set({ currentPattern: patternId })
  getPl().set({ source: { kind: 'pattern', ref: patternId } })
  ui.openWindow('channelRack', { kind: 'channelRack', title: 'Channel rack' })
}
