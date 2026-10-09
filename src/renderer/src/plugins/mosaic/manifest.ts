import type { ParamDef, PluginManifest } from '../sdk/types'
import { PRESETS } from './presets'
import { normalizeData } from './model'

const onoff = ['Off', 'On']

/** Global / performance-level params (automatable). Per-part settings live in `data` (see model.ts). */
export const PARAMS: ParamDef[] = [
  { id: 'super', name: 'Super Knob', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'master', name: 'Volume', min: 0, max: 1, default: 0.8, unit: '%' },
  { id: 'q.cutoff', name: 'Cutoff', min: -1, max: 1, default: 0 },
  { id: 'q.reso', name: 'Resonance', min: -1, max: 1, default: 0 },
  { id: 'q.attack', name: 'Attack', min: -1, max: 1, default: 0 },
  { id: 'q.release', name: 'Release', min: -1, max: 1, default: 0 },
  { id: 'rotary', name: 'Rotary Speed', min: 0, max: 1, default: 0, options: ['Slow', 'Fast'] },
  { id: 'eq.low', name: 'Low', min: -12, max: 12, default: 0, unit: 'dB' },
  { id: 'eq.mid', name: 'Mid', min: -12, max: 12, default: 0, unit: 'dB' },
  { id: 'eq.midf', name: 'Mid Freq', min: 200, max: 8000, default: 1000, unit: 'Hz', curve: 'exp' },
  { id: 'eq.high', name: 'High', min: -12, max: 12, default: 0, unit: 'dB' },
  { id: 'cho.on', name: 'Chorus', min: 0, max: 1, default: 0, options: onoff },
  { id: 'cho.rate', name: 'Rate', min: 0.05, max: 5, default: 0.6, unit: 'Hz', curve: 'exp' },
  { id: 'cho.depth', name: 'Depth', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'cho.mix', name: 'Mix', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'pha.on', name: 'Phaser', min: 0, max: 1, default: 0, options: onoff },
  { id: 'pha.rate', name: 'Rate', min: 0.02, max: 5, default: 0.3, unit: 'Hz', curve: 'exp' },
  { id: 'pha.depth', name: 'Depth', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'pha.fb', name: 'Feedback', min: 0, max: 0.9, default: 0.4, unit: '%' },
  { id: 'pha.mix', name: 'Mix', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'dly.on', name: 'Delay', min: 0, max: 1, default: 0, options: onoff },
  { id: 'dly.time', name: 'Time', min: 10, max: 1500, default: 375, unit: 'ms', curve: 'exp' },
  { id: 'dly.fb', name: 'Feedback', min: 0, max: 0.9, default: 0.35, unit: '%' },
  { id: 'dly.tone', name: 'Tone', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'dly.pp', name: 'Ping-Pong', min: 0, max: 1, default: 1, options: onoff },
  { id: 'dly.mix', name: 'Mix', min: 0, max: 1, default: 0.2, unit: '%' },
  { id: 'rev.on', name: 'Reverb', min: 0, max: 1, default: 1, options: onoff },
  { id: 'rev.size', name: 'Size', min: 0, max: 1, default: 0.6, unit: '%' },
  { id: 'rev.decay', name: 'Decay', min: 0.2, max: 12, default: 2.2, unit: 's', curve: 'exp' },
  { id: 'rev.damp', name: 'Damping', min: 0, max: 1, default: 0.5, unit: '%' },
  { id: 'rev.pre', name: 'Pre-Delay', min: 0, max: 200, default: 15, unit: 'ms' },
  { id: 'rev.mix', name: 'Mix', min: 0, max: 1, default: 0.22, unit: '%' }
]

export const manifest: PluginManifest = {
  id: 'mosaic',
  name: 'Mosaic',
  kind: 'instrument',
  category: 'Synth',
  description:
    'Flagship workstation (Montage homage): up to 4 layered/split Parts per Performance across 8 engines — modelled pianos, EPs, tonewheel/pipe/combo organs with rotary, 6-op FM, plucked & bowed strings, analog/supersaw, formant choir and mallets — with Super Knob and an EQ/chorus/phaser/delay/reverb chain.',
  color: '#e8c872',
  params: PARAMS,
  presets: PRESETS,
  defaultData: PRESETS[0]?.data ?? normalizeData(undefined)
}
