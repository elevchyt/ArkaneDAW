import type { ParamDef, PluginManifest, Preset } from '../sdk/types'

/** Guitar models. Acoustic ones use a modelled wooden body; electric ones a magnetic pickup into the amp. */
export const MODELS = ['Steel Acoustic', 'Nylon Classical', 'Electric Single-Coil', 'Electric Humbucker', 'Electric Hollow-Body'] as const
export const MODEL = { STEEL: 0, NYLON: 1, SINGLE: 2, HUMBUCKER: 3, HOLLOW: 4 } as const
export const isElectric = (m: number): boolean => m >= MODEL.SINGLE

/** Open-string MIDI keys, low (6th) string first. */
export const TUNINGS: { name: string; strings: number[] }[] = [
  { name: 'Standard (EADGBE)', strings: [40, 45, 50, 55, 59, 64] },
  { name: 'Drop D', strings: [38, 45, 50, 55, 59, 64] },
  { name: 'Eb Standard', strings: [39, 44, 49, 54, 58, 63] },
  { name: 'D Standard', strings: [38, 43, 48, 53, 57, 62] },
  { name: 'Drop C', strings: [36, 43, 48, 53, 57, 62] },
  { name: 'Open G', strings: [38, 43, 50, 55, 59, 62] },
  { name: 'Open D', strings: [38, 45, 50, 54, 57, 62] },
  { name: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] }
]
export const STRINGS = 6
export const MAX_FRET = 22

export const ARTS = ['Sustain', 'Palm Mute', 'Muted', 'Harmonics'] as const
export const ART = { SUSTAIN: 0, PALM: 1, MUTED: 2, HARMONIC: 3 } as const
export const PLAY_MODES = ['Poly', 'Solo (Legato)', 'Strummer'] as const
export const PLAY = { POLY: 0, SOLO: 1, STRUMMER: 2 } as const
export const STRUM_DIRS = ['Off', 'Down', 'Up', 'Alternate'] as const
export const AMPS = ['Off (DI)', 'Clean', 'Crunch', 'Lead', 'Metal'] as const
export const AMP = { OFF: 0, CLEAN: 1, CRUNCH: 2, LEAD: 3, METAL: 4 } as const
export const PICKUPS = ['Neck', 'Middle', 'Bridge'] as const

/**
 * Keyswitches (MIDI keys, below the lowest playable note of every tuning). FL naming: 24 = C2.
 * Articulation keys latch; strum keys re-strum the chord that is held (or the last one) like Ample's strummer.
 */
export const KS = {
  SUSTAIN: 24,
  PALM: 26,
  MUTED: 28,
  HARMONIC: 29,
  STRUM_DOWN: 31,
  STRUM_UP: 33,
  STRUM_MUTE: 35
} as const
export const KS_LO = 24
export const KS_HI = 35

export const params: ParamDef[] = [
  { id: 'model', name: 'Guitar', min: 0, max: MODELS.length - 1, default: 0, options: [...MODELS] },
  { id: 'tuning', name: 'Tuning', min: 0, max: TUNINGS.length - 1, default: 0, options: TUNINGS.map((t) => t.name) },
  { id: 'art', name: 'Articulation', min: 0, max: ARTS.length - 1, default: 0, options: [...ARTS] },
  { id: 'mode', name: 'Play Mode', min: 0, max: PLAY_MODES.length - 1, default: 0, options: [...PLAY_MODES] },
  { id: 'strum', name: 'Chord Strum', min: 0, max: STRUM_DIRS.length - 1, default: 3, options: [...STRUM_DIRS] },
  { id: 'strumTime', name: 'Strum Time', min: 0, max: 120, default: 28, unit: 'ms' },
  { id: 'human', name: 'Humanize', min: 0, max: 1, default: 0.35, unit: '%' },
  { id: 'pickPos', name: 'Pick Position', min: 0.04, max: 0.5, default: 0.16, unit: '%' },
  { id: 'attack', name: 'Pick Attack', min: 0, max: 1, default: 0.55, unit: '%' },
  { id: 'tone', name: 'Tone', min: 0, max: 1, default: 0.55, unit: '%' },
  { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'body', name: 'Body', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'pickup', name: 'Pickup', min: 0, max: PICKUPS.length - 1, default: 2, options: [...PICKUPS] },
  { id: 'noise', name: 'Fret Noise', min: 0, max: 1, default: 0.35, unit: '%' },
  { id: 'glide', name: 'Slide Time', min: 10, max: 400, default: 70, unit: 'ms', curve: 'exp' },
  { id: 'vibrato', name: 'Vibrato', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'vibRate', name: 'Vibrato Rate', min: 3, max: 8, default: 5.5, unit: 'Hz' },
  { id: 'amp', name: 'Amp', min: 0, max: AMPS.length - 1, default: 0, options: [...AMPS] },
  { id: 'gain', name: 'Gain', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'bass', name: 'Bass', min: -12, max: 12, default: 0, unit: 'dB' },
  { id: 'mid', name: 'Mid', min: -12, max: 12, default: 0, unit: 'dB' },
  { id: 'treble', name: 'Treble', min: -12, max: 12, default: 0, unit: 'dB' },
  { id: 'gate', name: 'Noise Gate', min: 0, max: 1, default: 0.3, unit: '%' },
  { id: 'double', name: 'Double Track', min: 0, max: 1, default: 0, step: 1, options: ['Off', 'On'] },
  { id: 'width', name: 'Width', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'reverb', name: 'Room', min: 0, max: 1, default: 0.15, unit: '%' },
  { id: 'volume', name: 'Volume', min: -24, max: 12, default: 0, unit: 'dB' }
]

const P = (name: string, category: string, values: Record<string, number>): Preset => ({ name, category, params: values })

export const presets: Preset[] = [
  P('Steel Acoustic', 'Acoustic', {}),
  P('Steel Acoustic · Strummed', 'Acoustic', { strum: 3, strumTime: 38, attack: 0.65, reverb: 0.2 }),
  P('Steel Acoustic · Fingerpicked', 'Acoustic', { strum: 0, attack: 0.25, pickPos: 0.22, tone: 0.45, noise: 0.45, reverb: 0.2 }),
  P('Steel Acoustic · Strummer Keys', 'Acoustic', { mode: 2, strumTime: 34, attack: 0.6, reverb: 0.18 }),
  P('Steel Acoustic · Bright Pop', 'Acoustic', { strum: 3, strumTime: 24, attack: 0.8, tone: 0.75, body: 0.45, double: 1, width: 0.9, reverb: 0.22 }),
  P('Steel Acoustic · Open G Slide', 'Acoustic', { tuning: 5, mode: 1, glide: 140, vibrato: 0.3, reverb: 0.25 }),
  P('Nylon Classical', 'Classical', { model: 1, strum: 0, attack: 0.3, pickPos: 0.2, tone: 0.45, body: 0.7, reverb: 0.25 }),
  P('Nylon Classical · Bossa', 'Classical', { model: 1, strum: 2, strumTime: 18, attack: 0.25, tone: 0.4, body: 0.65, reverb: 0.2 }),
  P('Nylon Classical · Rasgueado', 'Classical', { model: 1, strum: 3, strumTime: 55, attack: 0.7, tone: 0.55, reverb: 0.25 }),
  P('Nylon Classical · Concert Hall', 'Classical', { model: 1, strum: 0, attack: 0.35, tone: 0.5, body: 0.75, sustain: 0.7, reverb: 0.45, width: 0.75 }),
  P('Clean Single-Coil', 'Electric', { model: 2, amp: 1, gain: 0.3, pickup: 1, strum: 3, strumTime: 22, tone: 0.6, reverb: 0.18 }),
  P('Funk Rhythm', 'Electric', { model: 2, amp: 1, gain: 0.25, pickup: 1, strum: 3, strumTime: 12, attack: 0.8, tone: 0.7, sustain: 0.35, treble: 3, reverb: 0.08 }),
  P('Country Twang', 'Electric', { model: 2, amp: 1, gain: 0.35, pickup: 2, attack: 0.85, tone: 0.75, treble: 4, mid: -2, reverb: 0.15 }),
  P('Jazz Hollow-Body', 'Electric', { model: 4, amp: 1, gain: 0.2, pickup: 0, strum: 0, attack: 0.3, tone: 0.3, treble: -4, bass: 2, reverb: 0.18 }),
  P('Ambient Clean', 'Electric', { model: 2, amp: 1, gain: 0.3, pickup: 0, attack: 0.35, tone: 0.55, sustain: 0.85, vibrato: 0.15, double: 1, width: 1, reverb: 0.6 }),
  P('Crunch Rhythm', 'Electric', { model: 3, amp: 2, gain: 0.55, pickup: 2, strum: 3, strumTime: 16, attack: 0.7, mid: 2, reverb: 0.12 }),
  P('Classic Rock Lead', 'Electric', { model: 3, amp: 3, gain: 0.6, pickup: 0, mode: 1, strum: 0, glide: 60, vibrato: 0.45, mid: 3, reverb: 0.25 }),
  P('Drop D Grunge', 'Electric', { model: 3, amp: 2, gain: 0.8, tuning: 1, pickup: 2, strum: 1, strumTime: 10, attack: 0.75, double: 1, width: 0.85, reverb: 0.1 }),
  P('Metal Rhythm (Double)', 'Metal', { model: 3, amp: 4, gain: 0.75, pickup: 2, strum: 1, strumTime: 8, attack: 0.8, tone: 0.6, bass: 2, mid: -4, treble: 2, gate: 0.6, double: 1, width: 1, reverb: 0.05 }),
  P('Metal Rhythm · Drop C', 'Metal', { model: 3, amp: 4, gain: 0.85, tuning: 4, pickup: 2, strum: 1, strumTime: 6, attack: 0.85, bass: 3, mid: -5, treble: 2, gate: 0.7, double: 1, width: 1, reverb: 0.04 }),
  P('Metal Palm Mute Chugs', 'Metal', { model: 3, amp: 4, gain: 0.8, art: 1, pickup: 2, strum: 1, strumTime: 5, attack: 0.9, bass: 3, mid: -4, gate: 0.7, double: 1, width: 1, reverb: 0.04 }),
  P('Shred Lead', 'Metal', { model: 3, amp: 3, gain: 0.85, pickup: 2, mode: 1, strum: 0, glide: 45, vibrato: 0.5, vibRate: 6, attack: 0.75, mid: 4, reverb: 0.3, gate: 0.4 })
]

/** Guitar: physically modelled acoustic, classical and electric guitars with strumming, legato and an amp. */
export const manifest: PluginManifest = {
  id: 'guitar',
  name: 'Guitar',
  kind: 'instrument',
  category: 'Synths',
  description:
    'Modelled steel-string acoustic, nylon classical and electric guitars: every note is played on a real string and fret, chords strum, solos slide and hammer on, palm mutes and harmonics, keyswitches, double tracking and a built-in amp & cab.',
  color: '#c98a4b',
  params,
  presets
}
