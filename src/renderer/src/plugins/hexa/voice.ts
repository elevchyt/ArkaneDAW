// DX7 voice model: the 155-byte unpacked VCED layout (exactly as in a DX7 single-voice sysex dump)
// and its mapping onto plugin params. Shared by the DSP, the editor and the sysex code.
import type { ParamDef } from '../sdk/types'
import { CURVE_NAMES, LFO_WAVES } from './tables'

export const VOICE_SIZE = 155
export const NAME_OFF = 145
export const OP_SIZE = 21
/** VCED offset of operator n (1..6). OP6 is stored first. */
export const opOff = (n: number): number => (6 - n) * OP_SIZE

// Per-operator fields (offset within the 21-byte block)
export const O = { r1: 0, r2: 1, r3: 2, r4: 3, l1: 4, l2: 5, l3: 6, l4: 7, bp: 8, ld: 9, rd: 10, lc: 11, rc: 12, rs: 13, ams: 14, kvs: 15, ol: 16, mode: 17, coarse: 18, fine: 19, det: 20 } as const
// Global fields
export const G = { pr1: 126, pr2: 127, pr3: 128, pr4: 129, pl1: 130, pl2: 131, pl3: 132, pl4: 133, alg: 134, fb: 135, oks: 136, lfs: 137, lfd: 138, pmd: 139, amd: 140, lfks: 141, lfw: 142, pms: 143, trnp: 144 } as const

/** Max legal value of each VCED byte (used to sanitize imported data). */
export const VCED_MAX: number[] = (() => {
  const op = [99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 3, 3, 7, 3, 7, 99, 1, 31, 99, 14]
  const out: number[] = []
  for (let i = 0; i < 6; i++) out.push(...op)
  out.push(99, 99, 99, 99, 99, 99, 99, 99, 31, 7, 1, 99, 99, 99, 99, 1, 5, 7, 48)
  for (let i = 0; i < 10; i++) out.push(127)
  return out
})()

export function sanitizeVoice(v: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(VOICE_SIZE)
  for (let i = 0; i < VOICE_SIZE; i++) {
    const x = (v[i] ?? 0) | 0
    out[i] = Math.min(VCED_MAX[i], Math.max(0, x))
  }
  for (let i = NAME_OFF; i < VOICE_SIZE; i++) if (out[i] < 32) out[i] = 32
  return out
}

export function voiceName(v: ArrayLike<number>): string {
  let s = ''
  for (let i = NAME_OFF; i < VOICE_SIZE; i++) {
    const c = v[i]
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : ' '
  }
  return s.trimEnd()
}

export function setVoiceName(v: Uint8Array, name: string): void {
  const n = name.slice(0, 10).padEnd(10, ' ')
  for (let i = 0; i < 10; i++) {
    const c = n.charCodeAt(i)
    v[NAME_OFF + i] = c >= 32 && c < 127 ? c : 32
  }
}

/** The DX7 "INIT VOICE". */
export function initVoice(): Uint8Array {
  const v = new Uint8Array(VOICE_SIZE)
  for (let n = 1; n <= 6; n++) {
    const o = opOff(n)
    v.set([99, 99, 99, 99, 99, 99, 99, 0, 39, 0, 0, 0, 0, 0, 0, 0, n === 1 ? 99 : 0, 0, 1, 0, 7], o)
  }
  v.set([99, 99, 99, 99, 50, 50, 50, 50, 0, 0, 1, 35, 0, 0, 0, 1, 0, 3, 24], 126)
  setVoiceName(v, 'INIT VOICE')
  return v
}

// ─── Params ──────────────────────────────────────────────────────────────────

interface VoiceParam {
  def: ParamDef
  /** VCED byte index */
  off: number
  /** byte = value + add */
  add: number
}

const MODES = ['Ratio', 'Fixed']
const opParams = (n: number): VoiceParam[] => {
  const b = opOff(n)
  const P = (key: keyof typeof O, name: string, max: number, extra: Partial<ParamDef> = {}, add = 0): VoiceParam => ({
    def: { id: `op${n}.${key}`, name: `OP${n} ${name}`, min: -add, max: max - add, default: 0, step: 1, ...extra },
    off: b + O[key],
    add
  })
  return [
    P('r1', 'Rate 1', 99), P('r2', 'Rate 2', 99), P('r3', 'Rate 3', 99), P('r4', 'Rate 4', 99),
    P('l1', 'Level 1', 99), P('l2', 'Level 2', 99), P('l3', 'Level 3', 99), P('l4', 'Level 4', 99),
    P('bp', 'Break Point', 99), P('ld', 'L Depth', 99), P('rd', 'R Depth', 99),
    P('lc', 'L Curve', 3, { options: CURVE_NAMES }), P('rc', 'R Curve', 3, { options: CURVE_NAMES }),
    P('rs', 'Rate Scaling', 7), P('ams', 'Amp Mod Sens', 3), P('kvs', 'Velocity Sens', 7),
    P('ol', 'Output Level', 99), P('mode', 'Osc Mode', 1, { options: MODES }),
    P('coarse', 'Coarse', 31), P('fine', 'Fine', 99), P('det', 'Detune', 14, {}, 7)
  ]
}

const g = (id: string, name: string, key: keyof typeof G, max: number, extra: Partial<ParamDef> = {}, add = 0): VoiceParam => ({
  def: { id, name, min: -add, max: max - add, default: 0, step: 1, ...extra },
  off: G[key],
  add
})

export const VOICE_PARAMS: VoiceParam[] = [
  ...opParams(1), ...opParams(2), ...opParams(3), ...opParams(4), ...opParams(5), ...opParams(6),
  g('peg.r1', 'PEG Rate 1', 'pr1', 99), g('peg.r2', 'PEG Rate 2', 'pr2', 99), g('peg.r3', 'PEG Rate 3', 'pr3', 99), g('peg.r4', 'PEG Rate 4', 'pr4', 99),
  g('peg.l1', 'PEG Level 1', 'pl1', 99), g('peg.l2', 'PEG Level 2', 'pl2', 99), g('peg.l3', 'PEG Level 3', 'pl3', 99), g('peg.l4', 'PEG Level 4', 'pl4', 99),
  g('algo', 'Algorithm', 'alg', 31, {}, -1),
  g('fb', 'Feedback', 'fb', 7),
  g('oks', 'Osc Key Sync', 'oks', 1, { options: ['Off', 'On'] }),
  g('lfo.speed', 'LFO Speed', 'lfs', 99), g('lfo.delay', 'LFO Delay', 'lfd', 99), g('lfo.pmd', 'LFO Pitch Depth', 'pmd', 99), g('lfo.amd', 'LFO Amp Depth', 'amd', 99),
  g('lfo.sync', 'LFO Key Sync', 'lfks', 1, { options: ['Off', 'On'] }),
  g('lfo.wave', 'LFO Wave', 'lfw', 5, { options: LFO_WAVES }),
  g('lfo.pms', 'Pitch Mod Sens', 'pms', 7),
  g('transpose', 'Transpose', 'trnp', 48, { unit: 'st' }, 24)
]

// Defaults follow the INIT VOICE
{
  const iv = initVoice()
  for (const p of VOICE_PARAMS) p.def.default = iv[p.off] - p.add
}

export const VOICE_PARAM_MAP = new Map(VOICE_PARAMS.map((p) => [p.def.id, p]))

/** Non-voice (performance / engine) params. */
export const MASTER_PARAMS: ParamDef[] = [
  ...[1, 2, 3, 4, 5, 6].map((n): ParamDef => ({ id: `op${n}.on`, name: `OP${n} On`, min: 0, max: 1, default: 1, step: 1, options: ['Off', 'On'] })),
  { id: 'master.gain', name: 'Volume', min: -24, max: 12, default: 0, unit: 'dB' },
  { id: 'master.vintage', name: 'Character', min: 0, max: 1, default: 0, step: 1, options: ['Clean', 'Vintage'] },
  { id: 'master.poly', name: 'Polyphony', min: 0, max: 1, default: 0, step: 1, options: ['16', '32'] },
  { id: 'master.mono', name: 'Mode', min: 0, max: 1, default: 0, step: 1, options: ['Poly', 'Mono'] },
  { id: 'master.porta', name: 'Porta Time', min: 0, max: 99, default: 0, step: 1 },
  { id: 'master.bendRange', name: 'Bend Range', min: 0, max: 12, default: 2, step: 1, unit: 'st' },
  { id: 'master.bend', name: 'Pitch Bend', min: -1, max: 1, default: 0 },
  { id: 'mw.wheel', name: 'Mod Wheel', min: 0, max: 1, default: 0, unit: '%' },
  { id: 'mw.range', name: 'Wheel Range', min: 0, max: 99, default: 50, step: 1 },
  { id: 'mw.dest', name: 'Wheel Assign', min: 0, max: 2, default: 0, step: 1, options: ['Pitch', 'Amp', 'Both'] }
]
export const MASTER_IDS = MASTER_PARAMS.map((p) => p.id)

/** Convert a VCED voice to the plugin param map (voice params only). */
export function voiceToParams(v: ArrayLike<number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of VOICE_PARAMS) out[p.def.id] = v[p.off] - p.add
  return out
}

/** Build a VCED voice from a param map (missing params fall back to INIT VOICE). */
export function paramsToVoice(params: Record<string, number>, name = 'INIT VOICE'): Uint8Array {
  const v = initVoice()
  for (const p of VOICE_PARAMS) {
    const x = params[p.def.id]
    if (x !== undefined) v[p.off] = Math.min(VCED_MAX[p.off], Math.max(0, Math.round(x + p.add)))
  }
  setVoiceName(v, name)
  return v
}
