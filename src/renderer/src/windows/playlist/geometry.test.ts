import { describe, expect, it } from 'vitest'
import { clipAt, clipsInRect, hitZone, lineTicks, snapFloor, snapRound, snapTicks, trackAtY, trackOffsets, zoomAround, formatPos } from './geometry'
import type { Clip } from '@/store/types'

const clip = (id: string, track: number, start: number, length: number): Clip => ({ id, kind: 'pattern', ref: 'p', track, start, length, offset: 0, muted: false })

describe('snapping', () => {
  it('resolves fixed snaps', () => {
    expect(snapTicks('bar', 1, 384)).toBe(384)
    expect(snapTicks('beat', 1, 384)).toBe(96)
    expect(snapTicks('step', 1, 384)).toBe(24)
    expect(snapTicks('1/2step', 1, 384)).toBe(12)
    expect(snapTicks('none', 1, 384)).toBe(1)
  })
  it('line snap adapts to zoom', () => {
    expect(lineTicks(1, 384)).toBe(12) // 12 px per half step
    expect(lineTicks(0.1, 384)).toBe(96) // beat = 9.6 px
    expect(lineTicks(0.02, 384)).toBe(768) // bar = 7.7 px -> 2 bars
    expect(snapTicks('line', 0.1, 384)).toBe(96)
  })
  it('follows the time signature', () => {
    // 3/4: no half-bar (2-beat) lines, they would not line up with the bars
    expect(lineTicks(0.06, 288)).toBe(288)
    expect(lineTicks(0.1, 288)).toBe(96)
    // 6/8: beats are eighths
    expect(snapTicks('beat', 1, 288, 48)).toBe(48)
    expect(lineTicks(0.2, 288, 9, 48)).toBe(48)
  })
  it('rounds and floors', () => {
    expect(snapRound(140, 96)).toBe(96)
    expect(snapRound(150, 96)).toBe(192)
    expect(snapFloor(190, 96)).toBe(96)
    expect(snapFloor(190.7, 1)).toBe(190)
  })
})

describe('tracks', () => {
  it('computes offsets and finds tracks', () => {
    const off = trackOffsets([50, 30, 40], 1)
    expect(Array.from(off)).toEqual([0, 50, 80, 120])
    expect(trackAtY(off, 0)).toBe(0)
    expect(trackAtY(off, 49)).toBe(0)
    expect(trackAtY(off, 50)).toBe(1)
    expect(trackAtY(off, 119)).toBe(2)
    expect(trackAtY(off, 500)).toBe(2)
    expect(trackAtY(off, -3)).toBe(0)
  })
  it('applies vertical zoom with minimum height', () => {
    const off = trackOffsets([50, 20], 0.5)
    expect(off[1]).toBe(25)
    expect(off[2]).toBe(25 + 16)
  })
})

describe('hit testing', () => {
  const clips = [clip('a', 0, 0, 384), clip('b', 0, 200, 384), clip('c', 1, 0, 96)]
  it('returns topmost clip', () => {
    expect(clipAt(clips, 250, 0)?.id).toBe('b')
    expect(clipAt(clips, 100, 0)?.id).toBe('a')
    expect(clipAt(clips, 100, 1)).toBeNull()
  })
  it('rect selection', () => {
    expect(clipsInRect(clips, 90, 150, 0, 1).map((c) => c.id)).toEqual(['a', 'c'])
    expect(clipsInRect(clips, 600, 500, 1, 0).map((c) => c.id)).toEqual(['b'])
  })
  it('zones', () => {
    expect(hitZone(2, 20, 100, 50)).toBe('left')
    expect(hitZone(97, 20, 100, 50)).toBe('right')
    expect(hitZone(50, 5, 100, 50)).toBe('header')
    expect(hitZone(50, 30, 100, 50)).toBe('body')
    expect(hitZone(4, 5, 8, 50)).toBe('header') // too narrow for edges
    expect(hitZone(50, 5, 100, 20)).toBe('body') // no header on short tracks
  })
})

describe('zoom', () => {
  it('keeps anchor tick fixed', () => {
    const v = { scrollTick: 1000, ppt: 0.1, scrollY: 0, vZoom: 1 }
    const z = zoomAround(v, 200, 2)
    expect(z.ppt).toBeCloseTo(0.2)
    expect(z.scrollTick + 200 / z.ppt).toBeCloseTo(1000 + 200 / 0.1)
  })
  it('formats song position', () => {
    expect(formatPos(0, 384)).toBe('1:01:00')
    expect(formatPos(384 + 24 * 3 + 5, 384)).toBe('2:04:05')
  })
})
