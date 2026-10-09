// Polygon "virtual ROM" waveform directory. Pure data: imported by the manifest (UI + DSP) and rom.ts.
// Order matters: the `tN.wave` parameter stores an index into this list.

export interface WaveInfo {
  name: string
  group: 'Synth' | 'Keys' | 'Mallet' | 'Strings' | 'Vocal' | 'Wind' | 'Brass' | 'Bass' | 'Pluck' | 'Ethnic' | 'Hit' | 'Atmos'
}

export const WAVES: WaveInfo[] = [
  { name: 'Saw', group: 'Synth' },
  { name: 'Square', group: 'Synth' },
  { name: 'Pulse 25', group: 'Synth' },
  { name: 'Sine', group: 'Synth' },
  { name: 'Spectrum', group: 'Synth' },
  { name: 'Saw Ens', group: 'Synth' },
  { name: 'Warm Pad', group: 'Synth' },
  { name: 'Digital Bell', group: 'Mallet' },
  { name: 'Glass Atk', group: 'Mallet' },
  { name: 'Bell Loop', group: 'Mallet' },
  { name: 'Vibes', group: 'Mallet' },
  { name: 'Marimba', group: 'Mallet' },
  { name: 'Glocken', group: 'Mallet' },
  { name: 'Piano Atk', group: 'Keys' },
  { name: 'M1 Piano', group: 'Keys' },
  { name: 'DX EP', group: 'Keys' },
  { name: 'Organ', group: 'Keys' },
  { name: 'Strings Sus', group: 'Strings' },
  { name: 'Pizz', group: 'Strings' },
  { name: 'Choir Aah', group: 'Vocal' },
  { name: 'Vox', group: 'Vocal' },
  { name: 'Brass Sus', group: 'Brass' },
  { name: 'Horn', group: 'Brass' },
  { name: 'Flute', group: 'Wind' },
  { name: 'Pan Flute', group: 'Wind' },
  { name: 'Ocarina', group: 'Wind' },
  { name: 'Reed', group: 'Wind' },
  { name: 'Breath', group: 'Wind' },
  { name: 'Slap', group: 'Bass' },
  { name: 'Pick Bass', group: 'Bass' },
  { name: 'Fretless', group: 'Bass' },
  { name: 'Digi Bass', group: 'Bass' },
  { name: 'Harp', group: 'Pluck' },
  { name: 'Nylon Gtr', group: 'Pluck' },
  { name: 'Sitar', group: 'Ethnic' },
  { name: 'Koto', group: 'Ethnic' },
  { name: 'Kalimba', group: 'Ethnic' },
  { name: 'Steel Drum', group: 'Ethnic' },
  { name: 'Accordion', group: 'Ethnic' },
  { name: 'Shakuhachi', group: 'Ethnic' },
  { name: 'Orch Hit', group: 'Hit' },
  { name: 'Timpani', group: 'Hit' },
  { name: 'Noise', group: 'Atmos' },
  { name: 'Metal', group: 'Atmos' },
  { name: 'Ice Wave', group: 'Atmos' }
]

export const WAVE_NAMES = WAVES.map((w) => w.name)

export function waveIndex(name: string): number {
  const i = WAVE_NAMES.indexOf(name)
  if (i < 0) throw new Error(`Polygon: unknown wave "${name}"`)
  return i
}
