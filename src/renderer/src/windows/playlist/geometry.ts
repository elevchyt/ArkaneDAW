// Pure layout / snapping / hit-testing helpers for the Playlist. No DOM, no stores.
import { PPQ, TICKS_PER_STEP, type Clip } from '@/store/types'
import type { Snap } from '@/store/ui'

/** Viewport of the clip grid. Horizontal position is in ticks so zooming keeps a stable anchor. */
export interface View {
  scrollTick: number // tick at the left edge of the grid
  ppt: number // pixels per tick
  scrollY: number // px
  vZoom: number // multiplier for track heights
}

export const MIN_PPT = 0.004
export const MAX_PPT = 2.5
export const MIN_TRACK_H = 16
export const MAX_TRACK_H = 400

export const clampPpt = (ppt: number): number => Math.min(MAX_PPT, Math.max(MIN_PPT, ppt))

export const tickToX = (v: View, tick: number): number => (tick - v.scrollTick) * v.ppt
export const xToTick = (v: View, x: number): number => v.scrollTick + x / v.ppt

/**
 * Spacing (ticks) of the finest grid line visible at this zoom: FL's "Line" snap.
 * Candidates go from 1/4 step up to many bars; the first one at least `minPx` wide wins.
 */
export function lineTicks(ppt: number, bar: number, minPx = 9): number {
  const beat = PPQ
  const cands = [TICKS_PER_STEP / 4, TICKS_PER_STEP / 2, TICKS_PER_STEP, beat, beat * 2, bar, bar * 2, bar * 4, bar * 8, bar * 16, bar * 32, bar * 64]
  for (const c of cands) if (c * ppt >= minPx) return c
  return cands[cands.length - 1]
}

/** Resolve a snap setting to a grid size in ticks (1 = free). `snap` must not be 'main'. */
export function snapTicks(snap: Snap, ppt: number, bar: number): number {
  const beat = PPQ
  switch (snap) {
    case 'none':
      return 1
    case 'line':
    case 'cell':
    case 'main':
      return lineTicks(ppt, bar)
    case '1/6step':
      return TICKS_PER_STEP / 6
    case '1/4step':
      return TICKS_PER_STEP / 4
    case '1/3step':
      return TICKS_PER_STEP / 3
    case '1/2step':
      return TICKS_PER_STEP / 2
    case 'step':
      return TICKS_PER_STEP
    case '1/6beat':
      return beat / 6
    case '1/4beat':
      return beat / 4
    case '1/3beat':
      return beat / 3
    case '1/2beat':
      return beat / 2
    case 'beat':
      return beat
    case 'bar':
      return bar
  }
}

export function snapRound(t: number, grid: number): number {
  return grid <= 1 ? Math.round(t) : Math.round(t / grid) * grid
}

export function snapFloor(t: number, grid: number): number {
  return grid <= 1 ? Math.floor(t) : Math.floor(t / grid) * grid
}

/** Cumulative track tops (px, at vZoom). Length n+1; last entry = total height. */
export function trackOffsets(heights: readonly number[], vZoom: number): Float64Array {
  const out = new Float64Array(heights.length + 1)
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + Math.max(MIN_TRACK_H, Math.round(heights[i] * vZoom))
  return out
}

/** Track index at content-space y (binary search). Clamped to [0, n-1]. */
export function trackAtY(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1
  if (y <= 0) return 0
  if (y >= offsets[n]) return n - 1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Topmost clip (last in draw order) under a tick on a track. */
export function clipAt(clips: readonly Clip[], tick: number, track: number): Clip | null {
  for (let i = clips.length - 1; i >= 0; i--) {
    const c = clips[i]
    if (c.track === track && tick >= c.start && tick < c.start + c.length) return c
  }
  return null
}

/** Clips overlapping a tick range on tracks [tr0, tr1]. */
export function clipsInRect(clips: readonly Clip[], t0: number, t1: number, tr0: number, tr1: number): Clip[] {
  const a = Math.min(t0, t1)
  const b = Math.max(t0, t1)
  const lo = Math.min(tr0, tr1)
  const hi = Math.max(tr0, tr1)
  return clips.filter((c) => c.track >= lo && c.track <= hi && c.start < b && c.start + c.length > a)
}

export type Zone = 'left' | 'right' | 'header' | 'body'

export const HEADER_H = 13
export const EDGE_PX = 6

/** Height of a clip's title strip given the track's pixel height. */
export const headerHeight = (trackH: number): number => (trackH >= 26 ? HEADER_H : 0)

/**
 * Which part of a clip a point hits. `px`/`py` are relative to the clip's top-left,
 * `w`/`h` its pixel size. Edges are only offered when the clip is wide enough.
 */
export function hitZone(px: number, py: number, w: number, h: number): Zone {
  const edge = Math.min(EDGE_PX, w / 4)
  if (w >= 10) {
    if (px >= w - edge) return 'right'
    if (px < edge) return 'left'
  }
  const hh = headerHeight(h)
  if (hh > 0 && py < hh) return 'header'
  return 'body'
}

/** Ticks -> horizontal zoom so `span` ticks fill `width` px. */
export const fitPpt = (span: number, width: number): number => clampPpt(width / Math.max(1, span))

/** Zoom around an anchor x (px): keeps the tick under the anchor fixed. */
export function zoomAround(v: View, anchorX: number, factor: number): Pick<View, 'ppt' | 'scrollTick'> {
  const anchorTick = xToTick(v, anchorX)
  const ppt = clampPpt(v.ppt * factor)
  return { ppt, scrollTick: Math.max(0, anchorTick - anchorX / ppt) }
}

/** Bar label like FL (1-based). */
export const barLabel = (tick: number, bar: number): string => String(Math.floor(tick / bar) + 1)

/** "bar:step:tick" song position for hints. */
export function formatPos(tick: number, bar: number): string {
  const b = Math.floor(tick / bar) + 1
  const inBar = tick - (b - 1) * bar
  const step = Math.floor(inBar / TICKS_PER_STEP) + 1
  const t = Math.round(inBar % TICKS_PER_STEP)
  return `${b}:${String(step).padStart(2, '0')}:${String(t).padStart(2, '0')}`
}
