// Polygon parameter definitions (pure data, shared by UI + DSP).
import type { ParamDef } from '../sdk/types'
import { WAVE_NAMES } from './waves'

export const NUM_TONES = 4
export const FILTER_TYPES = ['Off', 'LPF', 'HPF', 'BPF', 'PKG']
export const LFO_WAVES = ['Tri', 'Sine', 'Saw', 'Square', 'S&H']
export const REVERB_TYPES = ['Room 1', 'Room 2', 'Stage 1', 'Stage 2', 'Hall 1', 'Hall 2']
export const CHORUS_TYPES = ['Chorus 1', 'Chorus 2', 'Chorus 3', 'Flanger']
export const BITS = ['16-bit', '12-bit', '8-bit']
export const DAC_RATES = ['Hi-Fi', '32 kHz', '24 kHz', '16 kHz']

/** Per-tone parameter suffixes (`t1.cutoff` ...) with their definitions. */
export function toneParams(n: number): ParamDef[] {
  const t = `t${n}.`
  const time = (id: string, name: string, def: number): ParamDef => ({ id: t + id, name, min: 0, max: 10, default: def, unit: 's', curve: 'exp' })
  const lvl = (id: string, name: string, def: number): ParamDef => ({ id: t + id, name, min: 0, max: 1, default: def, unit: '%' })
  return [
    { id: t + 'on', name: `Tone ${n}`, min: 0, max: 1, default: n === 1 ? 1 : 0, step: 1 },
    { id: t + 'wave', name: 'Wave', min: 0, max: WAVE_NAMES.length - 1, default: 0, options: WAVE_NAMES },
    lvl('level', 'Level', 0.8),
    { id: t + 'pan', name: 'Pan', min: -1, max: 1, default: 0 },
    { id: t + 'coarse', name: 'Coarse', min: -48, max: 48, default: 0, step: 1, unit: 'st' },
    { id: t + 'fine', name: 'Fine', min: -50, max: 50, default: 0, unit: 'ct' },
    { id: t + 'keyLo', name: 'Key Lo', min: 0, max: 127, default: 0, step: 1 },
    { id: t + 'keyHi', name: 'Key Hi', min: 0, max: 127, default: 127, step: 1 },
    lvl('velSens', 'Vel Sens', 0.5),
    { id: t + 'pDepth', name: 'P-Env Depth', min: -36, max: 36, default: 0, unit: 'st' },
    { id: t + 'pTime', name: 'P-Env Time', min: 0.001, max: 5, default: 0.1, unit: 's', curve: 'exp' },
    { id: t + 'fType', name: 'Filter', min: 0, max: FILTER_TYPES.length - 1, default: 1, options: FILTER_TYPES },
    { id: t + 'cutoff', name: 'Cutoff', min: 20, max: 20000, default: 16000, unit: 'Hz', curve: 'exp' },
    lvl('res', 'Resonance', 0),
    { id: t + 'fKey', name: 'Key Follow', min: 0, max: 1.5, default: 0.5 },
    { id: t + 'fEnv', name: 'Env Depth', min: -8, max: 8, default: 0, unit: 'oct' },
    lvl('fVel', 'Vel > Cutoff', 0.3),
    time('fT1', 'F-T1', 0.005), time('fT2', 'F-T2', 0.3), time('fT3', 'F-T3', 1), time('fT4', 'F-T4', 0.3),
    lvl('fL1', 'F-L1', 1), lvl('fL2', 'F-L2', 0.5), lvl('fL3', 'F-L3', 0.3),
    time('aT1', 'A-T1', 0.003), time('aT2', 'A-T2', 0.2), time('aT3', 'A-T3', 0.5), time('aT4', 'A-T4', 0.3),
    lvl('aL1', 'A-L1', 1), lvl('aL2', 'A-L2', 0.9), lvl('aL3', 'A-L3', 0.85),
    { id: t + 'lfoWave', name: 'LFO Wave', min: 0, max: LFO_WAVES.length - 1, default: 1, options: LFO_WAVES },
    { id: t + 'lfoRate', name: 'LFO Rate', min: 0.05, max: 20, default: 5.5, unit: 'Hz', curve: 'exp' },
    { id: t + 'lfoDelay', name: 'LFO Delay', min: 0, max: 5, default: 0, unit: 's' },
    { id: t + 'lfoFade', name: 'LFO Fade', min: 0, max: 5, default: 0, unit: 's' },
    { id: t + 'lfoPitch', name: 'Vibrato', min: 0, max: 100, default: 0, unit: 'ct' },
    { id: t + 'lfoFilter', name: 'LFO>Filter', min: 0, max: 4, default: 0, unit: 'oct' },
    lvl('lfoAmp', 'Tremolo', 0)
  ]
}

export const COMMON_PARAMS: ParamDef[] = [
  { id: 'com.level', name: 'Patch Level', min: 0, max: 1, default: 0.8, unit: '%' },
  { id: 'com.mono', name: 'Mono', min: 0, max: 1, default: 0, step: 1 },
  { id: 'com.legato', name: 'Legato', min: 0, max: 1, default: 0, step: 1 },
  { id: 'com.porta', name: 'Portamento', min: 0, max: 2, default: 0, unit: 's', curve: 'exp' },
  { id: 'com.drift', name: 'Analog Feel', min: 0, max: 1, default: 0.15, unit: '%' },
  { id: 'com.bits', name: 'ROM Bits', min: 0, max: BITS.length - 1, default: 0, options: BITS },
  { id: 'com.dac', name: 'DAC Rate', min: 0, max: DAC_RATES.length - 1, default: 0, options: DAC_RATES },
  { id: 'fx.chType', name: 'Chorus Type', min: 0, max: CHORUS_TYPES.length - 1, default: 0, options: CHORUS_TYPES },
  { id: 'fx.chorus', name: 'Chorus Level', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'fx.chRate', name: 'Chorus Rate', min: 0.05, max: 8, default: 0.5, unit: 'Hz', curve: 'exp' },
  { id: 'fx.chDepth', name: 'Chorus Depth', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'fx.delay', name: 'Delay Level', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'fx.dlyTime', name: 'Delay Time', min: 10, max: 1500, default: 375, unit: 'ms', curve: 'exp' },
  { id: 'fx.dlyFb', name: 'Delay Feedback', min: 0, max: 0.95, default: 0.35, unit: '%' },
  { id: 'fx.revType', name: 'Reverb Type', min: 0, max: REVERB_TYPES.length - 1, default: 4, options: REVERB_TYPES },
  { id: 'fx.reverb', name: 'Reverb Level', min: 0, max: 1, default: 0.25, unit: '%' },
  { id: 'fx.revTime', name: 'Reverb Time', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'fx.revTone', name: 'Reverb HF Damp', min: 0, max: 1, default: 0.5, unit: '%' }
]

export const ALL_PARAMS: ParamDef[] = [...COMMON_PARAMS, ...[1, 2, 3, 4].flatMap(toneParams)]
