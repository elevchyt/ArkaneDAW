// Mosaic data model. Pure data — imported by the DSP (worklet), the editor and the presets.
//
// A Mosaic "Performance" (one preset) = global params (manifest: Super Knob, quick edits, FX)
// + `data` = up to 4 Parts. Each Part has a sound engine and a flat param map: common params
// (level, pan, key/vel range, amp env, filter, LFO, play mode) plus that engine's own params.
import type { ParamDef } from '../sdk/types'

export const ENGINES = [
  { id: 'piano', name: 'Acoustic Piano', short: 'PIANO', color: '#e8c872' },
  { id: 'epiano', name: 'Electric Piano', short: 'E.PIANO', color: '#f09a5b' },
  { id: 'organ', name: 'Organ', short: 'ORGAN', color: '#d9655b' },
  { id: 'fm', name: 'FM (6-op)', short: 'FM', color: '#b48cf0' },
  { id: 'pluck', name: 'Plucked / Bowed', short: 'STRING', color: '#8fd16a' },
  { id: 'analog', name: 'Analog / Supersaw', short: 'ANALOG', color: '#5fb8f0' },
  { id: 'choir', name: 'Choir / Formant', short: 'VOICE', color: '#f07fb8' },
  { id: 'mallet', name: 'Mallets / Bells', short: 'MALLET', color: '#6fe0c8' }
] as const

export type EngineId = (typeof ENGINES)[number]['id']
export const ENGINE_IDS: EngineId[] = ENGINES.map((e) => e.id)

export interface PartDef {
  on: boolean
  engine: EngineId
  /** Flat param map (common + engine). Missing keys fall back to defaults. */
  p: Record<string, number>
}

export interface SuperAssign {
  dest: SuperDestId
  /** Offset applied at Super Knob = 100% (in the destination's unit). */
  amt: number
  /** Part index 0..3, or -1 = all parts (ignored by FX destinations). */
  part: number
}

export interface WSData {
  v: 1
  parts: PartDef[]
  superKnob: SuperAssign[]
}

export const NUM_PARTS = 4

// ─── common part params ───────────────────────────────────────────────────────
export const FILTER_TYPES = ['Off', 'LP 12', 'LP 24', 'HP 12', 'BP 12']
export const LFO_SHAPES = ['Sine', 'Tri', 'Saw', 'Square', 'S&H']
export const PLAY_MODES = ['Poly', 'Mono', 'Legato']

export const PART_PARAMS: ParamDef[] = [
  { id: 'level', name: 'Level', min: 0, max: 1, default: 0.8, unit: '%' },
  { id: 'pan', name: 'Pan', min: -1, max: 1, default: 0 },
  { id: 'transpose', name: 'Transpose', min: -48, max: 48, default: 0, step: 1, unit: 'st' },
  { id: 'fine', name: 'Fine', min: -100, max: 100, default: 0, unit: 'ct' },
  { id: 'keyLo', name: 'Key Low', min: 0, max: 127, default: 0, step: 1 },
  { id: 'keyHi', name: 'Key High', min: 0, max: 127, default: 127, step: 1 },
  { id: 'velLo', name: 'Vel Low', min: 1, max: 127, default: 1, step: 1 },
  { id: 'velHi', name: 'Vel High', min: 1, max: 127, default: 127, step: 1 },
  { id: 'mode', name: 'Play Mode', min: 0, max: 2, default: 0, options: PLAY_MODES },
  { id: 'porta', name: 'Portamento', min: 0, max: 2, default: 0, unit: 's', curve: 'exp' },
  { id: 'velSens', name: 'Vel Sens', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'amp.a', name: 'Attack', min: 0.0005, max: 10, default: 0.002, unit: 's', curve: 'exp' },
  { id: 'amp.d', name: 'Decay', min: 0.01, max: 20, default: 1, unit: 's', curve: 'exp' },
  { id: 'amp.s', name: 'Sustain', min: 0, max: 1, default: 1, unit: '%' },
  { id: 'amp.r', name: 'Release', min: 0.005, max: 20, default: 0.3, unit: 's', curve: 'exp' },
  { id: 'flt.type', name: 'Filter', min: 0, max: 4, default: 0, options: FILTER_TYPES },
  { id: 'flt.cut', name: 'Cutoff', min: 20, max: 20000, default: 8000, unit: 'Hz', curve: 'exp' },
  { id: 'flt.res', name: 'Reso', min: 0, max: 1, default: 0.1, unit: '%' },
  { id: 'flt.env', name: 'Env Amt', min: -8, max: 8, default: 0, unit: 'oct' },
  { id: 'flt.key', name: 'Key Trk', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'flt.vel', name: 'Vel>Cut', min: 0, max: 4, default: 0, unit: 'oct' },
  { id: 'flt.a', name: 'F.Attack', min: 0.0005, max: 10, default: 0.002, unit: 's', curve: 'exp' },
  { id: 'flt.d', name: 'F.Decay', min: 0.01, max: 20, default: 0.6, unit: 's', curve: 'exp' },
  { id: 'flt.s', name: 'F.Sustain', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'flt.r', name: 'F.Release', min: 0.005, max: 20, default: 0.4, unit: 's', curve: 'exp' },
  { id: 'lfo.shape', name: 'LFO Shape', min: 0, max: 4, default: 0, options: LFO_SHAPES },
  { id: 'lfo.rate', name: 'LFO Rate', min: 0.05, max: 20, default: 5, unit: 'Hz', curve: 'exp' },
  { id: 'lfo.delay', name: 'LFO Delay', min: 0, max: 5, default: 0.3, unit: 's' },
  { id: 'lfo.pitch', name: 'Vibrato', min: 0, max: 100, default: 0, unit: 'ct' },
  { id: 'lfo.amp', name: 'Tremolo', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'lfo.flt', name: 'LFO>Cut', min: 0, max: 4, default: 0, unit: 'oct' }
]

// ─── engine params ────────────────────────────────────────────────────────────
const P = (id: string, name: string, min: number, max: number, def: number, extra: Partial<ParamDef> = {}): ParamDef => ({ id, name, min, max, default: def, ...extra })

export const PIANO_VARIANTS = ['Grand', 'Bright', 'Upright', 'Honky-tonk']
export const EP_VARIANTS = ['Tine', 'Reed', 'FM']
export const ORGAN_VARIANTS = ['Tonewheel', 'Pipe', 'Combo']
export const PLUCK_VARIANTS = ['Nylon', 'Steel', 'Electric', 'Harp', 'Koto', 'Pizzicato', 'Bowed']
export const CHOIR_VARIANTS = ['Choir', 'Voice Pad', 'Breathy']
export const MALLET_VARIANTS = ['Marimba', 'Vibraphone', 'Glockenspiel', 'Xylophone', 'Tubular Bells', 'Kalimba', 'Steel Drum', 'Celesta', 'Church Bell', 'Music Box']
export const FM_ALGOS = ['Stack 6>1', '2>1 + 6>5>4>3', '3 Pairs', '2>1 + (4,6>5)>3', '(2,4>3,6>5)>1', '2>1 + 6>(5,4,3)', '3>2>1 + 6>(5,4)', 'All Carriers']
export const DRAWBARS = ["16'", "5⅓'", "8'", "4'", "2⅔'", "2'", "1⅗'", "1⅓'", "1'"]
export const ANALOG_WAVES = ['Saw', 'Square', 'Pulse', 'Tri', 'Sine']

const fmOps: ParamDef[] = []
for (let o = 1; o <= 6; o++) {
  fmOps.push(
    P(`o${o}.r`, `Op${o} Ratio`, 0.5, 16, o === 1 ? 1 : o, { step: 0.01 }),
    P(`o${o}.d`, `Op${o} Detune`, -50, 50, 0, { unit: 'ct' }),
    P(`o${o}.l`, `Op${o} Level`, 0, 1, o === 1 ? 1 : 0, { unit: '%' }),
    P(`o${o}.a`, `Op${o} Attack`, 0.0005, 5, 0.001, { unit: 's', curve: 'exp' }),
    P(`o${o}.dc`, `Op${o} Decay`, 0.01, 20, 1.5, { unit: 's', curve: 'exp' }),
    P(`o${o}.s`, `Op${o} Sustain`, 0, 1, 0.5, { unit: '%' }),
    P(`o${o}.rl`, `Op${o} Release`, 0.005, 10, 0.3, { unit: 's', curve: 'exp' }),
    P(`o${o}.v`, `Op${o} Vel Sens`, 0, 1, 0.5, { unit: '%' }),
    P(`o${o}.k`, `Op${o} Key Scale`, 0, 1, 0.3, { unit: '%' })
  )
}

export const ENGINE_PARAMS: Record<EngineId, ParamDef[]> = {
  piano: [
    P('variant', 'Model', 0, 3, 0, { options: PIANO_VARIANTS }),
    P('hard', 'Hammer', 0, 1, 0.5, { unit: '%' }),
    P('decay', 'Sustain', 0.2, 3, 1, { curve: 'exp', unit: 'x' }),
    P('unison', 'Unison', 0, 1, 0.3, { unit: '%' }),
    P('strike', 'Strike Pos', 0.06, 0.2, 0.12),
    P('body', 'Soundboard', 0, 1, 0.5, { unit: '%' }),
    P('stretch', 'Stretch', 0, 1, 0.6, { unit: '%' }),
    P('noise', 'Hammer Noise', 0, 1, 0.4, { unit: '%' }),
    P('damper', 'Damper Noise', 0, 1, 0.4, { unit: '%' }),
    P('width', 'Width', 0, 1, 0.6, { unit: '%' })
  ],
  epiano: [
    P('variant', 'Model', 0, 2, 0, { options: EP_VARIANTS }),
    P('bark', 'Bark', 0, 1, 0.5, { unit: '%' }),
    P('tine', 'Tine', 0, 1, 0.5, { unit: '%' }),
    P('decay', 'Decay', 0.2, 3, 1, { curve: 'exp', unit: 'x' }),
    P('drive', 'Drive', 0, 1, 0.2, { unit: '%' }),
    P('trem.mode', 'Mod Type', 0, 1, 1, { options: ['Tremolo', 'Auto-Pan'] }),
    P('trem.rate', 'Mod Rate', 0.1, 10, 4, { unit: 'Hz', curve: 'exp' }),
    P('trem.depth', 'Mod Depth', 0, 1, 0.3, { unit: '%' })
  ],
  organ: [
    P('variant', 'Model', 0, 2, 0, { options: ORGAN_VARIANTS }),
    ...DRAWBARS.map((d, i) => P(`db${i + 1}`, d, 0, 8, [8, 8, 8, 0, 0, 0, 0, 0, 0][i], { step: 1 })),
    P('perc', 'Percussion', 0, 2, 0, { options: ['Off', '2nd', '3rd'] }),
    P('percFast', 'Perc Decay', 0, 1, 1, { options: ['Slow', 'Fast'] }),
    P('percSoft', 'Perc Vol', 0, 1, 0, { options: ['Normal', 'Soft'] }),
    P('vib', 'Vib/Chorus', 0, 6, 0, { options: ['Off', 'V1', 'V2', 'V3', 'C1', 'C2', 'C3'] }),
    P('click', 'Key Click', 0, 1, 0.5, { unit: '%' }),
    P('leak', 'Leakage', 0, 1, 0.3, { unit: '%' }),
    P('drive', 'Overdrive', 0, 1, 0.2, { unit: '%' }),
    P('rotary', 'Rotary', 0, 1, 1, { options: ['Off', 'On'] }),
    P('hornMix', 'Horn/Drum', 0, 1, 0.5, { unit: '%' })
  ],
  fm: [P('algo', 'Algorithm', 0, 7, 2, { options: FM_ALGOS }), P('fb', 'Feedback', 0, 1, 0, { unit: '%' }), ...fmOps],
  pluck: [
    P('variant', 'Model', 0, 6, 0, { options: PLUCK_VARIANTS }),
    P('bright', 'Brightness', 0, 1, 0.5, { unit: '%' }),
    P('decay', 'Sustain', 0.1, 3, 1, { curve: 'exp', unit: 'x' }),
    P('pos', 'Pluck Pos', 0.05, 0.5, 0.15),
    P('body', 'Body', 0, 1, 0.5, { unit: '%' }),
    P('bend', 'Pitch Drop', 0, 1, 0, { unit: '%' }),
    P('bow', 'Bow Noise', 0, 1, 0.3, { unit: '%' })
  ],
  analog: [
    P('wave', 'Wave', 0, 4, 0, { options: ANALOG_WAVES }),
    P('voices', 'Voices', 1, 7, 1, { step: 1 }),
    P('detune', 'Detune', 0, 1, 0.3, { unit: '%' }),
    P('spread', 'Spread', 0, 1, 0.6, { unit: '%' }),
    P('pw', 'Pulse W', 0.05, 0.95, 0.5),
    P('pwm', 'PWM', 0, 1, 0, { unit: '%' }),
    P('b.wave', 'Osc2 Wave', 0, 4, 0, { options: ANALOG_WAVES }),
    P('b.mix', 'Osc2 Mix', 0, 1, 0, { unit: '%' }),
    P('b.semi', 'Osc2 Semi', -24, 24, 0, { step: 1, unit: 'st' }),
    P('b.fine', 'Osc2 Fine', -50, 50, 7, { unit: 'ct' }),
    P('sub', 'Sub Osc', 0, 1, 0, { unit: '%' }),
    P('noise', 'Noise', 0, 1, 0, { unit: '%' }),
    P('drive', 'Drive', 0, 1, 0, { unit: '%' })
  ],
  choir: [
    P('variant', 'Model', 0, 2, 0, { options: CHOIR_VARIANTS }),
    P('vowel', 'Vowel', 0, 4, 0, { unit: '' }),
    P('gender', 'Gender', 0, 1, 0.5, { unit: '%' }),
    P('ens', 'Ensemble', 1, 4, 3, { step: 1 }),
    P('detune', 'Detune', 0, 1, 0.4, { unit: '%' }),
    P('breath', 'Breath', 0, 1, 0.2, { unit: '%' }),
    P('bright', 'Brightness', 0, 1, 0.5, { unit: '%' })
  ],
  mallet: [
    P('variant', 'Model', 0, 9, 0, { options: MALLET_VARIANTS }),
    P('hard', 'Mallet', 0, 1, 0.5, { unit: '%' }),
    P('decay', 'Decay', 0.1, 4, 1, { curve: 'exp', unit: 'x' }),
    P('motor', 'Motor', 0, 1, 0, { unit: '%' }),
    P('motorRate', 'Motor Rate', 0.5, 10, 5, { unit: 'Hz', curve: 'exp' }),
    P('detune', 'Inharm', 0, 1, 0, { unit: '%' }),
    P('noise', 'Click', 0, 1, 0.4, { unit: '%' })
  ]
}

export const VOWELS = ['A', 'E', 'I', 'O', 'U']

// ─── Super Knob destinations ─────────────────────────────────────────────────
export const SUPER_DESTS = [
  { id: 'cutoff', name: 'Filter Cutoff', min: -6, max: 6, unit: 'oct', fx: false },
  { id: 'reso', name: 'Resonance', min: -1, max: 1, unit: '', fx: false },
  { id: 'attack', name: 'Attack Time', min: -4, max: 4, unit: 'oct', fx: false },
  { id: 'release', name: 'Release Time', min: -4, max: 4, unit: 'oct', fx: false },
  { id: 'level', name: 'Part Level', min: -1, max: 1, unit: '', fx: false },
  { id: 'bright', name: 'Brightness', min: -1, max: 1, unit: '', fx: false },
  { id: 'drive', name: 'Drive', min: -1, max: 1, unit: '', fx: false },
  { id: 'vibrato', name: 'Vibrato', min: 0, max: 100, unit: 'ct', fx: false },
  { id: 'detune', name: 'Detune/Spread', min: -1, max: 1, unit: '', fx: false },
  { id: 'tremolo', name: 'Tremolo', min: -1, max: 1, unit: '', fx: false },
  { id: 'rotary', name: 'Rotary Fast', min: 0, max: 1, unit: '', fx: true },
  { id: 'eqLow', name: 'EQ Low', min: -12, max: 12, unit: 'dB', fx: true },
  { id: 'eqHigh', name: 'EQ High', min: -12, max: 12, unit: 'dB', fx: true },
  { id: 'chorus', name: 'Chorus Mix', min: -1, max: 1, unit: '', fx: true },
  { id: 'phaser', name: 'Phaser Mix', min: -1, max: 1, unit: '', fx: true },
  { id: 'delay', name: 'Delay Mix', min: -1, max: 1, unit: '', fx: true },
  { id: 'reverb', name: 'Reverb Mix', min: -1, max: 1, unit: '', fx: true }
] as const
export type SuperDestId = (typeof SUPER_DESTS)[number]['id']
export const SUPER_DEST_INDEX: Record<string, number> = Object.fromEntries(SUPER_DESTS.map((d, i) => [d.id, i]))
export const NUM_DESTS = SUPER_DESTS.length

// ─── helpers ──────────────────────────────────────────────────────────────────
const commonDefaults: Record<string, number> = Object.fromEntries(PART_PARAMS.map((d) => [d.id, d.default]))
const engineDefaults: Record<string, Record<string, number>> = Object.fromEntries(
  ENGINE_IDS.map((e) => [e, Object.fromEntries(ENGINE_PARAMS[e].map((d) => [d.id, d.default]))])
)

export function engineDefaultParams(engine: EngineId): Record<string, number> {
  return { ...engineDefaults[engine] }
}

/** Fully resolved param map for a part (defaults + overrides). */
export function resolvePart(def: PartDef): Record<string, number> {
  return { ...commonDefaults, ...(engineDefaults[def.engine] ?? {}), ...def.p }
}

export function paramDef(engine: EngineId, id: string): ParamDef | undefined {
  return PART_PARAMS.find((d) => d.id === id) ?? ENGINE_PARAMS[engine]?.find((d) => d.id === id)
}

export function emptyPart(engine: EngineId = 'piano', on = false): PartDef {
  return { on, engine, p: {} }
}

export function normalizeData(d: unknown): WSData {
  const x = (d ?? {}) as Partial<WSData>
  const parts: PartDef[] = []
  for (let i = 0; i < NUM_PARTS; i++) {
    const pt = x.parts?.[i]
    parts.push(
      pt && ENGINE_IDS.includes(pt.engine) ? { on: !!pt.on, engine: pt.engine, p: { ...(pt.p ?? {}) } } : emptyPart('piano', i === 0 && !x.parts)
    )
  }
  const superKnob = Array.isArray(x.superKnob) ? x.superKnob.filter((s) => s && s.dest in SUPER_DEST_INDEX) : []
  return { v: 1, parts, superKnob }
}

export const midiName = (k: number): string => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((k % 12) + 12) % 12] + (Math.floor(k / 12) - 1)
