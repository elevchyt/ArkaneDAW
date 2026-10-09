// Bassline factory presets. Partial param maps: anything missing falls back to the ParamDef default.
import type { Preset } from '../sdk/types'

type P = Record<string, number>
const mk = (category: string, base: P) => (name: string, params: P): Preset => ({ name, category, params: { ...base, ...params } })

// engine bases
const ACID: P = { engine: 1, 'voice.mode': 2, glide: 0.06, 'osc1.wave': 0, 'flt.cutoff': 380, 'flt.res': 0.8, 'flt.env': 0.6, 'flt.key': 0.2, 'fenv.d': 0.35, 'amp.a': 0.001, 'amp.d': 1.6, 'amp.s': 0.35, 'amp.r': 0.015, 'acid.accent': 0.7, 'flt.drive': 0.3, punch: 0.25 }
const ANA: P = { engine: 0, 'voice.mode': 2 }
const S808: P = { engine: 4, 'voice.mode': 2, 'flt.type': 0, glide: 0.08, 'amp.a': 0.001, 'amp.d': 2.5, 'amp.s': 0, 'amp.r': 0.25, 's8.pitch': 8, 's8.ptime': 0.045, 's8.click': 0.25, punch: 0.3, 'vel.sens': 0.35 }
const GROWL: P = { engine: 3, 'voice.mode': 2, glide: 0.04, 'flt.type': 1, 'flt.cutoff': 300, 'flt.res': 0.45, 'flt.env': 0.15, 'fenv.d': 0.2, 'amp.s': 1, 'amp.r': 0.06, 'lfo.retrig': 1, 'sub.level': 0.5, drive: 0.35, punch: 0.4 }
const FM: P = { engine: 2, 'voice.mode': 2, glide: 0, 'flt.type': 0, 'amp.a': 0.001, 'amp.d': 0.9, 'amp.s': 0.6, 'amp.r': 0.07, punch: 0.35 }
const PHYS: P = { engine: 5, 'voice.mode': 1, glide: 0, 'flt.type': 0, 'amp.r': 0.08, 'vel.sens': 0.6, punch: 0.4, 'eq.low': 1.5 }

const acid = mk('Acid', ACID)
const analog = mk('Analog', ANA)
const sub = mk('Sub/808', S808)
const reese = mk('Reese/DnB', { ...ANA, 'voice.mode': 2, 'osc2.level': 1, 'osc2.detune': 16, 'flt.env': 0, 'flt.res': 0.15, 'amp.s': 1, 'amp.r': 0.12, 'sub.level': 0.45, glide: 0.03 })
const wob = mk('Wobble/Dubstep', GROWL)
const fm = mk('FM/Digital', FM)
const pluck = mk('Pluck', { ...ANA, 'voice.mode': 1, glide: 0, 'amp.s': 0, 'amp.d': 0.45, 'amp.r': 0.12, 'flt.env': 0.7, 'fenv.d': 0.18, 'flt.cutoff': 320, 'flt.res': 0.35 })
const pop80 = mk('80s/Synthpop', { ...ANA, 'voice.mode': 1, glide: 0, chorus: 0.25 })
const house = mk('House/Garage', ANA)
const elec = mk('Electric', PHYS)
const fretless = mk('Fretless/Upright', PHYS)
const hybrid = mk('Hybrid', {})

export const PRESETS: Preset[] = [
  { name: 'Init', category: 'Analog', params: {} },

  // ── Acid ──
  acid('Acid Squelch', { 'flt.cutoff': 360, 'flt.res': 0.84, 'flt.env': 0.65, 'fenv.d': 0.32, 'acid.accent': 0.8, drive: 0.25, 'drv.mode': 1 }),
  acid('Acid Square Bubble', { 'osc1.wave': 1, 'flt.cutoff': 480, 'flt.res': 0.72, 'flt.env': 0.5, 'fenv.d': 0.25, 'acid.accent': 0.6 }),
  acid('Acid Screamer', { 'flt.cutoff': 560, 'flt.res': 0.93, 'flt.env': 0.8, 'fenv.d': 0.5, 'acid.accent': 1, drive: 0.55, 'drv.mode': 2, 'eq.mid': 2, 'master.gain': 0.6 }),
  acid('Acid Deep Rubber', { 'flt.cutoff': 230, 'flt.res': 0.62, 'flt.env': 0.45, 'fenv.d': 0.9, 'acid.accent': 0.5, 'sub.level': 0.3, 'eq.low': 3 }),
  acid('Acid Hardfloor', { 'flt.cutoff': 320, 'flt.res': 0.88, 'flt.env': 0.72, 'fenv.d': 0.6, 'acid.accent': 0.9, drive: 0.45, 'drv.mode': 1, chorus: 0.12 }),
  acid('Acid Long Slide', { glide: 0.14, 'flt.cutoff': 300, 'flt.res': 0.78, 'flt.env': 0.55, 'fenv.d': 1.2, 'amp.s': 0.6 }),

  // ── Analog ──
  analog('Rubber Moog', { 'osc2.level': 0.6, 'osc2.semi': -12, 'osc2.detune': 4, 'flt.cutoff': 420, 'flt.res': 0.35, 'flt.env': 0.45, 'fenv.d': 0.35, 'fenv.s': 0.2, 'amp.s': 0.9, drive: 0.2, glide: 0.04, 'eq.low': 3 }),
  analog('Fat Minimoog', { 'osc2.wave': 1, 'osc2.level': 0.8, 'osc2.semi': -12, 'osc.uni': 2, 'osc.spread': 8, 'flt.cutoff': 700, 'flt.res': 0.25, 'flt.env': 0.35, 'flt.drive': 0.55, 'sub.level': 0.3, 'master.gain': 0.6 }),
  analog('Taurus Pedal', { 'osc2.level': 0.9, 'osc2.detune': 7, 'flt.cutoff': 260, 'flt.res': 0.3, 'flt.env': 0.3, 'fenv.d': 0.6, 'amp.d': 2, 'amp.s': 0.7, 'amp.r': 0.3, 'sub.level': 0.4, 'eq.low': 4, glide: 0.1 }),
  analog('Analog Punch', { 'osc1.wave': 1, 'flt.cutoff': 900, 'flt.res': 0.15, 'flt.env': 0.5, 'fenv.d': 0.15, 'amp.s': 0.6, punch: 0.7, 'voice.mode': 1 }),
  analog('Mono Saw', { 'flt.cutoff': 1200, 'flt.res': 0.2, 'flt.env': 0.25, 'amp.s': 0.85, glide: 0 }),
  analog('Pulse Width Bass', { 'osc1.wave': 2, 'osc1.pw': 0.3, 'lfo.wt': 0.4, 'lfo.rate': 0.4, 'flt.cutoff': 800, 'flt.res': 0.3, 'sub.level': 0.35, 'sub.wave': 2 }),

  // ── Sub / 808 ──
  sub('808 Long Glide', { 's8.pitch': 7, 's8.ptime': 0.04, glide: 0.25, 'amp.d': 3, drive: 0.25 }),
  sub('808 Boom', { 's8.pitch': 12, 's8.ptime': 0.06, 's8.click': 0.4, drive: 0.45, 'drv.mode': 1, 'amp.d': 1.8 }),
  sub('Pure Sub', { 's8.pitch': 0, 's8.click': 0, 'amp.d': 1, 'amp.s': 1, 'amp.r': 0.12, punch: 0.1, glide: 0.05 }),
  sub('Trap 808 Dist', { 's8.wave': 2, drive: 0.7, 'drv.mode': 2, 's8.pitch': 10, 'amp.d': 2.2, glide: 0.12, 'eq.mid': -3, 'master.gain': 0.6 }),
  sub('Sub Triangle', { 's8.wave': 1, 's8.pitch': 0, 's8.click': 0.1, 'amp.s': 1, 'amp.r': 0.1, 'flt.type': 3, 'flt.cutoff': 500, 'flt.env': 0, 'flt.res': 0.05 }),
  sub('808 Short Punch', { 'master.gain': 0.58, 'amp.d': 0.5, 's8.pitch': 18, 's8.ptime': 0.03, 's8.click': 0.5, 'voice.mode': 1, glide: 0, punch: 0.6 }),

  // ── Reese / DnB ──
  reese('Reese Tunnel', { 'osc.uni': 2, 'osc.spread': 20, 'flt.cutoff': 650, 'flt.res': 0.2, 'lfo.rate': 0.15, 'lfo.cutoff': 0.25, chorus: 0.35, drive: 0.3, 'master.gain': 0.6 }),
  reese('Neuro Reese', { 'osc.uni': 3, 'osc.spread': 30, 'osc2.detune': 25, 'flt.cutoff': 1400, 'flt.res': 0.45, drive: 0.6, 'drv.mode': 2, 'lfo.sync': 4, 'lfo.cutoff': 0.3, 'eq.mid': -4, 'master.gain': 0.55 }),
  reese('Classic Reese', { 'osc2.detune': 12, 'flt.cutoff': 1000, 'flt.res': 0.1, 'sub.level': 0.4 }),
  reese('Rolling DnB Sub', { 'osc1.wave': 4, 'osc2.wave': 0, 'osc2.level': 0.25, 'osc2.detune': 10, 'flt.cutoff': 400, 'sub.level': 0.2, punch: 0.5 }),
  reese('Neuro Growl', { engine: 3, 'wt.morph': 0.9, 'wt.sync': 2.5, 'wt.fm': 0.4, 'wt.fold': 0.3, 'wt.vowel': 0.4, 'wt.formant': 0.7, 'lfo.sync': 8, 'lfo.wt': 0.6, 'lfo.cutoff': 0.2, 'flt.cutoff': 1200, 'flt.res': 0.3, drive: 0.5, 'drv.mode': 2, 'master.gain': 0.6 }),

  // ── Wobble / Dubstep ──
  wob('Wobble 1/8', { 'wt.morph': 0.66, 'wt.formant': 0.3, 'flt.cutoff': 220, 'flt.res': 0.5, 'lfo.sync': 6, 'lfo.cutoff': 0.75, 'lfo.wt': 0.4 }),
  wob('Wobble 1/4 Yoi', { 'wt.morph': 0.7, 'wt.formant': 0.9, 'wt.vowel': 0.1, 'flt.cutoff': 400, 'lfo.sync': 4, 'lfo.cutoff': 0.5, 'lfo.wt': 0.85 }),
  wob('Wobble Triplet', { 'wt.morph': 0.9, 'wt.fold': 0.2, 'flt.cutoff': 260, 'lfo.sync': 7, 'lfo.cutoff': 0.7, 'lfo.wt': 0.3, 'lfo.wave': 1 }),
  wob('Dubstep Growl', { 'wt.sync': 3, 'wt.fm': 0.5, 'wt.fold': 0.5, 'wt.morph': 0.8, 'flt.cutoff': 900, 'lfo.sync': 8, 'lfo.wt': 0.7, 'lfo.cutoff': 0.25, drive: 0.5, 'drv.mode': 2, 'master.gain': 0.55 }),
  wob('Wub Classic', { engine: 0, 'osc2.level': 0.9, 'osc2.detune': 9, 'flt.cutoff': 180, 'flt.res': 0.55, 'flt.env': 0, 'lfo.sync': 4, 'lfo.cutoff': 0.8 }),
  wob('Wobble 1/16 Chop', { 'wt.morph': 1, 'flt.cutoff': 200, 'flt.res': 0.6, 'lfo.sync': 8, 'lfo.cutoff': 0.8, 'lfo.wave': 4, 'lfo.amp': 0.4 }),

  // ── FM / Digital ──
  fm('Lately FM', { 'fm.algo': 3, 'fm.r1': 1, 'fm.r2': 1, 'fm.i2': 0.7, 'fm.d2': 0.25, 'fm.r3': 1, 'fm.i3': 0.35, 'fm.d3': 0.15, 'fm.r4': 1, 'fm.i4': 0.4, 'fm.d4': 0.3, 'fm.fb': 0.55, 'fm.sus': 0.2, 'fm.vel': 0.6, 'amp.d': 0.8, 'amp.s': 0.6 }),
  fm('DX Solid Bass', { 'fm.algo': 0, 'fm.r2': 1, 'fm.r3': 3, 'fm.r4': 1, 'fm.i2': 0.6, 'fm.i3': 0.25, 'fm.i4': 0.2, 'fm.d2': 0.4, 'fm.fb': 0.3 }),
  fm('FM Pluck Bass', { 'fm.algo': 2, 'fm.r2': 1, 'fm.r3': 2, 'fm.r4': 5, 'fm.i2': 0.7, 'fm.i3': 0.3, 'fm.i4': 0.25, 'fm.d2': 0.12, 'fm.d3': 0.08, 'fm.d4': 0.03, 'fm.sus': 0, 'amp.s': 0.15, 'amp.d': 0.5 }),
  fm('FM E.Bass', { 'fm.algo': 2, 'fm.r2': 1, 'fm.i2': 0.5, 'fm.d2': 0.25, 'fm.r3': 4, 'fm.i3': 0.35, 'fm.d3': 0.05, 'fm.r4': 0.5, 'fm.i4': 0.2, 'fm.d4': 0.6, 'fm.sus': 0.1, 'amp.d': 1.2, 'amp.s': 0.3, 'voice.mode': 1 }),
  fm('Metal FM Bass', { 'fm.algo': 0, 'fm.r2': 3.5, 'fm.i2': 0.6, 'fm.r3': 1, 'fm.i3': 0.3, 'fm.fb': 0.6, 'fm.i4': 0.4, drive: 0.3, 'master.gain': 0.6 }),
  fm('Digital Wood', { 'fm.algo': 3, 'fm.r1': 1, 'fm.r2': 2, 'fm.i2': 0.4, 'fm.d2': 0.09, 'fm.r3': 1, 'fm.i3': 0.2, 'fm.fb': 0.2, 'fm.sus': 0.05, 'amp.s': 0.2, 'amp.d': 0.6 }),

  // ── Pluck ──
  pluck('Juno Pluck', { 'osc1.wave': 2, 'osc1.pw': 0.35, 'flt.cutoff': 350, 'flt.res': 0.3, 'flt.env': 0.7, 'fenv.d': 0.18, 'sub.level': 0.45, 'sub.wave': 2, chorus: 0.4 }),
  pluck('SH-101 Pluck', { 'flt.cutoff': 300, 'flt.res': 0.45, 'flt.env': 0.75, 'fenv.d': 0.14, 'amp.d': 0.35, 'sub.level': 0.5, 'sub.wave': 2 }),
  pluck('Pluck Thump', { 'osc1.wave': 1, 'osc2.wave': 4, 'osc2.level': 0.6, 'flt.cutoff': 200, 'flt.env': 0.8, 'fenv.d': 0.09, 'amp.d': 0.3, punch: 0.6 }),
  pluck('Rubber Pluck', { 'osc1.wave': 3, 'flt.type': 3, 'flt.cutoff': 260, 'flt.res': 0.55, 'flt.env': 0.6, 'fenv.d': 0.2, 'amp.d': 0.5 }),
  pluck('Tight Pluck', { 'master.gain': 0.9, 'flt.cutoff': 450, 'flt.env': 0.55, 'fenv.d': 0.08, 'amp.d': 0.2, 'amp.r': 0.05, punch: 0.5 }),

  // ── 80s / Synthpop ──
  pop80('Synthpop Bass', { 'osc2.wave': 1, 'osc2.level': 0.7, 'osc2.semi': -12, 'flt.cutoff': 1200, 'flt.res': 0.25, 'flt.env': 0.4, 'fenv.d': 0.25, 'amp.s': 0.6 }),
  pop80('Sequencer 16ths', { 'osc1.wave': 2, 'osc1.pw': 0.4, 'flt.cutoff': 700, 'flt.res': 0.4, 'flt.env': 0.45, 'fenv.d': 0.12, 'amp.s': 0.3, 'amp.d': 0.25 }),
  pop80('Night Drive', { 'osc2.level': 0.8, 'osc2.detune': 8, 'flt.cutoff': 600, 'flt.res': 0.5, 'flt.env': 0.5, 'fenv.d': 0.2, 'amp.s': 0.2, chorus: 0.35, 'eq.high': 2 }),
  pop80('DX Synth Pop', { ...FM, 'voice.mode': 1, 'fm.algo': 0, 'fm.r2': 1, 'fm.r3': 2, 'fm.i2': 0.75, 'fm.d2': 0.3, 'fm.i3': 0.3, 'fm.fb': 0.35, chorus: 0.3 }),
  pop80('Octave Bounce', { 'osc2.level': 0.6, 'osc2.semi': 12, 'flt.cutoff': 900, 'flt.env': 0.35, 'fenv.d': 0.15, 'amp.s': 0.4, 'amp.d': 0.3 }),

  // ── House / Garage ──
  house('Organ House Bass', { ...FM, 'fm.algo': 1, 'fm.r1': 1, 'fm.r2': 2, 'fm.i2': 0.12, 'fm.r3': 2, 'fm.i3': 0.55, 'fm.r4': 4, 'fm.i4': 0.15, 'fm.sus': 1, 'fm.fb': 0, 'amp.d': 0.3, 'amp.s': 0.8, 'amp.r': 0.05, 'voice.mode': 1, punch: 0.45 }),
  house('Garage Sub Wobble', { 'osc1.wave': 4, 'osc2.wave': 1, 'osc2.level': 0.35, 'flt.cutoff': 350, 'flt.env': 0.1, 'amp.s': 1, 'lfo.sync': 4, 'lfo.cutoff': 0.3, glide: 0.1 }),
  house('Deep House Sub', { 'osc1.wave': 4, 'osc2.wave': 3, 'osc2.level': 0.5, 'flt.type': 3, 'flt.cutoff': 300, 'flt.env': 0.2, 'amp.s': 0.7, punch: 0.5, 'voice.mode': 1 }),
  house('UKG Warp Bass', { ...GROWL, 'wt.morph': 0.66, 'wt.sync': 1.5, 'wt.formant': 0.2, 'flt.cutoff': 500, 'flt.res': 0.4, 'lfo.sync': 6, 'lfo.cutoff': 0.4, 'lfo.wt': 0.3, 'sub.level': 0.3, drive: 0.2 }),
  house('Tech House Rubber', { 'osc1.wave': 1, 'flt.cutoff': 260, 'flt.res': 0.6, 'flt.env': 0.5, 'fenv.d': 0.12, 'amp.s': 0.4, 'amp.d': 0.3, 'sub.level': 0.3, 'voice.mode': 1, punch: 0.6 }),

  // ── Electric ──
  elec('Fingerstyle P-Bass', { 'ph.model': 0, 'ph.pickup': 0.2, 'ph.pluck': 0.22, 'ph.bright': 0.45, 'ph.decay': 3, 'ph.damp': 0.45, 'ph.buzz': 0.08 }),
  elec('Jazz Bass Bridge', { 'master.gain': 0.58, 'ph.model': 0, 'ph.pickup': 0.09, 'ph.pluck': 0.15, 'ph.bright': 0.6, 'ph.decay': 3, 'ph.damp': 0.35, 'ph.buzz': 0.12, 'eq.mid': 2 }),
  elec('Pick Bass', { 'ph.model': 1, 'ph.pickup': 0.18, 'ph.bright': 0.6, 'ph.buzz': 0.12, 'ph.damp': 0.3, 'ph.decay': 2.5, drive: 0.15 }),
  elec('Muted Pick', { 'master.gain': 0.95, 'ph.model': 1, 'ph.decay': 0.45, 'ph.damp': 0.7, 'ph.bright': 0.4, 'amp.r': 0.05 }),
  elec('Slap Pop', { 'ph.model': 2, 'ph.pickup': 0.12, 'ph.bright': 0.7, 'ph.buzz': 0.3, 'ph.pop': 0.8, 'ph.decay': 2.2, 'ph.damp': 0.25, 'eq.mid': -4, 'eq.low': 3, 'eq.high': 3, punch: 0.6 }),
  elec('Slap Thumb Funk', { 'ph.model': 2, 'ph.pickup': 0.15, 'ph.bright': 0.55, 'ph.buzz': 0.2, 'ph.pop': 0.4, 'ph.decay': 1.8, 'ph.damp': 0.3, 'eq.mid': -2 }),
  elec('Flatwound Motown', { 'ph.model': 0, 'ph.bright': 0.2, 'ph.damp': 0.8, 'ph.decay': 1.3, 'ph.pickup': 0.25, 'ph.buzz': 0.03, 'flt.type': 3, 'flt.cutoff': 1800, 'flt.env': 0, 'flt.res': 0.1, 'flt.key': 0 }),
  elec('Chorus Fretted 80s', { 'master.gain': 0.95, 'ph.model': 1, 'ph.bright': 0.7, 'ph.pickup': 0.14, 'ph.damp': 0.25, 'ph.decay': 3.5, chorus: 0.45, 'eq.high': 2 }),

  // ── Fretless / Upright ──
  fretless('Fretless Mwah', { 'ph.model': 3, 'ph.mwah': 0.7, 'voice.mode': 2, glide: 0.12, 'ph.damp': 0.3, 'ph.decay': 4, 'ph.pickup': 0.12, chorus: 0.25 }),
  fretless('Fretless Jaco', { 'ph.model': 3, 'ph.mwah': 0.95, 'voice.mode': 2, glide: 0.09, 'ph.pickup': 0.08, 'ph.bright': 0.6, 'ph.decay': 5, chorus: 0.3 }),
  fretless('Jazz Upright', { 'ph.model': 4, 'ph.body': 0.6, 'ph.bright': 0.35, 'ph.damp': 0.55, 'ph.decay': 1.4, 'ph.pickup': 0.3, 'ph.pop': 0.4 }),
  fretless('Rockabilly Slap Upright', { 'master.gain': 0.58, 'ph.model': 4, 'ph.pop': 1, 'ph.bright': 0.6, 'ph.body': 0.5, 'ph.decay': 1, 'ph.buzz': 0.15, punch: 0.6 }),
  fretless('Dark Upright', { 'ph.model': 4, 'ph.body': 0.85, 'ph.bright': 0.15, 'ph.damp': 0.7, 'ph.decay': 1.8, 'ph.pickup': 0.35 }),

  // ── Hybrid (layers) ──
  hybrid('Finger + Sub', { 'master.gain': 0.62, ...PHYS, 'ph.model': 0, 'ph.pickup': 0.18, 'ph.bright': 0.5, 'sub.level': 0.55, 'sub.wave': 0 }),
  hybrid('Pick + Sub', { ...PHYS, 'ph.model': 1, 'ph.bright': 0.65, 'sub.level': 0.5, drive: 0.2, 'drv.mode': 1 }),
  hybrid('Lately + Sub', { ...FM, 'fm.algo': 3, 'fm.r1': 1, 'fm.r2': 1, 'fm.i2': 0.7, 'fm.d2': 0.25, 'fm.fb': 0.5, 'fm.i4': 0.4, 'sub.level': 0.5 }),
  hybrid('Moog + Sub Layer', { 'osc2.level': 0.6, 'osc2.detune': 6, 'flt.cutoff': 520, 'flt.res': 0.3, 'flt.env': 0.4, 'sub.level': 0.6, 'sub.oct': 0, drive: 0.25, 'eq.low': 2 }),
  hybrid('Acid + Sub', { ...ACID, 'flt.cutoff': 420, 'flt.res': 0.8, 'sub.level': 0.5 }),
  hybrid('Slap + 808', { ...PHYS, 'ph.model': 2, 'ph.pop': 0.6, 'ph.bright': 0.6, 'sub.level': 0.5, 'sub.wave': 0, 'eq.mid': -3 })
]
