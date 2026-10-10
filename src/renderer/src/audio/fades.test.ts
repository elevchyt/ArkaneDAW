import { describe, expect, it } from 'vitest'
import type { Clip } from '../store/types'
import { autoCrossfade, clampFades, clipGainAt, fadeShape, scheduleClipFades, splitFades } from './fades'
import { sliceClip, chopClip } from '../windows/playlist/ops'
import { fadeZone } from '../windows/playlist/geometry'

const clip = (o: Partial<Clip> = {}): Clip => ({ id: 'a', kind: 'audio', ref: 's', track: 0, start: 0, length: 384, offset: 0, muted: false, ...o })

describe('fade shape', () => {
  it('is linear at tension 0 and bends with tension', () => {
    expect(fadeShape(0)).toBe(0)
    expect(fadeShape(1)).toBe(1)
    expect(fadeShape(0.5)).toBeCloseTo(0.5)
    expect(fadeShape(0.5, 1)).toBeGreaterThan(0.75) // fast start
    expect(fadeShape(0.5, -1)).toBeLessThan(0.1) // slow start
  })

  it('applies fade-in and fade-out gains along the clip', () => {
    const c = clip({ fadeIn: 96, fadeOut: 96 })
    expect(clipGainAt(c, 0)).toBe(0)
    expect(clipGainAt(c, 48)).toBeCloseTo(0.5)
    expect(clipGainAt(c, 192)).toBe(1)
    expect(clipGainAt(c, 384 - 48)).toBeCloseTo(0.5)
    expect(clipGainAt(c, 384)).toBe(0)
    expect(clipGainAt(clip(), 0)).toBe(1)
  })
})

describe('fade bookkeeping', () => {
  it('keeps fades inside the clip', () => {
    const c = clampFades(clip({ length: 100, fadeIn: 80, fadeOut: 80 }))
    expect(c.fadeIn! + c.fadeOut!).toBeLessThanOrEqual(100)
    expect(clampFades(clip())).toEqual(clip())
  })

  it('crossfades a clip moved onto another on the same track', () => {
    const a = clip({ id: 'a', start: 0, length: 384 })
    const b = clip({ id: 'b', start: 1000, length: 384 })
    const moved = { ...b, start: 300 }
    const out = autoCrossfade([a, b], [a, moved])
    expect(out.find((c) => c.id === 'a')!.fadeOut).toBe(84)
    expect(out.find((c) => c.id === 'b')!.fadeIn).toBe(84)
    // other track / no overlap / untouched clips: nothing happens
    expect(autoCrossfade([a, b], [a, { ...b, start: 300, track: 1 }]).some((c) => c.fadeIn || c.fadeOut)).toBe(false)
    expect(autoCrossfade([a, b], [a, b])).toEqual([a, b])
    // pattern clips never crossfade
    const pat = { ...moved, kind: 'pattern' as const }
    expect(autoCrossfade([a, b], [a, pat]).some((c) => c.fadeOut)).toBe(false)
  })

  it('slicing keeps the outer fades and drops the ones at the cut', () => {
    const c = clip({ fadeIn: 50, fadeOut: 60 })
    const [l, r] = sliceClip(c, 200)!
    expect(l.fadeIn).toBe(50)
    expect(l.fadeOut).toBe(0)
    expect(r.fadeIn).toBe(0)
    expect(r.fadeOut).toBe(60)
    const parts = chopClip(c, 96)
    expect(parts[0].fadeIn).toBe(50)
    expect(parts[0].fadeOut).toBe(0)
    expect(parts[parts.length - 1].fadeOut).toBe(60)
    expect(parts[1].fadeIn).toBe(0)
    expect(splitFades(clip(), clip())).toEqual([clip(), clip()])
  })
})

describe('fade scheduling', () => {
  it('writes a value then non-overlapping curves for both fades', () => {
    const calls: { m: string; t: number; d?: number }[] = []
    const param = {
      setValueAtTime: (_v: number, t: number) => calls.push({ m: 'set', t }),
      setValueCurveAtTime: (_c: Float32Array, t: number, d: number) => calls.push({ m: 'curve', t, d })
    } as unknown as AudioParam
    const tps = 208 // 130 bpm
    scheduleClipFades(param, clip({ fadeIn: 192, fadeOut: 192 }), 1, 0, tps)
    const curves = calls.filter((c) => c.m === 'curve')
    expect(calls[0].m).toBe('set')
    expect(curves).toHaveLength(2)
    expect(curves[1].t).toBeGreaterThan(curves[0].t + curves[0].d!)
    // starting halfway through the fade-in only schedules what is left of it
    calls.length = 0
    scheduleClipFades(param, clip({ fadeIn: 192 }), 5, 96, tps)
    expect(calls.filter((c) => c.m === 'curve')[0].d).toBeCloseTo(96 / tps)
  })
})

describe('fade handles', () => {
  it('hits the corner handles and the curve tension dots', () => {
    const c = clip({ fadeIn: 96, fadeOut: 96 })
    // clip 384 px wide (ppt 1), 60 px tall in a 62 px track (13 px title strip)
    expect(fadeZone(c, 96, 17, 384, 60, 62, 1)).toBe('fadeIn')
    expect(fadeZone(c, 288, 17, 384, 60, 62, 1)).toBe('fadeOut')
    const midY = 13 + 47 - 0.5 * 47
    expect(fadeZone(c, 48, midY, 384, 60, 62, 1)).toBe('fadeInCurve')
    expect(fadeZone(c, 192, 40, 384, 60, 62, 1)).toBeNull()
    expect(fadeZone({ ...c, kind: 'pattern' }, 96, 17, 384, 60, 62, 1)).toBeNull()
    // no fades yet: the handles sit at the corners
    expect(fadeZone(clip(), 2, 17, 384, 60, 62, 1)).toBe('fadeIn')
    expect(fadeZone(clip(), 382, 17, 384, 60, 62, 1)).toBe('fadeOut')
  })
})
