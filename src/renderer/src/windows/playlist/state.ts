// Playlist-local UI state (view, selection, picker, clip source). Not part of the project/undo.
import { create } from 'zustand'
import type { Clip, ClipKind } from '@/store/types'
import type { Snap } from '@/store/ui'
import { useUI } from '@/store/ui'

export interface ClipSource {
  kind: ClipKind
  ref: string
}

interface PlaylistState {
  scrollTick: number
  ppt: number
  scrollY: number
  vZoom: number
  picker: boolean
  snap: Snap // 'main' = follow global snap
  selected: ReadonlySet<string>
  /** Source used by Draw/Paint. null = current pattern. */
  source: ClipSource | null
  /** Time selection drawn on the ruler (ticks). */
  timeSel: { start: number; end: number } | null
  clipboard: Clip[] | null
  set: (patch: Partial<Omit<PlaylistState, 'set'>>) => void
}

export const usePlaylist = create<PlaylistState>((set) => ({
  scrollTick: 0,
  ppt: 0.12,
  scrollY: 0,
  vZoom: 1,
  picker: true,
  snap: 'main',
  selected: new Set(),
  source: null,
  timeSel: null,
  clipboard: null,
  set: (patch) => set(patch)
}))

export const getPl = () => usePlaylist.getState()

/** Snap actually in effect. */
export function effectiveSnap(): Snap {
  const s = usePlaylist.getState().snap
  return s === 'main' ? useUI.getState().globalSnap : s
}

export function setSelection(ids: Iterable<string>): void {
  usePlaylist.getState().set({ selected: new Set(ids) })
}

/** Size of the clip grid in px (written by the Grid's ResizeObserver; read by key handlers). */
export const viewport = { w: 800, h: 400 }

/** Last mouse position over the grid (Insert = slice at cursor). */
export const mouse = { tick: 0, track: 0, inside: false }
