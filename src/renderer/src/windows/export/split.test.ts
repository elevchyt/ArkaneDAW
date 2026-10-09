import { describe, expect, it } from 'vitest'
import type { Clip, MixerTrack, PlaylistTrack, Project } from '../../store/types'
import { mixerStems, playlistStems, soloPlaylistTrack } from './split'

const track = (i: number, name = `Track ${i + 1}`, muted = false): PlaylistTrack => ({ id: `t${i}`, name, color: '#000', height: 52, muted, locked: false })
const clip = (id: string, trackIdx: number, kind: Clip['kind'] = 'pattern', muted = false): Clip => ({ id, kind, ref: 'r', track: trackIdx, start: 0, length: 96, offset: 0, muted })
const mix = (index: number, name: string): MixerTrack => ({ index, name } as MixerTrack)

const project = (): Project =>
  ({
    playlist: {
      tracks: [track(0, 'Drums'), track(1, ''), track(2, 'Auto'), track(3, 'Muted', true), track(4, 'Empty')],
      clips: [clip('a', 0), clip('b', 1, 'audio'), clip('c', 2, 'automation'), clip('d', 3), clip('e', 0, 'pattern', true)]
    },
    mixer: [mix(0, 'Master'), mix(1, 'Kick'), mix(2, ''), mix(3, 'Insert 3')]
  }) as unknown as Project

describe('playlist split', () => {
  it('lists tracks with sounding clips only', () => {
    expect(playlistStems(project())).toEqual([
      { name: 'Drums', index: 0 },
      { name: 'Track 2', index: 1 }
    ])
  })
  it('solo keeps the track and all automation, mutes other sound clips', () => {
    const p = soloPlaylistTrack(project(), 1)
    const muted = Object.fromEntries(p.playlist.clips.map((c) => [c.id, c.muted]))
    expect(muted).toEqual({ a: true, b: false, c: false, d: true, e: true })
    // original untouched
    expect(project().playlist.clips[0].muted).toBe(false)
  })
})

describe('mixer split', () => {
  it('master first, then used inserts in order with FL names', () => {
    expect(mixerStems(project(), new Set([3, 0, 1, 2, 9]))).toEqual([
      { name: 'Master', index: 0 },
      { name: 'Kick', index: 1 },
      { name: 'Insert 2', index: 2 },
      { name: 'Insert 3', index: 3 }
    ])
  })
})
