import type { ParamDef, PluginManifest } from '../sdk/types'
import { TABLE_NAMES } from './wavetables'
import { TEXTURE_NAMES } from './textures'
import { PRESETS } from './presets'

export const LFO_SHAPES = ['Sine', 'Tri', 'Saw', 'Square', 'S&H', 'Drift']
export const LFO_DESTS = ['Position', 'Cutoff', 'Pitch', 'Volume', 'Pan', 'Grain Pos', 'Noise', 'Formant']
export const FILTER_MODES = ['LP 12', 'LP 24', 'BP', 'HP', 'Formant', 'Comb']
export const NOISE_BANKS = ['Harmonic', 'Odd', 'Fifths', 'Bell']
export const SHIMMER_INTERVALS = ['Oct', 'Fifth', 'Oct+5th', '2 Oct', 'Oct Down']

const lfo = (n: number, rate: number, dest: number): ParamDef[] => [
  { id: `lfo${n}.shape`, name: `LFO ${n} Shape`, min: 0, max: LFO_SHAPES.length - 1, default: 0, options: LFO_SHAPES },
  { id: `lfo${n}.rate`, name: `LFO ${n} Rate`, min: 0.01, max: 20, default: rate, unit: 'Hz', curve: 'exp' },
  { id: `lfo${n}.depth`, name: `LFO ${n} Depth`, min: 0, max: 1, default: 0.2, unit: '%' },
  { id: `lfo${n}.dest`, name: `LFO ${n} Dest`, min: 0, max: LFO_DESTS.length - 1, default: dest, options: LFO_DESTS }
]

export const PARAMS: ParamDef[] = [
  // macros
  { id: 'macro.evolve', name: 'Evolve', min: 0, max: 1, default: 0.4, unit: '%' },
  { id: 'macro.motion', name: 'Motion', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'macro.space', name: 'Space', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'macro.tone', name: 'Tone', min: 0, max: 1, default: 0.5, unit: '%' },
  // wavetable layer
  { id: 'wave.on', name: 'Wave On', min: 0, max: 1, default: 1, step: 1 },
  { id: 'wave.table', name: 'Table', min: 0, max: TABLE_NAMES.length - 1, default: 0, options: TABLE_NAMES },
  { id: 'wave.pos', name: 'Position', min: 0, max: 1, default: 0.3, unit: '%' },
  { id: 'wave.level', name: 'Wave Level', min: 0, max: 1, default: 0.8, unit: '%' },
  { id: 'wave.octave', name: 'Octave', min: -2, max: 2, default: 0, step: 1 },
  { id: 'wave.semi', name: 'Semi', min: -12, max: 12, default: 0, step: 1, unit: 'st' },
  { id: 'wave.unison', name: 'Unison', min: 1, max: 8, default: 4, step: 1 },
  { id: 'wave.detune', name: 'Detune', min: 0, max: 50, default: 12, unit: 'ct' },
  { id: 'wave.spread', name: 'Spread', min: 0, max: 1, default: 0.7, unit: '%' },
  { id: 'wave.envAmt', name: 'Pos Env', min: -1, max: 1, default: 0 },
  { id: 'wave.sub', name: 'Sub', min: 0, max: 1, default: 0, unit: '%' },
  // granular layer
  { id: 'gran.on', name: 'Grain On', min: 0, max: 1, default: 0, step: 1 },
  { id: 'gran.texture', name: 'Texture', min: 0, max: TEXTURE_NAMES.length - 1, default: 0, options: TEXTURE_NAMES },
  { id: 'gran.level', name: 'Grain Level', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'gran.pos', name: 'Grain Pos', min: 0, max: 1, default: 0.3, unit: '%' },
  { id: 'gran.size', name: 'Size', min: 10, max: 1000, default: 180, unit: 'ms', curve: 'exp' },
  { id: 'gran.density', name: 'Density', min: 1, max: 80, default: 16, unit: '/s', curve: 'exp' },
  { id: 'gran.spray', name: 'Spray', min: 0, max: 1, default: 0.2, unit: '%' },
  { id: 'gran.pitchRand', name: 'Pitch Rnd', min: 0, max: 12, default: 0.1, unit: 'st', curve: 'exp' },
  { id: 'gran.reverse', name: 'Reverse', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'gran.octave', name: 'Grain Oct', min: -2, max: 2, default: 0, step: 1 },
  { id: 'gran.shimmer', name: 'Oct Up', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'gran.scan', name: 'Scan', min: -1, max: 1, default: 0.1 },
  { id: 'gran.width', name: 'Width', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'gran.keytrack', name: 'Key Track', min: 0, max: 1, default: 1, unit: '%' },
  // noise / air layer
  { id: 'noise.on', name: 'Noise On', min: 0, max: 1, default: 0, step: 1 },
  { id: 'noise.level', name: 'Noise Level', min: 0, max: 1, default: 0.4, unit: '%' },
  { id: 'noise.color', name: 'Color', min: 100, max: 18000, default: 3000, unit: 'Hz', curve: 'exp' },
  { id: 'noise.tune', name: 'Tuned', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'noise.q', name: 'Resonance', min: 2, max: 300, default: 40, curve: 'exp' },
  { id: 'noise.bank', name: 'Bank', min: 0, max: NOISE_BANKS.length - 1, default: 0, options: NOISE_BANKS },
  { id: 'noise.octave', name: 'Noise Oct', min: -2, max: 2, default: 0, step: 1 },
  // filter
  { id: 'filter.mode', name: 'Filter', min: 0, max: FILTER_MODES.length - 1, default: 1, options: FILTER_MODES },
  { id: 'filter.cutoff', name: 'Cutoff', min: 30, max: 20000, default: 2500, unit: 'Hz', curve: 'exp' },
  { id: 'filter.res', name: 'Reso', min: 0, max: 1, default: 0.2, unit: '%' },
  { id: 'filter.envAmt', name: 'Env Amt', min: -1, max: 1, default: 0.2 },
  { id: 'filter.keytrack', name: 'Key Trk', min: 0, max: 1, default: 0.4, unit: '%' },
  { id: 'filter.vowel', name: 'Vowel', min: 0, max: 1, default: 0.5, unit: '%' },
  // envelopes
  { id: 'amp.attack', name: 'Attack', min: 0.001, max: 20, default: 1.2, unit: 's', curve: 'exp' },
  { id: 'amp.decay', name: 'Decay', min: 0.01, max: 20, default: 2, unit: 's', curve: 'exp' },
  { id: 'amp.sustain', name: 'Sustain', min: 0, max: 1, default: 0.85, unit: '%' },
  { id: 'amp.release', name: 'Release', min: 0.01, max: 30, default: 3, unit: 's', curve: 'exp' },
  { id: 'amp.velSens', name: 'Vel Sens', min: 0, max: 1, default: 0.4, unit: '%' },
  { id: 'fenv.attack', name: 'F.Attack', min: 0.001, max: 20, default: 2, unit: 's', curve: 'exp' },
  { id: 'fenv.decay', name: 'F.Decay', min: 0.01, max: 20, default: 4, unit: 's', curve: 'exp' },
  { id: 'fenv.sustain', name: 'F.Sustain', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'fenv.release', name: 'F.Release', min: 0.01, max: 30, default: 4, unit: 's', curve: 'exp' },
  { id: 'fenv.pitch', name: 'Env Pitch', min: -24, max: 24, default: 0, unit: 'st' },
  // modulation
  ...lfo(1, 0.15, 0),
  ...lfo(2, 0.08, 1),
  { id: 'drift.amount', name: 'Drift', min: 0, max: 1, default: 0.3, unit: '%' },
  { id: 'drift.rate', name: 'Drift Rate', min: 0.02, max: 2, default: 0.2, unit: 'Hz', curve: 'exp' },
  { id: 'evolve.rate', name: 'Evolve Rate', min: 0.005, max: 0.5, default: 0.05, unit: 'Hz', curve: 'exp' },
  // fx
  { id: 'fx.drive', name: 'Drive', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'fx.chorus', name: 'Chorus', min: 0, max: 1, default: 0.3, unit: '%' },
  { id: 'fx.chorusRate', name: 'Ch Rate', min: 0.05, max: 5, default: 0.4, unit: 'Hz', curve: 'exp' },
  { id: 'fx.chorusDepth', name: 'Ch Depth', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'fx.delay', name: 'Delay', min: 0, max: 1, default: 0.15, unit: '%' },
  { id: 'fx.delayTime', name: 'Time', min: 20, max: 2000, default: 420, unit: 'ms', curve: 'exp' },
  { id: 'fx.delayFb', name: 'Feedback', min: 0, max: 0.85, default: 0.45, unit: '%' },
  { id: 'fx.reverb', name: 'Reverb', min: 0, max: 1, default: 0.45, unit: '%' },
  { id: 'fx.revDecay', name: 'Decay', min: 0.5, max: 40, default: 6, unit: 's', curve: 'exp' },
  { id: 'fx.revSize', name: 'Size', min: 0, max: 1, default: 0.7, unit: '%' },
  { id: 'fx.revDamp', name: 'Damp', min: 0, max: 1, default: 0.35, unit: '%' },
  { id: 'fx.revMod', name: 'Mod', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'fx.predelay', name: 'Pre-Dly', min: 0, max: 250, default: 20, unit: 'ms' },
  { id: 'fx.shimmer', name: 'Shimmer', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'fx.shimInterval', name: 'Interval', min: 0, max: SHIMMER_INTERVALS.length - 1, default: 0, options: SHIMMER_INTERVALS },
  { id: 'fx.freeze', name: 'Freeze', min: 0, max: 1, default: 0, step: 1 },
  { id: 'fx.width', name: 'Width', min: 0, max: 2, default: 1.2 },
  { id: 'master.gain', name: 'Volume', min: -24, max: 6, default: 0, unit: 'dB' }
]

/** Atmos: evolving pads, drones, textures, swells and shimmering soundscapes. */
export const manifest: PluginManifest = {
  id: 'atmos',
  name: 'Atmos',
  kind: 'instrument',
  category: 'Synths',
  description: 'Atmospheric synth: morphing wavetables, granular textures, tuned air, shimmer reverb.',
  color: '#8f7cf0',
  params: PARAMS,
  presets: PRESETS
}
