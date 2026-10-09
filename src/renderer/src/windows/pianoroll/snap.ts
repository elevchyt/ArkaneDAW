// Pure snap helpers shared by the piano roll renderer (grid line density) and editing (quantization).
import type { Snap } from '@/store/ui'

const PPQ = 96
const STEP = PPQ / 4

export const beatOf = (timeSig: [number, number]): number => (PPQ * 4) / timeSig[1]
export const barOf = (timeSig: [number, number]): number => beatOf(timeSig) * timeSig[0]

/**
 * Tick spacing of the finest visible grid lines at a zoom level (px per tick).
 * Lines are never drawn closer than `minPx` pixels apart.
 */
export function gridLineTicks(pxPerTick: number, timeSig: [number, number], minPx = 10): number {
  const beat = beatOf(timeSig)
  const bar = barOf(timeSig)
  const cands = [1, 2, 3, 6, 12, STEP, 48, beat].filter((t) => t <= bar && bar % t === 0)
  cands.push(bar, bar * 2, bar * 4, bar * 8, bar * 16, bar * 32, bar * 64)
  const sorted = [...new Set(cands)].sort((a, b) => a - b)
  for (const t of sorted) if (t * pxPerTick >= minPx) return t
  return sorted[sorted.length - 1]
}

/**
 * Resolve a snap setting to a grid size in ticks. 0 means "no snap".
 * 'main' follows the global snap; 'line' (and the playlist-only 'cell') adapts to zoom.
 */
export function snapTicks(snap: Snap, pxPerTick: number, timeSig: [number, number], globalSnap: Snap = 'line'): number {
  const beat = beatOf(timeSig)
  switch (snap) {
    case 'main':
      return globalSnap === 'main' ? gridLineTicks(pxPerTick, timeSig) : snapTicks(globalSnap, pxPerTick, timeSig, 'line')
    case 'line':
    case 'cell':
      return gridLineTicks(pxPerTick, timeSig)
    case 'none':
      return 0
    case '1/6step':
      return STEP / 6
    case '1/4step':
      return STEP / 4
    case '1/3step':
      return STEP / 3
    case '1/2step':
      return STEP / 2
    case 'step':
      return STEP
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
      return barOf(timeSig)
  }
}

export function snapFloor(t: number, grid: number): number {
  if (grid <= 0) return Math.round(t)
  return Math.floor(t / grid + 1e-9) * grid
}

export function snapRound(t: number, grid: number): number {
  if (grid <= 0) return Math.round(t)
  return Math.round(t / grid) * grid
}

export function snapCeil(t: number, grid: number): number {
  if (grid <= 0) return Math.round(t)
  return Math.ceil(t / grid - 1e-9) * grid
}
