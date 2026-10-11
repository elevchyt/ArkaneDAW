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
  /** Audio clip focus: slice / resize edits land on the nearest zero crossing. */
  zeroCross: boolean
  /** Audio clip focus: dragging an audio clip's edge time-stretches it instead of trimming. */
  stretch: boolean
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
  zeroCross: false,
  stretch: false,
  set: (patch) => set(patch)
}))

export const getPl = () => usePlaylist.getState()

/** Snap actually in effect. */
export function effectiveSnap(): Snap {
  const s = usePlaylist.getState().snap
  return s === 'main' ? useUI.getState().globalSnap : s
}

export const MIN_VZOOM = 0.3
export const MAX_VZOOM = 4

/** Change the track height zoom, keeping the content at `anchorY` (px from the grid top) in place. */
export function setTrackZoom(vZoom: number, anchorY = 0): void {
  const s = usePlaylist.getState()
  const nz = Math.min(MAX_VZOOM, Math.max(MIN_VZOOM, vZoom))
  if (nz === s.vZoom) return
  s.set({ vZoom: nz, scrollY: Math.max(0, (s.scrollY + anchorY) * (nz / s.vZoom) - anchorY) })
  useUI.getState().setHint(`Track height: ${Math.round(nz * 100)}%`)
}

export function toggleZeroCross(): void {
  const on = !usePlaylist.getState().zeroCross
  usePlaylist.getState().set({ zeroCross: on })
  useUI.getState().setHint(`Zero-cross ${on ? 'on' : 'off'}: audio clip slices and trims ${on ? 'snap to the nearest zero crossing' : 'land exactly on the grid'}`)
}

export function toggleStretch(): void {
  const on = !usePlaylist.getState().stretch
  usePlaylist.getState().set({ stretch: on })
  useUI.getState().setHint(`Stretch ${on ? 'on: dragging an audio clip edge time-stretches it' : 'off: dragging an audio clip edge trims it'}`)
}

export function setSelection(ids: Iterable<string>): void {
  usePlaylist.getState().set({ selected: new Set(ids) })
}

/** Size of the clip grid in px (written by the Grid's ResizeObserver; read by key handlers). */
export const viewport = { w: 800, h: 400 }

/** Last mouse position over the grid (Insert = slice at cursor). */
export const mouse = { tick: 0, track: 0, inside: false }
