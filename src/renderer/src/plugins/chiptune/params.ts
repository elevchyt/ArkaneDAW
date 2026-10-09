import type { ParamDef } from '../sdk/types'
import { WAVE_NAMES } from './chip'
import { DRUM_KITS } from './drumkeys'

const toggle = (id: string, name: string, def: number): ParamDef => ({ id, name, min: 0, max: 1, default: def, step: 1 })

export const SEQ_RATES = [60, 50, 30, 120, 240]
export const OUT_RATES = [0, 44100, 32000, 22050, 16000, 11025, 8000]
export const ARP_MODES = ['Off', 'Up', 'Down', 'Up/Down', 'Random', 'As Played']

export const PARAMS: ParamDef[] = [
  { id: 'mode', name: 'Mode', min: 0, max: 1, default: 0, options: ['Synth', 'Drums'] },
  // oscillator
  { id: 'osc.wave', name: 'Wave', min: 0, max: WAVE_NAMES.length - 1, default: 1, options: WAVE_NAMES },
  toggle('osc.authentic', 'Authentic', 1),
  { id: 'osc.coarse', name: 'Coarse', min: -24, max: 24, default: 0, step: 1, unit: 'st' },
  { id: 'osc.fine', name: 'Fine', min: -100, max: 100, default: 0, unit: 'ct' },
  { id: 'osc.pwm', name: 'Duty Sweep', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'osc.pwmRate', name: 'Sweep Rate', min: 0.05, max: 20, default: 1, unit: 'Hz', curve: 'exp' },
  // envelope
  { id: 'env.attack', name: 'Attack', min: 0, max: 2, default: 0, unit: 's', curve: 'exp' },
  { id: 'env.decay', name: 'Decay', min: 0.005, max: 4, default: 0.3, unit: 's', curve: 'exp' },
  { id: 'env.sustain', name: 'Sustain', min: 0, max: 1, default: 0.8, unit: '%' },
  { id: 'env.release', name: 'Release', min: 0.005, max: 4, default: 0.06, unit: 's', curve: 'exp' },
  toggle('env.quant', '4-bit Vol', 1),
  // sequences
  toggle('seq.vol', 'Vol Seq', 0),
  toggle('seq.pitch', 'Pitch Seq', 0),
  toggle('seq.duty', 'Duty Seq', 0),
  { id: 'seq.pitchMode', name: 'Pitch Mode', min: 0, max: 1, default: 0, options: ['Absolute', 'Relative'] },
  { id: 'seq.rate', name: 'Frame Rate', min: 0, max: SEQ_RATES.length - 1, default: 0, options: ['60 Hz NTSC', '50 Hz PAL', '30 Hz', '120 Hz', '240 Hz'] },
  { id: 'seq.div', name: 'Speed', min: 1, max: 16, default: 1, step: 1, unit: 'fr' },
  // bend / sweep / vibrato
  { id: 'bend.amt', name: 'Bend', min: -48, max: 48, default: 0, step: 1, unit: 'st' },
  { id: 'bend.time', name: 'Bend Time', min: 0, max: 2, default: 0.1, unit: 's', curve: 'exp' },
  { id: 'bend.sweep', name: 'Sweep', min: -96, max: 96, default: 0, unit: 'st' },
  { id: 'vib.depth', name: 'Vib Depth', min: 0, max: 2, default: 0, unit: 'st' },
  { id: 'vib.rate', name: 'Vib Rate', min: 0.5, max: 20, default: 6, unit: 'Hz', curve: 'exp' },
  { id: 'vib.delay', name: 'Vib Delay', min: 0, max: 2, default: 0.2, unit: 's' },
  // voicing
  { id: 'voice.poly', name: 'Voicing', min: 0, max: 1, default: 1, options: ['Mono', 'Poly'] },
  { id: 'voice.limit', name: 'Voices', min: 1, max: 16, default: 8, step: 1 },
  { id: 'voice.glide', name: 'Glide', min: 0, max: 1, default: 0, unit: 's', curve: 'exp' },
  toggle('voice.legato', 'Legato', 1),
  { id: 'voice.vel', name: 'Vel Sens', min: 0, max: 1, default: 0.5, unit: '%' },
  // arpeggiator
  { id: 'arp.mode', name: 'Arp', min: 0, max: ARP_MODES.length - 1, default: 0, options: ARP_MODES },
  { id: 'arp.speed', name: 'Arp Speed', min: 1, max: 16, default: 2, step: 1, unit: 'fr' },
  { id: 'arp.oct', name: 'Octaves', min: 1, max: 3, default: 1, step: 1 },
  toggle('arp.retrig', 'Retrigger', 0),
  // output
  { id: 'out.gain', name: 'Gain', min: 0, max: 1, default: 0.7, unit: '%' },
  toggle('out.dac', 'NES DAC', 0),
  { id: 'out.rate', name: 'Lo-Fi Rate', min: 0, max: OUT_RATES.length - 1, default: 0, options: ['Off', '44.1k', '32k', '22k', '16k', '11k', '8k'] },
  { id: 'out.lpf', name: 'Low-pass', min: 1000, max: 20000, default: 16000, unit: 'Hz', curve: 'exp' },
  { id: 'out.stereo', name: 'Stereo', min: 0, max: 1, default: 0, unit: '%' },
  // drums
  { id: 'drum.kit', name: 'Kit', min: 0, max: DRUM_KITS.length - 1, default: 0, options: [...DRUM_KITS] },
  { id: 'drum.tune', name: 'Kit Tune', min: -12, max: 12, default: 0, unit: 'st' },
  { id: 'drum.decay', name: 'Kit Decay', min: 0.25, max: 4, default: 1, curve: 'exp' }
]
