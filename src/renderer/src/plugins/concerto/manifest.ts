import type { ParamDef, PluginManifest, Preset } from '../sdk/types'
import { ENSEMBLES, INSTRUMENTS } from './instruments.gen'
import { DEFAULT_INSTRUMENT, layer, type ConcertoData } from './types'

export const MAX_ARTS = 5
export const PITCH_OPTIONS = ['A=440', 'A=430', 'A=415']
/** semitone offsets for PITCH_OPTIONS */
export const PITCH_SEMIS = [0, 12 * Math.log2(430 / 440), 12 * Math.log2(415 / 440)]

export const params: ParamDef[] = [
  { id: 'art', name: 'Articulation', min: 0, max: MAX_ARTS - 1, default: 0, options: Array.from({ length: MAX_ARTS }, (_, i) => `Art ${i + 1}`) },
  { id: 'attack', name: 'Attack', min: 0, max: 2000, default: 0, unit: 'ms', curve: 'exp' },
  { id: 'release', name: 'Release', min: 0.02, max: 6, default: 0.5, unit: 's', curve: 'exp' },
  { id: 'vibrato', name: 'Vibrato', min: 0, max: 100, default: 0, unit: '%', step: 1 },
  { id: 'vibRate', name: 'Vibrato Rate', min: 3.5, max: 8, default: 5.4, unit: 'Hz' },
  { id: 'expr', name: 'Expression', min: 0, max: 100, default: 100, unit: '%', step: 1 },
  { id: 'bright', name: 'Brightness', min: 0, max: 100, default: 80, unit: '%', step: 1 },
  { id: 'velSens', name: 'Velocity', min: 0, max: 100, default: 100, unit: '%', step: 1 },
  { id: 'legato', name: 'Legato', min: 0, max: 1, default: 0, options: ['Off', 'On'] },
  { id: 'glide', name: 'Glide', min: 0, max: 1000, default: 80, unit: 'ms', curve: 'exp' },
  { id: 'reverb', name: 'Reverb', min: 0, max: 100, default: 25, unit: '%', step: 1 },
  { id: 'size', name: 'Hall Size', min: 0, max: 100, default: 60, unit: '%', step: 1 },
  { id: 'seat', name: 'Seating', min: 0, max: 1, default: 0, options: ['Orchestral', 'Centre'] },
  { id: 'pan', name: 'Stage Position', min: -100, max: 100, default: 0, step: 1 },
  { id: 'width', name: 'Width', min: 0, max: 100, default: 100, unit: '%', step: 1 },
  { id: 'pitch', name: 'Tuning', min: 0, max: PITCH_OPTIONS.length - 1, default: 0, options: PITCH_OPTIONS },
  { id: 'volume', name: 'Volume', min: -36, max: 12, default: 0, unit: 'dB' }
]

const single = (inst: string): ConcertoData => ({ layers: [layer(inst)] })

function buildPresets(): Preset[] {
  const out: Preset[] = []
  for (const i of INSTRUMENTS) {
    const solo: Record<string, number> = i.solo ? { legato: 1, glide: 70 } : {}
    out.push({ name: i.name, category: i.section, params: { ...solo }, data: single(i.id) })
    i.arts.forEach((a, k) => {
      if (k === 0 || k >= MAX_ARTS) return
      out.push({ name: `${i.name} · ${a.name}`, category: i.section, params: { art: k, ...(a.kind === 'sustain' ? solo : {}) }, data: single(i.id) })
    })
  }
  const extra: [string, string, string, Record<string, number>][] = [
    ['Solo Violin · Expressive', 'violin', 'Strings', { legato: 1, glide: 140, vibrato: 25, reverb: 32, size: 70 }],
    ['Violins · Soft Pad', 'violins', 'Strings', { attack: 450, release: 1.4, bright: 60, reverb: 40, size: 75 }],
    ['String Ensemble · Classical Hall', 'strings', 'Strings', { reverb: 38, size: 72 }],
    ['Harpsichord · Dry Studio', 'harpsichord', 'Keys', { reverb: 8, size: 25 }],
    ['Harpsichord · Baroque Pitch', 'harpsichord', 'Keys', { pitch: 2, reverb: 22, size: 45 }],
    ['Pipe Organ · Cathedral', 'organ', 'Keys', { reverb: 60, size: 100, release: 1.2 }],
    ['Fortepiano · Salon', 'fortepiano', 'Keys', { reverb: 20, size: 40, pitch: 1 }],
    ['Choir · Cathedral Aahs', 'choir', 'Choir', { reverb: 55, size: 95, attack: 180, release: 1.6 }],
    ['Timpani · Thunder Roll', 'timpani', 'Percussion', { art: 1, reverb: 40, size: 80 }],
    ['Suspended Cymbal · Roll Swell', 'suscymbal', 'Percussion', { art: 3, attack: 2000, reverb: 40, size: 80 }],
    ['Gong · Cathedral Tam-tam', 'gong', 'Percussion', { reverb: 50, size: 95 }],
    ['Harp · Concert', 'harp', 'Plucked', { reverb: 35, size: 70 }]
  ]
  for (const [name, inst, cat, p] of extra) if (INSTRUMENTS.some((i) => i.id === inst)) out.push({ name, category: cat, params: p, data: single(inst) })
  for (const e of ENSEMBLES) {
    if (!e.layers.every((l) => INSTRUMENTS.some((i) => i.id === l.inst))) continue
    out.push({
      name: e.name,
      category: 'Ensembles',
      params: { reverb: 32, size: 68 },
      data: { layers: e.layers.map((l) => layer(l.inst, { lo: l.lo, hi: l.hi, gain: l.gain, transpose: l.transpose ?? 0, ...(l.art ? { art: l.art } : {}) })) } satisfies ConcertoData
    })
  }
  return out
}

export const presets = buildPresets()

export const manifest: PluginManifest = {
  id: 'concerto',
  name: 'Concerto',
  kind: 'instrument',
  category: 'Synths',
  description: 'Sampled Baroque & Classical orchestra: strings, winds, brass, harpsichord, organs, choir, timpani, cymbals, gong, harp — articulations with keyswitches, legato, layered ensembles, hall reverb and orchestral seating.',
  color: '#c9a45c',
  params,
  presets,
  defaultData: single(DEFAULT_INSTRUMENT) satisfies ConcertoData
}
