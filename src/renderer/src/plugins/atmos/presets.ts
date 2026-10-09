import type { Preset } from '../sdk/types'

// Table / texture / option indices (see manifest.ts)
const T = { analog: 0, harm: 1, vocal: 2, glass: 3, pwm: 4, dust: 5, hollow: 6, bowed: 7, fold: 8, warm: 9 }
const X = { glass: 0, breath: 1, choir: 2, metal: 3, vinyl: 4, strings: 5, ocean: 6, chimes: 7 }
const F = { lp12: 0, lp24: 1, bp: 2, hp: 3, formant: 4, comb: 5 }
const L = { sine: 0, tri: 1, saw: 2, square: 3, sh: 4, drift: 5 }
const D = { pos: 0, cut: 1, pitch: 2, vol: 3, pan: 4, gpos: 5, noise: 6, formant: 7 }
const B = { harm: 0, odd: 1, fifths: 2, bell: 3 }

// Loudness trims (dB) measured offline so every preset plays a 4-note chord at a similar RMS (see atmos.test.ts).
const TRIM: Record<string, number> = {
  'Init': -1,
  'Northern Lights': 4,
  'Velvet Horizon': -1,
  'Polar Silk': -2.5,
  'Soft Focus': -0.5,
  'Lunar Tide': 0,
  'Abyssal Drone': -8.5,
  'Rust Belt Hum': -3.5,
  'Monolith': -8,
  'Tibetan Bowl': -6.5,
  'Endless Engine': -0.5,
  'Breathing Fog': 1.5,
  'Vinyl Memories': -1.5,
  'Rainglass': 1,
  'Frozen Lake': -0.5,
  'Rust & Static': -2.5,
  'Aurora Riser': -1.5,
  'Tidal Swell': 3.5,
  'Event Horizon': 0.5,
  'Slow Bloom': -1.5,
  'Sunrise Over Ice': -3.5,
  'Glass Cathedral': -4,
  'Solar Wind': 2,
  'Celestial Choir': 1,
  'Halo': -1,
  'Starfall': 1,
  'Black Lodge': -1.5,
  'Catacombs': -11.5,
  'Night Terrors': -1,
  'Dead Signal': -4.5,
  'Shadow Veil': -2,
  'Distant Horizon': -3.5,
  'Last Light': 0,
  'Titan Bed': -5.5,
  'Requiem Strings': 0.5,
  'Orbit': -2.5,
  'Particle Cloud': 0.5,
  'Time Smear': 0,
  'Reverse Memory': -0.5,
  'Dust Motes': 1.5,
  'Frozen Time': -1.5,
  'Arctic Wind': 3.5,
  'Whispering Pines': 3.5,
  'Desert Night': 0.5,
  'Pressure Front': -6.5,
  'Ghost Whistle': -1.5,
  'Distant Choir': -1,
  'Cathedral Voices': -1.5,
  'Monks At Dusk': 3,
  'Angel Breath': -1.5,
  'Siren Song': 1.5
}

const P = (name: string, category: string, params: Record<string, number>): Preset => ({
  name,
  category,
  params: { 'master.gain': TRIM[name] ?? 0, ...params }
})

export const PRESETS: Preset[] = [
  P('Init', 'Pads', {}),

  // ── Pads ──────────────────────────────────────────────────────────────────
  P('Northern Lights', 'Pads', {
    'wave.table': T.harm, 'wave.pos': 0.25, 'wave.unison': 6, 'wave.detune': 14, 'wave.envAmt': 0.3,
    'filter.mode': F.lp24, 'filter.cutoff': 2200, 'filter.res': 0.25, 'filter.envAmt': 0.25,
    'amp.attack': 1.5, 'amp.release': 5, 'lfo1.dest': D.pos, 'lfo1.rate': 0.1, 'lfo1.depth': 0.15,
    'gran.on': 1, 'gran.texture': X.glass, 'gran.level': 0.3, 'gran.shimmer': 0.3, 'gran.size': 300,
    'fx.chorus': 0.35, 'fx.reverb': 0.5, 'fx.revDecay': 8, 'fx.shimmer': 0.25, 'macro.evolve': 0.55
  }),
  P('Velvet Horizon', 'Pads', {
    'wave.table': T.analog, 'wave.pos': 0.45, 'wave.unison': 8, 'wave.detune': 18, 'wave.sub': 0.3,
    'filter.mode': F.lp24, 'filter.cutoff': 1800, 'filter.res': 0.15, 'amp.attack': 0.8, 'amp.release': 3.5,
    'fx.chorus': 0.5, 'fx.reverb': 0.4, 'fx.revDecay': 5, 'fx.delay': 0.1
  }),
  P('Polar Silk', 'Pads', {
    'wave.table': T.warm, 'wave.pos': 0.6, 'wave.unison': 4, 'wave.detune': 8, 'filter.mode': F.lp12, 'filter.cutoff': 3000,
    'noise.on': 1, 'noise.tune': 0.7, 'noise.level': 0.2, 'noise.bank': B.harm, 'noise.q': 60,
    'amp.attack': 1, 'amp.release': 4, 'fx.reverb': 0.45, 'fx.revDecay': 7, 'fx.chorus': 0.3
  }),
  P('Soft Focus', 'Pads', {
    'wave.table': T.pwm, 'wave.pos': 0.3, 'wave.unison': 4, 'wave.detune': 10, 'lfo1.dest': D.pos, 'lfo1.depth': 0.3, 'lfo1.rate': 0.3,
    'filter.mode': F.lp24, 'filter.cutoff': 1500, 'filter.res': 0.2, 'amp.attack': 0.7, 'amp.release': 3,
    'fx.chorus': 0.6, 'fx.reverb': 0.4, 'fx.revDecay': 5
  }),
  P('Lunar Tide', 'Pads', {
    'wave.table': T.dust, 'wave.pos': 0.2, 'wave.unison': 5, 'wave.detune': 12, 'wave.envAmt': 0.4,
    'filter.mode': F.lp24, 'filter.cutoff': 1600, 'filter.envAmt': 0.35, 'fenv.attack': 4, 'fenv.decay': 8,
    'lfo2.dest': D.cut, 'lfo2.shape': L.drift, 'lfo2.depth': 0.2, 'lfo2.rate': 0.1,
    'amp.attack': 2, 'amp.release': 6, 'fx.reverb': 0.55, 'fx.revDecay': 10, 'macro.evolve': 0.6
  }),

  // ── Drones ────────────────────────────────────────────────────────────────
  P('Abyssal Drone', 'Drones', {
    'wave.table': T.hollow, 'wave.pos': 0.2, 'wave.octave': -1, 'wave.unison': 3, 'wave.detune': 6, 'wave.sub': 0.6,
    'filter.mode': F.lp24, 'filter.cutoff': 600, 'filter.res': 0.4, 'drift.amount': 0.5, 'macro.evolve': 0.7,
    'noise.on': 1, 'noise.tune': 0.8, 'noise.bank': B.odd, 'noise.q': 80, 'noise.level': 0.25, 'noise.octave': -1,
    'fx.reverb': 0.5, 'fx.revDecay': 14, 'fx.revDamp': 0.7, 'macro.tone': 0.35, 'amp.attack': 3, 'amp.release': 8, 'fx.chorus': 0.2
  }),
  P('Rust Belt Hum', 'Drones', {
    'wave.table': T.fold, 'wave.pos': 0.35, 'wave.octave': -1, 'wave.unison': 3, 'wave.detune': 7,
    'filter.mode': F.lp12, 'filter.cutoff': 1200, 'filter.res': 0.35, 'fx.drive': 0.45,
    'gran.on': 1, 'gran.texture': X.vinyl, 'gran.level': 0.35, 'gran.keytrack': 0, 'gran.size': 400,
    'lfo2.dest': D.cut, 'lfo2.shape': L.drift, 'lfo2.depth': 0.25, 'lfo2.rate': 0.15,
    'fx.reverb': 0.35, 'fx.revDecay': 4, 'amp.attack': 1.5, 'amp.release': 4
  }),
  P('Monolith', 'Drones', {
    'wave.table': T.analog, 'wave.pos': 0.55, 'wave.octave': -1, 'wave.unison': 6, 'wave.detune': 9, 'wave.sub': 0.4,
    'filter.mode': F.lp24, 'filter.cutoff': 400, 'filter.res': 0.5, 'filter.envAmt': 0.2, 'macro.evolve': 0.6,
    'lfo1.dest': D.cut, 'lfo1.depth': 0.2, 'lfo1.rate': 0.05, 'fx.reverb': 0.5, 'fx.revDecay': 9, 'fx.delay': 0,
    'amp.attack': 2.5, 'amp.release': 6
  }),
  P('Tibetan Bowl', 'Drones', {
    'wave.table': T.glass, 'wave.pos': 0.2, 'wave.octave': -1, 'wave.unison': 2, 'wave.detune': 4, 'wave.level': 0.6,
    'gran.on': 1, 'gran.texture': X.metal, 'gran.level': 0.5, 'gran.size': 400, 'gran.density': 10,
    'filter.mode': F.comb, 'filter.cutoff': 5000, 'filter.res': 0.7, 'fx.reverb': 0.55, 'fx.revDecay': 10,
    'amp.attack': 1.2, 'amp.release': 7, 'fx.chorus': 0.15
  }),
  P('Endless Engine', 'Drones', {
    'wave.table': T.bowed, 'wave.pos': 0.4, 'wave.octave': -1, 'wave.unison': 5, 'wave.detune': 11,
    'filter.mode': F.lp24, 'filter.cutoff': 900, 'filter.res': 0.3, 'drift.amount': 0.6, 'drift.rate': 0.4,
    'lfo1.dest': D.pos, 'lfo1.shape': L.tri, 'lfo1.depth': 0.25, 'lfo1.rate': 0.04,
    'fx.delay': 0.25, 'fx.delayTime': 750, 'fx.chorus': 0.3, 'fx.reverb': 0.45, 'fx.revDecay': 8, 'amp.attack': 2, 'amp.release': 5
  }),

  // ── Textures ──────────────────────────────────────────────────────────────
  P('Breathing Fog', 'Textures', {
    'wave.table': T.vocal, 'wave.level': 0.3, 'wave.pos': 0.4, 'gran.on': 1, 'gran.texture': X.breath, 'gran.level': 0.75,
    'gran.size': 300, 'gran.density': 18, 'gran.spray': 0.5, 'gran.keytrack': 0.5,
    'noise.on': 1, 'noise.tune': 0.3, 'noise.color': 2000, 'noise.level': 0.25,
    'filter.mode': F.formant, 'filter.vowel': 0.4, 'filter.cutoff': 1500, 'lfo1.dest': D.formant, 'lfo1.depth': 0.3, 'lfo1.rate': 0.1,
    'fx.reverb': 0.55, 'fx.revDecay': 9, 'amp.attack': 2, 'amp.release': 5
  }),
  P('Vinyl Memories', 'Textures', {
    'wave.table': T.warm, 'wave.pos': 0.3, 'wave.level': 0.6, 'wave.unison': 3, 'wave.detune': 9,
    'gran.on': 1, 'gran.texture': X.vinyl, 'gran.keytrack': 0, 'gran.level': 0.5, 'gran.size': 500, 'gran.density': 6,
    'filter.mode': F.lp12, 'filter.cutoff': 1800, 'fx.chorus': 0.4, 'fx.chorusRate': 0.25, 'fx.drive': 0.25,
    'fx.reverb': 0.3, 'fx.revDecay': 4, 'amp.attack': 0.6, 'amp.release': 3
  }),
  P('Rainglass', 'Textures', {
    'wave.on': 0, 'gran.on': 1, 'gran.texture': X.chimes, 'gran.level': 0.8, 'gran.size': 250, 'gran.density': 12,
    'gran.spray': 0.6, 'gran.pitchRand': 0.2, 'gran.shimmer': 0.2, 'gran.width': 1,
    'filter.mode': F.lp12, 'filter.cutoff': 9000, 'filter.envAmt': 0,
    'fx.reverb': 0.55, 'fx.revDecay': 7, 'fx.delay': 0.3, 'fx.delayTime': 380, 'fx.delayFb': 0.5, 'amp.attack': 0.3, 'amp.release': 4
  }),
  P('Frozen Lake', 'Textures', {
    'wave.table': T.glass, 'wave.pos': 0.7, 'wave.unison': 3, 'wave.detune': 5, 'wave.level': 0.6,
    'gran.on': 1, 'gran.texture': X.metal, 'gran.level': 0.4, 'gran.size': 600, 'gran.density': 6, 'gran.reverse': 0.5,
    'noise.on': 1, 'noise.color': 9000, 'noise.tune': 0, 'noise.level': 0.12,
    'filter.mode': F.lp12, 'filter.cutoff': 5000, 'fx.reverb': 0.6, 'fx.revDecay': 16, 'fx.revDamp': 0.15, 'fx.shimmer': 0.2,
    'amp.attack': 1.5, 'amp.release': 6, 'macro.tone': 0.6
  }),
  P('Rust & Static', 'Textures', {
    'wave.table': T.fold, 'wave.pos': 0.6, 'wave.unison': 2, 'wave.level': 0.5,
    'gran.on': 1, 'gran.texture': X.vinyl, 'gran.keytrack': 0, 'gran.level': 0.6, 'gran.size': 120, 'gran.density': 25, 'gran.spray': 0.7,
    'noise.on': 1, 'noise.tune': 0.4, 'noise.q': 30, 'noise.level': 0.2,
    'filter.mode': F.hp, 'filter.cutoff': 300, 'filter.envAmt': 0, 'fx.drive': 0.5,
    'lfo1.dest': D.cut, 'lfo1.shape': L.sh, 'lfo1.rate': 2, 'lfo1.depth': 0.2, 'fx.reverb': 0.35, 'fx.revDecay': 3
  }),

  // ── Swells / Risers ───────────────────────────────────────────────────────
  P('Aurora Riser', 'Swells/Risers', {
    'wave.table': T.analog, 'wave.pos': 0.1, 'wave.envAmt': 0.8, 'wave.unison': 7, 'wave.detune': 16,
    'fenv.attack': 8, 'fenv.decay': 20, 'fenv.sustain': 1, 'fenv.pitch': 12, 'filter.envAmt': 0.6, 'filter.cutoff': 400,
    'amp.attack': 6, 'amp.release': 4, 'noise.on': 1, 'noise.tune': 0.2, 'noise.level': 0.35, 'noise.color': 6000,
    'fx.shimmer': 0.4, 'fx.reverb': 0.5, 'fx.revDecay': 8
  }),
  P('Tidal Swell', 'Swells/Risers', {
    'wave.table': T.harm, 'wave.pos': 0.05, 'wave.envAmt': 0.7, 'wave.unison': 5, 'wave.detune': 12,
    'filter.mode': F.lp24, 'filter.cutoff': 500, 'filter.envAmt': 0.7, 'fenv.attack': 5, 'fenv.sustain': 0.8,
    'amp.attack': 4, 'amp.release': 4, 'fx.reverb': 0.5, 'fx.revDecay': 8, 'fx.chorus': 0.3
  }),
  P('Event Horizon', 'Swells/Risers', {
    'wave.table': T.dust, 'wave.pos': 0.3, 'wave.envAmt': 0.6, 'wave.unison': 6, 'wave.detune': 20,
    'fenv.attack': 10, 'fenv.decay': 20, 'fenv.sustain': 1, 'fenv.pitch': 24, 'filter.envAmt': 0.5, 'filter.cutoff': 600,
    'noise.on': 1, 'noise.level': 0.5, 'noise.tune': 0.5, 'noise.bank': B.fifths,
    'gran.on': 1, 'gran.texture': X.breath, 'gran.level': 0.3,
    'lfo1.dest': D.vol, 'lfo1.rate': 4, 'lfo1.depth': 0.25, 'lfo1.shape': L.tri,
    'amp.attack': 10, 'amp.release': 3, 'fx.reverb': 0.6, 'fx.revDecay': 10, 'fx.shimmer': 0.3
  }),
  P('Slow Bloom', 'Swells/Risers', {
    'wave.table': T.vocal, 'wave.pos': 0.0, 'wave.envAmt': 0.6, 'wave.unison': 5, 'wave.detune': 10,
    'filter.mode': F.lp12, 'filter.cutoff': 900, 'filter.envAmt': 0.5, 'fenv.attack': 12, 'fenv.sustain': 1,
    'amp.attack': 12, 'amp.release': 6, 'fx.reverb': 0.5, 'fx.revDecay': 9, 'macro.evolve': 0.5
  }),
  P('Sunrise Over Ice', 'Swells/Risers', {
    'wave.table': T.glass, 'wave.pos': 0.1, 'wave.envAmt': 0.8, 'wave.unison': 4, 'wave.detune': 8,
    'filter.mode': F.lp24, 'filter.cutoff': 300, 'filter.envAmt': 0.8, 'fenv.attack': 10, 'fenv.sustain': 1,
    'amp.attack': 8, 'amp.release': 6, 'fx.shimmer': 0.5, 'fx.reverb': 0.55, 'fx.revDecay': 12, 'fx.revDamp': 0.2
  }),

  // ── Shimmer ───────────────────────────────────────────────────────────────
  P('Glass Cathedral', 'Shimmer', {
    'wave.table': T.glass, 'wave.pos': 0.5, 'wave.unison': 5, 'wave.detune': 6, 'filter.mode': F.lp12, 'filter.cutoff': 6000,
    'gran.on': 1, 'gran.texture': X.glass, 'gran.level': 0.35, 'amp.attack': 0.6, 'amp.release': 6,
    'fx.reverb': 0.6, 'fx.revDecay': 12, 'fx.revSize': 0.9, 'fx.shimmer': 0.45, 'fx.revDamp': 0.25
  }),
  P('Solar Wind', 'Shimmer', {
    'wave.table': T.dust, 'wave.pos': 0.4, 'wave.unison': 6, 'wave.detune': 14, 'lfo1.dest': D.pos, 'lfo1.depth': 0.3, 'lfo1.rate': 0.07,
    'noise.on': 1, 'noise.tune': 0, 'noise.color': 8000, 'noise.level': 0.2, 'lfo2.dest': D.noise, 'lfo2.shape': L.drift, 'lfo2.depth': 0.5, 'lfo2.rate': 0.2,
    'fx.shimmer': 0.6, 'fx.reverb': 0.65, 'fx.revDecay': 14, 'macro.evolve': 0.7, 'amp.attack': 2, 'amp.release': 6
  }),
  P('Celestial Choir', 'Shimmer', {
    'wave.table': T.vocal, 'wave.pos': 0.5, 'wave.unison': 6, 'wave.detune': 12, 'filter.mode': F.lp12, 'filter.cutoff': 4500,
    'fx.shimmer': 0.55, 'fx.shimInterval': 2, 'fx.reverb': 0.6, 'fx.revDecay': 12, 'amp.attack': 1.5, 'amp.release': 6, 'fx.chorus': 0.4
  }),
  P('Halo', 'Shimmer', {
    'wave.table': T.analog, 'wave.pos': 0.05, 'wave.unison': 4, 'wave.detune': 10, 'filter.mode': F.lp12, 'filter.cutoff': 4000,
    'fx.shimmer': 0.7, 'fx.reverb': 0.7, 'fx.revDecay': 18, 'fx.revSize': 0.95, 'amp.attack': 1, 'amp.release': 6
  }),
  P('Starfall', 'Shimmer', {
    'wave.table': T.glass, 'wave.level': 0.4, 'wave.pos': 0.8, 'gran.on': 1, 'gran.texture': X.chimes, 'gran.level': 0.7, 'gran.shimmer': 0.5,
    'gran.spray': 0.5, 'gran.width': 1, 'filter.mode': F.lp12, 'filter.cutoff': 8000,
    'fx.shimmer': 0.5, 'fx.shimInterval': 3, 'fx.reverb': 0.6, 'fx.revDecay': 10, 'fx.delay': 0.2, 'amp.attack': 0.4, 'amp.release': 5
  }),

  // ── Dark ──────────────────────────────────────────────────────────────────
  P('Black Lodge', 'Dark', {
    'wave.table': T.hollow, 'wave.pos': 0.4, 'wave.octave': -1, 'wave.unison': 4, 'wave.detune': 9,
    'filter.mode': F.bp, 'filter.cutoff': 350, 'filter.res': 0.6, 'lfo1.dest': D.cut, 'lfo1.shape': L.drift, 'lfo1.depth': 0.4, 'lfo1.rate': 0.07,
    'noise.on': 1, 'noise.bank': B.odd, 'noise.q': 120, 'noise.tune': 0.9, 'noise.level': 0.3,
    'fx.reverb': 0.6, 'fx.revDecay': 20, 'fx.revDamp': 0.8, 'macro.tone': 0.3, 'amp.attack': 2.5, 'amp.release': 7
  }),
  P('Catacombs', 'Dark', {
    'wave.table': T.bowed, 'wave.octave': -1, 'wave.level': 0.45, 'gran.on': 1, 'gran.texture': X.ocean, 'gran.keytrack': 0.5, 'gran.level': 0.7,
    'gran.size': 500, 'filter.mode': F.lp24, 'filter.cutoff': 700, 'drift.amount': 0.6,
    'fx.reverb': 0.55, 'fx.revDecay': 12, 'fx.revDamp': 0.7, 'macro.tone': 0.35, 'amp.attack': 3, 'amp.release': 7
  }),
  P('Night Terrors', 'Dark', {
    'wave.table': T.fold, 'wave.pos': 0.5, 'wave.unison': 3, 'wave.detune': 25, 'gran.on': 1, 'gran.texture': X.metal,
    'gran.reverse': 0.7, 'gran.pitchRand': 3, 'gran.level': 0.45, 'filter.mode': F.comb, 'filter.res': 0.6, 'filter.cutoff': 1500,
    'drift.amount': 0.8, 'lfo2.dest': D.pitch, 'lfo2.shape': L.drift, 'lfo2.depth': 0.3, 'lfo2.rate': 0.3,
    'fx.reverb': 0.5, 'fx.revDecay': 9, 'fx.delay': 0.3, 'fx.delayTime': 900, 'macro.tone': 0.4, 'amp.attack': 2, 'amp.release': 5
  }),
  P('Dead Signal', 'Dark', {
    'wave.table': T.pwm, 'wave.pos': 0.7, 'wave.unison': 2, 'wave.octave': -1, 'gran.on': 1, 'gran.texture': X.vinyl, 'gran.keytrack': 0, 'gran.level': 0.4,
    'filter.mode': F.lp12, 'filter.cutoff': 900, 'filter.res': 0.5, 'fx.drive': 0.4,
    'lfo1.dest': D.cut, 'lfo1.shape': L.sh, 'lfo1.rate': 3, 'lfo1.depth': 0.25, 'fx.reverb': 0.4, 'fx.revDecay': 6, 'amp.attack': 0.5, 'amp.release': 3
  }),
  P('Shadow Veil', 'Dark', {
    'wave.table': T.vocal, 'wave.pos': 0.1, 'wave.octave': -1, 'wave.unison': 6, 'wave.detune': 12,
    'filter.mode': F.formant, 'filter.vowel': 0.1, 'filter.cutoff': 1200,
    'fx.reverb': 0.55, 'fx.revDecay': 10, 'fx.revDamp': 0.7, 'macro.tone': 0.35, 'amp.attack': 2, 'amp.release': 6
  }),

  // ── Cinematic ─────────────────────────────────────────────────────────────
  P('Distant Horizon', 'Cinematic', {
    'wave.table': T.analog, 'wave.pos': 0.45, 'wave.unison': 8, 'wave.detune': 16, 'wave.sub': 0.35,
    'filter.mode': F.lp24, 'filter.cutoff': 1500, 'filter.envAmt': 0.3, 'fenv.attack': 3,
    'fx.chorus': 0.35, 'fx.reverb': 0.55, 'fx.revDecay': 9, 'fx.revSize': 0.9, 'fx.delay': 0.2, 'amp.attack': 1.5, 'amp.release': 5
  }),
  P('Last Light', 'Cinematic', {
    'wave.table': T.bowed, 'wave.pos': 0.5, 'wave.unison': 6, 'wave.detune': 13, 'gran.on': 1, 'gran.texture': X.strings, 'gran.level': 0.4,
    'filter.mode': F.lp24, 'filter.cutoff': 2400, 'amp.attack': 2.5, 'amp.release': 6, 'fx.reverb': 0.5, 'fx.revDecay': 10
  }),
  P('Titan Bed', 'Cinematic', {
    'wave.table': T.harm, 'wave.pos': 0.5, 'wave.octave': -1, 'wave.unison': 7, 'wave.detune': 14, 'wave.sub': 0.5,
    'filter.mode': F.lp24, 'filter.cutoff': 1100, 'filter.res': 0.3, 'lfo1.dest': D.cut, 'lfo1.depth': 0.15, 'lfo1.rate': 0.06,
    'fx.drive': 0.2, 'fx.reverb': 0.55, 'fx.revDecay': 12, 'amp.attack': 2, 'amp.release': 6
  }),
  P('Requiem Strings', 'Cinematic', {
    'wave.table': T.bowed, 'wave.pos': 0.3, 'wave.unison': 8, 'wave.detune': 20, 'filter.mode': F.lp12, 'filter.cutoff': 3500,
    'gran.on': 1, 'gran.texture': X.strings, 'gran.level': 0.3, 'fx.chorus': 0.4, 'amp.attack': 1.8, 'amp.release': 4,
    'fx.reverb': 0.5, 'fx.revDecay': 7
  }),
  P('Orbit', 'Cinematic', {
    'wave.table': T.pwm, 'wave.pos': 0.4, 'wave.unison': 4, 'wave.detune': 10, 'filter.mode': F.lp24, 'filter.cutoff': 2000,
    'fx.delay': 0.35, 'fx.delayTime': 600, 'fx.delayFb': 0.55, 'lfo1.dest': D.pan, 'lfo1.depth': 0.5, 'lfo1.rate': 0.2,
    'fx.reverb': 0.5, 'fx.revDecay': 8, 'amp.attack': 1, 'amp.release': 4
  }),

  // ── Granular ──────────────────────────────────────────────────────────────
  P('Particle Cloud', 'Granular', {
    'wave.on': 0, 'gran.on': 1, 'gran.texture': X.glass, 'gran.level': 0.9, 'gran.size': 80, 'gran.density': 50, 'gran.spray': 0.8,
    'gran.pitchRand': 0.3, 'gran.width': 1, 'filter.mode': F.lp12, 'filter.cutoff': 7000, 'fx.reverb': 0.5, 'fx.revDecay': 7,
    'amp.attack': 0.8, 'amp.release': 4
  }),
  P('Time Smear', 'Granular', {
    'wave.on': 0, 'gran.on': 1, 'gran.texture': X.strings, 'gran.level': 0.9, 'gran.size': 700, 'gran.density': 8, 'gran.spray': 0.3,
    'gran.scan': 0.05, 'gran.reverse': 0.3, 'filter.mode': F.lp12, 'filter.cutoff': 4000, 'fx.reverb': 0.5, 'fx.revDecay': 8,
    'amp.attack': 1.5, 'amp.release': 5
  }),
  P('Reverse Memory', 'Granular', {
    'wave.on': 0, 'gran.on': 1, 'gran.texture': X.choir, 'gran.level': 0.9, 'gran.reverse': 1, 'gran.size': 450, 'gran.density': 10,
    'filter.mode': F.lp12, 'filter.cutoff': 6000, 'fx.chorus': 0.4, 'fx.reverb': 0.6, 'fx.revDecay': 9, 'amp.attack': 1, 'amp.release': 5
  }),
  P('Dust Motes', 'Granular', {
    'wave.on': 0, 'gran.on': 1, 'gran.texture': X.chimes, 'gran.level': 0.9, 'gran.size': 40, 'gran.density': 70, 'gran.spray': 1,
    'gran.pitchRand': 7, 'gran.shimmer': 0.3, 'gran.width': 1, 'filter.mode': F.lp12, 'filter.cutoff': 7000,
    'fx.delay': 0.3, 'fx.reverb': 0.5, 'fx.revDecay': 6, 'amp.attack': 0.5, 'amp.release': 3
  }),
  P('Frozen Time', 'Granular', {
    'wave.on': 0, 'gran.on': 1, 'gran.texture': X.metal, 'gran.level': 0.9, 'gran.size': 1000, 'gran.density': 4, 'gran.spray': 0.05,
    'gran.scan': 0, 'filter.mode': F.lp12, 'filter.cutoff': 6000, 'fx.shimmer': 0.3, 'fx.reverb': 0.7, 'fx.revDecay': 20,
    'amp.attack': 2, 'amp.release': 6
  }),

  // ── Air / Noise ───────────────────────────────────────────────────────────
  P('Arctic Wind', 'Air/Noise', {
    'wave.on': 0, 'noise.on': 1, 'noise.level': 0.9, 'noise.tune': 0.15, 'noise.color': 2500,
    'lfo1.dest': D.noise, 'lfo1.shape': L.drift, 'lfo1.depth': 0.4, 'lfo1.rate': 0.12,
    'lfo2.dest': D.cut, 'lfo2.shape': L.drift, 'lfo2.depth': 0.4, 'lfo2.rate': 0.07,
    'filter.mode': F.bp, 'filter.cutoff': 1200, 'filter.res': 0.5, 'filter.envAmt': 0, 'filter.keytrack': 0.2,
    'fx.reverb': 0.5, 'fx.revDecay': 6, 'amp.attack': 1.5, 'amp.release': 4
  }),
  P('Whispering Pines', 'Air/Noise', {
    'wave.on': 0, 'noise.on': 1, 'noise.level': 0.7, 'noise.tune': 0.8, 'noise.q': 25, 'noise.bank': B.harm,
    'gran.on': 1, 'gran.texture': X.breath, 'gran.keytrack': 0, 'gran.level': 0.4,
    'filter.mode': F.formant, 'filter.vowel': 0.6, 'filter.cutoff': 1800, 'lfo1.dest': D.formant, 'lfo1.depth': 0.2, 'lfo1.rate': 0.15,
    'fx.reverb': 0.5, 'fx.revDecay': 7, 'amp.attack': 1.2, 'amp.release': 4
  }),
  P('Desert Night', 'Air/Noise', {
    'wave.table': T.warm, 'wave.pos': 0, 'wave.level': 0.3, 'wave.unison': 1, 'noise.on': 1, 'noise.level': 0.7, 'noise.tune': 0.6,
    'noise.q': 150, 'noise.bank': B.fifths, 'noise.color': 6000, 'filter.mode': F.lp12, 'filter.cutoff': 5000,
    'fx.reverb': 0.55, 'fx.revDecay': 9, 'amp.attack': 1.5, 'amp.release': 5
  }),
  P('Pressure Front', 'Air/Noise', {
    'wave.on': 0, 'noise.on': 1, 'noise.level': 0.8, 'noise.tune': 0, 'noise.color': 500,
    'gran.on': 1, 'gran.texture': X.ocean, 'gran.keytrack': 0, 'gran.level': 0.5,
    'filter.mode': F.lp12, 'filter.cutoff': 2000, 'lfo1.dest': D.vol, 'lfo1.depth': 0.3, 'lfo1.rate': 0.08,
    'fx.reverb': 0.4, 'fx.revDecay': 5, 'amp.attack': 2, 'amp.release': 4
  }),
  P('Ghost Whistle', 'Air/Noise', {
    'wave.on': 0, 'noise.on': 1, 'noise.level': 0.6, 'noise.tune': 1, 'noise.q': 300, 'noise.bank': B.odd, 'noise.octave': 1,
    'filter.mode': F.lp12, 'filter.cutoff': 8000, 'lfo1.dest': D.pitch, 'lfo1.depth': 0.1, 'lfo1.rate': 4.5,
    'fx.reverb': 0.6, 'fx.revDecay': 9, 'amp.attack': 0.8, 'amp.release': 4
  }),

  // ── Choir-ish ─────────────────────────────────────────────────────────────
  P('Distant Choir', 'Choir-ish', {
    'wave.table': T.vocal, 'wave.pos': 0.45, 'wave.unison': 6, 'wave.detune': 14, 'wave.spread': 0.9,
    'lfo1.dest': D.pos, 'lfo1.depth': 0.15, 'lfo1.rate': 0.1, 'filter.mode': F.formant, 'filter.vowel': 0.45, 'filter.cutoff': 1500,
    'lfo2.dest': D.formant, 'lfo2.depth': 0.2, 'lfo2.rate': 0.08, 'gran.on': 1, 'gran.texture': X.choir, 'gran.level': 0.4,
    'fx.chorus': 0.4, 'fx.reverb': 0.6, 'fx.revDecay': 10, 'amp.attack': 1.5, 'amp.release': 5
  }),
  P('Cathedral Voices', 'Choir-ish', {
    'wave.table': T.vocal, 'wave.pos': 0.3, 'wave.unison': 5, 'wave.detune': 10, 'gran.on': 1, 'gran.texture': X.choir, 'gran.level': 0.6,
    'filter.mode': F.lp24, 'filter.cutoff': 3500, 'fx.shimmer': 0.25, 'fx.reverb': 0.65, 'fx.revDecay': 14, 'amp.attack': 1.2, 'amp.release': 6
  }),
  P('Monks At Dusk', 'Choir-ish', {
    'wave.table': T.vocal, 'wave.pos': 0.1, 'wave.octave': -1, 'wave.unison': 4, 'wave.detune': 8,
    'filter.mode': F.formant, 'filter.vowel': 0.2, 'filter.cutoff': 1300, 'fx.reverb': 0.55, 'fx.revDecay': 9, 'fx.revDamp': 0.6,
    'amp.attack': 1, 'amp.release': 5
  }),
  P('Angel Breath', 'Choir-ish', {
    'wave.table': T.vocal, 'wave.pos': 0.7, 'wave.unison': 6, 'wave.detune': 12, 'gran.on': 1, 'gran.texture': X.choir, 'gran.level': 0.5,
    'noise.on': 1, 'noise.tune': 0.5, 'noise.level': 0.2, 'filter.mode': F.lp12, 'filter.cutoff': 5000,
    'fx.shimmer': 0.45, 'fx.reverb': 0.6, 'fx.revDecay': 11, 'amp.attack': 1.5, 'amp.release': 6
  }),
  P('Siren Song', 'Choir-ish', {
    'wave.table': T.vocal, 'wave.pos': 0.5, 'wave.unison': 4, 'wave.detune': 9, 'lfo1.dest': D.pos, 'lfo1.depth': 0.4, 'lfo1.rate': 0.05,
    'filter.mode': F.formant, 'filter.vowel': 0.5, 'filter.cutoff': 1600, 'gran.on': 1, 'gran.texture': X.choir, 'gran.level': 0.35, 'gran.shimmer': 0.2,
    'fx.delay': 0.3, 'fx.reverb': 0.55, 'fx.revDecay': 9, 'amp.attack': 1.2, 'amp.release': 5
  })
]
