import type { PluginManifest } from '../sdk/types'
import { DECLICK_MODES } from './process'
import { STRETCH_MODES } from './stretch'

const ONOFF = ['Off', 'On']

/** The channel sampler (FL "Sampler Channel Settings"): what you get when you drop an audio file in the channel rack. */
export const manifest: PluginManifest = {
  id: 'sampler',
  name: 'Sampler',
  kind: 'instrument',
  category: 'Sampler',
  description: 'Plays an audio sample, pitched by the piano roll.',
  color: '#9fd27a',
  params: [
    { id: 'root', name: 'Root note', min: 0, max: 127, default: 60, step: 1 },
    { id: 'pitchToKey', name: 'Key tracking', min: 0, max: 1, default: 1, options: ONOFF },
    { id: 'oneShot', name: 'One shot', min: 0, max: 1, default: 1, options: ONOFF },
    // playback / looping
    { id: 'start', name: 'Start offset', min: 0, max: 1, default: 0, unit: '%' },
    { id: 'loop', name: 'Use loop points', min: 0, max: 1, default: 0, options: ONOFF },
    { id: 'pingPong', name: 'Ping pong loop', min: 0, max: 1, default: 0, options: ONOFF },
    { id: 'loopStart', name: 'Loop start', min: 0, max: 1, default: 0, unit: '%' },
    { id: 'loopEnd', name: 'Loop end', min: 0, max: 1, default: 1, unit: '%' },
    { id: 'declick', name: 'Declicking', min: 0, max: DECLICK_MODES.length - 1, default: 0, options: [...DECLICK_MODES] },
    // time stretching / pitch shifting (resample mode)
    { id: 'stretchMode', name: 'Stretch mode', min: 0, max: STRETCH_MODES.length - 1, default: 0, options: [...STRETCH_MODES] },
    { id: 'pitch', name: 'Pitch', min: -1200, max: 1200, default: 0, unit: 'ct', step: 1 },
    { id: 'mul', name: 'Length multiplier', min: 0.25, max: 4, default: 1, unit: 'x', curve: 'exp' },
    { id: 'time', name: 'Time', min: 0, max: 64, default: 0, unit: 'beats', step: 0.25, curve: 'exp' },
    { id: 'tempo', name: 'Tempo', min: 10, max: 522, default: 130, hidden: true },
    // precomputed effects
    { id: 'removeDC', name: 'Remove DC offset', min: 0, max: 1, default: 0, options: ONOFF },
    { id: 'normalize', name: 'Normalize', min: 0, max: 1, default: 0, options: ONOFF },
    { id: 'polarity', name: 'Reverse polarity', min: 0, max: 1, default: 0, options: ONOFF },
    { id: 'swapStereo', name: 'Swap stereo', min: 0, max: 1, default: 0, options: ONOFF },
    { id: 'reverse', name: 'Reverse', min: 0, max: 1, default: 0, options: ONOFF },
    { id: 'fadeIn', name: 'Fade in', min: 0, max: 2, default: 0, unit: 's', curve: 'exp' },
    { id: 'fadeOut', name: 'Fade out', min: 0, max: 2, default: 0, unit: 's', curve: 'exp' },
    // envelope / filter / amp (FL's INS tab)
    { id: 'attack', name: 'Attack', min: 0, max: 2, default: 0, unit: 's', curve: 'exp' },
    { id: 'decay', name: 'Decay', min: 0.01, max: 8, default: 8, unit: 's', curve: 'exp' },
    { id: 'sustain', name: 'Sustain', min: 0, max: 1, default: 1, unit: '%' },
    { id: 'release', name: 'Release', min: 0.003, max: 4, default: 0.02, unit: 's', curve: 'exp' },
    { id: 'cutoff', name: 'Cutoff', min: 40, max: 20000, default: 20000, unit: 'Hz', curve: 'exp' },
    { id: 'res', name: 'Reso', min: 0.5, max: 10, default: 0.7, curve: 'exp' },
    { id: 'gain', name: 'Amp', min: 0, max: 2, default: 1, unit: '%' }
  ],
  defaultData: { sampleId: null }
}
