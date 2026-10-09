// DX7 lookup tables and the 32 algorithms. Pure data, shared by the DSP and the editor.
// Table values follow the published behaviour of the DX7 as measured/re-implemented by
// the open-source msfa/Dexed engines (level, velocity, scaling, pitch-EG and LFO curves).

/** Output-level (0..99) to internal attenuation steps (1 step = 0.75 dB). */
const LEVEL_LUT = [0, 5, 9, 13, 17, 20, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 42, 43, 45, 46]
export function scaleOutLevel(l: number): number {
  return l >= 20 ? 28 + l : LEVEL_LUT[l < 0 ? 0 : l]
}

/** Key-velocity curve (index = MIDI velocity >> 1). */
export const VELOCITY_DATA = [
  0, 70, 86, 97, 106, 114, 121, 126, 132, 138, 142, 148, 152, 156, 160, 163, 166, 170, 173, 174, 178, 181, 184, 186, 189, 190, 194, 196, 198,
  200, 202, 205, 206, 209, 211, 214, 216, 218, 220, 222, 224, 225, 227, 229, 230, 232, 233, 235, 237, 238, 240, 241, 242, 243, 244, 246, 246,
  248, 249, 250, 251, 252, 253, 254
]

/** Velocity sensitivity 0..7 -> output-level offset (in 1/32 attenuation steps). */
export function scaleVelocity(velocity: number, sens: number): number {
  const v = velocity < 0 ? 0 : velocity > 127 ? 127 : velocity
  const vv = VELOCITY_DATA[v >> 1] - 239
  return ((sens * vv + 7) >> 3) << 4
}

const EXP_SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 14, 16, 19, 23, 27, 33, 39, 47, 56, 66, 80, 94, 110, 126, 142, 158, 174, 190, 206, 222, 238, 250]

/** curve: 0 -LIN, 1 -EXP, 2 +EXP, 3 +LIN */
function scaleCurve(group: number, depth: number, curve: number): number {
  let scale: number
  if (curve === 0 || curve === 3) scale = (group * depth * 329) >> 12
  else scale = (EXP_SCALE[Math.min(group, EXP_SCALE.length - 1)] * depth * 329) >> 15
  return curve < 2 ? -scale : scale
}

/** Keyboard level scaling, in attenuation steps (added to scaled output level). */
export function scaleLevel(note: number, bp: number, ld: number, rd: number, lc: number, rc: number): number {
  const offset = note - bp - 17
  if (offset >= 0) return scaleCurve(Math.floor((offset + 1) / 3), rd, rc)
  return scaleCurve(Math.floor(-(offset - 1) / 3), ld, lc)
}

/** Keyboard rate scaling 0..7 -> qrate delta. */
export function scaleRate(note: number, sens: number): number {
  const x = Math.min(31, Math.max(0, Math.floor(note / 3) - 7))
  return (sens * x) >> 3
}

export const PITCHENV_RATE = [
  1, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 16, 16, 17, 18, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 30, 31, 33, 34, 36, 37, 38, 39, 41, 42, 44, 46, 47, 49, 51, 53, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 79, 82, 85, 88, 91,
  94, 98, 102, 106, 110, 115, 120, 125, 130, 135, 141, 147, 153, 159, 165, 171, 178, 185, 193, 202, 211, 232, 243, 254, 255
]

/** Pitch-EG level 0..99 -> pitch in 1/32 octave (50 = no shift, ~±4 octaves at the extremes). */
export const PITCHENV_TAB = [
  -128, -116, -104, -95, -85, -76, -68, -61, -56, -52, -49, -46, -43, -41, -39, -37, -35, -33, -32, -31, -30, -29, -28, -27, -26, -25, -24, -23,
  -22, -21, -20, -19, -18, -17, -16, -15, -14, -13, -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 38, 40, 43, 46, 49, 53, 58, 65, 73, 82, 92,
  103, 115, 127
]

export const PMS_TAB = [0, 10, 20, 33, 55, 92, 153, 255]
/** Amp-mod sensitivity 0..3 as a fraction of full depth. */
export const AMS_TAB = [0, 4342338 / 16777216, 7171437 / 16777216, 1]

/** LFO speed 0..99 -> Hz (DX7 range ≈ 0.06 Hz .. ~24 Hz). */
export function lfoHz(speed: number): number {
  let sr = speed === 0 ? 1 : (165 * speed) >> 6
  sr *= sr < 160 ? 11 : 11 + ((sr - 160) >> 4)
  return (25190424 * sr) / 4294967296
}

/** LFO delay 0..99 -> [seconds of silence, seconds of fade-in]. */
export function lfoDelayTimes(delay: number): [number, number] {
  if (delay <= 0) return [0, 0]
  let a = 99 - delay
  a = (16 + (a & 15)) << (1 + (a >> 4))
  const a2 = Math.max(0x80, a & 0xff80)
  const half = 2147483648 / 25190424
  return [half / a, half / a2]
}

/** Envelope rate (0..99, + scaling) -> increment in doublings per second at full speed. */
export function envRateDoublingsPerSec(rate: number, rateScaling = 0): number {
  const qrate = Math.min(63, ((rate * 41) >> 6) + rateScaling)
  const inc = (4 + (qrate & 3)) << (2 + 6 + (qrate >> 2)) // Q24 per 64 samples @ 44.1k
  return (inc / 16777216) * (44100 / 64)
}

/** Portamento time 0..99 -> glide time constant in seconds. */
export function portaSeconds(t: number): number {
  return t <= 0 ? 0 : 0.0025 * Math.pow(2, t / 10)
}

export const CURVE_NAMES = ['-LIN', '-EXP', '+EXP', '+LIN']
export const LFO_WAVES = ['Triangle', 'Saw Down', 'Saw Up', 'Square', 'Sine', 'S&H']
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** DX7 break point 0..99 -> MIDI note (0 = A-1 = MIDI 21, 39 = C3 = MIDI 60). */
export const bpToNote = (bp: number): number => bp + 21
/** Yamaha naming (C3 = MIDI 60). */
export function noteName(n: number): string {
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 2}`
}

// ─── Algorithms ──────────────────────────────────────────────────────────────
// Operators are numbered 1..6 like on the DX7; arrays below are indexed op-1.

export interface Algorithm {
  /** mods[op] = operators modulating `op` (0-based). */
  mods: number[][]
  carriers: boolean[]
  /** Feedback: from operator `fbFrom`'s output into operator `fbTo`'s phase (same op = self feedback). */
  fbFrom: number
  fbTo: number
}

// Compact notation: "target<mod,mod" groups separated by spaces; carriers listed in `c`; feedback "from>to".
const ALG_SRC: [string, string, string][] = [
  /* 1 */ ['1<2 3<4 4<5 5<6', '1 3', '6>6'],
  /* 2 */ ['1<2 3<4 4<5 5<6', '1 3', '2>2'],
  /* 3 */ ['1<2 2<3 4<5 5<6', '1 4', '6>6'],
  /* 4 */ ['1<2 2<3 4<5 5<6', '1 4', '4>6'],
  /* 5 */ ['1<2 3<4 5<6', '1 3 5', '6>6'],
  /* 6 */ ['1<2 3<4 5<6', '1 3 5', '5>6'],
  /* 7 */ ['1<2 3<4,5 5<6', '1 3', '6>6'],
  /* 8 */ ['1<2 3<4,5 5<6', '1 3', '4>4'],
  /* 9 */ ['1<2 3<4,5 5<6', '1 3', '2>2'],
  /* 10 */ ['1<2 2<3 4<5,6', '1 4', '3>3'],
  /* 11 */ ['1<2 2<3 4<5,6', '1 4', '6>6'],
  /* 12 */ ['1<2 3<4,5,6', '1 3', '2>2'],
  /* 13 */ ['1<2 3<4,5,6', '1 3', '6>6'],
  /* 14 */ ['1<2 3<4 4<5,6', '1 3', '6>6'],
  /* 15 */ ['1<2 3<4 4<5,6', '1 3', '2>2'],
  /* 16 */ ['1<2,3,5 3<4 5<6', '1', '6>6'],
  /* 17 */ ['1<2,3,5 3<4 5<6', '1', '2>2'],
  /* 18 */ ['1<2,3,4 4<5 5<6', '1', '3>3'],
  /* 19 */ ['1<2 2<3 4<6 5<6', '1 4 5', '6>6'],
  /* 20 */ ['1<3 2<3 4<5,6', '1 2 4', '3>3'],
  /* 21 */ ['1<3 2<3 4<6 5<6', '1 2 4 5', '3>3'],
  /* 22 */ ['1<2 3<6 4<6 5<6', '1 3 4 5', '6>6'],
  /* 23 */ ['2<3 4<6 5<6', '1 2 4 5', '6>6'],
  /* 24 */ ['3<6 4<6 5<6', '1 2 3 4 5', '6>6'],
  /* 25 */ ['4<6 5<6', '1 2 3 4 5', '6>6'],
  /* 26 */ ['2<3 4<5,6', '1 2 4', '6>6'],
  /* 27 */ ['2<3 4<5,6', '1 2 4', '3>3'],
  /* 28 */ ['1<2 3<4 4<5', '1 3 6', '5>5'],
  /* 29 */ ['3<4 5<6', '1 2 3 5', '6>6'],
  /* 30 */ ['3<4 4<5', '1 2 3 6', '5>5'],
  /* 31 */ ['5<6', '1 2 3 4 5', '6>6'],
  /* 32 */ ['', '1 2 3 4 5 6', '6>6']
]

export const ALGORITHMS: Algorithm[] = ALG_SRC.map(([m, c, fb]) => {
  const mods: number[][] = [[], [], [], [], [], []]
  for (const g of m.split(' ').filter(Boolean)) {
    const [t, ms] = g.split('<')
    for (const x of ms.split(',')) mods[+t - 1].push(+x - 1)
  }
  const carriers = [false, false, false, false, false, false]
  for (const x of c.split(' ')) carriers[+x - 1] = true
  const [f, to] = fb.split('>')
  return { mods, carriers, fbFrom: +f - 1, fbTo: +to - 1 }
})
