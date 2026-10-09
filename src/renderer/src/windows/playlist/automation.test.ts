import { describe, expect, it } from 'vitest'
import { addPoint, handlePos, hitHandle, hitPoint, movePoint, removePoint, segmentAt, setTension, tensionFromDrag, makePoint } from './automation'

const pts = [makePoint(0, 0), makePoint(100, 1), makePoint(200, 0.5)]
const m = { toX: (t: number) => t, toY: (v: number) => 100 - v * 100 }

describe('automation editing', () => {
  it('adds points in order', () => {
    const { points, index } = addPoint(pts, 150, 0.2)
    expect(index).toBe(2)
    expect(points.map((p) => p.t)).toEqual([0, 100, 150, 200])
  })
  it('moves within neighbours', () => {
    expect(movePoint(pts, 1, 500, 2)[1]).toMatchObject({ t: 200, v: 1 })
    expect(movePoint(pts, 1, -5, -1)[1]).toMatchObject({ t: 0, v: 0 })
  })
  it('removes but keeps one', () => {
    expect(removePoint(pts, 1)).toHaveLength(2)
    expect(removePoint([pts[0]], 0)).toHaveLength(1)
  })
  it('tension', () => {
    expect(setTension(pts, 1, 3)[1].tension).toBe(1)
    expect(setTension(pts, 0, 0.5)).toBe(pts)
    expect(tensionFromDrag(0, 50, 100, pts[0], pts[1])).toBeGreaterThan(0)
    expect(tensionFromDrag(0, 50, 100, pts[1], pts[2])).toBeLessThan(0)
  })
  it('hit tests points and handles', () => {
    expect(hitPoint(pts, m, 101, 1)).toBe(1)
    expect(hitPoint(pts, m, 50, 50)).toBe(-1)
    const h = handlePos({ points: pts }, 1)
    expect(h.t).toBe(50)
    expect(h.v).toBeCloseTo(0.5)
    expect(hitHandle({ points: pts }, m, 50, 50)).toBe(1)
    expect(segmentAt(pts, 150)).toBe(2)
    expect(segmentAt(pts, 250)).toBe(-1)
  })
})
