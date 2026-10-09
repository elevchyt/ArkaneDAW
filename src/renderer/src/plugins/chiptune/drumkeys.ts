// Retro drum map for Chiptune's Drums mode. Each key plays a one-shot built from chip channels
// (pulse / triangle / noise / GB wave layers with pitch sweeps and stepped 4-bit decays).
// General-MIDI-style percussion on 35..64 and game SFX from C6 (MIDI 72, FL naming C5 = 60) upward.
// Pure data: imported by the DSP (AudioWorklet) and the editor.
import { W } from './chip'

export interface DrumLayer {
  wave: number
  /** start pitch (MIDI note; for noise layers the noise "pitch" -> LFSR rate) */
  note: number
  /** pitch change in semitones reached after sweepTime (negative = falling) */
  sweep?: number
  sweepTime?: number
  /** 0 linear (NES sweep unit), 1 exponential (fast start, drum-like) */
  curve?: 0 | 1
  /** seconds at full level before the decay */
  hold?: number
  /** seconds from full level to silence (linear, 4-bit stepped when Authentic) */
  decay: number
  level: number
  /** start offset in seconds */
  delay?: number
  duty?: number
  /** semitone offsets stepped every arpFrames (60 Hz frames) — coin/power-up jingles */
  arp?: number[]
  arpFrames?: number
  arpLoop?: boolean
}

export interface DrumDef {
  key: number
  name: string
  short: string
  group: 'Kick' | 'Snare' | 'Hat' | 'Cymbal' | 'Tom' | 'Perc' | 'SFX'
  /** voices in the same choke group cut each other (hats) */
  choke?: number
  layers: DrumLayer[]
}

export const DRUM_KITS = ['NES Kit', 'Game Boy Kit', 'Arcade Kit'] as const
export const SFX_START = 72

type L = DrumLayer
const tri = (note: number, o: Partial<L> = {}): L => ({ wave: W.TRI, note, decay: 0.2, level: 1, ...o })
const pul = (duty: number, note: number, o: Partial<L> = {}): L => ({ wave: duty <= 0.125 ? W.P12 : duty <= 0.25 ? W.P25 : W.P50, duty, note, decay: 0.2, level: 0.5, ...o })
const nl = (note: number, o: Partial<L> = {}): L => ({ wave: W.NL, note, decay: 0.1, level: 0.7, ...o })
const ns = (note: number, o: Partial<L> = {}): L => ({ wave: W.NS, note, decay: 0.3, level: 0.5, ...o })

const d = (key: number, name: string, short: string, group: DrumDef['group'], layers: L[], choke?: number): DrumDef => ({ key, name, short, group, layers, choke })

const tom = (key: number, name: string, short: string, n: number): DrumDef =>
  d(key, name, short, 'Tom', [
    tri(n, { sweep: -9, sweepTime: 0.18, curve: 1, decay: 0.32, level: 0.95 }),
    pul(0.25, n + 12, { sweep: -14, sweepTime: 0.12, curve: 1, decay: 0.12, level: 0.22 }),
    nl(74, { decay: 0.02, level: 0.25 })
  ])

/** The NES kit: the reference recipes. */
const NES: DrumDef[] = [
  d(35, 'Deep Kick', 'KICK2', 'Kick', [tri(52, { sweep: -30, sweepTime: 0.14, curve: 1, decay: 0.38 }), nl(62, { decay: 0.03, level: 0.45 })]),
  d(36, 'Kick', 'KICK', 'Kick', [tri(57, { sweep: -33, sweepTime: 0.08, curve: 1, decay: 0.26 }), nl(72, { decay: 0.025, level: 0.5 })]),
  d(37, 'Rim Shot', 'RIM', 'Snare', [pul(0.25, 79, { decay: 0.035, level: 0.45 }), ns(98, { decay: 0.025, level: 0.4 })]),
  d(38, 'Snare', 'SNARE', 'Snare', [nl(101, { decay: 0.19, level: 0.75 }), tri(62, { sweep: -12, sweepTime: 0.05, curve: 1, decay: 0.09, level: 0.9 })]),
  d(39, 'Clap', 'CLAP', 'Snare', [
    nl(99, { decay: 0.012, level: 0.7 }),
    nl(99, { decay: 0.012, level: 0.7, delay: 0.014 }),
    nl(99, { decay: 0.012, level: 0.7, delay: 0.028 }),
    nl(97, { decay: 0.16, level: 0.65, delay: 0.042 })
  ]),
  d(40, 'Snare 2', 'SNR2', 'Snare', [nl(106, { decay: 0.13, level: 0.7 }), pul(0.5, 67, { sweep: -12, sweepTime: 0.06, curve: 1, decay: 0.07, level: 0.4 })]),
  tom(41, 'Low Floor Tom', 'TOM1', 50),
  d(42, 'Closed Hat', 'CHH', 'Hat', [nl(119, { decay: 0.045, level: 0.55 })], 1),
  tom(43, 'High Floor Tom', 'TOM2', 53),
  d(44, 'Pedal Hat', 'PHH', 'Hat', [nl(113, { decay: 0.06, level: 0.45, hold: 0.01 })], 1),
  tom(45, 'Low Tom', 'TOM3', 56),
  d(46, 'Open Hat', 'OHH', 'Hat', [nl(119, { decay: 0.38, level: 0.5, hold: 0.02 })], 1),
  tom(47, 'Low-Mid Tom', 'TOM4', 59),
  tom(48, 'Hi-Mid Tom', 'TOM5', 62),
  d(49, 'Crash', 'CRASH', 'Cymbal', [ns(111, { decay: 1.1, level: 0.45 }), nl(117, { decay: 0.9, level: 0.35 })]),
  tom(50, 'High Tom', 'TOM6', 65),
  d(51, 'Ride', 'RIDE', 'Cymbal', [ns(121, { decay: 0.6, level: 0.3 }), pul(0.125, 96, { decay: 0.35, level: 0.14 })]),
  d(52, 'China', 'CHINA', 'Cymbal', [ns(104, { decay: 0.85, level: 0.45 }), nl(110, { decay: 0.3, level: 0.25 })]),
  d(53, 'Ride Bell', 'BELL', 'Cymbal', [pul(0.25, 93, { decay: 0.5, level: 0.3 }), pul(0.125, 100, { decay: 0.4, level: 0.18 }), ns(118, { decay: 0.15, level: 0.15 })]),
  d(54, 'Tambourine', 'TAMB', 'Perc', [ns(123, { decay: 0.14, level: 0.35 }), nl(121, { decay: 0.1, level: 0.35, delay: 0.03 })]),
  d(55, 'Splash', 'SPLSH', 'Cymbal', [ns(116, { decay: 0.45, level: 0.45 })]),
  d(56, 'Cowbell', 'COWBL', 'Perc', [pul(0.5, 73, { decay: 0.28, level: 0.35, hold: 0.02 }), pul(0.5, 79, { decay: 0.22, level: 0.28 })]),
  d(57, 'Crash 2', 'CRSH2', 'Cymbal', [ns(100, { decay: 1.3, level: 0.45 }), nl(113, { decay: 1.0, level: 0.3 })]),
  d(58, 'Vibra-slap', 'VIBRA', 'Perc', [pul(0.125, 84, { decay: 0.6, level: 0.3, arp: [0, 12], arpFrames: 2, arpLoop: true }), ns(110, { decay: 0.5, level: 0.15 })]),
  d(59, 'Ride 2', 'RIDE2', 'Cymbal', [ns(125, { decay: 0.5, level: 0.3 }), pul(0.125, 101, { decay: 0.25, level: 0.1 })]),
  d(60, 'Hi Bongo', 'BONG1', 'Perc', [tri(76, { sweep: -4, sweepTime: 0.05, curve: 1, decay: 0.12, level: 0.85 })]),
  d(61, 'Low Bongo', 'BONG2', 'Perc', [tri(71, { sweep: -4, sweepTime: 0.05, curve: 1, decay: 0.15, level: 0.85 })]),
  d(62, 'Mute Conga', 'CONG1', 'Perc', [tri(74, { sweep: -3, sweepTime: 0.03, curve: 1, decay: 0.06, level: 0.85 }), nl(90, { decay: 0.015, level: 0.2 })]),
  d(63, 'Open Conga', 'CONG2', 'Perc', [tri(72, { sweep: -2, sweepTime: 0.05, curve: 1, decay: 0.24, level: 0.85 })]),
  d(64, 'Low Conga', 'CONG3', 'Perc', [tri(67, { sweep: -2, sweepTime: 0.06, curve: 1, decay: 0.26, level: 0.85 })]),
  d(65, 'Shaker', 'SHAKE', 'Perc', [nl(124, { decay: 0.05, level: 0.3, hold: 0.02 })]),
  d(66, 'Claves', 'CLAVE', 'Perc', [pul(0.5, 88, { decay: 0.06, level: 0.35 })]),
  d(67, 'Hi Block', 'BLCK1', 'Perc', [pul(0.125, 84, { decay: 0.05, level: 0.4 }), tri(84, { decay: 0.05, level: 0.4 })]),
  d(68, 'Low Block', 'BLCK2', 'Perc', [pul(0.125, 79, { decay: 0.06, level: 0.4 }), tri(79, { decay: 0.06, level: 0.4 })]),
  d(69, 'Cabasa', 'CABSA', 'Perc', [nl(125, { decay: 0.07, level: 0.32 })]),
  d(70, 'Maracas', 'MARAC', 'Perc', [nl(127, { decay: 0.035, level: 0.3 })]),
  d(71, 'Triangle', 'TRNGL', 'Perc', [pul(0.5, 100, { decay: 0.8, level: 0.16 }), pul(0.125, 107, { decay: 0.6, level: 0.1 })])
]

/** Game SFX on C6 (72) and up. Shared by all kits. */
const SFX: DrumDef[] = [
  d(72, 'Coin', 'COIN', 'SFX', [pul(0.5, 83, { arp: [0, 5], arpFrames: 5, hold: 0.08, decay: 0.45, level: 0.45 })]),
  d(73, 'Jump', 'JUMP', 'SFX', [pul(0.25, 63, { sweep: 16, sweepTime: 0.2, decay: 0.24, hold: 0.03, level: 0.45 })]),
  d(74, 'Laser', 'LASER', 'SFX', [pul(0.125, 100, { sweep: -38, sweepTime: 0.16, curve: 1, decay: 0.2, level: 0.5 })]),
  d(75, 'Explosion', 'BOOM', 'SFX', [nl(84, { sweep: -34, sweepTime: 0.9, decay: 1.0, level: 0.9 }), { wave: W.N4, note: 64, decay: 0.45, level: 0.5 }]),
  d(76, 'Power Up', 'PWRUP', 'SFX', [pul(0.5, 60, { arp: [0, 4, 7, 12, 2, 6, 9, 14, 4, 8, 11, 16, 5, 9, 12, 17, 7, 11, 14, 19, 9, 13, 16, 21], arpFrames: 2, hold: 0.75, decay: 0.15, level: 0.4 })]),
  d(77, '1-Up', '1UP', 'SFX', [pul(0.5, 76, { arp: [0, 3, 12, 8, 10, 15], arpFrames: 7, hold: 0.62, decay: 0.2, level: 0.4 })]),
  d(78, 'Hit', 'HIT', 'SFX', [nl(92, { sweep: -20, sweepTime: 0.2, decay: 0.22, level: 0.6 }), pul(0.125, 70, { sweep: -24, sweepTime: 0.12, curve: 1, decay: 0.15, level: 0.35 })]),
  d(79, 'Blip', 'BLIP', 'SFX', [pul(0.5, 84, { hold: 0.035, decay: 0.03, level: 0.4 })]),
  d(80, 'Pause', 'PAUSE', 'SFX', [pul(0.5, 88, { arp: [0, -4, 0, -4], arpFrames: 5, hold: 0.3, decay: 0.08, level: 0.4 })]),
  d(81, 'Fireball', 'FIRE', 'SFX', [pul(0.125, 92, { sweep: -26, sweepTime: 0.07, curve: 1, decay: 0.09, level: 0.45 }), ns(100, { decay: 0.06, level: 0.3 })]),
  d(82, 'Bomb Drop', 'BOMB', 'SFX', [pul(0.5, 96, { sweep: -36, sweepTime: 1.0, hold: 0.95, decay: 0.1, level: 0.35 }), nl(80, { sweep: -24, sweepTime: 0.7, delay: 1.0, decay: 0.8, level: 0.85 })]),
  d(83, 'Pipe Warp', 'PIPE', 'SFX', [pul(0.5, 72, { arp: [0, -4, -8, -12], arpFrames: 3, arpLoop: true, sweep: -12, sweepTime: 0.8, hold: 0.6, decay: 0.2, level: 0.4 })]),
  d(84, 'Shoot', 'SHOOT', 'SFX', [pul(0.25, 88, { sweep: -22, sweepTime: 0.09, curve: 1, decay: 0.11, level: 0.45 })]),
  d(85, 'Zap', 'ZAP', 'SFX', [pul(0.125, 76, { arp: [0, 12], arpFrames: 1, arpLoop: true, sweep: -14, sweepTime: 0.3, decay: 0.32, level: 0.4 })]),
  d(86, 'Bounce', 'BOUNC', 'SFX', [tri(58, { sweep: 14, sweepTime: 0.09, decay: 0.16, level: 0.9 })]),
  d(87, 'Menu Select', 'SELCT', 'SFX', [pul(0.25, 79, { arp: [0, 12], arpFrames: 3, hold: 0.07, decay: 0.12, level: 0.4 })]),
  d(88, 'Alarm', 'ALARM', 'SFX', [pul(0.5, 81, { arp: [0, 0, 0, 0, -5, -5, -5, -5], arpFrames: 2, arpLoop: true, hold: 0.8, decay: 0.1, level: 0.35 })]),
  d(89, 'Game Over', 'G.OVR', 'SFX', [tri(64, { arp: [0, -1, -2, -3, -5, -8, -12], arpFrames: 9, hold: 1.0, decay: 0.3, level: 0.9 })])
]

const scaleLayer = (l: L, o: Partial<L>): L => ({ ...l, ...o })

/** Game Boy: kicks are pulse sweeps (channel 1 sweep unit), tones use the wave channel, shorter tails. */
function gbKit(): DrumDef[] {
  return NES.map((def) => {
    if (def.key === 35 || def.key === 36)
      return { ...def, layers: [pul(0.5, def.key === 35 ? 60 : 64, { sweep: -38, sweepTime: def.key === 35 ? 0.12 : 0.07, curve: 1, decay: def.key === 35 ? 0.3 : 0.2, level: 0.75 }), nl(76, { decay: 0.02, level: 0.45 })] }
    if (def.key === 38)
      return { ...def, layers: [ns(103, { decay: 0.14, level: 0.55 }), nl(100, { decay: 0.17, level: 0.55 }), pul(0.5, 64, { sweep: -14, sweepTime: 0.04, curve: 1, decay: 0.06, level: 0.4 })] }
    return {
      ...def,
      layers: def.layers.map((l) => (l.wave === W.TRI || l.wave === W.TRIS ? scaleLayer(l, { wave: W.GB, decay: l.decay * 0.85 }) : scaleLayer(l, { decay: l.decay * 0.8 })))
    }
  })
}

/** Arcade: crunchier 4-bit noise, an attack "click" on kicks, fatter and longer. */
function arcadeKit(): DrumDef[] {
  return NES.map((def) => {
    const layers = def.layers.map((l) => {
      if (l.wave === W.NL && def.group !== 'Hat') return scaleLayer(l, { wave: W.N4, note: l.note - 6, decay: l.decay * 1.2 })
      if (l.wave === W.TRI) return scaleLayer(l, { wave: W.TRIS, note: l.note - 2, decay: l.decay * 1.25 })
      return scaleLayer(l, { decay: l.decay * 1.15 })
    })
    if (def.group === 'Kick') layers.push(pul(0.25, 84, { sweep: -24, sweepTime: 0.02, curve: 1, decay: 0.025, level: 0.4 }))
    if (def.group === 'Snare') layers.push(pul(0.5, 70, { sweep: -18, sweepTime: 0.05, curve: 1, decay: 0.07, level: 0.3 }))
    return { ...def, layers }
  })
}

// SFX are mostly single pulse layers: give them a bit more level so they sit with the drums
const SFX_LOUD: DrumDef[] = SFX.map((x) => ({ ...x, layers: x.layers.map((l) => ({ ...l, level: Math.min(1, l.level * 1.5) })) }))
const build = (defs: DrumDef[]): Map<number, DrumDef> => new Map([...defs, ...SFX_LOUD].map((x) => [x.key, x]))

/** Kit index (`drum.kit` param) -> key -> drum. */
export const KIT_MAPS: Map<number, DrumDef>[] = [build(NES), build(gbKit()), build(arcadeKit())]

/** Flat key map (NES names; names are identical across kits). */
export const DRUM_KEYS: DrumDef[] = [...NES, ...SFX_LOUD]
export const drumForKey = (key: number, kit = 0): DrumDef | undefined => (KIT_MAPS[kit] ?? KIT_MAPS[0]).get(key)

/** Built-in GB wave used by Game Boy kit tone layers (bassy 4-bit triangle). */
export const DRUM_GB_WAVE = [8, 10, 12, 14, 15, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 7, 8, 8]
