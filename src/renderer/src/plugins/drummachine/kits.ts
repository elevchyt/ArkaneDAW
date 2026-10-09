// Drum Machine kits: one Recipe per pad role. Missing roles inherit from the `base` kit.
// Analog kits are synthesized live; sampled kits are rendered once through their converter.
import type { Role } from './keymap'
import { ROLES } from './keymap'
import type { Converter, NoiseC, OscC, Recipe } from './engine'

export interface KitDef {
  id: string
  base?: string
  mode: 'analog' | 'sampled'
  conv?: Converter
  sounds: Partial<Record<Role, Recipe>>
  names?: Partial<Record<Role, string>>
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const with_ = (r: Recipe, patch: Partial<Recipe>): Recipe => ({ ...r, ...patch })
const scaleF = (fr: number[], k: number): number[] => fr.map((f) => f * k)

/** circular membrane mode ratios */
const MEMB = [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501]

// 808 metal section: six square oscillators at the original (inharmonic) frequencies
const M808 = [205.3, 304.4, 369.6, 522.7, 540, 800]
const M909 = [263, 400, 421, 474, 587, 845]
const M606 = [245, 306, 365, 415, 437, 619]

// ─── analog voices ────────────────────────────────────────────────────────────

const hat808 = (d: number, lvl = 0.5): Recipe => ({ m: { fr: M808, bands: [{ f: 8000, q: 1.3, l: 1, d }], hp: 6500 }, lvl, pan: 0.15 })
const tom808 = (f: number, d: number, pan: number): Recipe => ({
  o: [{ f, l: 1, d, pa: 3.5, pd: 0.035, ph: 0.25 }],
  n: [{ m: 0, f: f * 7, l: 0.08, d: d * 0.35 }],
  lvl: 0.8,
  pan
})
const conga808 = (f: number, d: number, pan: number): Recipe => ({ o: [{ f, l: 1, d, pa: 3, pd: 0.005, ph: 0.25 }], lvl: 0.65, pan })
const clap = (f: number, q: number, gap: number, bursts: number, d: number, tail: number, tl: number): Recipe => ({
  n: [
    { m: 1, f, q, l: 1, d, bursts, gap },
    { m: 1, f: f * 0.95, q: q * 0.7, l: tl, d: tail, delay: gap * (bursts - 1), st: true }
  ],
  lvl: 0.65,
  pan: -0.1
})

const K808: KitDef = {
  id: '808',
  mode: 'analog',
  sounds: {
    kick: { o: [{ f: 50, l: 1, d: 1.1, pa: 7, pd: 0.012, ph: 0.25 }], n: [{ m: 0, f: 2500, l: 0.08, d: 0.012 }], drv: 0.2, lvl: 0.9 },
    kick2: { o: [{ f: 43, l: 1, d: 2.0, pa: 7, pd: 0.012, ph: 0.25 }], n: [{ m: 0, f: 2000, l: 0.06, d: 0.012 }], drv: 0.25, lvl: 0.9 },
    snare: {
      o: [
        { f: 180, l: 0.7, d: 0.18, pa: 2, pd: 0.01 },
        { f: 330, l: 0.45, d: 0.11, pa: 2, pd: 0.01 }
      ],
      n: [{ m: 2, f: 1800, l: 0.55, d: 0.22 }],
      lvl: 0.72
    },
    snare2: {
      o: [
        { f: 238, l: 0.6, d: 0.14, pa: 2, pd: 0.01 },
        { f: 476, l: 0.35, d: 0.09, pa: 2, pd: 0.01 }
      ],
      n: [{ m: 2, f: 2200, l: 0.85, d: 0.2 }],
      lvl: 0.7
    },
    clap: clap(1100, 1.3, 0.0105, 4, 0.07, 0.4, 0.45),
    rim: { o: [{ f: 1667, l: 0.7, d: 0.025 }, { f: 455, l: 1, d: 0.035 }], n: [{ m: 2, f: 5000, l: 0.2, d: 0.008 }], drv: 3, hp: 300, lvl: 0.55, pan: -0.15 },
    claves: { o: [{ f: 2500, l: 1, d: 0.07 }], lvl: 0.55, pan: -0.3 },
    cowbell: { m: { fr: [540, 800], bands: [{ f: 1050, q: 1.3, l: 1, d: 0.07, d2: 0.45, x2: 0.3 }], hp: 350 }, lvl: 0.5, pan: 0.2 },
    maracas: { n: [{ m: 2, f: 7000, l: 1, d: 0.07, a: 0.006 }], lvl: 0.42, pan: 0.3 },
    tamb: {
      n: [{ m: 2, f: 8000, l: 0.7, d: 0.2, a: 0.002 }],
      m: { fr: scaleF(M808, 3.1), bands: [{ f: 9000, q: 3, l: 1, d: 0.22 }], hp: 6000 },
      lvl: 0.45,
      pan: 0.25
    },
    congaMute: conga808(370, 0.07, -0.3),
    congaHi: conga808(370, 0.2, -0.3),
    congaLo: conga808(250, 0.28, -0.15),
    tomFloor: tom808(74, 0.7, 0.4),
    tomLo: tom808(88, 0.6, 0.25),
    tomMid: tom808(118, 0.5, 0.05),
    tomMid2: tom808(134, 0.45, -0.05),
    tomHi: tom808(160, 0.4, -0.25),
    tomHi2: tom808(185, 0.38, -0.35),
    chh: hat808(0.055),
    phh: hat808(0.11, 0.42),
    ohh: hat808(0.5),
    crash: {
      m: { fr: M808, bands: [{ f: 3440, q: 2.2, l: 0.55, d: 0.5, d2: 1.8, x2: 0.35 }, { f: 7100, q: 1.6, l: 1, d: 1.4 }], hp: 2800 },
      lvl: 0.42,
      pan: -0.25
    },
    crash2: {
      m: { fr: scaleF(M808, 1.12), bands: [{ f: 3900, q: 2.2, l: 0.5, d: 0.4, d2: 1.4, x2: 0.35 }, { f: 7800, q: 1.6, l: 1, d: 1.1 }], hp: 3200 },
      lvl: 0.42,
      pan: 0.3
    },
    ride: { m: { fr: scaleF(M808, 1.5), bands: [{ f: 5200, q: 3, l: 1, d: 1.6 }, { f: 2700, q: 5, l: 0.35, d: 1.2 }], hp: 2500 }, lvl: 0.38, pan: 0.3 },
    ride2: { m: { fr: scaleF(M808, 1.35), bands: [{ f: 4700, q: 3, l: 1, d: 1.4 }, { f: 2400, q: 5, l: 0.3, d: 1 }], hp: 2200 }, lvl: 0.38, pan: 0.35 },
    rideBell: { m: { fr: scaleF(M808, 2), bands: [{ f: 2600, q: 6, l: 1, d: 0.9 }], hp: 900 }, lvl: 0.4, pan: 0.3 },
    woodHi: { o: [{ f: 1100, l: 1, d: 0.07, ph: 0.25 }, { f: 2970, l: 0.3, d: 0.03 }], lvl: 0.5, pan: -0.2 },
    woodLo: { o: [{ f: 800, l: 1, d: 0.08, ph: 0.25 }, { f: 2160, l: 0.3, d: 0.035 }], lvl: 0.5, pan: -0.1 }
  },
  names: { rim: 'Rim Shot', crash: 'Cymbal', snare2: 'Snare Hi' }
}

const hat909 = (d: number, lvl = 0.45, bits = 6): Recipe => ({
  m: { fr: M909, bands: [{ f: 9000, q: 0.9, l: 1, d }], hp: 7500 },
  n: [{ m: 2, f: 9500, l: 0.35, d: d * 0.8 }],
  bits,
  lvl,
  pan: 0.15
})
const tom909 = (f: number, d: number, pan: number): Recipe => ({
  o: [{ f, l: 1, d, pa: 8, pd: 0.045 }],
  n: [{ m: 0, f: 1000, l: 0.12, d: 0.07 }],
  lvl: 0.8,
  pan
})

const K909: KitDef = {
  id: '909',
  base: '808',
  mode: 'analog',
  sounds: {
    kick: { o: [{ f: 51, l: 1, d: 0.6, pa: 22, pd: 0.022 }], n: [{ m: 0, f: 4000, l: 0.45, d: 0.012 }], drv: 0.8, lvl: 0.95 },
    kick2: { o: [{ f: 46, l: 1, d: 1.0, pa: 24, pd: 0.025 }], n: [{ m: 0, f: 3500, l: 0.35, d: 0.012 }], drv: 0.8, lvl: 0.95 },
    snare: {
      o: [
        { f: 185, w: 1, l: 0.8, d: 0.16, pa: 5, pd: 0.006 },
        { f: 331, w: 1, l: 0.45, d: 0.11, pa: 5, pd: 0.006 }
      ],
      n: [{ m: 0, f: 8000, hp: 600, l: 0.75, d: 0.26 }],
      drv: 0.3,
      lvl: 0.75
    },
    snare2: {
      o: [
        { f: 215, w: 1, l: 0.7, d: 0.12, pa: 5, pd: 0.006 },
        { f: 380, w: 1, l: 0.4, d: 0.09, pa: 5, pd: 0.006 }
      ],
      n: [{ m: 0, f: 9000, hp: 900, l: 1, d: 0.2 }],
      drv: 0.3,
      lvl: 0.72
    },
    clap: clap(1250, 1.1, 0.0095, 4, 0.08, 0.32, 0.4),
    rim: { o: [{ f: 1850, l: 0.6, d: 0.02 }, { f: 520, l: 1, d: 0.03 }, { f: 880, l: 0.5, d: 0.025 }], n: [{ m: 2, f: 6000, l: 0.25, d: 0.006 }], drv: 2.5, hp: 350, lvl: 0.55, pan: -0.15 },
    tomFloor: tom909(80, 0.55, 0.4),
    tomLo: tom909(96, 0.5, 0.25),
    tomMid: tom909(128, 0.45, 0.05),
    tomMid2: tom909(145, 0.42, -0.05),
    tomHi: tom909(170, 0.4, -0.25),
    tomHi2: tom909(200, 0.38, -0.35),
    chh: hat909(0.065),
    phh: hat909(0.12, 0.4),
    ohh: hat909(0.5),
    crash: {
      m: { fr: scaleF(M909, 1.27), bands: [{ f: 4800, q: 0.8, l: 0.8, d: 1.7 }, { f: 9000, q: 0.9, l: 0.6, d: 1.1 }], hp: 3500 },
      n: [{ m: 2, f: 6000, l: 0.6, d: 1.4, st: true, a: 0.002 }],
      bits: 6,
      lvl: 0.42,
      pan: -0.25
    },
    crash2: {
      m: { fr: scaleF(M909, 1.4), bands: [{ f: 5600, q: 0.8, l: 0.8, d: 1.3 }, { f: 9500, q: 0.9, l: 0.6, d: 0.9 }], hp: 4000 },
      n: [{ m: 2, f: 6500, l: 0.6, d: 1.1, st: true, a: 0.002 }],
      bits: 6,
      lvl: 0.42,
      pan: 0.3
    },
    ride: {
      m: { fr: [410, 571, 843, 1081, 1260, 1592], bands: [{ f: 6200, q: 2.5, l: 1, d: 1.9 }, { f: 3200, q: 4, l: 0.4, d: 1.2 }], hp: 3000 },
      n: [{ m: 2, f: 7500, l: 0.25, d: 1 }],
      bits: 6,
      lvl: 0.38,
      pan: 0.3
    },
    ride2: {
      m: { fr: [380, 530, 790, 1010, 1190, 1490], bands: [{ f: 5600, q: 2.5, l: 1, d: 1.7 }, { f: 2900, q: 4, l: 0.4, d: 1.1 }], hp: 2700 },
      n: [{ m: 2, f: 7000, l: 0.25, d: 0.9 }],
      bits: 6,
      lvl: 0.38,
      pan: 0.35
    },
    rideBell: { m: { fr: [410, 571, 843, 1081, 1260, 1592], bands: [{ f: 2400, q: 8, l: 1, d: 1.0 }], hp: 800 }, bits: 6, lvl: 0.4, pan: 0.3 }
  },
  names: { crash: 'Crash', snare2: 'Snare Tight' }
}

const hat606 = (d: number, lvl = 0.45): Recipe => ({ m: { fr: M606, bands: [{ f: 9500, q: 0.8, l: 1, d }], hp: 8000 }, lvl, pan: 0.15 })
const tom606 = (f: number, d: number, pan: number): Recipe => ({ o: [{ f, l: 1, d, pa: 4, pd: 0.03, ph: 0.25 }], n: [{ m: 0, f: f * 8, l: 0.1, d: d * 0.3 }], lvl: 0.8, pan })

const K606: KitDef = {
  id: '606',
  base: '808',
  mode: 'analog',
  sounds: {
    kick: { o: [{ f: 60, l: 1, d: 0.32, pa: 9, pd: 0.008, ph: 0.25 }], n: [{ m: 0, f: 3500, l: 0.12, d: 0.008 }], drv: 0.2, lvl: 0.9 },
    kick2: { o: [{ f: 54, l: 1, d: 0.45, pa: 9, pd: 0.008, ph: 0.25 }], n: [{ m: 0, f: 3500, l: 0.1, d: 0.008 }], drv: 0.2, lvl: 0.9 },
    snare: { o: [{ f: 255, l: 0.55, d: 0.09, pa: 3, pd: 0.008 }], n: [{ m: 2, f: 2200, l: 1, d: 0.17 }], lvl: 0.7 },
    snare2: { o: [{ f: 290, l: 0.5, d: 0.07, pa: 3, pd: 0.008 }], n: [{ m: 2, f: 2600, l: 1, d: 0.13 }], lvl: 0.68 },
    chh: hat606(0.045),
    phh: hat606(0.09, 0.4),
    ohh: hat606(0.32),
    crash: { m: { fr: M606, bands: [{ f: 4500, q: 1.5, l: 0.7, d: 1.1 }, { f: 8500, q: 1.2, l: 1, d: 0.9 }], hp: 3500 }, lvl: 0.42, pan: -0.25 },
    tomFloor: tom606(88, 0.38, 0.4),
    tomLo: tom606(105, 0.35, 0.25),
    tomMid: tom606(130, 0.33, 0.05),
    tomMid2: tom606(145, 0.32, -0.05),
    tomHi: tom606(160, 0.3, -0.25),
    tomHi2: tom606(180, 0.28, -0.35)
  },
  names: { crash: 'Cymbal' }
}

const KCR78: KitDef = {
  id: 'CR-78',
  base: '808',
  mode: 'analog',
  sounds: {
    kick: { o: [{ f: 66, l: 1, d: 0.3 }], lp: 1500, lvl: 0.9 },
    kick2: { o: [{ f: 58, l: 1, d: 0.42 }], lp: 1200, lvl: 0.9 },
    snare: { o: [{ f: 300, l: 0.4, d: 0.07 }], n: [{ m: 1, f: 3200, q: 0.6, l: 1, d: 0.14 }], lvl: 0.65 },
    snare2: { o: [{ f: 340, l: 0.35, d: 0.06 }], n: [{ m: 1, f: 4000, q: 0.6, l: 1, d: 0.1 }], lvl: 0.62 },
    rim: { o: [{ f: 2150, l: 1, d: 0.035 }, { f: 1100, l: 0.5, d: 0.025 }], drv: 1, lvl: 0.55, pan: -0.15 },
    chh: { n: [{ m: 2, f: 9000, l: 1, d: 0.045 }], m: { fr: scaleF(M808, 1.1), bands: [{ f: 10000, q: 2, l: 0.3, d: 0.04 }], hp: 8000 }, lvl: 0.45, pan: 0.15 },
    phh: { n: [{ m: 2, f: 8500, l: 1, d: 0.09 }], m: { fr: scaleF(M808, 1.1), bands: [{ f: 10000, q: 2, l: 0.3, d: 0.08 }], hp: 7500 }, lvl: 0.42, pan: 0.15 },
    ohh: { n: [{ m: 2, f: 8000, l: 1, d: 0.35 }], m: { fr: scaleF(M808, 1.1), bands: [{ f: 10000, q: 2, l: 0.3, d: 0.3 }], hp: 7000 }, lvl: 0.42, pan: 0.15 },
    crash: { n: [{ m: 1, f: 6500, q: 0.5, l: 1, d: 1.2, a: 0.003 }], m: { fr: scaleF(M808, 1.1), bands: [{ f: 5500, q: 2, l: 0.4, d: 1.0 }], hp: 3000 }, lvl: 0.42, pan: -0.25 },
    tamb: { n: [{ m: 2, f: 8500, l: 1, d: 0.07, bursts: 3, gap: 0.022 }, { m: 1, f: 10500, q: 3, l: 0.5, d: 0.12, delay: 0.044 }], lvl: 0.48, pan: 0.25 },
    maracas: { n: [{ m: 2, f: 9000, l: 1, d: 0.04, a: 0.003 }], lvl: 0.4, pan: 0.3 },
    claves: { o: [{ f: 2300, l: 1, d: 0.05 }], lvl: 0.5, pan: -0.3 },
    cowbell: { m: { fr: [800, 1150], bands: [{ f: 1600, q: 2, l: 1, d: 0.18 }], hp: 500 }, lvl: 0.48, pan: 0.2 },
    congaMute: { o: [{ f: 430, l: 1, d: 0.06 }], lvl: 0.6, pan: -0.3 },
    congaHi: { o: [{ f: 430, l: 1, d: 0.13, pa: 1, pd: 0.004 }], lvl: 0.6, pan: -0.3 },
    congaLo: { o: [{ f: 300, l: 1, d: 0.18, pa: 1, pd: 0.004 }], lvl: 0.6, pan: -0.1 },
    rideBell: { m: { fr: scaleF(M808, 3), bands: [{ f: 4000, q: 3, l: 1, d: 0.22 }], hp: 1500 }, lvl: 0.45, pan: 0.2 },
    woodHi: { n: [{ m: 1, f: 3000, q: 4, l: 1, d: 0.03, bursts: 6, gap: 0.018 }], lvl: 0.45, pan: -0.2 }
  },
  names: { crash: 'Cymbal', rideBell: 'Metal Beat', congaMute: 'Bongo Mute', congaHi: 'Bongo', congaLo: 'Conga', woodHi: 'Guiro' }
}

const simTom = (f: number, pan: number): Recipe => ({ o: [{ f, l: 1, d: 0.95, pa: 13, pd: 0.13 }], n: [{ m: 1, f: f * 7, q: 0.7, l: 0.3, d: 0.07 }], lvl: 0.8, pan })

const KSIM: KitDef = {
  id: 'Simmons',
  base: '909',
  mode: 'analog',
  sounds: {
    kick: { o: [{ f: 58, l: 1, d: 0.5, pa: 14, pd: 0.03 }], n: [{ m: 1, f: 1400, q: 0.8, l: 0.45, d: 0.025 }], drv: 0.4, lvl: 0.9 },
    kick2: { o: [{ f: 48, l: 1, d: 0.8, pa: 16, pd: 0.05 }], n: [{ m: 1, f: 1200, q: 0.8, l: 0.4, d: 0.03 }], drv: 0.4, lvl: 0.9 },
    snare: { o: [{ f: 195, l: 0.7, d: 0.28, pa: 10, pd: 0.05 }], n: [{ m: 1, f: 2800, q: 0.5, l: 0.9, d: 0.32, fs: 1.2, fd: 0.06 }], drv: 0.3, lvl: 0.75 },
    snare2: { o: [{ f: 240, l: 0.6, d: 0.18, pa: 12, pd: 0.03 }], n: [{ m: 2, f: 2400, l: 1, d: 0.22 }], lvl: 0.7 },
    rim: { o: [{ f: 900, l: 1, d: 0.08, pa: 12, pd: 0.01 }], n: [{ m: 1, f: 3500, q: 1, l: 0.4, d: 0.02 }], lvl: 0.55, pan: -0.15 },
    tomFloor: simTom(70, 0.4),
    tomLo: simTom(90, 0.25),
    tomMid: simTom(120, 0.05),
    tomMid2: simTom(140, -0.05),
    tomHi: simTom(165, -0.25),
    tomHi2: simTom(200, -0.35),
    congaMute: { o: [{ f: 330, l: 1, d: 0.12, pa: 12, pd: 0.03 }], lvl: 0.65, pan: -0.3 },
    congaHi: { o: [{ f: 330, l: 1, d: 0.35, pa: 12, pd: 0.06 }], lvl: 0.65, pan: -0.3 },
    congaLo: { o: [{ f: 240, l: 1, d: 0.45, pa: 12, pd: 0.07 }], lvl: 0.65, pan: -0.1 }
  },
  names: { tomFloor: 'Tom 5', tomLo: 'Tom 4', tomMid: 'Tom 3', tomMid2: 'Tom 3b', tomHi: 'Tom 2', tomHi2: 'Tom 1', congaMute: 'Syn Blip', congaHi: 'Syn Pew', congaLo: 'Syn Pew Lo' }
}

const KTRAP: KitDef = {
  id: 'Trap',
  base: '808',
  mode: 'analog',
  sounds: {
    kick: { o: [{ f: 49, l: 1, d: 2.6, pa: 12, pd: 0.018, ph: 0.25 }], drv: 1.4, lvl: 0.95 },
    kick2: { o: [{ f: 56, l: 1, d: 0.35, pa: 30, pd: 0.016 }], n: [{ m: 1, f: 3500, q: 0.7, l: 0.5, d: 0.01 }], drv: 0.8, lvl: 0.95 },
    snare: { o: [{ f: 205, l: 0.55, d: 0.12, pa: 5, pd: 0.008 }], n: [{ m: 2, f: 2000, l: 1, d: 0.22 }], drv: 0.5, lvl: 0.75 },
    clap: with_(clap(1400, 1, 0.008, 3, 0.1, 0.35, 0.45), { lvl: 0.7 }),
    rim: { n: [{ m: 1, f: 2600, q: 2.5, l: 1, d: 0.06, a: 0.0005 }], o: [{ f: 1800, l: 0.4, d: 0.02 }], drv: 0.5, lvl: 0.6, pan: -0.15 },
    chh: { m: { fr: scaleF(M808, 1.35), bands: [{ f: 11000, q: 0.7, l: 1, d: 0.045 }], hp: 9000 }, n: [{ m: 2, f: 10000, l: 0.5, d: 0.04 }], lvl: 0.45, pan: 0.15 },
    phh: { m: { fr: scaleF(M808, 1.35), bands: [{ f: 11000, q: 0.7, l: 1, d: 0.08 }], hp: 9000 }, n: [{ m: 2, f: 10000, l: 0.5, d: 0.07 }], lvl: 0.42, pan: 0.15 },
    ohh: { m: { fr: scaleF(M808, 1.35), bands: [{ f: 11000, q: 0.7, l: 1, d: 0.4 }], hp: 9000 }, n: [{ m: 2, f: 10000, l: 0.5, d: 0.35 }], lvl: 0.42, pan: 0.15 },
    crash: with_(K909.sounds.crash!, { bits: undefined })
  },
  names: { kick: '808 Bass', kick2: 'Punch Kick', rim: 'Snap' }
}

const KTECHNO: KitDef = {
  id: 'Techno',
  base: '909',
  mode: 'analog',
  sounds: {
    kick: { o: [{ f: 50, l: 1, d: 0.65, pa: 26, pd: 0.02 }], n: [{ m: 1, f: 3000, q: 0.8, l: 0.6, d: 0.008 }], drv: 2.5, lvl: 0.95 },
    kick2: { o: [{ f: 44, l: 1, d: 1.3, pa: 20, pd: 0.02 }], n: [{ m: 0, f: 160, q: 1.5, l: 0.5, d: 1.0, delay: 0.05, st: true }], drv: 3, lvl: 0.9 },
    snare: with_(K909.sounds.snare!, { drv: 1 }),
    rim: { o: [{ f: 900, l: 1, d: 0.07, pa: 24, pd: 0.008 }], lvl: 0.55, pan: -0.15 },
    chh: with_(hat909(0.04, 0.45, 5), { m: { fr: M909, bands: [{ f: 9500, q: 0.9, l: 1, d: 0.04 }], hp: 9500 } }),
    phh: hat909(0.09, 0.4, 5),
    ohh: hat909(0.4, 0.45, 5)
  },
  names: { kick2: 'Rumble', rim: 'Zap' }
}

// ─── acoustic-ish voices for the sample-era kits ──────────────────────────────

interface KickO { f: number; d: number; beater: number; boom: number; pa?: number; click?: number }
const acKick = ({ f, d, beater, boom, pa = 4, click = 3000 }: KickO): Recipe => ({
  o: [
    { f, l: 1, d, pa, pd: 0.02 },
    { f: f * 1.594, l: 0.22, d: d * 0.35, pa: pa * 0.7, pd: 0.02 },
    { f: f * 2.136, l: 0.12, d: d * 0.25 },
    { f: f * 2.296, l: 0.1, d: d * 0.2 },
    { f: f * 2.653, l: 0.06, d: d * 0.15 }
  ],
  n: [
    { m: 1, f: click, q: 0.8, l: beater, d: 0.02 },
    { m: 0, f: 180, l: boom, d: d * 0.8 }
  ],
  drv: 0.3,
  lvl: 0.9
})

interface SnareO { f: number; wires: number; ring: number; d: number; crack: number; wf?: number }
const acSnare = ({ f, wires, ring, d, crack, wf = 5000 }: SnareO): Recipe => {
  const lv = [1, 0.7, 0.5, 0.45, 0.35, 0.3, 0.25]
  return {
    o: lv.map((l, i) => ({ f: f * MEMB[i], l, d: ring * (i ? 0.6 : 1), pa: 1.5, pd: 0.01 })),
    n: [
      { m: 1, f: wf, q: 0.6, hp: 1500, l: wires, d, a: 0.002 },
      { m: 2, f: 2500, l: crack, d: 0.012 }
    ],
    drv: 0.4,
    lvl: 0.75
  }
}

const acTom = (f: number, d: number, pan: number): Recipe => ({
  o: [
    { f, l: 1, d, pa: 2.5, pd: 0.04 },
    { f: f * 1.594, l: 0.35, d: d * 0.45, pa: 2.5, pd: 0.04 },
    { f: f * 2.136, l: 0.2, d: d * 0.3 },
    { f: f * 2.296, l: 0.15, d: d * 0.3 }
  ],
  n: [
    { m: 1, f: 2500, q: 0.8, l: 0.25, d: 0.015 },
    { m: 0, f: f * 3, l: 0.15, d: d * 0.3 }
  ],
  lvl: 0.8,
  pan
})

function partials(seed: number, n: number, lo: number, hi: number, d: number, dSpread: number, lvlTilt: number): OscC[] {
  const r = rng(seed)
  const out: OscC[] = []
  for (let i = 0; i < n; i++) {
    const f = lo * Math.pow(hi / lo, r())
    out.push({ f, l: (0.3 + 0.7 * r()) / (1 + (f / 4000) * lvlTilt), d: d * (1 - dSpread + 2 * dSpread * r()) })
  }
  return out
}

const acHat = ({ d, seed, bright = 1, chick = 0 }: { d: number; seed: number; bright?: number; chick?: number }): Recipe => {
  const n: NoiseC[] = [
    { m: 2, f: 7000 * bright, l: 1.2, d, a: 0.0005 },
    { m: 1, f: 10000 * bright, q: 0.7, l: 0.6, d: d * 0.7 }
  ]
  if (chick) n.push({ m: 1, f: 600, q: 1, l: chick, d: 0.03 })
  return { o: partials(seed, 28, 3000 * bright, 15000, d, 0.4, 0.3), n, lvl: 0.45, pan: 0.15 }
}

const acCymbal = ({ d, seed, bright = 1, f0 = 350 }: { d: number; seed: number; bright?: number; f0?: number }): Recipe => ({
  o: partials(seed, 56, f0, 15000, d, 0.45, 0.5),
  n: [
    { m: 2, f: 4000 * bright, l: 1, d: d * 0.8, a: 0.003 },
    { m: 1, f: 9000 * bright, q: 0.5, l: 0.5, d: d * 0.5 }
  ],
  lvl: 0.42,
  pan: -0.25
})

const acRide = ({ d, seed, f0 = 420 }: { d: number; seed: number; f0?: number }): Recipe => ({
  o: [...partials(seed, 40, f0, 12000, d, 0.4, 0.8), { f: f0 * 1.31, l: 0.8, d: d * 0.7 }, { f: f0 * 2.7, l: 0.6, d: d * 0.6 }],
  n: [
    { m: 1, f: 5000, q: 1, l: 0.7, d: 0.02 },
    { m: 2, f: 6000, l: 0.25, d: d * 0.5 }
  ],
  lvl: 0.38,
  pan: 0.3
})

const acBell = (f0 = 620): Recipe => ({
  o: [1, 2.12, 2.9, 3.7, 4.95, 6.1].map((r, i) => ({ f: f0 * r, l: [1, 0.7, 0.6, 0.4, 0.3, 0.2][i], d: 1.2 - i * 0.14 })),
  n: [{ m: 1, f: 5000, q: 1, l: 0.5, d: 0.015 }],
  lvl: 0.4,
  pan: 0.3
})

const acClap = ({ f = 1200, bursts = 4, gap = 0.011, tail = 0.25 }: { f?: number; bursts?: number; gap?: number; tail?: number }): Recipe => ({
  n: [
    { m: 1, f, q: 1.1, l: 1, d: 0.09, bursts, gap },
    { m: 1, f: f * 0.9, q: 0.7, l: 0.35, d: tail, delay: bursts * gap * 0.8 }
  ],
  lvl: 0.68,
  pan: -0.1
})

const acTamb = (seed = 5): Recipe => ({
  o: partials(seed, 12, 5000, 9500, 0.25, 0.3, 0),
  n: [
    { m: 2, f: 7000, l: 1, d: 0.22, a: 0.002 },
    { m: 1, f: 9500, q: 2, l: 0.6, d: 0.15 }
  ],
  lvl: 0.45,
  pan: 0.25
})

const acShaker = (d = 0.09): Recipe => ({ n: [{ m: 2, f: 5500, l: 1, d, a: 0.012 }], lvl: 0.42, pan: 0.3 })

const acCowbell = (f = 587): Recipe => ({
  o: [
    { f, l: 1, d: 0.35 },
    { f: f * 1.44, l: 0.8, d: 0.3 },
    { f: f * 2.3, l: 0.3, d: 0.15 },
    { f: f * 2.98, l: 0.2, d: 0.1 }
  ],
  n: [{ m: 1, f: 3000, q: 1, l: 0.2, d: 0.01 }],
  lvl: 0.48,
  pan: 0.2
})

const acConga = (f: number, d: number, slap: number, pan: number): Recipe => ({
  o: [
    { f, l: 1, d, pa: 1.5, pd: 0.01 },
    { f: f * 1.5, l: 0.3, d: d * 0.5 },
    { f: f * 2.1, l: 0.15, d: d * 0.3 }
  ],
  n: [{ m: 1, f: 1800, q: 0.8, l: slap, d: 0.02 }],
  lvl: 0.65,
  pan
})

const acClave = (f = 2450): Recipe => ({ o: [{ f, l: 1, d: 0.12 }, { f: f * 2.76, l: 0.15, d: 0.05 }], lvl: 0.52, pan: -0.3 })

const acWood = (f: number, pan: number): Recipe => ({
  o: [
    { f, l: 1, d: 0.07 },
    { f: f * 2.71, l: 0.4, d: 0.04 },
    { f: f * 5.2, l: 0.2, d: 0.02 }
  ],
  n: [{ m: 1, f: 3500, q: 1, l: 0.3, d: 0.006 }],
  lvl: 0.5,
  pan
})

const acSideStick = (f = 420): Recipe => ({
  o: [
    { f, l: 0.8, d: 0.05 },
    { f: f * 4.1, l: 0.6, d: 0.03 },
    { f: f * 7.9, l: 0.3, d: 0.02 }
  ],
  n: [{ m: 1, f: 3000, q: 1, l: 0.6, d: 0.015 }],
  lvl: 0.55,
  pan: -0.15
})

const acAgogo = (f: number, pan: number): Recipe => ({
  o: [
    { f, l: 1, d: 0.45 },
    { f: f * 2.04, l: 0.4, d: 0.3 },
    { f: f * 3.3, l: 0.2, d: 0.15 }
  ],
  n: [{ m: 1, f: 4000, q: 1, l: 0.2, d: 0.006 }],
  lvl: 0.45,
  pan
})

const toms = (fs: number[], ds: number[]): Partial<Record<Role, Recipe>> => {
  const roles: Role[] = ['tomFloor', 'tomLo', 'tomMid', 'tomMid2', 'tomHi', 'tomHi2']
  const pans = [0.4, 0.25, 0.05, -0.05, -0.25, -0.35]
  return Object.fromEntries(roles.map((r, i) => [r, acTom(fs[i], ds[i], pans[i])]))
}

const KSTUDIO: KitDef = {
  id: 'Studio',
  mode: 'sampled',
  conv: { rate: 44100, bits: 0, lp: 20000 },
  sounds: {
    kick: acKick({ f: 57, d: 0.45, beater: 0.5, boom: 0.3 }),
    kick2: acKick({ f: 50, d: 0.7, beater: 0.35, boom: 0.5 }),
    snare: acSnare({ f: 190, wires: 0.8, ring: 0.25, d: 0.3, crack: 0.4 }),
    snare2: acSnare({ f: 215, wires: 0.6, ring: 0.2, d: 0.22, crack: 1 }),
    rim: acSideStick(),
    clap: acClap({}),
    ...toms([82, 98, 118, 132, 155, 180], [0.9, 0.8, 0.7, 0.65, 0.6, 0.55]),
    chh: acHat({ d: 0.08, seed: 1 }),
    phh: acHat({ d: 0.12, seed: 1, chick: 0.6 }),
    ohh: acHat({ d: 0.9, seed: 1 }),
    crash: acCymbal({ d: 2.2, seed: 3 }),
    crash2: with_(acCymbal({ d: 1.7, seed: 7, bright: 1.15 }), { pan: 0.3 }),
    ride: acRide({ d: 2.6, seed: 11 }),
    ride2: acRide({ d: 2.2, seed: 13, f0: 480 }),
    rideBell: acBell(),
    tamb: acTamb(),
    cowbell: acCowbell(),
    congaMute: acConga(330, 0.06, 0.6, -0.3),
    congaHi: acConga(330, 0.28, 0.4, -0.3),
    congaLo: acConga(235, 0.35, 0.35, -0.1),
    maracas: acShaker(),
    claves: acClave(),
    woodHi: acWood(1150, -0.2),
    woodLo: acWood(820, -0.1)
  },
  names: { rim: 'Side Stick', snare2: 'Snare Rimshot', maracas: 'Shaker' }
}

const KLINN: KitDef = {
  id: 'Linn',
  base: 'Studio',
  mode: 'sampled',
  conv: { rate: 28000, bits: 8, mu: true, lp: 12000 },
  sounds: {
    kick: acKick({ f: 63, d: 0.32, beater: 0.6, boom: 0.15 }),
    kick2: acKick({ f: 56, d: 0.45, beater: 0.45, boom: 0.25 }),
    snare: acSnare({ f: 215, wires: 0.9, ring: 0.2, d: 0.22, crack: 0.6, wf: 6000 }),
    snare2: acSnare({ f: 235, wires: 0.7, ring: 0.18, d: 0.18, crack: 1, wf: 6500 }),
    clap: acClap({ f: 1350, bursts: 4, gap: 0.012, tail: 0.3 }),
    ...toms([92, 110, 132, 148, 172, 200], [0.6, 0.55, 0.5, 0.48, 0.45, 0.42]),
    chh: acHat({ d: 0.07, seed: 21, bright: 1.1 }),
    phh: acHat({ d: 0.11, seed: 21, bright: 1.1, chick: 0.5 }),
    ohh: acHat({ d: 0.7, seed: 21, bright: 1.1 }),
    crash: acCymbal({ d: 1.9, seed: 23 }),
    ride: acRide({ d: 2.4, seed: 25 }),
    tamb: acTamb(27),
    maracas: acShaker(0.07),
    cowbell: acCowbell(560),
    congaHi: acConga(350, 0.25, 0.45, -0.3),
    congaLo: acConga(250, 0.3, 0.4, -0.1)
  },
  names: { rim: 'Sidestick', maracas: 'Cabasa' }
}

const KLM1: KitDef = {
  id: 'LM-1',
  base: 'Linn',
  mode: 'sampled',
  conv: { rate: 28000, bits: 8, mu: true, lp: 10000 },
  sounds: {
    kick: acKick({ f: 52, d: 0.55, beater: 0.3, boom: 0.4 }),
    snare: acSnare({ f: 180, wires: 0.7, ring: 0.3, d: 0.26, crack: 0.3 }),
    clap: acClap({ f: 1150, bursts: 5, gap: 0.009, tail: 0.22 }),
    ...toms([78, 92, 112, 125, 145, 168], [0.75, 0.7, 0.62, 0.6, 0.55, 0.5]),
    chh: acHat({ d: 0.09, seed: 31, bright: 0.9 }),
    phh: acHat({ d: 0.13, seed: 31, bright: 0.9, chick: 0.5 }),
    ohh: acHat({ d: 0.55, seed: 31, bright: 0.9 }),
    rim: acSideStick(460),
    tamb: acTamb(33),
    cowbell: acCowbell(610)
  },
  names: { maracas: 'Cabasa' }
}

const KDMX: KitDef = {
  id: 'DMX',
  base: 'Linn',
  mode: 'sampled',
  conv: { rate: 25000, bits: 8, mu: true, lp: 10500 },
  sounds: {
    kick: acKick({ f: 60, d: 0.42, beater: 0.8, boom: 0.25, pa: 6 }),
    kick2: acKick({ f: 54, d: 0.5, beater: 0.6, boom: 0.35, pa: 6 }),
    snare: acSnare({ f: 200, wires: 1, ring: 0.28, d: 0.3, crack: 0.8 }),
    snare2: acSnare({ f: 222, wires: 0.8, ring: 0.22, d: 0.24, crack: 1.1 }),
    ...toms([85, 100, 122, 136, 160, 185], [0.75, 0.7, 0.62, 0.6, 0.55, 0.5]),
    chh: acHat({ d: 0.07, seed: 41, bright: 0.85 }),
    phh: acHat({ d: 0.1, seed: 41, bright: 0.85, chick: 0.5 }),
    ohh: acHat({ d: 0.6, seed: 41, bright: 0.85 }),
    crash: acCymbal({ d: 2.0, seed: 43, bright: 0.9 }),
    ride: acRide({ d: 2.3, seed: 45 }),
    maracas: acShaker(0.08),
    tamb: acTamb(47)
  },
  names: { rim: 'Rimshot', maracas: 'Shaker' }
}

const KDRUMU: KitDef = {
  id: 'Drumulator',
  base: 'DMX',
  mode: 'sampled',
  conv: { rate: 26500, bits: 8, mu: true, lp: 9500, sat: 0.2 },
  sounds: {
    kick: acKick({ f: 66, d: 0.3, beater: 0.7, boom: 0.15 }),
    snare: acSnare({ f: 205, wires: 0.85, ring: 0.18, d: 0.2, crack: 0.6 }),
    clap: acClap({ f: 1200, bursts: 3, gap: 0.011, tail: 0.18 }),
    chh: acHat({ d: 0.06, seed: 51, bright: 0.92 }),
    ohh: acHat({ d: 0.45, seed: 51, bright: 0.92 }),
    ...toms([90, 105, 125, 140, 165, 190], [0.55, 0.5, 0.45, 0.44, 0.42, 0.4])
  }
}

const K707: KitDef = {
  id: '707',
  base: 'Studio',
  mode: 'sampled',
  conv: { rate: 25000, bits: 8, lp: 11000 },
  sounds: {
    kick: acKick({ f: 58, d: 0.3, beater: 0.7, boom: 0.1, pa: 7 }),
    kick2: acKick({ f: 54, d: 0.42, beater: 0.5, boom: 0.2, pa: 7 }),
    snare: acSnare({ f: 225, wires: 0.95, ring: 0.18, d: 0.2, crack: 0.5 }),
    snare2: acSnare({ f: 200, wires: 0.7, ring: 0.25, d: 0.25, crack: 0.3 }),
    rim: acSideStick(500),
    clap: acClap({ f: 1300, bursts: 4, gap: 0.01, tail: 0.2 }),
    ...toms([95, 112, 135, 150, 175, 205], [0.5, 0.45, 0.42, 0.4, 0.38, 0.36]),
    chh: { ...acHat({ d: 0.07, seed: 61 }), bits: 6 },
    phh: { ...acHat({ d: 0.11, seed: 61, chick: 0.4 }), bits: 6 },
    ohh: { ...acHat({ d: 0.55, seed: 61 }), bits: 6 },
    crash: { ...acCymbal({ d: 1.8, seed: 63 }), bits: 6 },
    ride: { ...acRide({ d: 2.0, seed: 65 }), bits: 6 },
    cowbell: acCowbell(640),
    tamb: acTamb(67),
    congaMute: acConga(440, 0.08, 0.5, -0.3),
    congaHi: acConga(330, 0.22, 0.45, -0.3),
    congaLo: acConga(240, 0.3, 0.4, -0.1),
    woodHi: acAgogo(880, -0.2),
    woodLo: acAgogo(600, -0.1),
    maracas: acShaker(0.06)
  },
  names: { congaMute: 'Hi Bongo', woodHi: 'Hi Agogo', woodLo: 'Lo Agogo' }
}

const KSP12: KitDef = {
  id: 'SP-12',
  base: 'Studio',
  mode: 'sampled',
  conv: { rate: 26040, bits: 12, alias: true, lp: 16000 },
  sounds: {
    kick: acKick({ f: 52, d: 0.55, beater: 0.5, boom: 0.45 }),
    kick2: acKick({ f: 47, d: 0.75, beater: 0.4, boom: 0.6 }),
    snare: acSnare({ f: 185, wires: 0.85, ring: 0.3, d: 0.32, crack: 0.6 }),
    clap: acClap({ f: 1100, bursts: 4, gap: 0.011, tail: 0.35 }),
    chh: acHat({ d: 0.085, seed: 71 }),
    phh: acHat({ d: 0.12, seed: 71, chick: 0.5 }),
    ohh: acHat({ d: 0.7, seed: 71 })
  }
}

const KLOFI: KitDef = {
  id: 'Lo-fi',
  base: 'SP-12',
  mode: 'sampled',
  conv: { rate: 22050, bits: 10, alias: true, lp: 6500, sat: 0.6 },
  sounds: {
    kick: acKick({ f: 54, d: 0.4, beater: 0.25, boom: 0.3 }),
    snare: acSnare({ f: 195, wires: 0.65, ring: 0.25, d: 0.25, crack: 0.35 }),
    chh: acHat({ d: 0.06, seed: 81, bright: 0.8 }),
    ohh: acHat({ d: 0.5, seed: 81, bright: 0.8 }),
    rim: acSideStick(380)
  },
  names: { rim: 'Rim Click' }
}

export const KIT_DEFS: Record<string, KitDef> = Object.fromEntries(
  [K808, K909, K606, KCR78, KSIM, KTRAP, KTECHNO, KSTUDIO, KLINN, KLM1, KDMX, KDRUMU, K707, KSP12, KLOFI].map((k) => [k.id, k])
)

export interface ResolvedPad {
  key: number
  role: Role
  name: string
  recipe: Recipe
}

/** Walk the base chain and return the recipe for every role. */
export function resolveKit(id: string): { def: KitDef; pads: ResolvedPad[] } {
  const def = KIT_DEFS[id] ?? K808
  const pads: ResolvedPad[] = []
  for (const r of ROLES) {
    let k: KitDef | undefined = def
    while (k && !k.sounds[r.role]) k = k.base ? KIT_DEFS[k.base] : undefined
    const recipe = k?.sounds[r.role]
    const name = def.names?.[r.role] ?? k?.names?.[r.role] ?? r.name
    if (recipe) pads.push({ key: r.key, role: r.role, name, recipe })
  }
  return { def, pads }
}
