import { describe, expect, it } from 'vitest'
import { normalizeProject } from './normalize'
import { defaultNote, makeChannel, makeEmptyProject, makePattern } from './factory'
import { FX_SLOTS, MIXER_INSERTS, PLAYLIST_TRACKS, type Project } from './types'

function sample(): Project {
  const p = makeEmptyProject()
  const ch = makeChannel('Lead', { pluginId: 'triosc', params: { cutoff: 0.4 }, data: { x: [1, 2] }, presetName: 'Init' }, { mixerTrack: 3 })
  p.channels.push(ch)
  p.patterns[0].notes[ch.id] = [defaultNote({ key: 64, pos: 96, len: 48, slide: true })]
  p.patterns.push({ ...makePattern(2), length: 768, timeSig: [3, 4] })
  p.playlist.clips.push({ id: 'c1', kind: 'pattern', ref: p.patterns[0].id, track: 2, start: 384, length: 384, offset: 0, muted: false, group: 'g' })
  p.mixer[3].slots[1] = { id: 's1', plugin: { pluginId: 'reverb', params: { mix: 0.3 } }, enabled: false, mix: 0.5 }
  p.mixer[3].sends = [{ target: 0, level: 1 }, { target: 5, level: 0.5 }]
  p.automations.push({ id: 'a1', name: 'Cut', color: '#fff', target: { kind: 'tempo' }, points: [{ t: 0, v: 0.2, tension: 0, mode: 'single' }], length: 384 })
  p.markers.push({ id: 'm1', pos: 384, name: 'Drop', kind: 'marker' })
  p.samples.push({ id: 'smp', name: 'Kick', path: '/x/kick.wav', duration: 0.5, sampleRate: 48000, channels: 1, embedded: false })
  return p
}

describe('normalizeProject', () => {
  it('leaves a project the app saved unchanged', () => {
    const p = sample()
    const json = JSON.parse(JSON.stringify(p))
    expect(normalizeProject(json)).toEqual(p)
    const empty = makeEmptyProject()
    expect(normalizeProject(JSON.parse(JSON.stringify(empty)))).toEqual(empty)
  })

  it('is idempotent', () => {
    const once = normalizeProject({ channels: [{ id: 'a', name: 'A' }], patterns: [{ notes: { a: [{ pos: 0 }] } }] })
    expect(normalizeProject(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('builds a full project from a minimal hand-written one', () => {
    const p = normalizeProject({
      tempo: 140,
      channels: [{ id: 'kick', name: 'Kick', plugin: { pluginId: 'drummachine' } }],
      patterns: [{ id: 'p1', name: 'Beat', notes: { kick: [{ pos: 0 }, { pos: 96, key: 62, vel: 0.5 }] } }],
      playlist: { clips: [{ kind: 'pattern', ref: 'p1', track: 0, start: 0 }] }
    })
    expect(p.tempo).toBe(140)
    expect(p.mixer).toHaveLength(MIXER_INSERTS + 1)
    expect(p.mixer[4].slots).toHaveLength(FX_SLOTS)
    expect(p.playlist.tracks).toHaveLength(PLAYLIST_TRACKS)
    expect(p.channels[0]).toMatchObject({ id: 'kick', kind: 'instrument', volume: 0.78, mixerTrack: 0, plugin: { pluginId: 'drummachine', params: {} } })
    const notes = p.patterns[0].notes.kick
    expect(notes[0]).toMatchObject({ key: 60, pos: 0, len: 24, pan: 0, muted: false })
    expect(notes[1]).toMatchObject({ key: 62, vel: 0.5 })
    expect(notes[0].id).toBeTruthy()
    expect(notes[0].id).not.toBe(notes[1].id)
    expect(p.playlist.clips[0]).toMatchObject({ kind: 'pattern', ref: 'p1', length: 384, offset: 0, muted: false })
    expect(p.playlist.clips[0].id).toBeTruthy()
  })

  it('drops broken references and clamps bad values', () => {
    const p = normalizeProject({
      tempo: 'fast',
      channels: [{ id: 'a', volume: 9, pan: NaN, mixerTrack: 999 }, { id: 'a' }, 'junk'],
      patterns: [{ id: 'p', notes: { a: [{ pos: 'x' }, { pos: 10.4, key: 200, vel: 2 }], ghost: [{ pos: 0 }] } }],
      playlist: {
        clips: [
          { kind: 'pattern', ref: 'missing', start: 0 },
          { kind: 'audio', ref: 'nope', start: 0 },
          { kind: 'weird', ref: 'p' },
          { kind: 'pattern', ref: 'p', track: 5000, start: -5 }
        ]
      },
      mixer: [{}, { slots: [{ plugin: { pluginId: 'reverb', params: { mix: 'a', size: 0.4 } } }, { plugin: {} }], sends: [{ target: 1 }, { target: 0 }] }]
    })
    expect(p.tempo).toBe(130)
    expect(p.channels).toHaveLength(2)
    expect(p.channels[1].id).not.toBe('a')
    expect(p.channels[0]).toMatchObject({ volume: 1.25, pan: 0, mixerTrack: MIXER_INSERTS })
    expect(Object.keys(p.patterns[0].notes)).toEqual(['a'])
    expect(p.patterns[0].notes.a).toHaveLength(1)
    expect(p.patterns[0].notes.a[0]).toMatchObject({ pos: 10, key: 131, vel: 1 })
    expect(p.playlist.clips).toHaveLength(1)
    expect(p.playlist.clips[0]).toMatchObject({ track: PLAYLIST_TRACKS - 1, start: 0 })
    expect(p.mixer[1].slots[0]?.plugin.params).toEqual({ size: 0.4 })
    expect(p.mixer[1].slots[1]).toBeNull()
    expect(p.mixer[1].sends).toEqual([{ target: 0, level: 1 }])
  })

  it('always has at least one pattern', () => {
    expect(normalizeProject({}).patterns).toHaveLength(1)
    expect(normalizeProject(null).patterns).toHaveLength(1)
  })
})
