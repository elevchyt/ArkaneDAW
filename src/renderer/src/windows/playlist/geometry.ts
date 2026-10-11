// Pure layout / snapping / hit-testing helpers for the Playlist. No DOM, no stores.
import { PPQ, TICKS_PER_STEP, type Clip } from '@/store/types'
import { fadeIn, fadeOut, fadeShape } from '@/audio/fades'
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
export function lineTicks(ppt: number, bar: number, minPx = 9, beat = PPQ): number {
  // below a bar only spacings that divide the bar (3/4: no half-bar lines)
  const sub = [TICKS_PER_STEP / 4, TICKS_PER_STEP / 2, TICKS_PER_STEP, beat, beat * 2].filter((t) => t < bar && bar % t === 0)
  const cands = [...sub, bar, bar * 2, bar * 4, bar * 8, bar * 16, bar * 32, bar * 64]
  for (const c of cands) if (c * ppt >= minPx) return c
  return cands[cands.length - 1]
}

/** Resolve a snap setting to a grid size in ticks (1 = free). `snap` must not be 'main'. */
export function snapTicks(snap: Snap, ppt: number, bar: number, beat = PPQ): number {
  switch (snap) {
    case 'none':
      return 1
    case 'line':
    case 'cell':
    case 'main':
      return lineTicks(ppt, bar, 9, beat)
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

export type Zone = 'left' | 'right' | 'header' | 'body' | FadeZone
export type FadeZone = 'fadeIn' | 'fadeOut' | 'fadeInCurve' | 'fadeOutCurve'

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

// ── audio clip fades ─────────────────────────────────────────────────────────
/** Fade handles sit at the top corners of the clip body (below the title strip, clear of the menu arrow). */
export const FADE_HANDLE_PX = 6

export interface FadeGeom {
  /** body top / height (local px) the fade curves span */
  top: number
  height: number
  inX: number
  outX: number
  handleY: number
  /** curve middle points (tension handles), null when the fade is too short to grab */
  inMid: { x: number; y: number } | null
  outMid: { x: number; y: number } | null
}

/** Local-px layout of an audio clip's fades. `w`/`h` = clip size, `th` = track height, `ppt` = px per tick. */
export function fadeGeom(c: Clip, w: number, h: number, th: number, ppt: number): FadeGeom {
  const top = headerHeight(th)
  const height = Math.max(1, h - top)
  const fi = Math.min(w, fadeIn(c) * ppt)
  const fo = Math.min(w, fadeOut(c) * ppt)
  const midY = (g: number) => top + height - g * height
  return {
    top,
    height,
    inX: fi,
    outX: w - fo,
    handleY: top + FADE_HANDLE_PX / 2 + 1,
    inMid: fi >= 14 ? { x: fi / 2, y: midY(fadeShape(0.5, c.fadeInTension ?? 0)) } : null,
    outMid: fo >= 14 ? { x: w - fo / 2, y: midY(fadeShape(0.5, c.fadeOutTension ?? 0)) } : null
  }
}

/** Which fade handle (if any) a local point hits on an audio clip wide/tall enough to show them. */
export function fadeZone(c: Clip, px: number, py: number, w: number, h: number, th: number, ppt: number): FadeZone | null {
  if (c.kind !== 'audio' || w < 16 || h - headerHeight(th) < 10) return null
  const g = fadeGeom(c, w, h, th, ppt)
  const near = (x: number, y: number, r: number) => Math.abs(px - x) <= r && Math.abs(py - y) <= r
  if (g.inMid && near(g.inMid.x, g.inMid.y, 5)) return 'fadeInCurve'
  if (g.outMid && near(g.outMid.x, g.outMid.y, 5)) return 'fadeOutCurve'
  // with both handles at the same spot (fades meet), grab the one on the side of the pointer
  const dIn = Math.abs(px - Math.max(g.inX, FADE_HANDLE_PX / 2))
  const dOut = Math.abs(px - Math.min(g.outX, w - FADE_HANDLE_PX / 2))
  if (Math.abs(py - g.handleY) > 6) return null
  if (dIn <= 6 && (dIn < dOut || (dIn === dOut && px < w / 2))) return 'fadeIn'
  if (dOut <= 6) return 'fadeOut'
  return null
}
