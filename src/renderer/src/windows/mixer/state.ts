// Mixer-only view state (not part of the project, not undoable).
import { create } from 'zustand'

export type StripLayout = 'narrow' | 'wide'

interface MixerViewState {
  layout: StripLayout
  /** Extra selected tracks (Ctrl/Shift multi-select). `useUI.selectedMixerTrack` is the current one. */
  multi: number[]
  /** Track whose name is being edited inline. */
  renaming: number | null
  /** Show the track inspector (right panel). */
  inspector: boolean
  /** Show routing cables. */
  cables: boolean
  set: (p: Partial<MixerViewState>) => void
}

export const useMixerView = create<MixerViewState>((set) => ({
  layout: 'narrow',
  multi: [],
  renaming: null,
  inspector: true,
  cables: true,
  set: (p) => set(p)
}))

export const STRIP_W: Record<StripLayout, number> = { narrow: 32, wide: 46 }
export const MASTER_W: Record<StripLayout, number> = { narrow: 42, wide: 58 }
/** Width of the right-hand track inspector. */
export const PANEL_W = 300
export const DEFAULT_TRACK_COLOR = '#5c676d'

/** FL-ish mixer track palette (Rename/color dialog swatches). */
export const TRACK_COLORS = [
  '#5c676d', '#6d8aa0', '#5f86b3', '#7d6e9c', '#a65fb3', '#9c6e8b', '#b35f86', '#b36a5f',
  '#a37a52', '#b3a05f', '#8e9c6e', '#86b35f', '#6e9c7d', '#5fb3a6', '#6e8e9c', '#7f8f98'
]

/** Fixed vertical space of a strip besides the name/meter and fader zones (see Strip layout):
 *  number 14 + color 2 + mute 14 + pan 22 + phase/swap 13 + sep 18 + fx/pdc 13 + arm 12 + route 30 + padding 6 */
export const STRIP_FIXED_H = 14 + 2 + 14 + 22 + 13 + 18 + 13 + 12 + 30 + 6

/** Split the strip's free height between the name/meter area (top) and the fader. */
export function stripSplit(stripH: number): { nameH: number; faderH: number } {
  const free = Math.max(90, stripH - STRIP_FIXED_H)
  const nameH = Math.max(36, Math.round(free * 0.4))
  return { nameH, faderH: free - nameH }
}
