import type { ParamDef, PluginManifest, Preset } from '../sdk/types'

export const BAND_TYPES = ['Peak', 'Low Shelf', 'High Shelf', 'Low Cut', 'Low Cut 24', 'High Cut', 'High Cut 24', 'Notch']
export const NBANDS = 7
export const MAX_GAIN = 18

export const T_PEAK = 0, T_LSHELF = 1, T_HSHELF = 2, T_LCUT = 3, T_LCUT24 = 4, T_HCUT = 5, T_HCUT24 = 6, T_NOTCH = 7

/** Biquad type string for a band type, and whether it is two cascaded sections. */
export function bandShape(type: number): { kind: string; double: boolean; usesGain: boolean } {
  switch (type) {
    case T_LSHELF: return { kind: 'lowshelf', double: false, usesGain: true }
    case T_HSHELF: return { kind: 'highshelf', double: false, usesGain: true }
    case T_LCUT: return { kind: 'hp', double: false, usesGain: false }
    case T_LCUT24: return { kind: 'hp', double: true, usesGain: false }
    case T_HCUT: return { kind: 'lp', double: false, usesGain: false }
    case T_HCUT24: return { kind: 'lp', double: true, usesGain: false }
    case T_NOTCH: return { kind: 'notch', double: false, usesGain: false }
    default: return { kind: 'peak', double: false, usesGain: true }
  }
}

const DEFAULTS: [number, number, number][] = [
  // type, freq, q
  [T_LSHELF, 80, 0.71],
  [T_PEAK, 200, 0.9],
  [T_PEAK, 500, 0.9],
  [T_PEAK, 1200, 0.9],
  [T_PEAK, 3000, 0.9],
  [T_PEAK, 7000, 0.9],
  [T_HSHELF, 12000, 0.71]
]

const band = (n: number): ParamDef[] => {
  const [type, freq, q] = DEFAULTS[n - 1]
  return [
    { id: `b${n}.on`, name: `Band ${n} On`, min: 0, max: 1, default: 1, step: 1 },
    { id: `b${n}.type`, name: `Band ${n} Type`, min: 0, max: BAND_TYPES.length - 1, default: type, options: BAND_TYPES },
    { id: `b${n}.freq`, name: `Band ${n} Freq`, min: 20, max: 20000, default: freq, unit: 'Hz', curve: 'exp' },
    { id: `b${n}.gain`, name: `Band ${n} Gain`, min: -MAX_GAIN, max: MAX_GAIN, default: 0, unit: 'dB' },
    { id: `b${n}.q`, name: `Band ${n} Q`, min: 0.1, max: 18, default: q, curve: 'exp' }
  ]
}

const P = (name: string, category: string, params: Record<string, number>): Preset => ({ name, category, params })

/** Parametric EQ: 7-band EQ with a big interactive response graph and live spectrum. */
export const manifest: PluginManifest = {
  id: 'parametric-eq',
  name: 'Parametric EQ',
  kind: 'effect',
  category: 'EQ & Filter',
  description: '7-band parametric EQ: drag the bands on the graph, wheel for Q. Shelves, cuts (12/24 dB), peaks and notches.',
  color: '#5fb7ff',
  params: [
    ...band(1), ...band(2), ...band(3), ...band(4), ...band(5), ...band(6), ...band(7),
    { id: 'out', name: 'Output', min: -18, max: 18, default: 0, unit: 'dB' }
  ],
  presets: [
    { name: 'Flat', params: {} },
    P('Low Cut 80 Hz', 'Clean-up', { 'b1.type': T_LCUT24, 'b1.freq': 80, 'b1.q': 0.71 }),
    P('Vocal Presence', 'Vocal', { 'b1.type': T_LCUT, 'b1.freq': 100, 'b1.q': 0.71, 'b3.freq': 300, 'b3.gain': -2.5, 'b3.q': 1.2, 'b5.freq': 3500, 'b5.gain': 3, 'b5.q': 0.8, 'b7.freq': 10000, 'b7.gain': 2.5 }),
    P('De-mud', 'Clean-up', { 'b2.freq': 250, 'b2.gain': -4, 'b2.q': 1.1, 'b3.freq': 450, 'b3.gain': -2, 'b3.q': 1.4 }),
    P('Kick Thump', 'Drums', { 'b1.type': T_LCUT, 'b1.freq': 30, 'b2.freq': 60, 'b2.gain': 4, 'b2.q': 1.2, 'b3.freq': 350, 'b3.gain': -5, 'b3.q': 1.5, 'b5.freq': 3500, 'b5.gain': 3, 'b5.q': 1.4 }),
    P('Snare Crack', 'Drums', { 'b1.type': T_LCUT, 'b1.freq': 90, 'b2.freq': 200, 'b2.gain': 3, 'b2.q': 1.4, 'b3.freq': 800, 'b3.gain': -3, 'b3.q': 2, 'b6.freq': 6000, 'b6.gain': 4, 'b6.q': 0.9 }),
    P('Bass Definition', 'Bass', { 'b1.type': T_LCUT24, 'b1.freq': 35, 'b2.freq': 90, 'b2.gain': 2, 'b2.q': 0.9, 'b3.freq': 250, 'b3.gain': -3, 'b3.q': 1.2, 'b4.freq': 900, 'b4.gain': 2.5, 'b4.q': 1 }),
    P('Air & Sparkle', 'Master', { 'b7.freq': 11000, 'b7.gain': 4, 'b7.q': 0.6, 'b6.freq': 5000, 'b6.gain': 1, 'b6.q': 0.6 }),
    P('Smile Curve', 'Master', { 'b1.freq': 90, 'b1.gain': 4, 'b4.freq': 1000, 'b4.gain': -2, 'b4.q': 0.5, 'b7.freq': 9000, 'b7.gain': 4 }),
    P('Telephone', 'Creative', { 'b1.type': T_LCUT24, 'b1.freq': 400, 'b7.type': T_HCUT24, 'b7.freq': 3200, 'b4.freq': 1500, 'b4.gain': 6, 'b4.q': 1.2 }),
    P('Lo-Fi Radio', 'Creative', { 'b1.type': T_LCUT, 'b1.freq': 250, 'b7.type': T_HCUT24, 'b7.freq': 5000, 'b3.freq': 900, 'b3.gain': 5, 'b3.q': 0.8 }),
    P('Hum Notch 50/100 Hz', 'Clean-up', { 'b2.type': T_NOTCH, 'b2.freq': 50, 'b2.q': 8, 'b3.type': T_NOTCH, 'b3.freq': 100, 'b3.q': 8 }),
    P('Master Polish', 'Master', { 'b1.type': T_LCUT, 'b1.freq': 25, 'b3.freq': 350, 'b3.gain': -1.5, 'b3.q': 0.8, 'b6.freq': 4500, 'b6.gain': 1, 'b6.q': 0.7, 'b7.freq': 14000, 'b7.gain': 2 })
  ]
}
