import { describe, expect, it } from 'vitest'
import { defaultNote } from '@/store/factory'
import type { Note } from '@/store/types'
import { chop, duplicate, glue, legato, notesInRange, nudge, quantizeStarts, sliceNote, sortNotes, span, transpose } from './noteOps'
import { formatTime, inScale, noteName, parseTime } from './music'

const n = (id: string, pos: number, len: number, key = 60): Note => defaultNote({ id, pos, len, key })
let seq = 0
const gen = () => `g${seq++}`

describe('noteOps', () => {
  it('sorts by pos then key', () => {
    const s = sortNotes([n('a', 10, 1, 62), n('b', 0, 1), n('c', 10, 1, 60)])
    expect(s.map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('transposes selection and clamps to range', () => {
    const notes = [n('a', 0, 24, 60), n('b', 24, 24, 125)]
    expect(transpose(notes, new Set(['a']), 12).find((x) => x.id === 'a')!.key).toBe(72)
    // b would exceed 131: whole selection clamps together
    const t = transpose(notes, null, 12)
    expect(t.map((x) => x.key)).toEqual([66, 131])
  })

  it('nudges without going negative', () => {
    const notes = [n('a', 10, 24), n('b', 30, 24)]
    expect(nudge(notes, null, -24).map((x) => x.pos)).toEqual([0, 20])
  })

  it('quantizes starts only', () => {
    const q = quantizeStarts([n('a', 13, 7), n('b', 35, 5)], null, 24)
    expect(q.map((x) => [x.pos, x.len])).toEqual([
      [24, 7],
      [24, 5]
    ])
  })

  it('legato extends to the next start', () => {
    const l = legato([n('a', 0, 5), n('b', 0, 5, 64), n('c', 48, 5), n('d', 96, 10)], null)
    const by = Object.fromEntries(l.map((x) => [x.id, x.len]))
    expect(by).toEqual({ a: 48, b: 48, c: 48, d: 10 })
  })

  it('glues touching notes on the same key', () => {
    const g = glue([n('a', 0, 24), n('b', 24, 24), n('c', 48, 24, 61), n('d', 100, 10)], null)
    expect(g.map((x) => [x.id, x.pos, x.len])).toEqual([
      ['a', 0, 48],
      ['c', 48, 24],
      ['d', 100, 10]
    ])
  })

  it('chops into grid pieces', () => {
    const c = chop([n('a', 6, 60)], null, 24, gen)
    expect(c.map((x) => [x.pos, x.len])).toEqual([
      [6, 18],
      [24, 24],
      [48, 18]
    ])
    expect(c[0].id).toBe('a')
  })

  it('slices a note', () => {
    const s = sliceNote(n('a', 0, 48), 24, gen)!
    expect(s.map((x) => [x.pos, x.len])).toEqual([
      [0, 24],
      [24, 24]
    ])
    expect(sliceNote(n('a', 0, 48), 0)).toBeNull()
    expect(sliceNote(n('a', 0, 48), 48)).toBeNull()
  })

  it('duplicates to the right', () => {
    const notes = [n('a', 0, 24), n('b', 24, 24)]
    const sp = span(notes, null)!
    expect(sp).toEqual({ start: 0, end: 48 })
    const d = duplicate(notes, new Set(['a', 'b']), 48, gen)
    expect(d.notes.length).toBe(4)
    expect(d.notes.filter((x) => d.ids.has(x.id)).map((x) => x.pos)).toEqual([48, 72])
  })

  it('range selection uses note starts', () => {
    const r = notesInRange([n('a', 0, 100), n('b', 50, 10), n('c', 96, 10)], 24, 96)
    expect(r.map((x) => x.id)).toEqual(['b'])
  })
})

describe('music helpers', () => {
  it('uses FL note naming', () => {
    expect(noteName(60)).toBe('C5')
    expect(noteName(0)).toBe('C0')
    expect(noteName(131)).toBe('B10')
    expect(noteName(61)).toBe('C#5')
  })
  it('scale membership', () => {
    expect(inScale(64, 0, 'major')).toBe(true)
    expect(inScale(63, 0, 'major')).toBe(false)
    expect(inScale(63, 0, 'none')).toBe(true)
    expect(inScale(57, 9, 'minor')).toBe(true) // A in A minor
  })
  it('formats and parses B:S:T', () => {
    expect(formatTime(0, [4, 4])).toBe('1:01:00')
    expect(formatTime(384 + 24 * 2 + 5, [4, 4])).toBe('2:03:05')
    expect(parseTime('2:03:05', [4, 4], true)).toBe(384 + 48 + 5)
    expect(parseTime('0:04:00', [4, 4], false)).toBe(96)
    expect(parseTime('x', [4, 4], true)).toBeNull()
  })
})
