import { describe, expect, it } from 'vitest'
import { defaultNote, makeChannel, makeEmptyProject } from './factory'
import { editProject, getProject, useProject } from './project'
import { splitPatternByChannel } from './actions'
import type { Clip } from './types'

const BAR = 384

function setup(): { pid: string; a: string; b: string } {
  const p = makeEmptyProject()
  const a = makeChannel('Kick', { pluginId: 'triosc', params: {} })
  const b = makeChannel('Hat', { pluginId: 'triosc', params: {} })
  p.channels.push(a, b)
  const pat = p.patterns[0]
  pat.notes[a.id] = [defaultNote({ pos: 0, len: 24 })]
  pat.notes[b.id] = [defaultNote({ pos: BAR + 96, len: 24 })] // 2 bars long
  const clip = (id: string, start: number, length: number, offset = 0): Clip => ({ id, kind: 'pattern', ref: pat.id, track: 1, start, length, offset, muted: false })
  p.playlist.clips.push(clip('full', 0, 2 * BAR), clip('cut', 4 * BAR, BAR), clip('slip', 8 * BAR, BAR, BAR))
  useProject.getState().load(p)
  return { pid: pat.id, a: a.id, b: b.id }
}

describe('pattern clips follow pattern growth', () => {
  it('stretches whole-pattern clips when the pattern grows, in the same undo step', () => {
    const { pid, a } = setup()
    editProject('Add note', (d) => void d.patterns[0].notes[a].push(defaultNote({ pos: 2 * BAR + 10, len: 24 })))
    const len = (id: string) => getProject().playlist.clips.find((c) => c.id === id)!.length
    expect(len('full')).toBe(3 * BAR)
    expect(len('cut')).toBe(BAR)
    expect(len('slip')).toBe(BAR)
    useProject.getState().undo()
    expect(len('full')).toBe(2 * BAR)
    expect(getProject().patterns[0].notes[a]).toHaveLength(1)
    expect(getProject().patterns[0].id).toBe(pid)
  })

  it('leaves clips alone when the pattern shrinks', () => {
    const { b } = setup()
    editProject('Delete note', (d) => void (d.patterns[0].notes[b] = []))
    expect(getProject().playlist.clips.find((c) => c.id === 'full')!.length).toBe(2 * BAR)
  })
})

describe('split by channel', () => {
  it('replaces the pattern with one per channel and splits its clips onto consecutive tracks', () => {
    const { pid, a, b } = setup()
    const ids = splitPatternByChannel(pid)
    const p = getProject()
    expect(ids).toHaveLength(2)
    expect(p.patterns.some((x) => x.id === pid)).toBe(false)
    const [pa, pb] = ids.map((id) => p.patterns.find((x) => x.id === id)!)
    expect(pa.name).toMatch(/ - Kick$/)
    expect(Object.keys(pa.notes)).toEqual([a])
    expect(Object.keys(pb.notes)).toEqual([b])
    // the kick-only pattern keeps the original 2-bar length
    expect(pa.length).toBe(2 * BAR)
    const full = p.playlist.clips.filter((c) => c.start === 0)
    expect(full.map((c) => [c.ref, c.track, c.length])).toEqual([
      [pa.id, 1, 2 * BAR],
      [pb.id, 2, 2 * BAR]
    ])
    expect(p.playlist.clips.filter((c) => c.ref === pid)).toHaveLength(0)
    useProject.getState().undo()
    expect(getProject().patterns[0].id).toBe(pid)
  })
})
