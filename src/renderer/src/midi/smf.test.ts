import { describe, expect, it } from 'vitest'
import { MidiParseError, parseMidi } from './smf'
import { GM_DRUM_FALLBACK, GM_DRUM_TARGET, GM_TARGETS, allNotes, initialTempo, midiParts, tempoPoints, toNotes } from './convert'
import { normToTempo } from '@/audio/tempo'
import { PPQ } from '@/store/types'
import type { PluginManifest } from '@/plugins/sdk/types'

const MANIFESTS = Object.values(import.meta.glob<{ manifest: PluginManifest }>('../plugins/*/manifest.ts', { eager: true })).map((m) => m.manifest)

// ── tiny SMF writer for fixtures ────────────────────────────────────────────────
const vlq = (n: number): number[] => {
  const out = [n & 0x7f]
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80)
  return out
}
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const str = (s: string) => [...s].map((c) => c.charCodeAt(0))
type Ev = [delta: number, ...bytes: number[]]
const track = (events: Ev[]): number[] => {
  const body = events.flatMap(([d, ...b]) => [...vlq(d), ...b])
  body.push(0, 0xff, 0x2f, 0)
  return [...str('MTrk'), ...u32(body.length), ...body]
}
const smf = (format: number, division: number, tracks: number[][]): Uint8Array =>
  new Uint8Array([...str('MThd'), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(division), ...tracks.flat()])
const meta = (type: number, data: number[]): number[] => [0xff, type, ...vlq(data.length), ...data]

describe('parseMidi', () => {
  it('reads a format-1 file: tempo, time signature, names, programs, notes', () => {
    const conductor = track([
      [0, ...meta(0x51, [0x07, 0xa1, 0x20])], // 500000 µs = 120 BPM
      [0, ...meta(0x58, [6, 3, 24, 8])] // 6/8
    ])
    const piano = track([
      [0, ...meta(0x03, str('Keys'))],
      [0, 0xc0, 4],
      [0, 0x90, 60, 100],
      [0, 64, 90], // running status
      [480, 0x80, 60, 0],
      [0, 0x90, 64, 0] // note-on velocity 0 = note-off
    ])
    const f = parseMidi(smf(1, 480, [conductor, piano]))
    expect(f.format).toBe(1)
    expect(f.ppq).toBe(480)
    expect(f.tempos).toEqual([{ tick: 0, bpm: 120 }])
    expect(f.timeSig).toEqual([6, 8])
    expect(f.tracks[1].name).toBe('Keys')
    expect(f.tracks[1].programs[0]).toBe(4)
    expect(f.tracks[1].notes).toEqual([
      { tick: 0, len: 480, key: 60, vel: 100, channel: 0 },
      { tick: 0, len: 480, key: 64, vel: 90, channel: 0 }
    ])
  })

  it('pairs overlapping notes on the same key first-in first-out and closes held notes at the track end', () => {
    const t = track([
      [0, 0x91, 50, 80],
      [10, 0x91, 50, 70],
      [10, 0x81, 50, 0],
      [10, 0x81, 50, 0],
      [0, 0x91, 52, 60],
      [40, 0xb1, 7, 100] // CC is ignored, but its time still counts
    ])
    const notes = parseMidi(smf(0, 96, [t])).tracks[0].notes
    expect(notes).toEqual([
      { tick: 0, len: 20, key: 50, vel: 80, channel: 1 },
      { tick: 10, len: 20, key: 50, vel: 70, channel: 1 },
      { tick: 30, len: 40, key: 52, vel: 60, channel: 1 }
    ])
  })

  it('skips sysex, unknown chunks and meta events it does not use', () => {
    const t = track([
      [0, 0xf0, ...vlq(3), 1, 2, 0xf7],
      [0, ...meta(0x01, str('hello'))],
      [0, 0x99, 36, 127],
      [24, 0x89, 36, 0]
    ])
    const junk = [...str('XFIH'), ...u32(4), 1, 2, 3, 4]
    const bytes = smf(0, 96, [t])
    const withJunk = new Uint8Array([...bytes.slice(0, 14), ...junk, ...bytes.slice(14)])
    expect(parseMidi(withJunk).tracks[0].notes).toEqual([{ tick: 0, len: 24, key: 36, vel: 127, channel: 9 }])
  })

  it('rejects files that are not MIDI', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(MidiParseError)
  })

  it('converts SMPTE divisions as if the file ran at 120 BPM', () => {
    // 25 fps × 40 ticks per frame = 1000 ticks per second = 500 per quarter at 120 BPM
    const f = parseMidi(smf(0, ((256 - 25) << 8) | 40, [track([[0, 0x90, 60, 64], [500, 0x80, 60, 0]])]))
    expect(f.ppq).toBe(500)
    expect(toNotes(f.tracks[0].notes, f.ppq)[0]).toMatchObject({ pos: 0, len: PPQ })
  })
})

describe('MIDI → ArkaneDAW', () => {
  const file = parseMidi(
    smf(1, 192, [
      track([[0, ...meta(0x51, [0x09, 0x27, 0xc0])]]), // 600000 µs = 100 BPM
      track([
        [0, 0xc0, 33],
        [0, 0xc9, 0],
        [0, 0x90, 40, 100],
        [0, 0x99, 36, 110],
        [96, 0x80, 40, 0],
        [0, 0x89, 36, 0]
      ])
    ])
  )

  it('splits tracks into one part per MIDI channel, drums on channel 10', () => {
    const parts = midiParts(file)
    expect(parts.map((p) => [p.name, p.channel, p.program, p.drums])).toEqual([
      ['Finger Bass (ch 1)', 0, 33, false],
      ['Drums (ch 10)', 9, 0, true]
    ])
  })

  it('numbers repeated part names', () => {
    const named = (n: string) => track([[0, ...meta(0x03, str(n))], [0, 0x90, 60, 100], [96, 0x80, 60, 0]])
    const f = parseMidi(smf(1, 96, [named('Keys'), named('Keys'), named('Bass')]))
    expect(midiParts(f).map((p) => p.name)).toEqual(['Keys', 'Keys 2', 'Bass'])
  })

  it('rescales ticks to PPQ 96, maps velocity like FL and keeps the MIDI channel as the note colour', () => {
    const notes = allNotes(file)
    expect(notes.map((n) => [n.pos, n.len, n.key, n.color])).toEqual([
      [0, 48, 36, 9],
      [0, 48, 40, 0]
    ])
    expect(notes[1].vel).toBeCloseTo(100 / 128)
    expect(initialTempo(file)).toBe(100)
  })

  it('turns tempo changes into stepped tempo automation points', () => {
    const tempos = smf(1, 96, [
      track([
        [0, ...meta(0x51, [0x07, 0xa1, 0x20])], // 120
        [384, ...meta(0x51, [0x0f, 0x42, 0x40])], // 60 at bar 2
        [0, ...meta(0x51, [0x0f, 0x42, 0x40])], // repeat: no new point
        [384, ...meta(0x51, [0x03, 0xd0, 0x90])] // 240 at bar 3
      ])
    ])
    const pts = tempoPoints(parseMidi(tempos), 4 * 384)!
    expect(pts.map((p) => [p.t, Math.round(normToTempo(p.v)), p.mode])).toEqual([
      [0, 120, 'hold'],
      [384, 60, 'hold'],
      [768, 240, 'hold'],
      [1536, 240, 'hold']
    ])
    expect(tempoPoints(file, 384)).toBeNull() // one tempo only
  })

  it('maps every General MIDI program to an existing built-in preset', () => {
    expect(GM_TARGETS).toHaveLength(128)
    for (const [pluginId, preset] of [...GM_TARGETS, GM_DRUM_TARGET, GM_DRUM_FALLBACK]) {
      const m = MANIFESTS.find((x) => x.id === pluginId)
      expect(m, pluginId).toBeTruthy()
      expect(m!.presets?.some((p) => p.name === preset), `${pluginId} › ${preset}`).toBe(true)
    }
  })
})
