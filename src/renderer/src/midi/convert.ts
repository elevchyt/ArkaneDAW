// MIDI → ArkaneDAW conversion (pure: no store, no DOM). Ticks are rescaled to PPQ 96, velocities to 0..1
// (MIDI 100 ≈ FL's default 0.78), the MIDI channel goes into the note colour (FL does the same).
import { defaultNote } from '@/store/factory'
import { PPQ, type AutomationPoint, type Note } from '@/store/types'
import { tempoToNorm } from '@/audio/tempo'
import type { MidiFile, MidiNote } from './smf'

export const MIDI_EXT = /\.(mid|midi|smf|kar|rmi)$/i
export const GM_DRUM_CHANNEL = 9

/** One instrument part of a MIDI file: the notes of one MIDI channel inside one track. */
export interface MidiPart {
  name: string
  track: number
  channel: number
  program: number
  drums: boolean
  notes: MidiNote[]
}

export const GM_NAMES = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Saw Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass + Lead',
  'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  'Rain FX', 'Soundtrack FX', 'Crystal FX', 'Atmosphere FX', 'Brightness FX', 'Goblins FX', 'Echoes FX', 'Sci-fi FX',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot'
]

/** Built-in plugin + factory preset for every General MIDI program (none of them need a content pack). */
type Target = [pluginId: string, preset: string]
const M = (p: string): Target => ['mosaic', p]
const PIANO = (p: string): Target => ['piano', p]
const GTR = (p: string): Target => ['guitar', p]
const BASS = (p: string): Target => ['bassline', p]
const ATMOS = (p: string): Target => ['atmos', p]

export const GM_TARGETS: Target[] = [
  PIANO('Concert Grand'), PIANO('Bright Grand'), PIANO('Electric Grand'), PIANO('Honky-Tonk'), PIANO('Tine EP'), PIANO('FM EP'), M('Harpsichord'), M('Funk Clav'),
  M('Celesta'), M('Glockenspiel'), M('Music Box'), M('Vibes Tremolo'), M('Marimba'), M('Xylophone'), M('Tubular Bells'), M('Koto'),
  M('B3 Full Drawbars'), M('Gospel Perc Organ'), M('Rock Organ Overdrive'), M('Cathedral Pipes'), M('Ballad Organ Soft'), M('Combo Organ 60s'), M('Breathy Sax'), M('Combo Organ 60s'),
  GTR('Nylon Classical'), GTR('Steel Acoustic'), GTR('Jazz Hollow-Body'), GTR('Clean Single-Coil'), GTR('Funk Rhythm'), GTR('Crunch Rhythm'), GTR('Classic Rock Lead'), GTR('Ambient Clean'),
  BASS('Jazz Upright'), BASS('Fingerstyle P-Bass'), BASS('Pick Bass'), BASS('Fretless Mwah'), BASS('Slap Thumb Funk'), BASS('Slap Pop'), BASS('Fat Minimoog'), BASS('Rubber Moog'),
  M('Solo Violin'), M('Chamber Strings'), M('Cello Section'), M('Upright Bass'), M('Tremolo Strings'), M('Pizzicato'), M('Harp Glissando'), M('Low Brass'),
  M('Lush Strings'), M('Slow Strings'), M('Solina Strings'), M('Solina Strings'), M('Aah Choir'), M('Ooh Choir'), M('Voice Pad Heaven'), M('Brass Stabs'),
  M('Trumpet Solo'), M('Low Brass'), M('Low Brass'), M('Trumpet Solo'), M('French Horns'), M('Brass Section'), M('Synth Brass 80s'), M('Synth Brass 80s'),
  M('Breathy Sax'), M('Breathy Sax'), M('Breathy Sax'), M('Breathy Sax'), M('Oboe'), M('Oboe'), M('Clarinet'), M('Clarinet'),
  M('Flute'), M('Flute'), M('Recorder'), M('Pan Flute'), M('Pan Flute'), M('Pan Flute'), M('Whistle Sine Lead'), M('Whistle Sine Lead'),
  M('Square Lead'), M('Mono Saw Lead'), M('Whistle Sine Lead'), M('Pulse Glide Lead'), M('Fat Mono Lead'), M('Choir Pad'), M('Super Saw Lead'), M('Fat Mono Lead'),
  M('Glass Pad'), M('Warm Pad'), M('Super Saw Pad'), M('Choir Pad'), M('Slow Strings'), M('Bell Pad'), M('Shimmer Pad'), M('Sweep Pad'),
  ATMOS('Rainglass'), ATMOS('Distant Horizon'), M('Crystal Bells'), ATMOS('Northern Lights'), ATMOS('Sunrise Over Ice'), ATMOS('Black Lodge'), ATMOS('Time Smear'), ATMOS('Event Horizon'),
  M('12-String'), GTR('Steel Acoustic'), M('Koto'), M('Koto'), M('Kalimba'), M('Oboe'), M('Solo Violin'), M('Oboe'),
  M('Glockenspiel'), M('Marimba'), M('Steel Drum'), M('Xylophone'), M('Marimba'), M('Marimba'), M('Marimba'), ATMOS('Reverse Memory'),
  ATMOS('Dust Motes'), ATMOS('Breathing Fog'), ATMOS('Tidal Swell'), ATMOS('Ghost Whistle'), M('FM Bell'), ATMOS('Pressure Front'), ATMOS('Particle Cloud'), ATMOS('Dead Signal')
]

/** Drums (MIDI channel 10) play on the Classic Drum Machines plugin, which uses the GM drum key map. */
export const GM_DRUM_TARGET: Target = ['drummachine', 'Studio']

export function targetFor(part: Pick<MidiPart, 'program' | 'drums'>): Target {
  return part.drums ? GM_DRUM_TARGET : (GM_TARGETS[part.program] ?? GM_TARGETS[0])
}

/** Split a file into parts (track × MIDI channel), in file order, skipping tracks without notes. */
export function midiParts(file: MidiFile): MidiPart[] {
  const out: MidiPart[] = []
  file.tracks.forEach((tr, ti) => {
    const byCh = new Map<number, MidiNote[]>()
    for (const n of tr.notes) {
      const list = byCh.get(n.channel)
      if (list) list.push(n)
      else byCh.set(n.channel, [n])
    }
    const multi = byCh.size > 1
    for (const [ch, notes] of [...byCh].sort((a, b) => a[0] - b[0])) {
      const drums = ch === GM_DRUM_CHANNEL
      const program = tr.programs[ch] ?? programFromOtherTracks(file, ch) ?? 0
      const base = tr.name || tr.instrument || (drums ? 'Drums' : GM_NAMES[program])
      out.push({ name: multi ? `${base} (ch ${ch + 1})` : base, track: ti, channel: ch, program, drums, notes })
    }
  })
  // Several tracks often share a player's name ("Keys", "Keys", …): number the repeats.
  const seen = new Map<string, number>()
  for (const part of out) {
    const n = (seen.get(part.name) ?? 0) + 1
    seen.set(part.name, n)
    if (n > 1) part.name = `${part.name} ${n}`
  }
  return out
}

/** Format-1 files often put program changes in a conductor track or another track on the same channel. */
function programFromOtherTracks(file: MidiFile, ch: number): number | undefined {
  for (const tr of file.tracks) if (tr.notes.length === 0 && tr.programs[ch] !== undefined) return tr.programs[ch]
  return undefined
}

/** MIDI notes → pattern notes at PPQ 96. */
export function toNotes(notes: MidiNote[], ppq: number): Note[] {
  const k = PPQ / ppq
  return notes
    .map((n) =>
      defaultNote({
        pos: Math.max(0, Math.round(n.tick * k)),
        len: Math.max(1, Math.round(n.len * k)),
        key: n.key,
        vel: Math.min(1, n.vel / 128),
        color: n.channel
      })
    )
    .sort((a, b) => a.pos - b.pos || a.key - b.key)
}

/** Every note of the file (all tracks and channels), for loading a file into a single channel. */
export function allNotes(file: MidiFile): Note[] {
  return toNotes(
    file.tracks.flatMap((t) => t.notes),
    file.ppq
  )
}

/**
 * The file's tempo changes as tempo automation points (PPQ 96, every point 'hold' so the tempo steps like MIDI's),
 * from tick 0 to `length`. Null when the tempo never changes.
 */
export function tempoPoints(file: MidiFile, length: number): AutomationPoint[] | null {
  const k = PPQ / file.ppq
  const pts: AutomationPoint[] = []
  let bpm = 120 // MIDI's default before the first tempo event
  for (const e of file.tempos) {
    const t = Math.round(e.tick * k)
    if (t >= length) break
    if (pts.length && pts[pts.length - 1].t === t) pts.pop() // last event on a tick wins
    if (!pts.length && t > 0) pts.push({ t: 0, v: tempoToNorm(bpm), tension: 0, mode: 'hold' })
    bpm = e.bpm
    pts.push({ t, v: tempoToNorm(bpm), tension: 0, mode: 'hold' })
  }
  if (new Set(pts.map((p) => p.v)).size < 2) return null
  // drop repeats: a point equal to the previous one changes nothing
  const out = pts.filter((p, i) => i === 0 || p.v !== pts[i - 1].v)
  out.push({ t: length, v: out[out.length - 1].v, tension: 0, mode: 'hold' })
  return out
}

/** Initial tempo, rounded to 3 decimals, or null when the file doesn't set one at the start. */
export function initialTempo(file: MidiFile): number | null {
  const t = file.tempos.find((x) => x.tick === 0) ?? null
  return t ? Math.round(t.bpm * 1000) / 1000 : null
}
