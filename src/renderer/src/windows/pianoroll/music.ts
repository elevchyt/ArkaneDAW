// Pure music helpers for the piano roll: FL note naming, scales, chords, note colors, time formatting.
import { PPQ, TICKS_PER_STEP } from '@/store/types'

export const MAX_KEY = 131 // B10
export const KEY_COUNT = MAX_KEY + 1
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** FL Studio naming: C5 = MIDI 60. */
export const noteName = (key: number): string => `${NOTE_NAMES[((key % 12) + 12) % 12]}${Math.floor(key / 12)}`

const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false]
export const isBlack = (key: number): boolean => BLACK[((key % 12) + 12) % 12]

export interface ScaleDef {
  name: string
  steps: number[]
}

export const SCALES: Record<string, ScaleDef> = {
  none: { name: '(none)', steps: [] },
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { name: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { name: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  majorPenta: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  minorPenta: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  wholeTone: { name: 'Whole tone', steps: [0, 2, 4, 6, 8, 10] },
  phrygianDominant: { name: 'Phrygian dominant', steps: [0, 1, 4, 5, 7, 8, 10] },
  hungarianMinor: { name: 'Hungarian minor', steps: [0, 2, 3, 6, 7, 8, 11] }
}

export function inScale(key: number, root: number, scale: string): boolean {
  const s = SCALES[scale]
  if (!s || s.steps.length === 0) return true
  return s.steps.includes((((key - root) % 12) + 12) % 12)
}

export const CHORDS: Record<string, { name: string; iv: number[] }> = {
  major: { name: 'Major', iv: [0, 4, 7] },
  minor: { name: 'Minor', iv: [0, 3, 7] },
  dim: { name: 'Diminished', iv: [0, 3, 6] },
  aug: { name: 'Augmented', iv: [0, 4, 8] },
  sus2: { name: 'Sus2', iv: [0, 2, 7] },
  sus4: { name: 'Sus4', iv: [0, 5, 7] },
  power: { name: 'Power (5)', iv: [0, 7, 12] },
  maj7: { name: 'Major 7th', iv: [0, 4, 7, 11] },
  min7: { name: 'Minor 7th', iv: [0, 3, 7, 10] },
  dom7: { name: 'Dominant 7th', iv: [0, 4, 7, 10] },
  m7b5: { name: 'Half-diminished', iv: [0, 3, 6, 10] },
  add9: { name: 'Add9', iv: [0, 4, 7, 14] },
  min9: { name: 'Minor 9th', iv: [0, 3, 7, 10, 14] },
  maj9: { name: 'Major 9th', iv: [0, 4, 7, 11, 14] },
  octave: { name: 'Octave', iv: [0, 12] }
}

/** 16 note color groups (FL "color/MIDI channel"). Group 0 is the classic FL green. */
export const NOTE_COLORS = [
  '#8fe19a', '#8fe1c6', '#8fd2e1', '#8fb3e1', '#9b9be6', '#b498e6', '#d097e3', '#e394cf',
  '#e8949e', '#e8a48c', '#e8bd85', '#e3d585', '#c9e385', '#a8e388', '#a3c4b0', '#b6bfc4'
]

export function noteColor(group: number): string {
  return NOTE_COLORS[((group % 16) + 16) % 16]
}

export const beatTicks = (timeSig: [number, number]): number => (PPQ * 4) / timeSig[1]
export const barLen = (timeSig: [number, number]): number => beatTicks(timeSig) * timeSig[0]

/** FL style B:S:T (1-based bar and step, ticks within the step). */
export function formatTime(ticks: number, timeSig: [number, number]): string {
  const bar = barLen(timeSig)
  const t = Math.max(0, Math.round(ticks))
  const b = Math.floor(t / bar)
  const inBar = t - b * bar
  const s = Math.floor(inBar / TICKS_PER_STEP)
  const k = inBar - s * TICKS_PER_STEP
  return `${b + 1}:${String(s + 1).padStart(2, '0')}:${String(k).padStart(2, '0')}`
}

/** Length as B:S:T without the 1-based offsets. */
export function formatLength(ticks: number, timeSig: [number, number]): string {
  const bar = barLen(timeSig)
  const t = Math.max(0, Math.round(ticks))
  const b = Math.floor(t / bar)
  const inBar = t - b * bar
  const s = Math.floor(inBar / TICKS_PER_STEP)
  const k = inBar - s * TICKS_PER_STEP
  return `${b}:${String(s).padStart(2, '0')}:${String(k).padStart(2, '0')}`
}

/** Parse "B:S:T" (or "B:S", "B"). `oneBased` for positions, false for lengths. */
export function parseTime(str: string, timeSig: [number, number], oneBased: boolean): number | null {
  const parts = str.trim().split(/[:.]/).map((x) => x.trim())
  if (parts.length === 0 || parts.length > 3 || parts.some((x) => !/^\d+$/.test(x))) return null
  const [b, s = oneBased ? '1' : '0', k = '0'] = parts
  const off = oneBased ? 1 : 0
  const bn = Number(b) - off
  const sn = Number(s) - off
  if (bn < 0 || sn < 0) return null
  return bn * barLen(timeSig) + sn * TICKS_PER_STEP + Number(k)
}
