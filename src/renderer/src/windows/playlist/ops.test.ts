import { describe, expect, it } from 'vitest'
import { applyClipDiff, chopClip, clampMove, cloneShifted, deleteSpace, diffClips, duplicateRight, insertSpace, moveClips, paintRepeat, resizeRight, sliceAt, sliceClip, setGroup, sliceTracks, sliceTrim, slipClip, stretchClip, trimLeft, withGroups } from './ops'
import type { Clip } from '@/store/types'

let n = 0
const gen = () => `n${++n}`
const clip = (id: string, track: number, start: number, length: number, offset = 0): Clip => ({ id, kind: 'pattern', ref: 'p', track, start, length, offset, muted: false })

describe('move', () => {
  it('clamps to song start and track range', () => {
    const cs = [clip('a', 0, 96, 96), clip('b', 3, 200, 96)]
    expect(clampMove(cs, -500, -5, 200)).toEqual({ dTick: -96, dTrack: 0 })
    expect(clampMove(cs, 10, 500, 200)).toEqual({ dTick: 10, dTrack: 196 })
  })
  it('moves only selected', () => {
    const cs = [clip('a', 0, 0, 96), clip('b', 1, 0, 96)]
    const out = moveClips(cs, new Set(['b']), 384, 2)
    expect(out[0]).toBe(cs[0])
    expect(out[1]).toMatchObject({ start: 384, track: 3 })
  })
})

describe('resize / trim / slip', () => {
  it('resizes right with min and max', () => {
    const c = clip('a', 0, 100, 200)
    expect(resizeRight(c, 500).length).toBe(400)
    expect(resizeRight(c, 50).length).toBe(6)
    expect(resizeRight(c, 900, 300).length).toBe(300)
  })
  it('trims left keeping content in place', () => {
    const c = clip('a', 0, 100, 200, 0)
    expect(trimLeft(c, 150)).toMatchObject({ start: 150, length: 150, offset: 50 })
    // cannot extend before offset 0 without wrap
    expect(trimLeft(c, 40)).toBe(c)
    const c2 = clip('b', 0, 100, 200, 30)
    expect(trimLeft(c2, 40)).toMatchObject({ start: 70, length: 230, offset: 0 })
    // patterns wrap
    expect(trimLeft(c, 40, 384)).toMatchObject({ start: 40, length: 260, offset: 384 - 60 })
  })
  it('slips content', () => {
    const c = clip('a', 0, 0, 384, 0)
    expect(slipClip(c, -96, 0).offset).toBe(96)
    expect(slipClip(c, 96, 0).offset).toBe(0)
    expect(slipClip(c, 96, 0, 384).offset).toBe(288)
  })
})

describe('slice / chop', () => {
  it('slices inside only', () => {
    const c = clip('a', 0, 100, 200, 10)
    const [l, r] = sliceClip(c, 150, gen)!
    expect(l).toMatchObject({ id: 'a', start: 100, length: 50, offset: 10 })
    expect(r).toMatchObject({ start: 150, length: 150, offset: 60 })
    expect(sliceClip(c, 100, gen)).toBeNull()
    expect(sliceClip(c, 300, gen)).toBeNull()
  })
  it('slices across a track range', () => {
    const cs = [clip('a', 0, 0, 384), clip('b', 1, 0, 384), clip('c', 5, 0, 384)]
    expect(sliceAt(cs, 192, 0, 1, gen)).toHaveLength(5)
  })
  it('chops into pieces', () => {
    const parts = chopClip(clip('a', 0, 0, 1000), 384, gen)
    expect(parts.map((p) => [p.start, p.length, p.offset])).toEqual([[0, 384, 0], [384, 384, 384], [768, 232, 768]])
    expect(parts[0].id).toBe('a')
  })
})

describe('space', () => {
  it('inserts space', () => {
    const cs = [clip('a', 0, 0, 100), clip('b', 0, 50, 100), clip('c', 0, 200, 50)]
    const out = insertSpace(cs, 100, 384, gen)
    expect(out.map((c) => [c.start, c.length])).toEqual([[0, 100], [50, 50], [484, 50], [584, 50]])
  })
  it('deletes space', () => {
    const cs = [clip('a', 0, 0, 100), clip('b', 0, 120, 30), clip('c', 0, 90, 100), clip('d', 0, 50, 300), clip('e', 0, 400, 10)]
    const out = deleteSpace(cs, 100, 200, gen)
    const by = (id: string) => out.filter((c) => c.id === id)
    expect(by('a')[0]).toMatchObject({ start: 0, length: 100 })
    expect(by('b')).toHaveLength(0)
    expect(by('c')[0]).toMatchObject({ start: 90, length: 10 })
    expect(by('d')[0]).toMatchObject({ start: 50, length: 50 })
    expect(out.find((c) => c.start === 100 && c.length === 150)).toMatchObject({ offset: 150 })
    expect(by('e')[0]).toMatchObject({ start: 300 })
  })
})

describe('duplicate / paint / clone', () => {
  it('duplicates right rounded to bars', () => {
    const out = duplicateRight([clip('a', 0, 0, 300), clip('b', 1, 384, 100)], 384, gen)
    expect(out.map((c) => c.start)).toEqual([768, 1152])
    expect(out[0].id).not.toBe('a')
  })
  it('paints repeats', () => {
    expect(paintRepeat(clip('a', 0, 0, 384), 1000, gen).map((c) => c.start)).toEqual([384, 768])
  })
  it('clones', () => {
    expect(cloneShifted([clip('a', 2, 10, 5)], 5, 1, gen)[0]).toMatchObject({ start: 15, track: 3 })
  })
})

describe('diff', () => {
  it('detects changes and applies them', () => {
    const a = clip('a', 0, 0, 1)
    const b = clip('b', 0, 0, 1)
    const c = clip('c', 0, 0, 1)
    const before = [a, b, c]
    const b2 = { ...b, start: 5 }
    const d = clip('d', 0, 0, 1)
    const after = [a, b2, d]
    const { removed, upserts } = diffClips(before, after)
    expect([...removed]).toEqual(['c'])
    expect(upserts).toEqual([b2, d])
    const target = before.slice()
    applyClipDiff(target, removed, upserts)
    expect(target).toEqual([a, b2, d])
  })
})

describe('stretch', () => {
  const audio = (start: number, length: number, offset = 0): Clip => ({ id: 'x', kind: 'audio', ref: 's', track: 0, start, length, offset, muted: false })
  it('stretches from the right edge, scaling offset and fades', () => {
    const out = stretchClip({ ...audio(96, 384, 48), fadeIn: 24 }, 96, 96 + 768)
    expect(out).toMatchObject({ start: 96, length: 768, offset: 96, stretch: 2, fadeIn: 48 })
  })
  it('stretches from the left edge keeping the end', () => {
    const out = stretchClip(audio(384, 384), 576, 768)
    expect(out).toMatchObject({ start: 576, length: 192, stretch: 0.5 })
  })
  it('compounds and clamps the factor', () => {
    const once = stretchClip(audio(0, 100), 0, 200)
    const twice = stretchClip(once, 0, 100000)
    expect(twice.stretch).toBe(8)
    expect(twice.length).toBe(800)
  })
})

describe('groups and slicing', () => {
  const a = (id: string, track: number, start: number, length: number, group?: string): Clip => ({ id, kind: 'pattern', ref: 'p', track, start, length, offset: 0, muted: false, group })
  it('expands ids to whole groups', () => {
    const cs = [a('a', 0, 0, 96, 'g'), a('b', 1, 0, 96, 'g'), a('c', 2, 0, 96)]
    expect([...withGroups(cs, ['a'])].sort()).toEqual(['a', 'b'])
    expect([...withGroups(cs, ['c'])]).toEqual(['c'])
  })
  it('groups, ungroups and gives copies their own group', () => {
    const cs = setGroup([a('a', 0, 0, 96), a('b', 1, 0, 96), a('c', 2, 0, 96)], new Set(['a', 'b']), 'g1')
    expect(cs.map((c) => c.group)).toEqual(['g1', 'g1', undefined])
    const copies = cloneShifted(cs.slice(0, 2), 96, 0, gen)
    expect(copies[0].group).toBe(copies[1].group)
    expect(copies[0].group).not.toBe('g1')
    expect('group' in setGroup(cs, new Set(['a']), undefined)[0]).toBe(false)
  })
  it('trims away the smaller part', () => {
    const cs = [a('a', 0, 0, 384)]
    expect(sliceTrim(cs, 'a', 96, gen)).toEqual([{ ...cs[0], id: expect.any(String), start: 96, length: 288, offset: 96 }])
    expect(sliceTrim(cs, 'a', 300, gen)[0]).toMatchObject({ id: 'a', start: 0, length: 300 })
  })
  it('slices an angled line per track', () => {
    const cs = [a('a', 0, 0, 384), a('b', 1, 0, 384)]
    const out = sliceTracks(cs, [0, 1], (t) => (t === 0 ? 96 : 192), gen)
    expect(out.filter((c) => c.track === 0).map((c) => c.length).sort((x, y) => x - y)).toEqual([96, 288])
    expect(out.filter((c) => c.track === 1).map((c) => c.length).sort((x, y) => x - y)).toEqual([192, 192])
  })
})
