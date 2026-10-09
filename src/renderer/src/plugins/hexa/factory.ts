// Hexa factory bank: original voices designed for this engine (not Yamaha ROM data).
// Each voice is authored as compact operator specs and compiled to a 155-byte DX7 VCED voice,
// so the whole bank can be exported as a genuine DX7 cartridge.
import { G, O, VOICE_SIZE, initVoice, opOff, setVoiceName } from './voice'

type E4 = [number, number, number, number]
interface OpSpec {
  /** coarse 0..31 (0 = ×0.5) */
  c: number
  ol: number
  r: E4
  l: E4
  f?: number
  /** detune -7..7 */
  d?: number
  /** velocity sensitivity 0..7 */
  v?: number
  rs?: number
  ams?: number
  /** fixed frequency mode */
  fx?: boolean
  bp?: number
  ld?: number
  rd?: number
  lc?: number
  rc?: number
}
interface VoiceSpec {
  name: string
  cat: string
  alg: number
  fb?: number
  /** op1..op6 (missing = silent) */
  ops: (OpSpec | null)[]
  peg?: { r: E4; l: E4 }
  lfo?: { s?: number; d?: number; pmd?: number; amd?: number; sync?: number; w?: number; pms?: number }
  tr?: number
  oks?: number
  /** extra non-voice params (mono, porta, ...) */
  extra?: Record<string, number>
}

const OFF: OpSpec = { c: 1, ol: 0, r: [99, 99, 99, 99], l: [99, 99, 99, 0] }

function compile(s: VoiceSpec): Uint8Array {
  const v = initVoice()
  for (let n = 1; n <= 6; n++) {
    const o = s.ops[n - 1] ?? OFF
    const b = opOff(n)
    v.set(o.r, b + O.r1)
    v.set(o.l, b + O.l1)
    v[b + O.bp] = o.bp ?? 39
    v[b + O.ld] = o.ld ?? 0
    v[b + O.rd] = o.rd ?? 0
    v[b + O.lc] = o.lc ?? 0
    v[b + O.rc] = o.rc ?? 0
    v[b + O.rs] = o.rs ?? 0
    v[b + O.ams] = o.ams ?? 0
    v[b + O.kvs] = o.v ?? 0
    v[b + O.ol] = o.ol
    v[b + O.mode] = o.fx ? 1 : 0
    v[b + O.coarse] = o.c
    v[b + O.fine] = o.f ?? 0
    v[b + O.det] = (o.d ?? 0) + 7
  }
  const peg = s.peg ?? { r: [99, 99, 99, 99], l: [50, 50, 50, 50] }
  v.set(peg.r, G.pr1)
  v.set(peg.l, G.pl1)
  v[G.alg] = s.alg - 1
  v[G.fb] = s.fb ?? 0
  v[G.oks] = s.oks ?? 1
  const l = s.lfo ?? {}
  v[G.lfs] = l.s ?? 35
  v[G.lfd] = l.d ?? 0
  v[G.pmd] = l.pmd ?? 0
  v[G.amd] = l.amd ?? 0
  v[G.lfks] = l.sync ?? 0
  v[G.lfw] = l.w ?? 4
  v[G.pms] = l.pms ?? 3
  v[G.trnp] = 24 + (s.tr ?? 0)
  setVoiceName(v, s.name.toUpperCase())
  if (v.length !== VOICE_SIZE) throw new Error('bad voice')
  return v
}

const E = (...x: number[]): E4 => x as E4

const SPECS: VoiceSpec[] = [
  // ── Keys ──────────────────────────────────────────────────────────────────
  {
    name: 'TINE EP 83', cat: 'Keys', alg: 5, fb: 6,
    ops: [
      { c: 1, ol: 92, r: E(96, 26, 22, 62), l: E(99, 82, 0, 0), v: 2, rs: 3, d: 2 },
      { c: 14, ol: 60, r: E(95, 55, 38, 74), l: E(99, 0, 0, 0), v: 7, rs: 3 },
      { c: 1, ol: 93, r: E(95, 29, 20, 60), l: E(99, 92, 0, 0), v: 2, rs: 3 },
      { c: 1, ol: 76, r: E(95, 42, 25, 62), l: E(99, 72, 0, 0), v: 7, rs: 3, rd: 20, rc: 1 },
      { c: 1, ol: 84, r: E(95, 29, 20, 60), l: E(99, 92, 0, 0), v: 2, rs: 3, d: -3 },
      { c: 1, ol: 64, r: E(95, 35, 22, 62), l: E(99, 80, 0, 0), v: 6, rs: 3 }
    ],
    lfo: { s: 32, amd: 0, pmd: 0 }
  },
  {
    name: 'BARKER EP', cat: 'Keys', alg: 5, fb: 5,
    ops: [
      { c: 1, ol: 90, r: E(97, 30, 22, 64), l: E(99, 84, 0, 0), v: 3, rs: 3, d: 1 },
      { c: 13, ol: 64, r: E(96, 60, 40, 74), l: E(99, 0, 0, 0), v: 7, rs: 3 },
      { c: 1, ol: 92, r: E(96, 32, 22, 62), l: E(99, 90, 0, 0), v: 3, rs: 3 },
      { c: 1, ol: 83, r: E(97, 48, 26, 64), l: E(99, 70, 0, 0), v: 7, rs: 4, rd: 24, rc: 1 },
      { c: 1, ol: 80, r: E(95, 30, 22, 62), l: E(99, 90, 0, 0), v: 2, rs: 3, d: -4 },
      { c: 1, ol: 72, r: E(96, 45, 24, 62), l: E(99, 70, 0, 0), v: 7, rs: 3 }
    ]
  },
  {
    name: 'GLASS EP', cat: 'Keys', alg: 5, fb: 3,
    ops: [
      { c: 1, ol: 92, r: E(95, 30, 24, 55), l: E(99, 86, 0, 0), v: 2, rs: 2 },
      { c: 7, ol: 66, r: E(95, 40, 28, 60), l: E(99, 40, 0, 0), v: 6, rs: 2 },
      { c: 1, ol: 90, r: E(95, 28, 22, 55), l: E(99, 90, 0, 0), v: 2, rs: 2, d: 3 },
      { c: 1, ol: 70, r: E(95, 45, 25, 55), l: E(99, 70, 0, 0), v: 6, rs: 2 },
      { c: 3, ol: 70, r: E(96, 38, 26, 55), l: E(99, 0, 0, 0), v: 3, rs: 2 },
      { c: 5, ol: 58, r: E(96, 50, 30, 55), l: E(99, 0, 0, 0), v: 5, rs: 2 }
    ]
  },
  {
    name: 'FM GRAND', cat: 'Keys', alg: 3, fb: 5,
    ops: [
      { c: 1, ol: 96, r: E(97, 32, 24, 58), l: E(99, 86, 0, 0), v: 2, rs: 3, rd: 18, rc: 1 },
      { c: 1, ol: 79, r: E(97, 42, 26, 60), l: E(99, 76, 0, 0), v: 6, rs: 3, rd: 40, rc: 1 },
      { c: 5, ol: 62, r: E(98, 66, 40, 62), l: E(99, 0, 0, 0), v: 7, rs: 3 },
      { c: 1, ol: 90, r: E(97, 30, 22, 58), l: E(99, 86, 0, 0), v: 2, rs: 3, d: 3 },
      { c: 3, ol: 70, r: E(98, 55, 30, 60), l: E(99, 50, 0, 0), v: 6, rs: 3, rd: 40, rc: 1 },
      { c: 1, ol: 62, r: E(97, 40, 25, 60), l: E(99, 70, 0, 0), v: 4, rs: 3 }
    ]
  },
  {
    name: 'CLAVINETTE', cat: 'Keys', alg: 3, fb: 7,
    ops: [
      { c: 1, ol: 96, r: E(99, 50, 34, 82), l: E(99, 86, 0, 0), v: 3, rs: 3 },
      { c: 3, ol: 80, r: E(99, 62, 38, 80), l: E(99, 66, 0, 0), v: 6, rs: 3 },
      { c: 1, ol: 66, r: E(99, 75, 40, 80), l: E(99, 40, 0, 0), v: 4 },
      { c: 1, ol: 86, r: E(99, 52, 34, 82), l: E(99, 84, 0, 0), v: 3, rs: 3, d: 4 },
      { c: 5, ol: 74, r: E(99, 66, 40, 80), l: E(99, 55, 0, 0), v: 6, rs: 3 },
      { c: 1, ol: 76, r: E(99, 70, 40, 80), l: E(99, 60, 0, 0), v: 4 }
    ]
  },
  {
    name: 'HARPSI 18', cat: 'Keys', alg: 5, fb: 7,
    ops: [
      { c: 1, ol: 92, r: E(99, 40, 30, 70), l: E(99, 82, 0, 0), rs: 3 },
      { c: 1, ol: 84, r: E(99, 46, 32, 70), l: E(99, 74, 0, 0), rs: 3 },
      { c: 2, ol: 86, r: E(99, 42, 30, 70), l: E(99, 80, 0, 0), rs: 3, d: 2 },
      { c: 5, ol: 74, r: E(99, 50, 34, 70), l: E(99, 62, 0, 0), rs: 3 },
      { c: 4, ol: 72, r: E(99, 55, 36, 72), l: E(99, 60, 0, 0), rs: 3 },
      { c: 1, ol: 76, r: E(99, 56, 36, 72), l: E(99, 66, 0, 0), rs: 3 }
    ]
  },
  // ── Organ ─────────────────────────────────────────────────────────────────
  {
    name: 'PERC ORGAN', cat: 'Organ', alg: 32, fb: 0,
    ops: [
      { c: 0, ol: 80, r: E(99, 99, 99, 78), l: E(99, 99, 99, 0) },
      { c: 1, ol: 86, r: E(99, 99, 99, 78), l: E(99, 99, 99, 0), ams: 1 },
      { c: 2, ol: 80, r: E(99, 99, 99, 78), l: E(99, 99, 99, 0), ams: 1 },
      { c: 3, ol: 82, r: E(99, 60, 40, 78), l: E(99, 0, 0, 0) },
      { c: 4, ol: 70, r: E(99, 99, 99, 78), l: E(99, 99, 99, 0) },
      { c: 8, ol: 62, r: E(99, 99, 99, 78), l: E(99, 99, 99, 0) }
    ],
    lfo: { s: 68, amd: 6, pmd: 3, w: 4, pms: 2 }
  },
  {
    name: 'DRAWBAR 88', cat: 'Organ', alg: 32, fb: 2,
    ops: [
      { c: 0, ol: 84, r: E(99, 99, 99, 80), l: E(99, 99, 99, 0) },
      { c: 1, ol: 84, r: E(99, 99, 99, 80), l: E(99, 99, 99, 0), ams: 1 },
      { c: 1, f: 50, ol: 76, r: E(99, 99, 99, 80), l: E(99, 99, 99, 0) },
      { c: 2, ol: 78, r: E(99, 99, 99, 80), l: E(99, 99, 99, 0), ams: 1 },
      { c: 4, ol: 70, r: E(99, 99, 99, 80), l: E(99, 99, 99, 0) },
      { c: 8, ol: 66, r: E(99, 99, 99, 80), l: E(99, 99, 99, 0) }
    ],
    lfo: { s: 74, amd: 8, pmd: 4, w: 4, pms: 2 }
  },
  {
    name: 'REED ORGAN', cat: 'Organ', alg: 19, fb: 5,
    ops: [
      { c: 1, ol: 90, r: E(80, 99, 99, 70), l: E(99, 99, 99, 0) },
      { c: 2, ol: 72, r: E(80, 99, 99, 70), l: E(99, 99, 99, 0) },
      { c: 3, ol: 60, r: E(80, 99, 99, 70), l: E(99, 99, 99, 0) },
      { c: 2, ol: 82, r: E(80, 99, 99, 70), l: E(99, 99, 99, 0), d: 3 },
      { c: 4, ol: 70, r: E(80, 99, 99, 70), l: E(99, 99, 99, 0) },
      { c: 1, ol: 66, r: E(80, 99, 99, 70), l: E(99, 99, 99, 0) }
    ],
    lfo: { s: 40, d: 40, pmd: 5, pms: 3 }
  },
  // ── Bass ──────────────────────────────────────────────────────────────────
  {
    name: 'LATELY BS', cat: 'Bass', alg: 5, fb: 6,
    ops: [
      null,
      null,
      { c: 1, ol: 84, r: E(99, 48, 30, 76), l: E(99, 80, 0, 0), v: 2 },
      { c: 1, ol: 76, r: E(99, 76, 42, 72), l: E(99, 40, 0, 0), v: 6 },
      { c: 0, ol: 99, r: E(99, 40, 30, 76), l: E(99, 86, 0, 0), v: 2 },
      { c: 0, ol: 79, r: E(99, 56, 34, 72), l: E(99, 66, 0, 0), v: 6 }
    ]
  },
  {
    name: 'SOLID BASS', cat: 'Bass', alg: 16, fb: 6,
    ops: [
      { c: 0, ol: 99, r: E(99, 30, 25, 72), l: E(99, 92, 82, 0), v: 2 },
      { c: 0, ol: 74, r: E(99, 50, 30, 72), l: E(99, 80, 70, 0), v: 5 },
      { c: 1, ol: 70, r: E(99, 60, 30, 72), l: E(99, 62, 50, 0), v: 4 },
      { c: 2, ol: 58, r: E(99, 70, 30, 72), l: E(99, 50, 0, 0) },
      { c: 1, ol: 66, r: E(99, 85, 40, 72), l: E(99, 40, 30, 0), v: 6 },
      { c: 0, ol: 72, r: E(99, 50, 30, 72), l: E(99, 76, 66, 0) }
    ]
  },
  {
    name: 'SLAP FM', cat: 'Bass', alg: 5, fb: 4,
    ops: [
      { c: 0, ol: 99, r: E(99, 38, 28, 74), l: E(99, 84, 0, 0), v: 3 },
      { c: 1, ol: 82, r: E(99, 72, 36, 76), l: E(99, 54, 0, 0), v: 7 },
      { c: 1, ol: 78, r: E(99, 82, 40, 78), l: E(99, 0, 0, 0), v: 6 },
      { c: 7, ol: 70, r: E(99, 86, 40, 78), l: E(99, 0, 0, 0), v: 6 },
      null,
      null
    ]
  },
  {
    name: 'SQUARE SUB', cat: 'Bass', alg: 5, fb: 0,
    ops: [
      { c: 0, ol: 99, r: E(99, 50, 40, 76), l: E(99, 95, 90, 0) },
      { c: 1, ol: 72, r: E(99, 60, 40, 76), l: E(99, 86, 80, 0), v: 3 },
      null, null, null, null
    ],
    extra: { 'master.mono': 1, 'master.porta': 22 }
  },
  {
    name: 'WOOD BASS', cat: 'Bass', alg: 1, fb: 0,
    ops: [
      { c: 0, ol: 99, r: E(92, 36, 26, 70), l: E(99, 82, 0, 0), v: 3 },
      { c: 0, ol: 70, r: E(95, 60, 30, 70), l: E(99, 60, 0, 0), v: 5 },
      { c: 1, ol: 72, r: E(99, 85, 40, 72), l: E(99, 0, 0, 0), v: 6 },
      { c: 5, ol: 56, r: E(99, 85, 40, 72), l: E(99, 0, 0, 0) },
      null,
      null
    ]
  },
  // ── Brass ─────────────────────────────────────────────────────────────────
  {
    name: 'BRASS SECT', cat: 'Brass', alg: 22, fb: 7,
    ops: [
      { c: 1, ol: 90, r: E(72, 60, 40, 66), l: E(99, 94, 92, 0), v: 1 },
      { c: 1, ol: 80, r: E(60, 44, 30, 62), l: E(99, 86, 82, 0), v: 3 },
      { c: 1, ol: 84, r: E(70, 58, 40, 66), l: E(99, 94, 92, 0), v: 1, d: -3 },
      { c: 1, ol: 84, r: E(70, 58, 40, 66), l: E(99, 94, 92, 0), v: 1, d: 3 },
      { c: 1, ol: 82, r: E(68, 58, 40, 66), l: E(99, 94, 92, 0), v: 1, d: 6 },
      { c: 1, ol: 74, r: E(58, 42, 30, 62), l: E(99, 86, 82, 0), v: 3 }
    ],
    peg: { r: E(92, 70, 99, 60), l: E(53, 50, 50, 50) },
    lfo: { s: 34, d: 55, pmd: 6, pms: 4 }
  },
  {
    name: 'SOLO HORN', cat: 'Brass', alg: 2, fb: 6,
    ops: [
      { c: 1, ol: 96, r: E(68, 60, 45, 70), l: E(99, 96, 93, 0), v: 1 },
      { c: 1, ol: 80, r: E(58, 50, 40, 68), l: E(99, 88, 84, 0), v: 4 },
      { c: 1, ol: 80, r: E(68, 60, 45, 70), l: E(99, 94, 90, 0), d: 3 },
      { c: 1, ol: 74, r: E(60, 50, 40, 68), l: E(99, 86, 82, 0), v: 4 },
      { c: 3, ol: 52, r: E(70, 50, 40, 68), l: E(99, 80, 70, 0) },
      { c: 1, ol: 46, r: E(70, 50, 40, 68), l: E(99, 80, 70, 0) }
    ],
    peg: { r: E(94, 70, 99, 60), l: E(52, 50, 50, 49) },
    lfo: { s: 34, d: 60, pmd: 8, pms: 4 },
    extra: { 'master.mono': 1, 'master.porta': 18 }
  },
  {
    name: 'SYN BRASS', cat: 'Brass', alg: 16, fb: 7,
    ops: [
      { c: 1, ol: 99, r: E(80, 50, 40, 64), l: E(99, 92, 88, 0), v: 1 },
      { c: 1, ol: 74, r: E(70, 45, 35, 62), l: E(99, 84, 80, 0), d: 5, v: 3 },
      { c: 1, ol: 72, r: E(70, 45, 35, 62), l: E(99, 84, 80, 0), d: -5, v: 3 },
      { c: 1, ol: 66, r: E(70, 45, 35, 62), l: E(99, 80, 76, 0) },
      { c: 1, ol: 78, r: E(66, 42, 32, 62), l: E(99, 84, 78, 0), v: 3 },
      { c: 1, ol: 82, r: E(66, 42, 32, 62), l: E(99, 82, 76, 0) }
    ],
    lfo: { s: 30, d: 40, pmd: 4, pms: 3 }
  },
  // ── Bells & mallets ───────────────────────────────────────────────────────
  {
    name: 'TUBULAR BL', cat: 'Bells', alg: 5, fb: 0,
    ops: [
      { c: 1, ol: 95, r: E(95, 33, 25, 36), l: E(99, 75, 0, 0), rs: 2, v: 2 },
      { c: 3, f: 17, ol: 78, r: E(98, 30, 25, 36), l: E(99, 70, 0, 0), rs: 2, v: 4 },
      { c: 1, ol: 90, r: E(95, 31, 24, 36), l: E(99, 80, 0, 0), rs: 2, d: 5, v: 2 },
      { c: 3, f: 17, ol: 74, r: E(98, 32, 25, 36), l: E(99, 66, 0, 0), rs: 2, d: -3, v: 4 },
      { c: 0, ol: 70, r: E(80, 30, 25, 36), l: E(99, 70, 0, 0), rs: 2 },
      { c: 5, f: 25, ol: 64, r: E(98, 40, 25, 36), l: E(99, 0, 0, 0), rs: 2 }
    ]
  },
  {
    name: 'CHIME BELL', cat: 'Bells', alg: 5, fb: 2,
    ops: [
      { c: 1, ol: 94, r: E(99, 38, 26, 40), l: E(99, 70, 0, 0), rs: 3, v: 2 },
      { c: 3, f: 41, ol: 74, r: E(99, 42, 28, 40), l: E(99, 50, 0, 0), rs: 3, v: 5 },
      { c: 2, ol: 86, r: E(99, 40, 28, 40), l: E(99, 60, 0, 0), rs: 3, v: 2 },
      { c: 9, ol: 64, r: E(99, 60, 30, 40), l: E(99, 0, 0, 0), rs: 3, v: 5 },
      { c: 4, ol: 78, r: E(99, 45, 30, 40), l: E(99, 0, 0, 0), rs: 3 },
      { c: 13, f: 30, ol: 58, r: E(99, 66, 30, 40), l: E(99, 0, 0, 0), rs: 3 }
    ]
  },
  {
    name: 'MARIMBA 1', cat: 'Mallets', alg: 5, fb: 0,
    ops: [
      { c: 1, ol: 99, r: E(99, 48, 30, 62), l: E(99, 0, 0, 0), rs: 3, v: 3 },
      { c: 4, ol: 70, r: E(99, 72, 40, 62), l: E(99, 0, 0, 0), rs: 3, v: 6 },
      { c: 4, ol: 76, r: E(99, 62, 34, 62), l: E(99, 0, 0, 0), rs: 3, v: 4 },
      { c: 1, ol: 50, r: E(99, 70, 34, 62), l: E(99, 0, 0, 0), rs: 3 },
      { c: 10, ol: 62, r: E(99, 85, 40, 62), l: E(99, 0, 0, 0), rs: 3, v: 6 },
      null
    ]
  },
  {
    name: 'VIBES 5', cat: 'Mallets', alg: 5, fb: 0,
    ops: [
      { c: 1, ol: 98, r: E(96, 33, 25, 46), l: E(99, 84, 0, 0), rs: 2, v: 3, ams: 3 },
      { c: 4, ol: 62, r: E(96, 60, 30, 46), l: E(99, 40, 0, 0), rs: 2, v: 6 },
      { c: 4, ol: 74, r: E(96, 50, 28, 46), l: E(99, 50, 0, 0), rs: 2, v: 3, ams: 3 },
      { c: 1, ol: 46, r: E(96, 60, 30, 46), l: E(99, 0, 0, 0), rs: 2 },
      { c: 10, ol: 60, r: E(98, 80, 40, 46), l: E(99, 0, 0, 0), rs: 2, v: 5 },
      null
    ],
    lfo: { s: 60, amd: 25, w: 4, sync: 1 }
  },
  {
    name: 'KALIMBA', cat: 'Mallets', alg: 5, fb: 0,
    ops: [
      { c: 1, ol: 99, r: E(99, 46, 32, 60), l: E(99, 0, 0, 0), rs: 3, v: 3 },
      { c: 5, f: 16, ol: 66, r: E(99, 80, 40, 60), l: E(99, 0, 0, 0), rs: 3, v: 6 },
      { c: 6, ol: 68, r: E(99, 72, 40, 60), l: E(99, 0, 0, 0), rs: 3, v: 5 },
      null, null, null
    ]
  },
  {
    name: 'GLOCKEN', cat: 'Mallets', alg: 5, fb: 0, tr: 12,
    ops: [
      { c: 1, ol: 94, r: E(99, 38, 28, 42), l: E(99, 0, 0, 0), rs: 3, v: 3 },
      { c: 2, f: 38, ol: 72, r: E(99, 50, 30, 42), l: E(99, 0, 0, 0), rs: 3, v: 6 },
      { c: 5, f: 8, ol: 80, r: E(99, 50, 30, 42), l: E(99, 0, 0, 0), rs: 3, v: 3 },
      { c: 1, ol: 50, r: E(99, 60, 30, 42), l: E(99, 0, 0, 0), rs: 3 },
      { c: 8, f: 11, ol: 72, r: E(99, 60, 32, 42), l: E(99, 0, 0, 0), rs: 3, v: 3 },
      null
    ]
  },
  {
    name: 'STEEL DRUM', cat: 'Mallets', alg: 5, fb: 1,
    ops: [
      { c: 1, ol: 98, r: E(99, 45, 30, 52), l: E(99, 0, 0, 0), rs: 2, v: 3 },
      { c: 1, ol: 76, r: E(99, 52, 30, 52), l: E(99, 30, 0, 0), rs: 2, v: 6 },
      { c: 2, ol: 84, r: E(99, 48, 30, 52), l: E(99, 0, 0, 0), rs: 2, v: 3 },
      { c: 3, f: 50, ol: 62, r: E(99, 60, 30, 52), l: E(99, 0, 0, 0), rs: 2, v: 5 },
      { c: 4, ol: 70, r: E(99, 56, 30, 52), l: E(99, 0, 0, 0), rs: 2 },
      { c: 1, ol: 60, r: E(99, 66, 30, 52), l: E(99, 0, 0, 0), rs: 2 }
    ]
  },
  // ── Strings & pads ────────────────────────────────────────────────────────
  {
    name: 'STRINGS 1', cat: 'Strings', alg: 5, fb: 6,
    ops: [
      { c: 1, ol: 86, r: E(44, 40, 30, 52), l: E(99, 95, 92, 0), d: -4 },
      { c: 1, ol: 72, r: E(40, 40, 30, 50), l: E(99, 90, 88, 0), v: 2 },
      { c: 1, ol: 86, r: E(42, 40, 30, 52), l: E(99, 95, 92, 0), d: 4 },
      { c: 1, ol: 72, r: E(40, 40, 30, 50), l: E(99, 90, 88, 0), v: 2 },
      { c: 2, ol: 76, r: E(46, 40, 30, 52), l: E(99, 95, 92, 0), d: 1 },
      { c: 1, ol: 66, r: E(42, 40, 30, 50), l: E(99, 90, 88, 0) }
    ],
    lfo: { s: 30, d: 50, pmd: 5, pms: 4 }
  },
  {
    name: 'SLOW STRGS', cat: 'Strings', alg: 2, fb: 7,
    ops: [
      { c: 1, ol: 92, r: E(32, 40, 30, 46), l: E(99, 96, 94, 0), d: 3 },
      { c: 1, ol: 76, r: E(30, 40, 30, 46), l: E(99, 90, 88, 0) },
      { c: 1, ol: 90, r: E(30, 40, 30, 46), l: E(99, 96, 94, 0), d: -3 },
      { c: 1, ol: 74, r: E(28, 40, 30, 46), l: E(99, 90, 88, 0) },
      { c: 1, ol: 60, r: E(30, 40, 30, 46), l: E(99, 90, 88, 0), d: 6 },
      { c: 1, ol: 60, r: E(30, 40, 30, 46), l: E(99, 88, 86, 0) }
    ],
    lfo: { s: 28, d: 40, pmd: 6, pms: 4 }
  },
  {
    name: 'GLASS PAD', cat: 'Pad', alg: 5, fb: 3,
    ops: [
      { c: 1, ol: 88, r: E(34, 30, 30, 44), l: E(99, 94, 92, 0), ams: 1 },
      { c: 3, ol: 64, r: E(30, 26, 30, 44), l: E(99, 80, 72, 0) },
      { c: 2, ol: 82, r: E(36, 30, 30, 44), l: E(99, 92, 90, 0), d: 4, ams: 1 },
      { c: 7, ol: 56, r: E(30, 24, 30, 44), l: E(99, 70, 60, 0) },
      { c: 1, ol: 82, r: E(32, 30, 30, 44), l: E(99, 94, 92, 0), d: -4 },
      { c: 1, ol: 62, r: E(28, 30, 30, 44), l: E(99, 86, 80, 0) }
    ],
    lfo: { s: 24, amd: 14, pmd: 3, pms: 3, w: 0 }
  },
  {
    name: 'WARM PAD', cat: 'Pad', alg: 22, fb: 4,
    ops: [
      { c: 0, ol: 86, r: E(36, 40, 30, 44), l: E(99, 96, 94, 0) },
      { c: 0, ol: 62, r: E(30, 40, 30, 44), l: E(99, 90, 86, 0) },
      { c: 1, ol: 80, r: E(34, 40, 30, 44), l: E(99, 96, 94, 0), d: -5 },
      { c: 1, ol: 80, r: E(34, 40, 30, 44), l: E(99, 96, 94, 0), d: 5 },
      { c: 2, ol: 70, r: E(34, 40, 30, 44), l: E(99, 96, 94, 0), d: 2 },
      { c: 1, ol: 68, r: E(30, 36, 30, 44), l: E(99, 86, 82, 0) }
    ],
    lfo: { s: 22, d: 30, pmd: 4, pms: 3 }
  },
  {
    name: 'CHOIR AAH', cat: 'Pad', alg: 5, fb: 3,
    ops: [
      { c: 1, ol: 90, r: E(40, 40, 30, 46), l: E(99, 96, 94, 0) },
      { c: 1, ol: 60, r: E(38, 40, 30, 46), l: E(99, 90, 86, 0) },
      { c: 3, ol: 78, r: E(36, 40, 30, 46), l: E(99, 94, 92, 0), d: 2 },
      { c: 1, ol: 58, r: E(36, 40, 30, 46), l: E(99, 90, 86, 0) },
      { c: 5, ol: 66, r: E(36, 40, 30, 46), l: E(99, 92, 90, 0), d: -2 },
      { c: 1, ol: 50, r: E(36, 40, 30, 46), l: E(99, 90, 86, 0) }
    ],
    lfo: { s: 32, d: 30, pmd: 6, pms: 3 }
  },
  {
    name: 'SPACE BELL', cat: 'Pad', alg: 7, fb: 5,
    ops: [
      { c: 1, ol: 88, r: E(50, 30, 30, 40), l: E(99, 90, 86, 0), d: 2 },
      { c: 1, ol: 64, r: E(40, 30, 30, 40), l: E(99, 88, 84, 0) },
      { c: 1, ol: 86, r: E(80, 32, 25, 40), l: E(99, 70, 50, 0), d: -2 },
      { c: 3, f: 50, ol: 62, r: E(80, 36, 26, 40), l: E(99, 60, 40, 0) },
      { c: 7, ol: 52, r: E(70, 40, 26, 40), l: E(99, 60, 40, 0) },
      { c: 1, ol: 56, r: E(60, 30, 26, 40), l: E(99, 70, 60, 0) }
    ],
    lfo: { s: 26, pmd: 3, amd: 6, pms: 2 }
  },
  // ── Leads & wind ──────────────────────────────────────────────────────────
  {
    name: 'SAW LEAD', cat: 'Lead', alg: 5, fb: 7,
    ops: [
      { c: 0, ol: 80, r: E(95, 50, 40, 70), l: E(99, 95, 92, 0) },
      { c: 0, ol: 70, r: E(95, 50, 40, 70), l: E(99, 90, 86, 0) },
      { c: 1, ol: 86, r: E(95, 50, 40, 70), l: E(99, 95, 92, 0), d: 5 },
      { c: 1, ol: 78, r: E(95, 50, 40, 70), l: E(99, 92, 88, 0) },
      { c: 1, ol: 96, r: E(95, 50, 40, 70), l: E(99, 95, 92, 0) },
      { c: 1, ol: 86, r: E(95, 50, 40, 70), l: E(99, 92, 88, 0), v: 2 }
    ],
    lfo: { s: 36, d: 50, pmd: 7, pms: 4 },
    extra: { 'master.mono': 1, 'master.porta': 25 }
  },
  {
    name: 'SQUARE LD', cat: 'Lead', alg: 5, fb: 0,
    ops: [
      { c: 1, ol: 96, r: E(95, 50, 40, 70), l: E(99, 95, 92, 0) },
      { c: 2, ol: 78, r: E(95, 50, 40, 70), l: E(99, 92, 90, 0), v: 2 },
      { c: 2, ol: 78, r: E(95, 50, 40, 70), l: E(99, 95, 92, 0), d: 3 },
      { c: 4, ol: 66, r: E(95, 50, 40, 70), l: E(99, 90, 88, 0) },
      null,
      null
    ],
    lfo: { s: 38, d: 55, pmd: 8, pms: 4 },
    extra: { 'master.mono': 1, 'master.porta': 20 }
  },
  {
    name: 'HARMONICA', cat: 'Wind', alg: 5, fb: 6,
    ops: [
      { c: 1, ol: 94, r: E(62, 40, 40, 70), l: E(99, 92, 90, 0), v: 2, ams: 1 },
      { c: 1, ol: 78, r: E(56, 40, 40, 70), l: E(99, 86, 82, 0), v: 5 },
      { c: 3, ol: 78, r: E(60, 40, 40, 70), l: E(99, 90, 88, 0), v: 2 },
      { c: 1, ol: 70, r: E(56, 40, 40, 70), l: E(99, 86, 82, 0), v: 4 },
      { c: 5, ol: 64, r: E(60, 40, 40, 70), l: E(99, 88, 86, 0) },
      { c: 1, ol: 66, r: E(58, 40, 40, 70), l: E(99, 86, 82, 0), v: 4 }
    ],
    lfo: { s: 40, d: 60, pmd: 10, amd: 6, pms: 4 },
    extra: { 'master.mono': 1, 'master.porta': 10 }
  },
  {
    name: 'FLUTE 1', cat: 'Wind', alg: 1, fb: 7,
    ops: [
      { c: 1, ol: 96, r: E(54, 40, 30, 66), l: E(99, 95, 93, 0), v: 2 },
      { c: 1, ol: 58, r: E(50, 40, 30, 66), l: E(99, 90, 86, 0), v: 4 },
      { c: 2, ol: 62, r: E(70, 50, 40, 66), l: E(99, 76, 66, 0) },
      { c: 1, ol: 48, r: E(70, 50, 40, 66), l: E(99, 80, 70, 0) },
      { c: 9, ol: 60, r: E(70, 50, 40, 66), l: E(99, 80, 70, 0) },
      { c: 14, ol: 82, r: E(70, 50, 40, 66), l: E(99, 80, 70, 0) }
    ],
    lfo: { s: 36, d: 60, pmd: 7, pms: 4 }
  },
  {
    name: 'KOTO PLUCK', cat: 'Pluck', alg: 5, fb: 5,
    ops: [
      { c: 1, ol: 98, r: E(99, 45, 28, 62), l: E(99, 84, 0, 0), rs: 3, v: 3 },
      { c: 3, ol: 78, r: E(99, 70, 40, 62), l: E(99, 40, 0, 0), rs: 3, v: 6 },
      { c: 1, ol: 84, r: E(99, 48, 30, 62), l: E(99, 80, 0, 0), rs: 3, d: 3 },
      { c: 1, ol: 80, r: E(99, 78, 40, 62), l: E(99, 30, 0, 0), rs: 3, v: 6 },
      { c: 2, ol: 70, r: E(99, 55, 30, 62), l: E(99, 0, 0, 0), rs: 3 },
      { c: 1, ol: 70, r: E(99, 70, 40, 62), l: E(99, 0, 0, 0), rs: 3 }
    ]
  },
  // ── Drums & FX (fixed-frequency operators + pitch EG) ─────────────────────
  {
    name: 'FM KICK', cat: 'Drums', alg: 5, fb: 0,
    ops: [
      { c: 1, f: 74, fx: true, ol: 99, r: E(99, 60, 50, 70), l: E(99, 0, 0, 0), v: 3 },
      { c: 2, f: 4, fx: true, ol: 72, r: E(99, 85, 50, 70), l: E(99, 0, 0, 0), v: 5 },
      null, null, null, null
    ],
    peg: { r: E(84, 99, 99, 99), l: E(50, 50, 50, 82) },
    oks: 1
  },
  {
    name: 'FM SNARE', cat: 'Drums', alg: 5, fb: 7,
    ops: [
      { c: 2, f: 26, fx: true, ol: 92, r: E(99, 68, 50, 72), l: E(99, 0, 0, 0), v: 3 },
      { c: 2, f: 52, fx: true, ol: 66, r: E(99, 80, 50, 72), l: E(99, 0, 0, 0) },
      null,
      null,
      { c: 3, f: 8, fx: true, ol: 88, r: E(99, 70, 50, 72), l: E(99, 0, 0, 0), v: 3 },
      { c: 3, f: 32, fx: true, ol: 99, r: E(99, 70, 50, 72), l: E(99, 40, 0, 0) }
    ],
    peg: { r: E(90, 99, 99, 99), l: E(50, 50, 50, 60) }
  },
  {
    name: 'FM HIHAT', cat: 'Drums', alg: 5, fb: 7,
    ops: [
      null,
      null,
      { c: 3, f: 85, fx: true, ol: 80, r: E(99, 80, 60, 80), l: E(99, 0, 0, 0), v: 4 },
      { c: 3, f: 62, fx: true, ol: 99, r: E(99, 80, 60, 80), l: E(99, 60, 0, 0) },
      { c: 3, f: 90, fx: true, ol: 82, r: E(99, 78, 60, 80), l: E(99, 0, 0, 0), v: 4 },
      { c: 3, f: 75, fx: true, ol: 99, r: E(99, 78, 60, 80), l: E(99, 60, 0, 0) }
    ]
  },
  {
    name: 'TOM DROP', cat: 'Drums', alg: 5, fb: 0,
    ops: [
      { c: 0, ol: 99, r: E(99, 55, 50, 66), l: E(99, 0, 0, 0), v: 3 },
      { c: 0, ol: 62, r: E(99, 75, 50, 66), l: E(99, 0, 0, 0), v: 4 },
      null, null, null, null
    ],
    peg: { r: E(70, 99, 99, 99), l: E(46, 46, 46, 62) }
  },
  {
    name: 'INIT VOICE', cat: 'Init', alg: 1, fb: 0,
    ops: [{ c: 1, ol: 99, r: E(99, 99, 99, 99), l: E(99, 99, 99, 0) }, null, null, null, null, null],
    lfo: { s: 35, sync: 1, w: 0 }
  }
]

export interface FactoryVoice {
  name: string
  category: string
  voice: Uint8Array
  extra?: Record<string, number>
}

export const FACTORY: FactoryVoice[] = SPECS.map((s) => ({ name: s.name.toUpperCase(), category: s.cat, voice: compile(s), extra: s.extra }))
