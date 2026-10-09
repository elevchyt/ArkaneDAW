import type { Preset } from '../sdk/types'
import { WAVE_PRESETS, defaultChipData, seq, type ChipData } from './data'

// Every preset ships complete `data` so switching presets never inherits stale sequences.
const mk = (name: string, category: string, params: Record<string, number>, data: Partial<ChipData> = {}): Preset => ({
  name,
  category,
  params,
  data: { ...defaultChipData(), ...data }
})

const rep = (v: number, n: number): number[] => Array.from({ length: n }, () => v)
const ramp = (from: number, to: number, n: number): number[] => Array.from({ length: n }, (_, i) => Math.round(from + ((to - from) * i) / Math.max(1, n - 1)))

// wave ids: 0 P12, 1 P25, 2 P50, 3 FC tri, 4 tri, 5 noise long, 6 noise short, 7 noise 4-bit, 8 GB wave
export const PRESETS: Preset[] = [
  mk('Default', 'Lead', {}),
  // ── Lead ──
  mk('NES Pulse Lead 25%', 'Lead', { 'osc.wave': 1, 'vib.depth': 0.25, 'vib.delay': 0.3, 'vib.rate': 5.5 }),
  mk('Square Hero', 'Lead', { 'osc.wave': 2, 'vib.depth': 0.3, 'vib.delay': 0.25, 'vib.rate': 6, 'env.decay': 0.4, 'env.sustain': 0.75 }),
  mk('Thin Lead 12.5%', 'Lead', { 'osc.wave': 0, 'vib.depth': 0.2, 'vib.delay': 0.2 }),
  mk('Echo Lead (delay via sequence)', 'Lead', { 'osc.wave': 1, 'seq.vol': 1, 'seq.div': 2 }, {
    vol: seq([15, 14, 13, 12, 12, 11, 11, 0, 0, 0, 0, 7, 6, 5, 4, 0, 0, 0, 0, 3, 3, 2, 1, 0], -1, 6)
  }),
  mk('Vibrato Lead', 'Lead', { 'osc.wave': 2, 'vib.depth': 0.5, 'vib.rate': 5.5, 'vib.delay': 0.12, 'voice.poly': 0, 'voice.glide': 0.05 }),
  mk('Portamento Lead', 'Lead', { 'osc.wave': 1, 'voice.poly': 0, 'voice.glide': 0.12, 'voice.legato': 1, 'vib.depth': 0.2, 'vib.delay': 0.35 }),
  mk('PWM Sweep Lead', 'Lead', { 'osc.wave': 2, 'osc.pwm': 0.8, 'osc.pwmRate': 0.7, 'osc.authentic': 0 }),
  mk('Smooth Lead (Band-limited)', 'Lead', { 'osc.wave': 2, 'osc.authentic': 0, 'out.lpf': 9000, 'out.stereo': 0.4, 'vib.depth': 0.2, 'env.release': 0.15 }),
  mk('Stereo Detune Lead', 'Lead', { 'osc.wave': 1, 'out.stereo': 1, 'env.release': 0.12 }),
  mk('Duty Morph Lead', 'Lead', { 'osc.wave': 2, 'seq.duty': 1, 'seq.div': 3 }, { duty: seq([0, 1, 2, 1], 0) }),
  mk('GB Wave Lead', 'Lead', { 'osc.wave': 8, 'vib.depth': 0.25, 'vib.delay': 0.2 }, { wave: WAVE_PRESETS.Organ.slice() }),
  mk('Bend-in Lead', 'Lead', { 'osc.wave': 1, 'bend.amt': -5, 'bend.time': 0.07, 'vib.depth': 0.25, 'vib.delay': 0.3 }),
  // ── Bass ──
  mk('Triangle Bass', 'Bass', { 'osc.wave': 3, 'env.sustain': 1, 'env.release': 0.03, 'osc.coarse': -12 }),
  mk('Smooth Triangle Bass', 'Bass', { 'osc.wave': 4, 'osc.authentic': 0, 'env.sustain': 1, 'env.release': 0.05, 'osc.coarse': -12 }),
  mk('GB Wave Bass', 'Bass', { 'osc.wave': 8, 'osc.coarse': -12, 'env.sustain': 0.9, 'env.release': 0.05 }, { wave: WAVE_PRESETS.Bass.slice() }),
  mk('Pulse Bass 50%', 'Bass', { 'osc.wave': 2, 'osc.coarse': -12, 'env.decay': 0.25, 'env.sustain': 0.6 }),
  mk('Pluck Bass 12.5%', 'Bass', { 'osc.wave': 0, 'osc.coarse': -12, 'env.decay': 0.15, 'env.sustain': 0.3 }),
  mk('Growl Bass (GB)', 'Bass', { 'osc.wave': 8, 'osc.coarse': -12, 'out.lpf': 7000 }, { wave: WAVE_PRESETS.Growl.slice() }),
  mk('Octave Bounce Bass', 'Bass', { 'osc.wave': 1, 'osc.coarse': -12, 'seq.pitch': 1, 'seq.div': 3 }, { pitch: seq([0, 12], 0) }),
  mk('Slap Bass', 'Bass', { 'osc.wave': 1, 'osc.coarse': -12, 'bend.amt': 12, 'bend.time': 0.035, 'env.decay': 0.2, 'env.sustain': 0.4 }),
  // ── Arp/Chord ──
  mk('Fast Arp Chords', 'Arp/Chord', { 'osc.wave': 1, 'arp.mode': 1, 'arp.speed': 1 }),
  mk('Major Chord (seq arp)', 'Arp/Chord', { 'osc.wave': 2, 'seq.pitch': 1 }, { pitch: seq([0, 4, 7], 0) }),
  mk('Minor Chord (seq arp)', 'Arp/Chord', { 'osc.wave': 2, 'seq.pitch': 1 }, { pitch: seq([0, 3, 7], 0) }),
  mk('Power Chord (seq arp)', 'Arp/Chord', { 'osc.wave': 1, 'seq.pitch': 1 }, { pitch: seq([0, 7, 12], 0) }),
  mk('Up/Down Arp 2 Oct', 'Arp/Chord', { 'osc.wave': 1, 'arp.mode': 3, 'arp.speed': 3, 'arp.oct': 2 }),
  mk('Random Arp', 'Arp/Chord', { 'osc.wave': 0, 'arp.mode': 4, 'arp.speed': 4, 'arp.oct': 2 }),
  mk('Retrig Arp Pluck', 'Arp/Chord', { 'osc.wave': 1, 'arp.mode': 1, 'arp.speed': 6, 'arp.retrig': 1, 'env.decay': 0.1, 'env.sustain': 0 }),
  // ── Pad-ish ──
  mk('Soft Pulse Pad', 'Pad-ish', { 'osc.wave': 1, 'osc.authentic': 0, 'env.attack': 0.4, 'env.release': 0.8, 'vib.depth': 0.15, 'out.stereo': 0.6, 'out.lpf': 7000 }),
  mk('Tremolo Pad (vol seq)', 'Pad-ish', { 'osc.wave': 2, 'seq.vol': 1, 'seq.div': 2, 'env.release': 0.6, 'out.stereo': 0.5 }, { vol: seq([12, 12, 11, 10, 9, 8, 8, 9, 10, 11], 0) }),
  mk('Wave Organ (GB)', 'Pad-ish', { 'osc.wave': 8, 'env.attack': 0.02, 'env.release': 0.3, 'vib.depth': 0.1 }, { wave: WAVE_PRESETS.Organ.slice() }),
  mk('PWM Pad', 'Pad-ish', { 'osc.wave': 2, 'osc.pwm': 0.9, 'osc.pwmRate': 0.3, 'osc.authentic': 0, 'env.attack': 0.5, 'env.release': 1.0, 'out.lpf': 8000 }),
  // ── Pluck ──
  mk('Chip Pluck', 'Pluck', { 'osc.wave': 1, 'env.decay': 0.18, 'env.sustain': 0 }),
  mk('Harp Pluck (vol seq)', 'Pluck', { 'osc.wave': 2, 'seq.vol': 1 }, { vol: seq([15, 12, 10, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 0]) }),
  mk('Chip Bell', 'Pluck', { 'osc.wave': 0, 'seq.pitch': 1, 'env.decay': 0.6, 'env.sustain': 0 }, { pitch: seq([12, 0]) }),
  mk('Koto Bend Pluck', 'Pluck', { 'osc.wave': 1, 'bend.amt': 2, 'bend.time': 0.05, 'env.decay': 0.4, 'env.sustain': 0 }),
  mk('Triangle Marimba', 'Pluck', { 'osc.wave': 3, 'env.decay': 0.25, 'env.sustain': 0 }),
  // ── FX/SFX ──
  mk('Coin Get', 'FX/SFX', { 'osc.wave': 2, 'seq.vol': 1, 'seq.pitch': 1 }, { pitch: seq([0, 0, 0, 0, 5]), vol: seq([...rep(15, 5), ...ramp(14, 0, 24)]) }),
  mk('Jump', 'FX/SFX', { 'osc.wave': 1, 'bend.sweep': 70, 'seq.vol': 1 }, { vol: seq([...rep(14, 4), ...ramp(13, 0, 10)]) }),
  mk('Power Up', 'FX/SFX', { 'osc.wave': 2, 'seq.vol': 1, 'seq.pitch': 1, 'seq.div': 2 }, {
    pitch: seq([0, 4, 7, 12, 2, 6, 9, 14, 4, 8, 11, 16, 5, 9, 12, 12]),
    vol: seq([...rep(14, 16), ...ramp(12, 0, 6)])
  }),
  mk('Laser', 'FX/SFX', { 'osc.wave': 0, 'bend.amt': 30, 'bend.time': 0.15, 'seq.vol': 1 }, { vol: seq([15, 15, 14, 13, 12, 10, 8, 6, 4, 2, 0]) }),
  mk('Explosion', 'FX/SFX', { 'osc.wave': 5, 'bend.sweep': -30, 'env.decay': 1.0, 'env.sustain': 0 }),
  mk('Siren', 'FX/SFX', { 'osc.wave': 2, 'vib.depth': 2, 'vib.rate': 2, 'vib.delay': 0 }),
  mk('1-Up', 'FX/SFX', { 'osc.wave': 2, 'seq.vol': 1, 'seq.pitch': 1, 'seq.div': 7 }, { pitch: seq([0, 3, 12, 8, 10, 15]), vol: seq([15, 15, 15, 15, 15, 14, 0]) }),
  mk('Metal Noise Hit', 'FX/SFX', { 'osc.wave': 5, 'seq.duty': 1, 'env.decay': 0.4, 'env.sustain': 0 }, { duty: seq([1, 1, 0, 1, 0, 0]) }),
  mk('Engine Rumble', 'FX/SFX', { 'osc.wave': 7, 'osc.coarse': -24, 'vib.depth': 1.2, 'vib.rate': 9, 'vib.delay': 0 }),
  // ── Drums ──
  mk('NES Kit', 'Drums', { mode: 1, 'drum.kit': 0 }),
  mk('Game Boy Kit', 'Drums', { mode: 1, 'drum.kit': 1 }),
  mk('Arcade Kit', 'Drums', { mode: 1, 'drum.kit': 2, 'out.rate': 3 }),
  mk('NES Kit Tight', 'Drums', { mode: 1, 'drum.kit': 0, 'drum.decay': 0.6 }),
  mk('Lo-Fi 8k Kit', 'Drums', { mode: 1, 'drum.kit': 0, 'out.rate': 6, 'out.lpf': 6000 }),
  mk('Smooth Kit (Band-limited)', 'Drums', { mode: 1, 'drum.kit': 0, 'osc.authentic': 0, 'env.quant': 0 })
]
