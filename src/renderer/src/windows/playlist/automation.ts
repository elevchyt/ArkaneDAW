// Pure automation-point editing helpers (FL-style: points + per-segment tension handle).
import type { Automation, AutomationPoint } from '@/store/types'
import { automationValue } from '@/audio/sequence'

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x))

export function makePoint(t: number, v: number): AutomationPoint {
  return { t: Math.max(0, Math.round(t)), v: clamp(v, 0, 1), tension: 0, mode: 'single' }
}

/** Insert a point keeping time order. Returns the new array and the inserted index. */
export function addPoint(points: readonly AutomationPoint[], t: number, v: number): { points: AutomationPoint[]; index: number } {
  const p = makePoint(t, v)
  let i = 0
  while (i < points.length && points[i].t <= p.t) i++
  const out = [...points.slice(0, i), p, ...points.slice(i)]
  return { points: out, index: i }
}

/** Move a point; time is clamped between its neighbours, value to 0..1. */
export function movePoint(points: readonly AutomationPoint[], i: number, t: number, v: number): AutomationPoint[] {
  const lo = i > 0 ? points[i - 1].t : 0
  const hi = i < points.length - 1 ? points[i + 1].t : Infinity
  const out = points.slice()
  out[i] = { ...points[i], t: clamp(Math.round(t), lo, hi), v: clamp(v, 0, 1) }
  return out
}

/** Delete a point (the last remaining point is kept). */
export function removePoint(points: readonly AutomationPoint[], i: number): AutomationPoint[] {
  if (points.length <= 1 || i < 0 || i >= points.length) return points as AutomationPoint[]
  return [...points.slice(0, i), ...points.slice(i + 1)]
}

/** Set the tension of the segment that ends at point `i`. */
export function setTension(points: readonly AutomationPoint[], i: number, tension: number): AutomationPoint[] {
  if (i <= 0 || i >= points.length) return points as AutomationPoint[]
  const out = points.slice()
  out[i] = { ...points[i], tension: clamp(tension, -1, 1) }
  return out
}

/**
 * Tension change for a vertical handle drag of `dyPx` (down = positive) over a lane `h` px tall.
 * Dragging down always bends the curve down, whichever direction the segment goes.
 */
export function tensionFromDrag(orig: number, dyPx: number, h: number, p0: AutomationPoint, p1: AutomationPoint): number {
  const rising = p1.v >= p0.v
  return clamp(orig + ((dyPx / Math.max(20, h)) * 2.5) * (rising ? 1 : -1), -1, 1)
}

export type Mapper = { toX: (t: number) => number; toY: (v: number) => number }

/** Index of the point within `r` px of (x, y), or -1. Last (topmost) wins. */
export function hitPoint(points: readonly AutomationPoint[], m: Mapper, x: number, y: number, r = 6): number {
  for (let i = points.length - 1; i >= 0; i--) {
    const dx = m.toX(points[i].t) - x
    const dy = m.toY(points[i].v) - y
    if (dx * dx + dy * dy <= r * r) return i
  }
  return -1
}

/** Position of the tension handle for the segment ending at `i` (midway in time, on the curve). */
export function handlePos(a: Pick<Automation, 'points'>, i: number): { t: number; v: number } {
  const p0 = a.points[i - 1]
  const p1 = a.points[i]
  const t = (p0.t + p1.t) / 2
  return { t, v: automationValue(a as Automation, t) }
}

/** Segment index (1..n-1) whose tension handle is under (x, y), or -1. */
export function hitHandle(a: Pick<Automation, 'points'>, m: Mapper, x: number, y: number, r = 5): number {
  for (let i = 1; i < a.points.length; i++) {
    if (a.points[i].t - a.points[i - 1].t < 2) continue
    const h = handlePos(a, i)
    const dx = m.toX(h.t) - x
    const dy = m.toY(h.v) - y
    if (dx * dx + dy * dy <= r * r) return i
  }
  return -1
}

/** Segment index (1..n-1) containing time t, or -1. */
export function segmentAt(points: readonly AutomationPoint[], t: number): number {
  for (let i = 1; i < points.length; i++) if (t >= points[i - 1].t && t < points[i].t) return i
  return -1
}
