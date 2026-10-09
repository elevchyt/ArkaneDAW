import { describe, expect, it } from 'vitest'
import { bendSemitones, parseMidi, SustainTracker, velocityCurve } from './midi-core'

describe('parseMidi', () => {
  it('parses notes, running-status note-off and CCs', () => {
    expect(parseMidi([0x90, 60, 127])).toEqual({ type: 'on', ch: 0, key: 60, vel: 1 })
    expect(parseMidi([0x93, 60, 0])).toMatchObject({ type: 'off', ch: 3, key: 60 })
    expect(parseMidi([0x80, 61, 64])).toMatchObject({ type: 'off', key: 61 })
    expect(parseMidi([0xb0, 64, 127])).toEqual({ type: 'cc', ch: 0, cc: 64, value: 127 })
    expect(parseMidi([0xf8])).toEqual({ type: 'other' })
  })
  it('parses 14-bit pitch bend', () => {
    expect(parseMidi([0xe0, 0, 64])).toEqual({ type: 'bend', ch: 0, value: 0 })
    expect((parseMidi([0xe0, 0, 0]) as { value: number }).value).toBe(-1)
    expect((parseMidi([0xe0, 127, 127]) as { value: number }).value).toBeCloseTo(1, 3)
    expect(bendSemitones(-1, 2)).toBe(-2)
  })
})

describe('SustainTracker', () => {
  it('releases immediately without the pedal', () => {
    const t = new SustainTracker<number>()
    t.press('a', 1)
    expect(t.release('a')).toEqual([1])
    expect(t.size).toBe(0)
  })
  it('defers note-offs while the pedal is down', () => {
    const t = new SustainTracker<number>()
    t.setPedal(true)
    t.press('a', 1)
    t.press('b', 2)
    expect(t.release('a')).toEqual([])
    expect(t.release('b')).toEqual([])
    t.press('c', 3) // still physically held at pedal up
    expect(t.setPedal(false).sort()).toEqual([1, 2])
    expect(t.size).toBe(1)
    expect(t.release('c')).toEqual([3])
  })
  it('retriggering a sustained key releases the old voice', () => {
    const t = new SustainTracker<number>()
    t.setPedal(true)
    t.press('a', 1)
    t.release('a')
    expect(t.press('a', 2)).toEqual([1])
    t.release('a')
    expect(t.setPedal(false)).toEqual([2])
  })
  it('releaseAll returns held and sustained voices', () => {
    const t = new SustainTracker<number>()
    t.setPedal(true)
    t.press('a', 1)
    t.release('a')
    t.press('b', 2)
    expect(t.releaseAll().sort()).toEqual([1, 2])
    expect(t.size).toBe(0)
  })
})

describe('velocity curve', () => {
  it('is linear at 0 and monotonic', () => {
    expect(velocityCurve(0.5, 0)).toBe(0.5)
    expect(velocityCurve(0.5, 1)).toBeGreaterThan(0.5)
    expect(velocityCurve(0.5, -1)).toBeLessThan(0.5)
    expect(velocityCurve(1, 0.7)).toBe(1)
  })
})
