// Bassline parameter definitions. Pure data: imported by the UI and by the AudioWorklet DSP.
import type { ParamDef } from '../sdk/types'

export const ENGINES = ['Analog', 'Acid 303', 'FM', 'Growl', '808 / Sub', 'Physical'] as const
export const ENG = { ANALOG: 0, ACID: 1, FM: 2, GROWL: 3, SUB808: 4, PHYS: 5 } as const

export const OSC_WAVES = ['Saw', 'Square', 'Pulse', 'Tri', 'Sine']
export const FILTER_TYPES = ['Off', 'Ladder 24', 'Diode 303', 'LP 12', 'BP 12', 'HP 12']
export const LFO_WAVES = ['Sine', 'Tri', 'Saw Dn', 'Saw Up', 'Square', 'S&H']
/** Tempo-synced LFO divisions; value = length of one LFO cycle in beats (0 = free running Hz). */
export const LFO_SYNC = ['Free', '1/1', '1/2', '1/2T', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32', '3/16', '3/8', '2/1']
export const LFO_SYNC_BEATS = [0, 4, 2, 4 / 3, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125, 0.75, 1.5, 8]
export const FM_ALGOS = ['4>3>2>1', '2>1 + 4>3', '2+3+4>1', '4>3>1 + 2>1']
export const SUB8_WAVES = ['Sine', 'Triangle', 'Sine+Harm']
export const PHYS_MODELS = ['Finger', 'Pick', 'Slap', 'Fretless', 'Upright']
export const SUB_WAVES = ['Sine', 'Triangle', 'Square']
export const SUB_OCT = ['-1 Oct', '-2 Oct']
export const VOICE_MODES = ['Poly', 'Mono', 'Legato']
export const DRIVE_MODES = ['Tape', 'Tube', 'Fuzz', 'Fold']

const sec = (id: string, name: string, min: number, max: number, def: number): ParamDef => ({ id, name, min, max, default: def, unit: 's', curve: 'exp' })
const pct = (id: string, name: string, def: number, hidden = false): ParamDef => ({ id, name, min: 0, max: 1, default: def, unit: '%', hidden })
const bip = (id: string, name: string, def = 0): ParamDef => ({ id, name, min: -1, max: 1, default: def })
const opt = (id: string, name: string, options: readonly string[], def = 0): ParamDef => ({ id, name, min: 0, max: options.length - 1, default: def, step: 1, options: [...options] })
const db = (id: string, name: string): ParamDef => ({ id, name, min: -12, max: 12, default: 0, unit: 'dB' })

export const PARAMS: ParamDef[] = [
  // ── global / voicing ──
  opt('engine', 'Engine', ENGINES, 0),
  opt('voice.mode', 'Voicing', VOICE_MODES, 2),
  { id: 'glide', name: 'Glide', min: 0, max: 1.5, default: 0.05, unit: 's', curve: 'exp' },
  pct('vel.sens', 'Vel Sens', 0.5),
  pct('master.gain', 'Volume', 0.7),
  { id: 'tempo', name: 'Tempo', min: 20, max: 400, default: 140, unit: 'BPM', hidden: true },

  // ── analog oscillators ──
  opt('osc1.wave', 'Osc 1', OSC_WAVES, 0),
  { id: 'osc1.pw', name: 'PW', min: 0.05, max: 0.95, default: 0.5 },
  pct('osc1.level', 'Osc1 Lvl', 1),
  opt('osc2.wave', 'Osc 2', OSC_WAVES, 0),
  pct('osc2.level', 'Osc2 Lvl', 0),
  { id: 'osc2.semi', name: 'Semi', min: -24, max: 24, default: 0, step: 1, unit: 'st' },
  { id: 'osc2.detune', name: 'Detune', min: -50, max: 50, default: 0, unit: 'ct' },
  { id: 'osc.uni', name: 'Unison', min: 1, max: 3, default: 1, step: 1 },
  { id: 'osc.spread', name: 'Spread', min: 0, max: 50, default: 12, unit: 'ct' },
  pct('noise.level', 'Noise', 0),

  // ── filter ──
  opt('flt.type', 'Filter', FILTER_TYPES, 1),
  { id: 'flt.cutoff', name: 'Cutoff', min: 30, max: 18000, default: 900, unit: 'Hz', curve: 'exp' },
  pct('flt.res', 'Resonance', 0.2),
  bip('flt.env', 'Env Mod', 0.4),
  pct('flt.key', 'Key Track', 0.3),
  pct('flt.vel', 'Vel>Cut', 0.3),
  pct('flt.drive', 'Flt Drive', 0.2),
  sec('fenv.a', 'F Attack', 0.0005, 2, 0.002),
  sec('fenv.d', 'F Decay', 0.01, 4, 0.3),
  pct('fenv.s', 'F Sustain', 0),
  sec('fenv.r', 'F Release', 0.005, 4, 0.1),

  // ── acid ──
  pct('acid.accent', 'Accent', 0.6),
  { id: 'acid.thr', name: 'Acc Thresh', min: 0.5, max: 1, default: 0.85 },

  // ── amp ──
  sec('amp.a', 'Attack', 0.0005, 2, 0.002),
  sec('amp.d', 'Decay', 0.01, 8, 0.6),
  pct('amp.s', 'Sustain', 0.8),
  sec('amp.r', 'Release', 0.005, 4, 0.08),

  // ── LFO ──
  opt('lfo.wave', 'LFO Wave', LFO_WAVES, 0),
  opt('lfo.sync', 'LFO Sync', LFO_SYNC, 0),
  { id: 'lfo.rate', name: 'LFO Rate', min: 0.05, max: 20, default: 2, unit: 'Hz', curve: 'exp' },
  bip('lfo.cutoff', 'LFO>Cut', 0),
  { id: 'lfo.pitch', name: 'LFO>Pitch', min: 0, max: 12, default: 0, unit: 'st', curve: 'exp' },
  pct('lfo.amp', 'LFO>Amp', 0),
  pct('lfo.wt', 'LFO>Timbre', 0),
  opt('lfo.retrig', 'Retrig', ['Off', 'On'], 1),

  // ── FM ──
  opt('fm.algo', 'Algorithm', FM_ALGOS, 0),
  { id: 'fm.r1', name: 'Ratio 1', min: 0.5, max: 4, default: 1, step: 0.5 },
  { id: 'fm.r2', name: 'Ratio 2', min: 0.5, max: 16, default: 1, step: 0.5 },
  { id: 'fm.r3', name: 'Ratio 3', min: 0.5, max: 16, default: 2, step: 0.5 },
  { id: 'fm.r4', name: 'Ratio 4', min: 0.5, max: 16, default: 1, step: 0.5 },
  pct('fm.i2', 'Index 2', 0.5),
  pct('fm.i3', 'Index 3', 0.3),
  pct('fm.i4', 'Index 4', 0.2),
  sec('fm.d2', 'Decay 2', 0.01, 4, 0.3),
  sec('fm.d3', 'Decay 3', 0.01, 4, 0.2),
  sec('fm.d4', 'Decay 4', 0.01, 4, 0.5),
  pct('fm.sus', 'Mod Sus', 0.15),
  pct('fm.fb', 'Feedback', 0.2),
  pct('fm.vel', 'Vel>Index', 0.5),

  // ── growl / wavetable ──
  pct('wt.morph', 'Morph', 0.5),
  { id: 'wt.sync', name: 'Sync', min: 1, max: 8, default: 1 },
  pct('wt.fm', 'FM', 0),
  pct('wt.fold', 'Fold', 0),
  pct('wt.vowel', 'Vowel', 0.3),
  pct('wt.formant', 'Formant', 0.5),

  // ── 808 / sub ──
  opt('s8.wave', '808 Wave', SUB8_WAVES, 0),
  { id: 's8.pitch', name: 'Pitch Env', min: 0, max: 36, default: 12, unit: 'st' },
  sec('s8.ptime', 'Pitch Time', 0.005, 0.5, 0.05),
  pct('s8.click', 'Click', 0.3),

  // ── physical ──
  opt('ph.model', 'Model', PHYS_MODELS, 0),
  { id: 'ph.pickup', name: 'Pickup', min: 0.03, max: 0.5, default: 0.18 },
  { id: 'ph.pluck', name: 'Pluck Pos', min: 0.04, max: 0.5, default: 0.2 },
  pct('ph.bright', 'Bright', 0.5),
  sec('ph.decay', 'Sustain', 0.2, 12, 3),
  pct('ph.damp', 'Damping', 0.4),
  pct('ph.buzz', 'Fret Buzz', 0.1),
  pct('ph.pop', 'Pop/Slap', 0.5),
  pct('ph.body', 'Body', 0.2),
  pct('ph.mwah', 'Mwah', 0),

  // ── sub layer ──
  pct('sub.level', 'Sub', 0),
  opt('sub.wave', 'Sub Wave', SUB_WAVES, 0),
  opt('sub.oct', 'Sub Oct', SUB_OCT, 0),

  // ── drive & output FX ──
  pct('drive', 'Drive', 0),
  opt('drv.mode', 'Drive Type', DRIVE_MODES, 0),
  db('eq.low', 'Low'),
  db('eq.mid', 'Mid'),
  db('eq.high', 'High'),
  pct('punch', 'Punch', 0.3),
  pct('chorus', 'Chorus', 0),
  { id: 'chorus.rate', name: 'Ch Rate', min: 0.1, max: 5, default: 0.7, unit: 'Hz', curve: 'exp' }
]
