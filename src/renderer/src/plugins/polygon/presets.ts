// Polygon factory patches: 90s Japanese digital synth / ROMpler homage (JV / D-50 / SC-55 / M1 / SY / 01W era).
import type { Preset } from '../sdk/types'
import { CHORUS_TYPES, FILTER_TYPES, LFO_WAVES, REVERB_TYPES } from './params'
import { waveIndex } from './waves'

type Env7 = [number, number, number, number, number, number, number] // T1 T2 T3 T4 L1 L2 L3

interface T {
  wave: string
  level?: number
  pan?: number
  coarse?: number
  fine?: number
  key?: [number, number]
  vel?: number
  /** pitch envelope: [depth st, time s] */
  pEnv?: [number, number]
  filter?: 'Off' | 'LPF' | 'HPF' | 'BPF' | 'PKG'
  cutoff?: number
  res?: number
  fKey?: number
  fEnv?: number
  fVel?: number
  tvf?: Env7
  tva?: Env7
  /** ADSR shorthand for the TVA: [attack, decay, sustain, release] */
  adsr?: [number, number, number, number]
  lfo?: { wave?: (typeof LFO_WAVES)[number]; rate?: number; delay?: number; fade?: number; pitch?: number; filter?: number; amp?: number }
}

interface C {
  level?: number
  mono?: boolean
  legato?: boolean
  porta?: number
  drift?: number
  bits?: 0 | 1 | 2
  dac?: 0 | 1 | 2 | 3
  /** [level, rate Hz, depth, type] */
  chorus?: [number, number?, number?, (typeof CHORUS_TYPES)[number]?]
  /** [level, ms, feedback] */
  delay?: [number, number?, number?]
  /** [level, type, time, hf damp] */
  reverb?: [number, (typeof REVERB_TYPES)[number]?, number?, number?]
}

function adsr([a, d, s, r]: [number, number, number, number]): Env7 {
  return [a, d * 0.35, d, r, 1, s + (1 - s) * 0.4, s]
}

function P(name: string, category: string, tones: T[], c: C = {}): Preset {
  const p: Record<string, number> = {}
  tones.forEach((t, i) => {
    const k = `t${i + 1}.`
    p[k + 'on'] = 1
    p[k + 'wave'] = waveIndex(t.wave)
    if (t.level !== undefined) p[k + 'level'] = t.level
    if (t.pan !== undefined) p[k + 'pan'] = t.pan
    if (t.coarse !== undefined) p[k + 'coarse'] = t.coarse
    if (t.fine !== undefined) p[k + 'fine'] = t.fine
    if (t.key) [p[k + 'keyLo'], p[k + 'keyHi']] = t.key
    if (t.vel !== undefined) p[k + 'velSens'] = t.vel
    if (t.pEnv) [p[k + 'pDepth'], p[k + 'pTime']] = t.pEnv
    if (t.filter) p[k + 'fType'] = FILTER_TYPES.indexOf(t.filter)
    if (t.cutoff !== undefined) p[k + 'cutoff'] = t.cutoff
    if (t.res !== undefined) p[k + 'res'] = t.res
    if (t.fKey !== undefined) p[k + 'fKey'] = t.fKey
    if (t.fEnv !== undefined) p[k + 'fEnv'] = t.fEnv
    if (t.fVel !== undefined) p[k + 'fVel'] = t.fVel
    const tvf = t.tvf ?? (t.fEnv ? ([0.005, 0.3, 1, 0.3, 1, 0.5, 0.3] as Env7) : undefined)
    if (tvf) [p[k + 'fT1'], p[k + 'fT2'], p[k + 'fT3'], p[k + 'fT4'], p[k + 'fL1'], p[k + 'fL2'], p[k + 'fL3']] = tvf
    const tva = t.tva ?? (t.adsr ? adsr(t.adsr) : undefined)
    if (tva) [p[k + 'aT1'], p[k + 'aT2'], p[k + 'aT3'], p[k + 'aT4'], p[k + 'aL1'], p[k + 'aL2'], p[k + 'aL3']] = tva
    if (t.lfo) {
      const l = t.lfo
      if (l.wave) p[k + 'lfoWave'] = LFO_WAVES.indexOf(l.wave)
      if (l.rate !== undefined) p[k + 'lfoRate'] = l.rate
      if (l.delay !== undefined) p[k + 'lfoDelay'] = l.delay
      if (l.fade !== undefined) p[k + 'lfoFade'] = l.fade
      if (l.pitch !== undefined) p[k + 'lfoPitch'] = l.pitch
      if (l.filter !== undefined) p[k + 'lfoFilter'] = l.filter
      if (l.amp !== undefined) p[k + 'lfoAmp'] = l.amp
    }
  })
  for (let i = tones.length; i < 4; i++) p[`t${i + 1}.on`] = 0
  if (c.level !== undefined) p['com.level'] = c.level
  if (c.mono) p['com.mono'] = 1
  if (c.legato) p['com.legato'] = 1
  if (c.porta !== undefined) p['com.porta'] = c.porta
  if (c.drift !== undefined) p['com.drift'] = c.drift
  if (c.bits !== undefined) p['com.bits'] = c.bits
  if (c.dac !== undefined) p['com.dac'] = c.dac
  if (c.chorus) {
    const [lv, rate, depth, type] = c.chorus
    p['fx.chorus'] = lv
    if (rate !== undefined) p['fx.chRate'] = rate
    if (depth !== undefined) p['fx.chDepth'] = depth
    if (type) p['fx.chType'] = CHORUS_TYPES.indexOf(type)
  }
  if (c.delay) {
    const [lv, ms, fb] = c.delay
    p['fx.delay'] = lv
    if (ms !== undefined) p['fx.dlyTime'] = ms
    if (fb !== undefined) p['fx.dlyFb'] = fb
  }
  if (c.reverb) {
    const [lv, type, time, tone] = c.reverb
    p['fx.reverb'] = lv
    if (type) p['fx.revType'] = REVERB_TYPES.indexOf(type)
    if (time !== undefined) p['fx.revTime'] = time
    if (tone !== undefined) p['fx.revTone'] = tone
  }
  return { name, category, params: p }
}

export const CATEGORIES = ['Piano/Keys', 'Organ', 'Pad', 'Strings', 'Brass', 'Choir/Vox', 'Bass', 'Lead', 'Bell/Mallet', 'Ethnic', 'Orchestral/Hit', 'SFX/Atmos']

const KEYS = 'Piano/Keys'
const ORG = 'Organ'
const PAD = 'Pad'
const STR = 'Strings'
const BRS = 'Brass'
const VOX = 'Choir/Vox'
const BASS = 'Bass'
const LEAD = 'Lead'
const BELL = 'Bell/Mallet'
const ETH = 'Ethnic'
const ORCH = 'Orchestral/Hit'
const SFX = 'SFX/Atmos'

const pianoTVA: Env7 = [0.002, 1.2, 7, 0.45, 1, 0.5, 0]
const pianoTVF: Env7 = [0, 0.8, 4, 0.4, 1, 0.45, 0]

export const PRESETS: Preset[] = [
  // ── Piano / Keys ────────────────────────────────────────────────────────────
  P('M-Piano 1990', KEYS, [
    { wave: 'M1 Piano', vel: 0.65, cutoff: 7000, fEnv: 1.2, fVel: 0.5, tvf: pianoTVF, tva: pianoTVA },
    { wave: 'Piano Atk', level: 0.35, vel: 0.8, cutoff: 9000, tva: [0, 0.3, 0.1, 0.1, 1, 0, 0] }
  ], { chorus: [0.25, 0.4, 0.4], reverb: [0.3, 'Hall 1'] }),
  P('House Piano 91', KEYS, [
    { wave: 'M1 Piano', vel: 0.5, cutoff: 12000, fEnv: 0.8, tvf: pianoTVF, tva: [0.001, 0.8, 4, 0.3, 1, 0.45, 0] },
    { wave: 'M1 Piano', coarse: 12, level: 0.35, fine: 6, vel: 0.5, cutoff: 9000, tva: [0.001, 0.5, 2.5, 0.25, 1, 0.35, 0] }
  ], { chorus: [0.35, 0.6, 0.5], reverb: [0.2, 'Room 2'] }),
  P('Piano & Pad', KEYS, [
    { wave: 'M1 Piano', vel: 0.6, cutoff: 6000, fEnv: 1, tvf: pianoTVF, tva: pianoTVA },
    { wave: 'Warm Pad', level: 0.35, vel: 0.2, cutoff: 3000, adsr: [0.9, 2, 0.8, 1.6] },
    { wave: 'Strings Sus', level: 0.25, vel: 0.2, cutoff: 4000, adsr: [1.2, 2, 0.8, 1.8] }
  ], { chorus: [0.4, 0.3, 0.6, 'Chorus 2'], reverb: [0.4, 'Hall 2'] }),
  P('Crystal EP', KEYS, [
    { wave: 'DX EP', vel: 0.7, cutoff: 9000, tva: [0.001, 1.5, 6, 0.5, 1, 0.55, 0] },
    { wave: 'Glass Atk', coarse: 12, level: 0.35, vel: 0.9 },
    { wave: 'DX EP', coarse: 12, fine: 7, level: 0.2, vel: 0.8, tva: [0.001, 0.8, 3, 0.4, 1, 0.3, 0] }
  ], { chorus: [0.5, 0.5, 0.55], reverb: [0.3, 'Hall 1'] }),
  P('Tine Dream', KEYS, [
    { wave: 'DX EP', vel: 0.6, cutoff: 7000, tva: [0.001, 2, 6, 0.6, 1, 0.6, 0.2], lfo: { wave: 'Sine', rate: 4.2, amp: 0.4 } },
    { wave: 'Sine', level: 0.3, coarse: 12, tva: [0.001, 1, 3, 0.5, 1, 0.3, 0] }
  ], { chorus: [0.45, 0.35, 0.7, 'Chorus 2'], reverb: [0.3, 'Room 2'] }),
  P('Baroque Harpsi', KEYS, [
    { wave: 'Pulse 25', level: 0.6, cutoff: 3500, fEnv: 2, fKey: 1, tvf: [0, 0.4, 1.5, 0.2, 1, 0.3, 0], tva: [0.001, 0.6, 2.5, 0.15, 1, 0.4, 0] },
    { wave: 'Koto', coarse: 12, level: 0.45, vel: 0.2, tva: [0.001, 0.4, 1.5, 0.12, 1, 0.3, 0] },
    { wave: 'Piano Atk', coarse: 12, level: 0.25, filter: 'HPF', cutoff: 1500 }
  ], { reverb: [0.25, 'Room 1'] }),

  // ── Organ ───────────────────────────────────────────────────────────────────
  P('House Organ 2', ORG, [
    { wave: 'Organ', vel: 0.3, tva: [0.002, 0.25, 0.3, 0.08, 1, 0.75, 0.65] },
    { wave: 'Sine', coarse: 19, level: 0.6, vel: 0.3, tva: [0.001, 0.15, 0.3, 0.05, 1, 0.2, 0] },
    { wave: 'Square', coarse: 12, level: 0.25, cutoff: 3000, adsr: [0.002, 0.2, 0.5, 0.08] }
  ], { chorus: [0.2], reverb: [0.25, 'Room 2'] }),
  P('Drawbar Full', ORG, [
    { wave: 'Organ', vel: 0, adsr: [0.004, 0.1, 1, 0.06], lfo: { wave: 'Sine', rate: 6.4, pitch: 7, amp: 0.12 } },
    { wave: 'Organ', coarse: 12, level: 0.35, vel: 0, adsr: [0.004, 0.1, 1, 0.06], lfo: { wave: 'Sine', rate: 6.8, pitch: 9 } }
  ], { chorus: [0.55, 0.9, 0.6, 'Chorus 3'], reverb: [0.25, 'Room 2'] }),
  P('Church Pipes', ORG, [
    { wave: 'Organ', vel: 0, adsr: [0.08, 0.2, 1, 0.5] },
    { wave: 'Flute', coarse: -12, level: 0.55, vel: 0, adsr: [0.12, 0.2, 1, 0.6] },
    { wave: 'Square', coarse: 12, level: 0.18, vel: 0, cutoff: 5000, adsr: [0.1, 0.2, 1, 0.5] }
  ], { reverb: [0.55, 'Hall 2', 0.8] }),
  P('Jazz Perc Organ', ORG, [
    { wave: 'Organ', vel: 0.2, adsr: [0.003, 0.1, 1, 0.05], lfo: { wave: 'Sine', rate: 5.8, pitch: 5 } },
    { wave: 'Sine', coarse: 24, level: 0.5, vel: 0.4, tva: [0.001, 0.2, 0.5, 0.04, 1, 0.15, 0] }
  ], { chorus: [0.35, 0.8, 0.5], reverb: [0.2, 'Room 1'] }),
  P('Reed Organ', ORG, [
    { wave: 'Reed', vel: 0.2, cutoff: 5000, adsr: [0.05, 0.2, 1, 0.25] },
    { wave: 'Organ', level: 0.45, vel: 0.2, cutoff: 4000, adsr: [0.04, 0.2, 1, 0.25] }
  ], { chorus: [0.3], reverb: [0.3, 'Stage 1'] }),
  P('Cathedral', ORG, [
    { wave: 'Organ', vel: 0, adsr: [0.15, 0.2, 1, 1.2] },
    { wave: 'Saw', coarse: -12, level: 0.3, vel: 0, cutoff: 1800, adsr: [0.2, 0.2, 1, 1.2] },
    { wave: 'Choir Aah', level: 0.35, vel: 0, adsr: [0.6, 0.5, 1, 1.5] }
  ], { reverb: [0.65, 'Hall 2', 1, 0.6] }),

  // ── Pad ─────────────────────────────────────────────────────────────────────
  P('Fantasy Pad', PAD, [
    { wave: 'Digital Bell', level: 0.55, vel: 0.6, cutoff: 9000, tva: [0.001, 0.8, 3, 1.5, 1, 0.35, 0] },
    { wave: 'Glass Atk', coarse: 12, level: 0.3, vel: 0.8 },
    { wave: 'Warm Pad', level: 0.6, vel: 0.2, cutoff: 3500, adsr: [0.45, 2, 0.85, 2.2], lfo: { wave: 'Tri', rate: 0.3, filter: 0.4 } },
    { wave: 'Saw Ens', level: 0.3, vel: 0.2, cutoff: 1800, fine: 6, adsr: [0.7, 2, 0.8, 2.2] }
  ], { chorus: [0.5, 0.45, 0.6, 'Chorus 2'], reverb: [0.45, 'Hall 2'] }),
  P('Glass Atmosphere', PAD, [
    { wave: 'Spectrum', level: 0.5, vel: 0.3, cutoff: 5000, res: 0.3, adsr: [0.6, 2, 0.8, 2.5], lfo: { wave: 'Tri', rate: 0.18, filter: 1.2 } },
    { wave: 'Ice Wave', level: 0.4, coarse: 12, vel: 0.3, adsr: [1.2, 2, 0.8, 3] },
    { wave: 'Bell Loop', level: 0.25, coarse: 24, vel: 0.5, tva: [0.001, 1, 4, 2, 1, 0.3, 0.1] }
  ], { chorus: [0.55, 0.3, 0.7, 'Chorus 3'], delay: [0.2, 450, 0.4], reverb: [0.5, 'Hall 2', 0.8] }),
  P('Universe Pad', PAD, [
    { wave: 'Choir Aah', level: 0.6, vel: 0.2, cutoff: 3000, fEnv: 1.5, tvf: [2.5, 3, 4, 2, 1, 0.6, 0.5], adsr: [0.8, 2, 0.9, 2.5] },
    { wave: 'Saw Ens', level: 0.35, vel: 0.2, cutoff: 900, fEnv: 2.5, res: 0.3, tvf: [3, 3, 4, 2, 1, 0.5, 0.4], adsr: [1, 2, 0.85, 2.5] },
    { wave: 'Vox', coarse: 12, level: 0.25, vel: 0.2, adsr: [1.5, 2, 0.8, 3] }
  ], { chorus: [0.45, 0.25, 0.7, 'Chorus 2'], reverb: [0.55, 'Hall 2', 0.85] }),
  P('Ice Shower', PAD, [
    { wave: 'Ice Wave', level: 1, vel: 0.3, cutoff: 6000, adsr: [0.3, 2, 0.75, 2.5], lfo: { wave: 'S&H', rate: 9, filter: 1.5 } },
    { wave: 'Digital Bell', coarse: 12, level: 0.75, vel: 0.7, tva: [0.001, 0.6, 2.5, 1.5, 1, 0.3, 0] },
    { wave: 'Glass Atk', coarse: 24, level: 0.45, vel: 0.8 }
  ], { chorus: [0.4], delay: [0.35, 330, 0.5], reverb: [0.45, 'Hall 2'] }),
  P('Soft Haze', PAD, [
    { wave: 'Warm Pad', level: 0.7, vel: 0.2, cutoff: 2500, adsr: [1.2, 2, 0.9, 2.5], lfo: { wave: 'Sine', rate: 0.25, filter: 0.6 } },
    { wave: 'Sine', coarse: 12, level: 0.3, vel: 0.2, adsr: [1.5, 2, 0.8, 2.5], lfo: { wave: 'Sine', rate: 4.5, pitch: 8, delay: 1 } }
  ], { chorus: [0.5, 0.3, 0.7, 'Chorus 2'], reverb: [0.45, 'Hall 1'] }),
  P('Sweep Pad JD', PAD, [
    { wave: 'Saw Ens', level: 0.6, vel: 0.2, cutoff: 400, res: 0.55, fEnv: 4.5, tvf: [3.5, 3, 5, 2.5, 1, 0.5, 0.35], adsr: [0.5, 2, 0.9, 2.5] },
    { wave: 'Saw', coarse: -12, fine: -8, level: 0.35, vel: 0.2, cutoff: 600, res: 0.4, fEnv: 3.5, tvf: [4, 3, 5, 2.5, 1, 0.5, 0.35], adsr: [0.6, 2, 0.9, 2.5] }
  ], { chorus: [0.5, 0.4, 0.6], reverb: [0.4, 'Hall 1'] }),
  P('Digital Nebula', PAD, [
    { wave: 'Spectrum', level: 0.8, vel: 0.2, cutoff: 3000, adsr: [1.5, 3, 0.8, 3], lfo: { wave: 'Tri', rate: 0.12, filter: 1.5 } },
    { wave: 'Metal', coarse: -12, level: 0.3, vel: 0.2, filter: 'BPF', cutoff: 2000, res: 0.3, adsr: [2, 3, 0.7, 3], lfo: { wave: 'Sine', rate: 0.2, filter: 2 } },
    { wave: 'Noise', level: 0.12, vel: 0.2, filter: 'HPF', cutoff: 6000, adsr: [2, 2, 0.6, 3] }
  ], { chorus: [0.6, 0.2, 0.8, 'Chorus 3'], reverb: [0.6, 'Hall 2', 0.9], bits: 1 }),

  // ── Strings ─────────────────────────────────────────────────────────────────
  P('JV Strings', STR, [
    { wave: 'Strings Sus', pan: -0.4, fine: -7, vel: 0.4, cutoff: 6500, fVel: 0.5, adsr: [0.15, 1, 0.9, 0.6] },
    { wave: 'Strings Sus', pan: 0.4, fine: 7, vel: 0.4, cutoff: 6000, fVel: 0.5, adsr: [0.2, 1, 0.9, 0.65] }
  ], { chorus: [0.3, 0.4, 0.5], reverb: [0.4, 'Hall 1'] }),
  P('Slow Strings', STR, [
    { wave: 'Strings Sus', pan: -0.3, fine: -5, vel: 0.3, cutoff: 4500, adsr: [0.9, 2, 0.9, 1.4] },
    { wave: 'Strings Sus', pan: 0.3, fine: 6, vel: 0.3, cutoff: 4000, adsr: [1.1, 2, 0.9, 1.5] }
  ], { chorus: [0.35, 0.3, 0.6, 'Chorus 2'], reverb: [0.5, 'Hall 2'] }),
  P('Octave Strings', STR, [
    { wave: 'Strings Sus', vel: 0.4, cutoff: 6000, adsr: [0.2, 1, 0.9, 0.7] },
    { wave: 'Strings Sus', coarse: 12, level: 0.45, fine: 5, vel: 0.4, cutoff: 7000, adsr: [0.3, 1, 0.9, 0.8] },
    { wave: 'Strings Sus', coarse: -12, level: 0.4, fine: -4, vel: 0.4, cutoff: 3000, adsr: [0.25, 1, 0.9, 0.8] }
  ], { chorus: [0.3], reverb: [0.45, 'Hall 1'] }),
  P('Pizzicato Section', STR, [
    { wave: 'Pizz', pan: -0.3, vel: 0.6, cutoff: 7000 },
    { wave: 'Pizz', pan: 0.3, fine: 8, level: 0.6, vel: 0.6, cutoff: 5000 }
  ], { reverb: [0.4, 'Stage 2'] }),
  P('Syn Strings JP', STR, [
    { wave: 'Saw Ens', vel: 0.3, cutoff: 2800, fEnv: 0.8, tvf: [0.4, 1, 2, 0.8, 1, 0.6, 0.5], adsr: [0.35, 1.5, 0.85, 1] },
    { wave: 'Saw', fine: 9, level: 0.4, vel: 0.3, cutoff: 2200, adsr: [0.35, 1.5, 0.85, 1] }
  ], { chorus: [0.65, 0.55, 0.65, 'Chorus 3'], reverb: [0.35, 'Hall 1'] }),
  P('Tremolo Strings', STR, [
    { wave: 'Strings Sus', vel: 0.4, cutoff: 6000, adsr: [0.08, 1, 0.9, 0.5], lfo: { wave: 'Tri', rate: 7.5, amp: 0.65 } },
    { wave: 'Strings Sus', coarse: -12, level: 0.5, fine: 4, vel: 0.4, cutoff: 3000, adsr: [0.1, 1, 0.9, 0.5], lfo: { wave: 'Tri', rate: 7.9, amp: 0.65 } }
  ], { reverb: [0.45, 'Hall 1'] }),

  // ── Brass ───────────────────────────────────────────────────────────────────
  P('Synth Brass 1', BRS, [
    { wave: 'Saw', vel: 0.5, cutoff: 900, res: 0.2, fEnv: 3, fVel: 0.6, tvf: [0.07, 0.6, 1, 0.3, 1, 0.55, 0.45], adsr: [0.02, 0.6, 0.85, 0.25] },
    { wave: 'Saw', fine: 11, level: 0.6, vel: 0.5, cutoff: 900, res: 0.2, fEnv: 3, fVel: 0.6, tvf: [0.07, 0.6, 1, 0.3, 1, 0.55, 0.45], adsr: [0.02, 0.6, 0.85, 0.25] }
  ], { chorus: [0.4, 0.5, 0.5], reverb: [0.3, 'Hall 1'] }),
  P('Brass Section', BRS, [
    { wave: 'Brass Sus', pan: -0.3, vel: 0.6, cutoff: 2000, fEnv: 1.5, fVel: 0.6, tvf: [0.05, 0.5, 1, 0.2, 1, 0.7, 0.6], adsr: [0.03, 0.8, 0.85, 0.25], pEnv: [-0.6, 0.06] },
    { wave: 'Brass Sus', pan: 0.3, fine: 8, vel: 0.6, cutoff: 1800, fEnv: 1.5, fVel: 0.6, tvf: [0.06, 0.5, 1, 0.2, 1, 0.7, 0.6], adsr: [0.035, 0.8, 0.85, 0.25] },
    { wave: 'Horn', coarse: -12, level: 0.35, vel: 0.5, adsr: [0.05, 0.8, 0.85, 0.3] }
  ], { reverb: [0.35, 'Stage 2'] }),
  P('Horn Section', BRS, [
    { wave: 'Horn', vel: 0.5, cutoff: 2500, fEnv: 0.8, tvf: [0.1, 0.5, 1, 0.3, 1, 0.7, 0.6], adsr: [0.08, 1, 0.9, 0.4] },
    { wave: 'Horn', fine: -9, pan: 0.3, level: 0.6, vel: 0.5, cutoff: 2200, adsr: [0.1, 1, 0.9, 0.4] }
  ], { reverb: [0.45, 'Hall 1'] }),
  P('Fanfare Trumpets', BRS, [
    { wave: 'Brass Sus', vel: 0.6, cutoff: 3500, fEnv: 1.2, fVel: 0.7, tvf: [0.03, 0.4, 1, 0.2, 1, 0.75, 0.7], adsr: [0.015, 0.5, 0.85, 0.2], pEnv: [-1.5, 0.07], lfo: { rate: 5.5, pitch: 10, delay: 0.4, fade: 0.4 } },
    { wave: 'Brass Sus', coarse: 12, fine: 6, level: 0.35, vel: 0.6, cutoff: 4000, adsr: [0.02, 0.5, 0.8, 0.2], pEnv: [-1.5, 0.07] }
  ], { reverb: [0.4, 'Hall 1'] }),
  P('Poly Brass Stab', BRS, [
    { wave: 'Brass Sus', vel: 0.6, cutoff: 2500, fEnv: 2, tvf: [0.01, 0.25, 0.5, 0.1, 1, 0.3, 0.2], tva: [0.005, 0.25, 0.6, 0.12, 1, 0.5, 0] },
    { wave: 'Saw', level: 0.5, fine: -10, vel: 0.6, cutoff: 1500, fEnv: 2.5, tvf: [0.01, 0.2, 0.4, 0.1, 1, 0.3, 0.2], tva: [0.005, 0.25, 0.6, 0.12, 1, 0.5, 0] }
  ], { chorus: [0.3], reverb: [0.3, 'Room 2'] }),
  P('Mellow Brass Pad', BRS, [
    { wave: 'Horn', vel: 0.3, cutoff: 1800, adsr: [0.4, 1.5, 0.9, 1.2] },
    { wave: 'Warm Pad', level: 0.45, vel: 0.2, cutoff: 2000, adsr: [0.7, 1.5, 0.9, 1.5] }
  ], { chorus: [0.45, 0.3, 0.6, 'Chorus 2'], reverb: [0.45, 'Hall 2'] }),

  // ── Choir / Vox ─────────────────────────────────────────────────────────────
  P('Temple Choir', VOX, [
    { wave: 'Choir Aah', pan: -0.3, fine: -6, vel: 0.3, cutoff: 5000, adsr: [0.35, 1.5, 0.9, 1.4] },
    { wave: 'Choir Aah', pan: 0.3, fine: 6, vel: 0.3, cutoff: 4500, adsr: [0.45, 1.5, 0.9, 1.5] },
    { wave: 'Vox', coarse: -12, level: 0.35, vel: 0.3, adsr: [0.5, 1.5, 0.9, 1.5] }
  ], { chorus: [0.35, 0.3, 0.5], reverb: [0.55, 'Hall 2', 0.75] }),
  P('Aah Ensemble', VOX, [
    { wave: 'Choir Aah', vel: 0.3, cutoff: 6000, adsr: [0.25, 1, 0.9, 0.9] },
    { wave: 'Strings Sus', level: 0.35, vel: 0.3, cutoff: 3500, adsr: [0.35, 1, 0.9, 0.9] }
  ], { chorus: [0.3], reverb: [0.45, 'Hall 1'] }),
  P('Ooh Voices', VOX, [
    { wave: 'Vox', pan: -0.25, vel: 0.3, adsr: [0.3, 1, 0.9, 1] },
    { wave: 'Vox', pan: 0.25, fine: 9, vel: 0.3, adsr: [0.35, 1, 0.9, 1.1] }
  ], { chorus: [0.45, 0.4, 0.55, 'Chorus 2'], reverb: [0.45, 'Hall 1'] }),
  P('Angel Vox Pad', VOX, [
    { wave: 'Vox', vel: 0.3, adsr: [0.8, 2, 0.9, 2.5] },
    { wave: 'Choir Aah', coarse: 12, level: 0.4, vel: 0.3, cutoff: 6000, adsr: [1.2, 2, 0.85, 2.5] },
    { wave: 'Glass Atk', coarse: 24, level: 0.25, vel: 0.8 },
    { wave: 'Spectrum', level: 0.2, vel: 0.3, cutoff: 3000, adsr: [1.5, 2, 0.8, 2.5] }
  ], { chorus: [0.5, 0.3, 0.6, 'Chorus 3'], reverb: [0.6, 'Hall 2', 0.85] }),
  P('Synth Vox 91', VOX, [
    { wave: 'Vox', vel: 0.4, cutoff: 1200, res: 0.45, fEnv: 2.5, tvf: [0.3, 1, 2, 0.6, 1, 0.5, 0.4], adsr: [0.1, 1, 0.85, 0.7], lfo: { wave: 'Tri', rate: 0.6, filter: 0.8 } },
    { wave: 'Saw Ens', level: 0.3, vel: 0.4, cutoff: 1500, adsr: [0.15, 1, 0.85, 0.7] }
  ], { chorus: [0.5], delay: [0.2, 400, 0.35], reverb: [0.4, 'Hall 1'] }),
  P('Breathy Choir', VOX, [
    { wave: 'Choir Aah', vel: 0.3, cutoff: 4000, adsr: [0.5, 1.5, 0.9, 1.5] },
    { wave: 'Breath', level: 0.3, vel: 0.3, filter: 'BPF', cutoff: 2500, fKey: 1, adsr: [0.4, 1, 0.6, 1.2] }
  ], { chorus: [0.3], reverb: [0.55, 'Hall 2'] }),

  // ── Bass ────────────────────────────────────────────────────────────────────
  P('Slap Bass DX', BASS, [
    { wave: 'Slap', vel: 0.7, cutoff: 8000, fVel: 0.6, tva: [0.001, 0.4, 2.5, 0.08, 1, 0.55, 0.15] },
    { wave: 'Digi Bass', level: 0.35, vel: 0.5, cutoff: 1200, tva: [0.001, 0.3, 1.5, 0.06, 1, 0.4, 0.1] }
  ], { reverb: [0.1, 'Room 1'] }),
  P('Fretless Night', BASS, [
    { wave: 'Fretless', vel: 0.5, cutoff: 3000, pEnv: [-0.7, 0.09], adsr: [0.01, 1.5, 0.6, 0.15], lfo: { wave: 'Sine', rate: 5, pitch: 10, delay: 0.45, fade: 0.5 } }
  ], { mono: true, legato: true, porta: 0.07, chorus: [0.3, 0.4, 0.5], reverb: [0.25, 'Room 2'] }),
  P('Pick Bass 1', BASS, [
    { wave: 'Pick Bass', vel: 0.6, cutoff: 5000, fVel: 0.5, tva: [0.001, 0.5, 3, 0.07, 1, 0.6, 0.2] }
  ], { reverb: [0.08, 'Room 1'] }),
  P('Digital Bass', BASS, [
    { wave: 'Digi Bass', vel: 0.5, cutoff: 1400, fEnv: 2, tvf: [0, 0.2, 0.5, 0.1, 1, 0.3, 0.2], adsr: [0.001, 0.5, 0.65, 0.08] },
    { wave: 'Square', coarse: -12, level: 0.3, vel: 0.3, cutoff: 600, adsr: [0.001, 0.5, 0.8, 0.08] }
  ], { reverb: [0.08, 'Room 1'] }),
  P('Acid-ish Saw Bass', BASS, [
    { wave: 'Saw', vel: 0.5, cutoff: 350, res: 0.72, fEnv: 4, fKey: 0.3, tvf: [0, 0.18, 0.3, 0.1, 1, 0.2, 0.1], adsr: [0.001, 0.4, 0.75, 0.06] }
  ], { mono: true, legato: true, porta: 0.05, delay: [0.15, 375, 0.3] }),
  P('Sub Sine Bass', BASS, [
    { wave: 'Sine', vel: 0.4, adsr: [0.003, 0.5, 0.9, 0.1] },
    { wave: 'Pick Bass', level: 0.25, vel: 0.6, cutoff: 2500, tva: [0.001, 0.2, 0.5, 0.06, 1, 0.3, 0] }
  ]),
  P('Synth Bass 2', BASS, [
    { wave: 'Square', vel: 0.5, cutoff: 700, res: 0.35, fEnv: 3, tvf: [0, 0.25, 0.4, 0.1, 1, 0.3, 0.2], adsr: [0.001, 0.4, 0.7, 0.08] },
    { wave: 'Saw', coarse: 12, fine: 6, level: 0.3, vel: 0.5, cutoff: 900, fEnv: 2.5, tvf: [0, 0.2, 0.3, 0.1, 1, 0.3, 0.15], adsr: [0.001, 0.3, 0.5, 0.08] }
  ], { chorus: [0.15] }),

  // ── Lead ────────────────────────────────────────────────────────────────────
  P('Square Lead 64', LEAD, [
    { wave: 'Square', vel: 0.3, cutoff: 6000, adsr: [0.005, 0.3, 0.85, 0.15], lfo: { wave: 'Tri', rate: 5.8, pitch: 18, delay: 0.3, fade: 0.4 } },
    { wave: 'Pulse 25', coarse: 12, level: 0.25, vel: 0.3, cutoff: 5000, adsr: [0.005, 0.3, 0.8, 0.15], lfo: { wave: 'Tri', rate: 5.8, pitch: 18, delay: 0.3, fade: 0.4 } }
  ], { mono: true, legato: true, porta: 0.04, delay: [0.25, 320, 0.35], reverb: [0.25, 'Hall 1'] }),
  P('Saw Lead Hero', LEAD, [
    { wave: 'Saw', vel: 0.3, cutoff: 5500, res: 0.2, fEnv: 1, tvf: [0.02, 0.4, 1, 0.2, 1, 0.6, 0.5], adsr: [0.005, 0.4, 0.85, 0.2], lfo: { wave: 'Sine', rate: 5.5, pitch: 16, delay: 0.35, fade: 0.4 } },
    { wave: 'Saw', fine: 12, level: 0.7, vel: 0.3, cutoff: 5000, adsr: [0.005, 0.4, 0.85, 0.2], lfo: { wave: 'Sine', rate: 5.5, pitch: 16, delay: 0.35, fade: 0.4 } }
  ], { mono: true, legato: true, porta: 0.05, chorus: [0.3], delay: [0.25, 375, 0.4], reverb: [0.25, 'Hall 1'] }),
  P('Whistle Lead', LEAD, [
    { wave: 'Sine', vel: 0.3, adsr: [0.03, 0.3, 0.9, 0.2], lfo: { wave: 'Sine', rate: 5.2, pitch: 22, delay: 0.25, fade: 0.3 }, pEnv: [-0.5, 0.06] },
    { wave: 'Breath', level: 0.15, vel: 0.3, filter: 'BPF', cutoff: 3000, fKey: 1, adsr: [0.02, 0.2, 0.5, 0.2] }
  ], { mono: true, legato: true, porta: 0.06, delay: [0.2, 300, 0.3], reverb: [0.35, 'Hall 1'] }),
  P('Digital Sync Lead', LEAD, [
    { wave: 'Spectrum', vel: 0.3, cutoff: 7000, adsr: [0.005, 0.5, 0.85, 0.2] },
    { wave: 'Saw', level: 0.55, vel: 0.3, pEnv: [12, 0.25], cutoff: 4000, res: 0.3, adsr: [0.005, 0.4, 0.8, 0.2] }
  ], { mono: true, chorus: [0.3], delay: [0.2, 280, 0.35], reverb: [0.2, 'Room 2'] }),
  P('Fifth Lead', LEAD, [
    { wave: 'Saw', vel: 0.3, cutoff: 4500, adsr: [0.005, 0.4, 0.85, 0.2], lfo: { rate: 5.6, pitch: 12, delay: 0.4, fade: 0.3 } },
    { wave: 'Saw', coarse: 7, level: 0.55, vel: 0.3, cutoff: 4000, adsr: [0.005, 0.4, 0.85, 0.2], lfo: { rate: 5.6, pitch: 12, delay: 0.4, fade: 0.3 } }
  ], { mono: true, legato: true, porta: 0.03, delay: [0.2, 375, 0.3], reverb: [0.2, 'Hall 1'] }),
  P('Soft Flute Lead', LEAD, [
    { wave: 'Flute', vel: 0.4, adsr: [0.04, 0.4, 0.9, 0.25], lfo: { wave: 'Sine', rate: 5, pitch: 14, delay: 0.3, fade: 0.4 } },
    { wave: 'Sine', coarse: 12, level: 0.2, vel: 0.3, adsr: [0.05, 0.4, 0.9, 0.25] }
  ], { mono: true, legato: true, porta: 0.04, reverb: [0.35, 'Hall 1'] }),

  // ── Bell / Mallet ───────────────────────────────────────────────────────────
  P('Digital Bells', BELL, [
    { wave: 'Digital Bell', vel: 0.6, tva: [0.001, 1.2, 5, 1.5, 1, 0.4, 0] },
    { wave: 'Bell Loop', coarse: 12, level: 0.3, vel: 0.6, tva: [0.001, 0.8, 3, 1, 1, 0.3, 0] }
  ], { chorus: [0.35], reverb: [0.4, 'Hall 1'] }),
  P('Vibraphone', BELL, [
    { wave: 'Vibes', vel: 0.7, tva: [0.001, 1.5, 5, 0.6, 1, 0.5, 0], lfo: { wave: 'Sine', rate: 5, amp: 0.35 } }
  ], { reverb: [0.35, 'Stage 1'] }),
  P('Marimba', BELL, [
    { wave: 'Marimba', vel: 0.7, cutoff: 9000, tva: [0.001, 0.4, 1.2, 0.2, 1, 0.3, 0] }
  ], { reverb: [0.3, 'Room 2'] }),
  P('Glockenspiel', BELL, [
    { wave: 'Glocken', coarse: 12, vel: 0.7, tva: [0.001, 1, 4, 1, 1, 0.4, 0] }
  ], { reverb: [0.4, 'Hall 1'] }),
  P('Music Box', BELL, [
    { wave: 'Glocken', coarse: 12, vel: 0.5, tva: [0.001, 0.5, 2.5, 0.6, 1, 0.3, 0] },
    { wave: 'Kalimba', coarse: 24, level: 0.4, vel: 0.5, tva: [0.001, 0.3, 1.5, 0.4, 1, 0.2, 0] }
  ], { chorus: [0.25], reverb: [0.45, 'Room 2'] }),
  P('Crystal Mallet', BELL, [
    { wave: 'Glass Atk', vel: 0.8 },
    { wave: 'Vibes', level: 0.7, vel: 0.6, tva: [0.001, 1.2, 4, 0.8, 1, 0.4, 0] },
    { wave: 'Bell Loop', coarse: 12, level: 0.25, vel: 0.6, tva: [0.002, 1, 3, 1, 1, 0.3, 0] }
  ], { chorus: [0.4], delay: [0.2, 420, 0.35], reverb: [0.4, 'Hall 2'] }),
  P('Tubular Bells', BELL, [
    { wave: 'Bell Loop', coarse: -12, vel: 0.6, cutoff: 8000, tva: [0.001, 2, 7, 2, 1, 0.45, 0] },
    { wave: 'Digital Bell', level: 0.5, vel: 0.6, tva: [0.001, 1, 4, 1.5, 1, 0.3, 0] }
  ], { reverb: [0.5, 'Hall 2'] }),

  // ── Ethnic ──────────────────────────────────────────────────────────────────
  P('Pan Flute Valley', ETH, [
    { wave: 'Pan Flute', vel: 0.5, adsr: [0.03, 0.5, 0.85, 0.3], lfo: { wave: 'Sine', rate: 4.8, pitch: 12, delay: 0.35, fade: 0.4 } },
    { wave: 'Breath', level: 0.12, vel: 0.5, filter: 'BPF', cutoff: 2000, fKey: 1, adsr: [0.02, 0.15, 0.3, 0.2] }
  ], { reverb: [0.45, 'Hall 2'] }),
  P('Ocarina Temple', ETH, [
    { wave: 'Ocarina', vel: 0.4, adsr: [0.03, 0.4, 0.9, 0.25], lfo: { wave: 'Sine', rate: 5.2, pitch: 15, delay: 0.3, fade: 0.4 } }
  ], { mono: true, legato: true, porta: 0.03, reverb: [0.5, 'Hall 2', 0.7] }),
  P('Sitar Dreams', ETH, [
    { wave: 'Sitar', vel: 0.5, tva: [0.001, 1, 4, 0.4, 1, 0.55, 0] },
    { wave: 'Sitar', fine: 7, pan: 0.4, level: 0.5, vel: 0.5, pEnv: [0.3, 0.15], tva: [0.001, 1, 4, 0.4, 1, 0.55, 0] }
  ], { chorus: [0.2], reverb: [0.35, 'Hall 1'] }),
  P('Koto Garden', ETH, [
    { wave: 'Koto', vel: 0.6, cutoff: 9000, tva: [0.001, 0.5, 2.5, 0.3, 1, 0.4, 0] }
  ], { reverb: [0.4, 'Hall 1'] }),
  P('Kalimba Sun', ETH, [
    { wave: 'Kalimba', vel: 0.6, tva: [0.001, 0.4, 1.8, 0.3, 1, 0.35, 0] }
  ], { delay: [0.15, 250, 0.25], reverb: [0.3, 'Room 2'] }),
  P('Steel Islands', ETH, [
    { wave: 'Steel Drum', vel: 0.6, tva: [0.001, 0.5, 2, 0.3, 1, 0.4, 0] }
  ], { chorus: [0.2], reverb: [0.3, 'Room 2'] }),
  P('Musette Accordion', ETH, [
    { wave: 'Accordion', vel: 0.4, cutoff: 6000, adsr: [0.04, 0.4, 0.9, 0.15], lfo: { wave: 'Sine', rate: 5.5, amp: 0.15 } }
  ], { reverb: [0.3, 'Room 2'] }),
  P('Shakuhachi Mist', ETH, [
    { wave: 'Shakuhachi', vel: 0.5, pEnv: [-1, 0.15], adsr: [0.08, 0.5, 0.85, 0.35], lfo: { wave: 'Sine', rate: 4.5, pitch: 18, delay: 0.5, fade: 0.6 } }
  ], { mono: true, legato: true, porta: 0.08, reverb: [0.55, 'Hall 2', 0.7] }),

  // ── Orchestral / Hit ────────────────────────────────────────────────────────
  P('Orch Hit Stab', ORCH, [
    { wave: 'Orch Hit', vel: 0.5 },
    { wave: 'Orch Hit', coarse: -12, level: 0.5, vel: 0.5 }
  ], { reverb: [0.4, 'Hall 1'] }),
  P('Orchestra Tutti', ORCH, [
    { wave: 'Strings Sus', vel: 0.5, cutoff: 6000, adsr: [0.06, 1, 0.9, 0.6] },
    { wave: 'Brass Sus', level: 0.45, vel: 0.6, cutoff: 2500, fEnv: 1, adsr: [0.05, 1, 0.85, 0.4] },
    { wave: 'Horn', coarse: -12, level: 0.4, vel: 0.5, adsr: [0.08, 1, 0.9, 0.5] }
  ], { reverb: [0.5, 'Hall 2'] }),
  P('Timpani', ORCH, [
    { wave: 'Timpani', vel: 0.8, cutoff: 5000, tva: [0.001, 0.6, 2.5, 0.5, 1, 0.35, 0] }
  ], { reverb: [0.4, 'Hall 1'] }),
  P('Flute Solo', ORCH, [
    { wave: 'Flute', vel: 0.5, adsr: [0.05, 0.5, 0.9, 0.3], lfo: { wave: 'Sine', rate: 5, pitch: 12, delay: 0.4, fade: 0.5 } }
  ], { reverb: [0.45, 'Hall 1'] }),
  P('Oboe Reed', ORCH, [
    { wave: 'Reed', vel: 0.5, cutoff: 6000, adsr: [0.04, 0.5, 0.9, 0.2], lfo: { wave: 'Sine', rate: 5.3, pitch: 10, delay: 0.4, fade: 0.4 } }
  ], { reverb: [0.4, 'Hall 1'] }),
  P('Harp Glissando', ORCH, [
    { wave: 'Harp', vel: 0.6, tva: [0.001, 1, 4, 1, 1, 0.45, 0] }
  ], { chorus: [0.15], reverb: [0.5, 'Hall 2'] }),
  P('Spanish Nylon', ORCH, [
    { wave: 'Nylon Gtr', vel: 0.6, cutoff: 7000, fVel: 0.6, tva: [0.001, 0.8, 3.5, 0.4, 1, 0.45, 0] }
  ], { reverb: [0.3, 'Room 2'] }),
  P('Epic Hit', ORCH, [
    { wave: 'Orch Hit', vel: 0.5 },
    { wave: 'Timpani', coarse: -12, level: 0.6, vel: 0.5, tva: [0.001, 0.4, 1.2, 0.4, 1, 0.3, 0] },
    { wave: 'Noise', level: 0.2, filter: 'LPF', cutoff: 3000, tva: [0.001, 0.15, 0.4, 0.2, 1, 0.2, 0] }
  ], { reverb: [0.55, 'Hall 2'] }),

  // ── SFX / Atmos ─────────────────────────────────────────────────────────────
  P('Wind Tunnel', SFX, [
    { wave: 'Noise', vel: 0.2, filter: 'BPF', cutoff: 900, res: 0.6, fKey: 1, adsr: [1, 2, 0.9, 2], lfo: { wave: 'Sine', rate: 0.15, filter: 2 } },
    { wave: 'Noise', level: 0.4, vel: 0.2, filter: 'BPF', cutoff: 2500, res: 0.5, fKey: 1, adsr: [1.5, 2, 0.8, 2], lfo: { wave: 'Tri', rate: 0.23, filter: 1.5 } }
  ], { reverb: [0.5, 'Hall 2'] }),
  P('Space Laser', SFX, [
    { wave: 'Spectrum', vel: 0.3, pEnv: [30, 0.35], cutoff: 8000, tva: [0.001, 0.3, 0.4, 0.2, 1, 0.5, 0] },
    { wave: 'Square', coarse: 12, level: 0.4, vel: 0.3, pEnv: [24, 0.25], tva: [0.001, 0.2, 0.3, 0.2, 1, 0.4, 0] }
  ], { delay: [0.35, 180, 0.5], reverb: [0.3, 'Hall 1'], dac: 2 }),
  P('Metal Rain', SFX, [
    { wave: 'Metal', coarse: 12, vel: 0.5, tva: [0.001, 0.6, 2, 0.8, 1, 0.3, 0], lfo: { wave: 'S&H', rate: 12, pitch: 60 } },
    { wave: 'Ice Wave', coarse: 12, level: 0.5, vel: 0.5, adsr: [0.5, 1, 0.6, 1.5] }
  ], { delay: [0.35, 260, 0.55], reverb: [0.45, 'Hall 2'] }),
  P('Ghost Breath', SFX, [
    { wave: 'Breath', vel: 0.2, filter: 'BPF', cutoff: 1200, res: 0.5, fKey: 1, adsr: [1, 2, 0.8, 2], lfo: { wave: 'Sine', rate: 0.3, filter: 1.5 } },
    { wave: 'Vox', coarse: -12, level: 0.4, vel: 0.2, adsr: [1.5, 2, 0.8, 2.2], lfo: { wave: 'Sine', rate: 3, pitch: 25 } }
  ], { chorus: [0.5, 0.2, 0.8, 'Chorus 3'], reverb: [0.6, 'Hall 2', 0.9] }),
  P('Seashore', SFX, [
    { wave: 'Noise', level: 1, vel: 0.1, cutoff: 3000, res: 0.2, fKey: 0, adsr: [1.5, 2, 0.9, 2.5], lfo: { wave: 'Tri', rate: 0.12, amp: 0.55, filter: 1.5 } },
    { wave: 'Breath', level: 1, vel: 0.1, coarse: -12, filter: 'LPF', cutoff: 1500, fKey: 0, adsr: [2, 2, 0.8, 2.5], lfo: { wave: 'Sine', rate: 0.09, amp: 0.5 } }
  ], { reverb: [0.45, 'Hall 2'] }),
  P('Dungeon Drone', SFX, [
    { wave: 'Metal', coarse: -24, vel: 0.2, cutoff: 1500, res: 0.4, adsr: [1, 2, 0.9, 2.5], lfo: { wave: 'Tri', rate: 0.1, filter: 1.5 } },
    { wave: 'Saw Ens', coarse: -24, level: 0.5, vel: 0.2, cutoff: 500, adsr: [1.5, 2, 0.9, 2.5] }
  ], { chorus: [0.4, 0.15, 0.8, 'Flanger'], reverb: [0.55, 'Hall 2', 0.9], bits: 1 }),
  P('Crystal Cave', SFX, [
    { wave: 'Ice Wave', coarse: 24, level: 1, vel: 0.5, tva: [0.001, 0.5, 2, 1, 1, 0.3, 0] },
    { wave: 'Glass Atk', coarse: 12, level: 0.9, vel: 0.8 }
  ], { delay: [0.45, 375, 0.6], reverb: [0.55, 'Hall 2', 0.9] }),
  P('8-Bit Arcade', SFX, [
    { wave: 'Square', vel: 0.2, pEnv: [12, 0.08], tva: [0.001, 0.1, 0.2, 0.05, 1, 0.6, 0] }
  ], { bits: 2, dac: 3, delay: [0.25, 150, 0.4] })
]

/** Patch levels calibrated offline (analysis.test.ts loudness) so patches sit at similar loudness. */
const LEVELS: Record<string, number> = {
  "M-Piano 1990": 0.71,
  "House Piano 91": 0.67,
  "Piano & Pad": 0.81,
  "Crystal EP": 0.67,
  "Tine Dream": 0.9,
  "Baroque Harpsi": 1,
  "House Organ 2": 0.74,
  "Drawbar Full": 0.67,
  "Church Pipes": 0.55,
  "Jazz Perc Organ": 0.79,
  "Reed Organ": 0.81,
  "Cathedral": 0.57,
  "Fantasy Pad": 0.89,
  "Glass Atmosphere": 1,
  "Universe Pad": 0.62,
  "Ice Shower": 1,
  "Soft Haze": 0.67,
  "Sweep Pad JD": 0.58,
  "Digital Nebula": 1,
  "JV Strings": 0.59,
  "Slow Strings": 0.43,
  "Octave Strings": 0.69,
  "Pizzicato Section": 0.62,
  "Syn Strings JP": 0.53,
  "Tremolo Strings": 0.95,
  "Synth Brass 1": 0.52,
  "Brass Section": 0.77,
  "Horn Section": 0.6,
  "Fanfare Trumpets": 0.91,
  "Poly Brass Stab": 0.75,
  "Mellow Brass Pad": 1,
  "Temple Choir": 0.47,
  "Aah Ensemble": 0.79,
  "Ooh Voices": 0.41,
  "Angel Vox Pad": 0.81,
  "Synth Vox 91": 0.82,
  "Breathy Choir": 0.73,
  "Slap Bass DX": 0.95,
  "Fretless Night": 1,
  "Pick Bass 1": 0.79,
  "Digital Bass": 1,
  "Acid-ish Saw Bass": 0.82,
  "Sub Sine Bass": 0.79,
  "Synth Bass 2": 1,
  "Square Lead 64": 0.92,
  "Saw Lead Hero": 0.46,
  "Whistle Lead": 0.88,
  "Digital Sync Lead": 0.7,
  "Fifth Lead": 0.76,
  "Soft Flute Lead": 0.92,
  "Digital Bells": 0.7,
  "Vibraphone": 1,
  "Marimba": 1,
  "Glockenspiel": 0.82,
  "Music Box": 0.63,
  "Crystal Mallet": 0.62,
  "Tubular Bells": 0.82,
  "Pan Flute Valley": 0.96,
  "Ocarina Temple": 0.9,
  "Sitar Dreams": 0.77,
  "Koto Garden": 1,
  "Kalimba Sun": 1,
  "Steel Islands": 0.79,
  "Musette Accordion": 1,
  "Shakuhachi Mist": 0.91,
  "Orch Hit Stab": 0.99,
  "Orchestra Tutti": 0.69,
  "Timpani": 1,
  "Flute Solo": 0.88,
  "Oboe Reed": 1,
  "Harp Glissando": 0.67,
  "Spanish Nylon": 0.69,
  "Epic Hit": 0.76,
  "Wind Tunnel": 0.53,
  "Space Laser": 1,
  "Metal Rain": 1,
  "Ghost Breath": 0.6,
  "Seashore": 0.8,
  "Dungeon Drone": 0.5,
  "Crystal Cave": 1,
  "8-Bit Arcade": 1
}
for (const p of PRESETS) if (LEVELS[p.name] !== undefined && p.params['com.level'] === undefined) p.params['com.level'] = LEVELS[p.name]
