// Hexa FM engine: DX7-style envelopes, pitch EG and the 6-operator voice.
// Units follow the DX7/msfa model: envelope levels are in "doublings" (log2 amplitude, 1.0 = 6.02 dB),
// operator outputs are in cycles of phase deviation (full output level ≈ 2 cycles ≈ 4π rad).
// Everything here is allocation-free after construction (AudioWorklet safe).
import { AMS_TAB, ALGORITHMS, PITCHENV_RATE, PITCHENV_TAB, type Algorithm, scaleLevel, scaleOutLevel, scaleRate, scaleVelocity } from './tables'
import { G, O, opOff } from './voice'
import type { VoiceLike } from '../sdk/dsp'

/** Control-rate block: envelopes, LFO and pitch are updated every CHUNK samples (msfa uses 64 @ 44.1k). */
export const CHUNK = 32

const SIN_BITS = 12
const SIN_N = 1 << SIN_BITS
const FRAC_SHIFT = 32 - SIN_BITS
const FRAC_MASK = (1 << FRAC_SHIFT) - 1
const FRAC_SCALE = 1 / (1 << FRAC_SHIFT)
const TWO32 = 4294967296

/** Clean sine (interpolated 4096-point table). */
export const SIN_CLEAN = new Float32Array(SIN_N + 1)
/** "Vintage" sine: 1024 steps per cycle, 12-bit amplitude (DX7 OPS-chip resolution). */
export const SIN_VINTAGE = new Float32Array(SIN_N + 1)
for (let i = 0; i <= SIN_N; i++) {
  SIN_CLEAN[i] = Math.sin((2 * Math.PI * i) / SIN_N)
  const j = (i >> 2) << 2
  SIN_VINTAGE[i] = Math.round(Math.sin((2 * Math.PI * j) / SIN_N) * 2047) / 2047
}

const JUMP = 1716 / 256 // attack starts here (≈ -44 dB below full scale)

/** DX7 operator envelope (4 rates / 4 levels). */
export class Env {
  level = 0
  target = 0
  inc = 0
  ix = 4
  down = false
  rising = false
  readonly r = [99, 99, 99, 99]
  readonly l = [99, 99, 99, 0]
  outlevel = 0
  rs = 0
  private k: number
  constructor(sampleRate: number) {
    this.k = 44100 / sampleRate / 64 / 16777216
  }
  /** retrigger=true keeps the current level (no click on voice steal / legato retrigger). */
  init(patch: ArrayLike<number>, base: number, outlevel: number, rs: number, retrigger: boolean): void {
    this.set(patch, base, outlevel, rs)
    if (!retrigger) this.level = 0
    this.down = true
    this.advance(0)
  }
  /** Live update of rates/levels/output level without restarting. */
  update(patch: ArrayLike<number>, base: number, outlevel: number, rs: number): void {
    this.set(patch, base, outlevel, rs)
    if (this.ix < 4) {
      const lvl = this.level
      this.advance(this.ix)
      this.level = lvl
      this.rising = this.target > lvl
    }
  }
  private set(patch: ArrayLike<number>, base: number, outlevel: number, rs: number): void {
    for (let i = 0; i < 4; i++) {
      this.r[i] = patch[base + O.r1 + i]
      this.l[i] = patch[base + O.l1 + i]
    }
    this.outlevel = outlevel
    this.rs = rs
  }
  private advance(ix: number): void {
    this.ix = ix
    if (ix < 4) {
      let actual = ((scaleOutLevel(this.l[ix]) >> 1) << 6) + this.outlevel - 4256
      if (actual < 16) actual = 16
      this.target = actual / 256
      this.rising = this.target > this.level
      const q = Math.min(63, ((this.r[ix] * 41) >> 6) + this.rs)
      this.inc = (4 + (q & 3)) * Math.pow(2, 8 + (q >> 2)) * this.k
    }
  }
  /** Advance by n samples; returns the level in doublings. */
  step(n: number): number {
    if (this.ix < 3 || (this.ix < 4 && !this.down)) {
      if (this.rising) {
        if (this.level < JUMP) this.level = JUMP
        this.level += Math.max(1, Math.floor(17 - this.level)) * this.inc * n
        if (this.level >= this.target) {
          this.level = this.target
          this.advance(this.ix + 1)
        }
      } else {
        this.level -= this.inc * n
        if (this.level <= this.target) {
          this.level = this.target
          this.advance(this.ix + 1)
        }
      }
    }
    return this.level
  }
  keyup(): void {
    if (this.down) {
      this.down = false
      this.advance(3)
    }
  }
}

/** DX7 pitch envelope. level in octaves. */
export class PitchEnv {
  level = 0
  target = 0
  inc = 0
  ix = 4
  down = false
  rising = false
  readonly r = [99, 99, 99, 99]
  readonly l = [50, 50, 50, 50]
  private k: number
  constructor(sampleRate: number) {
    this.k = 1 / (21.3 * sampleRate)
  }
  private set(patch: ArrayLike<number>): void {
    for (let i = 0; i < 4; i++) {
      this.r[i] = patch[G.pr1 + i]
      this.l[i] = patch[G.pl1 + i]
    }
  }
  init(patch: ArrayLike<number>): void {
    this.set(patch)
    this.level = PITCHENV_TAB[this.l[3]] / 32
    this.down = true
    this.advance(0)
  }
  update(patch: ArrayLike<number>): void {
    this.set(patch)
    if (this.ix < 4) {
      const lvl = this.level
      this.advance(this.ix)
      this.level = lvl
      this.rising = this.target > lvl
    }
  }
  private advance(ix: number): void {
    this.ix = ix
    if (ix < 4) {
      this.target = PITCHENV_TAB[this.l[ix]] / 32
      this.rising = this.target > this.level
      this.inc = PITCHENV_RATE[this.r[ix]] * this.k
    }
  }
  step(n: number): number {
    if (this.ix < 3 || (this.ix < 4 && !this.down)) {
      if (this.rising) {
        this.level += this.inc * n
        if (this.level >= this.target) {
          this.level = this.target
          this.advance(this.ix + 1)
        }
      } else {
        this.level -= this.inc * n
        if (this.level <= this.target) {
          this.level = this.target
          this.advance(this.ix + 1)
        }
      }
    }
    return this.level
  }
  keyup(): void {
    if (this.down) {
      this.down = false
      this.advance(3)
    }
  }
}

const LOG2_440 = Math.log2(440)
const LOG2_10 = Math.log2(10)
export const noteToLog2 = (note: number): number => LOG2_440 + (note - 69) / 12

/** Operator frequency offset in octaves: relative to the note for ratio mode, absolute log2(Hz) for fixed mode. */
export function opFreqOffset(patch: ArrayLike<number>, n: number, noteLog: number): { fixed: boolean; ofs: number } {
  const b = opOff(n)
  const coarse = patch[b + O.coarse]
  const fine = patch[b + O.fine]
  const det = patch[b + O.det]
  if (patch[b + O.mode]) {
    return { fixed: true, ofs: LOG2_10 * ((coarse & 3) + fine / 100) + (det > 7 ? (13457 * (det - 7)) / 16777216 : 0) }
  }
  let ofs = Math.log2(coarse === 0 ? 0.5 : coarse)
  if (fine) ofs += Math.log2(1 + 0.01 * fine)
  ofs += ((0.0209 * Math.exp(-0.396 * noteLog)) / 7) * noteLog * (det - 7)
  return { fixed: false, ofs }
}

/** Shared per-chunk modulation state computed by the synth for all voices. */
export interface ModState {
  /** LFO value 0..1 */
  lfo: number
  /** LFO delay ramp 0..1 */
  delay: number
  /** pitch bend in octaves */
  bend: number
  /** pitch-mod depth from LFO PMD (0..127) */
  pmd: number
  /** amp-mod depth from LFO AMD (0..127) */
  amd: number
  /** mod wheel range (0..127) and destinations */
  wheelRange: number
  wheelPitch: boolean
  wheelAmp: boolean
  wheel: number
  pms: number
  /** 6 op enable switches */
  opOn: Uint8Array
  tab: Float32Array
  sampleRate: number
}

export class Voice implements VoiceLike {
  active = false
  releasing = false
  noteId = -1
  key = 60
  age = 0
  /** transposed MIDI note */
  note = 60
  vel = 100
  pan = 0
  gl = 1
  gr = 1
  wheel = 0
  bright = 0
  /** current / target pitch of the note (log2 Hz) for portamento */
  pitch = 0
  target = 0
  glideCoef = 0
  readonly env: Env[]
  readonly peg: PitchEnv
  readonly phase = new Int32Array(6)
  readonly inc = new Int32Array(6)
  readonly g0 = new Float64Array(6)
  readonly g1 = new Float64Array(6)
  readonly ofs = new Float64Array(6)
  readonly fixed = new Uint8Array(6)
  readonly ams = new Float64Array(6)
  readonly out: Float32Array[]
  /** mono voice output for the current chunk */
  readonly buf = new Float32Array(CHUNK)
  private readonly modSum = new Float32Array(CHUNK)
  private fb0 = 0
  private fb1 = 0
  alg: Algorithm = ALGORITHMS[0]
  fbShift = 0
  constructor(private sr: number) {
    this.env = Array.from({ length: 6 }, () => new Env(sr))
    this.peg = new PitchEnv(sr)
    this.out = Array.from({ length: 6 }, () => new Float32Array(CHUNK))
  }

  private applyPatch(patch: ArrayLike<number>, start: boolean, retrigger: boolean): void {
    this.alg = ALGORITHMS[patch[G.alg] & 31]
    const fb = patch[G.fb] & 7
    this.fbShift = fb ? Math.pow(2, fb - 9) * TWO32 : 0
    const noteLog = noteToLog2(this.note)
    for (let i = 0; i < 6; i++) {
      const n = i + 1
      const b = opOff(n)
      let outlevel = scaleOutLevel(patch[b + O.ol])
      outlevel += scaleLevel(this.note, patch[b + O.bp], patch[b + O.ld], patch[b + O.rd], patch[b + O.lc], patch[b + O.rc])
      outlevel = Math.min(127, outlevel) << 5
      outlevel += scaleVelocity(this.vel, patch[b + O.kvs])
      outlevel = Math.max(0, outlevel)
      const rs = scaleRate(this.note, patch[b + O.rs])
      if (start) this.env[i].init(patch, b, outlevel, rs, retrigger)
      else this.env[i].update(patch, b, outlevel, rs)
      const f = opFreqOffset(patch, n, noteLog)
      this.fixed[i] = f.fixed ? 1 : 0
      this.ofs[i] = f.ofs
      this.ams[i] = AMS_TAB[patch[b + O.ams] & 3] * 16
    }
    if (start) this.peg.init(patch)
    else this.peg.update(patch)
  }

  start(patch: ArrayLike<number>, note: number, vel: number, retrigger: boolean, oks: boolean): void {
    this.note = note
    this.vel = vel
    this.applyPatch(patch, true, retrigger)
    if (oks || !retrigger) {
      this.phase.fill(0)
      this.fb0 = this.fb1 = 0
    }
    if (!retrigger) {
      this.g0.fill(0)
      this.g1.fill(0)
    }
  }

  /** Patch edited while sounding. */
  refresh(patch: ArrayLike<number>): void {
    this.applyPatch(patch, false, true)
  }

  /** Legato / slide: change the note without retriggering envelopes. */
  setNote(patch: ArrayLike<number>, note: number): void {
    this.note = note
    this.applyPatch(patch, false, true)
  }

  keyup(): void {
    for (let i = 0; i < 6; i++) this.env[i].keyup()
    this.peg.keyup()
  }

  kill(): void {
    this.active = false
    this.releasing = false
    for (let i = 0; i < 6; i++) {
      this.env[i].level = 0
      this.env[i].ix = 4
    }
    this.g0.fill(0)
    this.g1.fill(0)
  }

  /** Render n (≤ CHUNK) samples into this.buf. Returns false when the voice has finished. */
  render(n: number, m: ModState): boolean {
    const sr = this.sr
    // ── pitch ──
    if (this.glideCoef > 0) this.pitch = this.target + (this.pitch - this.target) * Math.pow(this.glideCoef, n)
    else this.pitch = this.target
    const pegv = this.peg.step(n)
    const wheel = this.wheel > m.wheel ? this.wheel : m.wheel
    const lfoBi = m.lfo - 0.5
    let depth = m.pmd * m.delay
    if (m.wheelPitch) {
      const w = m.wheelRange * wheel
      if (w > depth) depth = w
    }
    const pmod = (depth * m.pms * lfoBi) / 32768
    const pitchBase = pegv
    const pitchMod = pegv + pmod + m.bend
    // ── amp mod ──
    const inv = 1 - m.lfo
    let amod = (m.amd * m.delay * inv) / 256
    if (m.wheelAmp) {
      const w = (m.wheelRange * wheel * inv) / 256
      if (w > amod) amod = w
    }
    const toInc = TWO32 / sr
    const alg = this.alg
    for (let i = 0; i < 6; i++) {
      const lf = this.fixed[i] ? this.ofs[i] + pitchBase : this.ofs[i] + this.pitch + pitchMod
      this.inc[i] = (Math.pow(2, lf) * toInc) | 0
      let lvl = this.env[i].step(n) - amod * this.ams[i]
      if (!alg.carriers[i]) lvl += this.bright
      this.g0[i] = this.g1[i]
      this.g1[i] = m.opOn[i] && lvl > 0.5 ? Math.pow(2, lvl - 14) : 0
    }
    if (alg.fbFrom !== alg.fbTo) this.renderLoop(n, m.tab)
    else this.renderBlock(n, m.tab)
    // ── mix carriers ──
    const buf = this.buf
    buf.fill(0, 0, n)
    let done = this.releasing
    for (let i = 0; i < 6; i++) {
      if (!alg.carriers[i]) continue
      const o = this.out[i]
      for (let k = 0; k < n; k++) buf[k] += o[k]
      if (done) {
        const e = this.env[i]
        if (m.opOn[i] && (e.level > 1.5 || (e.ix < 4 && e.target > e.level))) done = false
      }
    }
    return !done
  }

  private renderBlock(n: number, tab: Float32Array): void {
    const alg = this.alg
    const fbOp = this.fbShift ? alg.fbTo : -1
    for (let op = 5; op >= 0; op--) {
      const buf = this.out[op]
      let ph = this.phase[op]
      const inc = this.inc[op]
      const g0 = this.g0[op]
      const g1 = this.g1[op]
      if (g0 < 1e-7 && g1 < 1e-7) {
        buf.fill(0, 0, n)
        this.phase[op] = (ph + inc * n) | 0
        if (op === fbOp) this.fb0 = this.fb1 = 0
        continue
      }
      const dg = (g1 - g0) / n
      let g = g0
      const mods = alg.mods[op]
      if (op === fbOp) {
        const fs = this.fbShift
        let y0 = this.fb0
        let y = this.fb1
        for (let i = 0; i < n; i++) {
          g += dg
          const t = (ph + (y0 + y) * fs) | 0
          y0 = y
          const idx = t >>> FRAC_SHIFT
          const a = tab[idx]
          y = (a + (tab[idx + 1] - a) * (t & FRAC_MASK) * FRAC_SCALE) * g
          buf[i] = y
          ph = (ph + inc) | 0
        }
        this.fb0 = y0
        this.fb1 = y
      } else if (mods.length === 0) {
        for (let i = 0; i < n; i++) {
          g += dg
          const idx = ph >>> FRAC_SHIFT
          const a = tab[idx]
          buf[i] = (a + (tab[idx + 1] - a) * (ph & FRAC_MASK) * FRAC_SCALE) * g
          ph = (ph + inc) | 0
        }
      } else {
        let src: Float32Array
        if (mods.length === 1) src = this.out[mods[0]]
        else {
          src = this.modSum
          const a0 = this.out[mods[0]]
          const a1 = this.out[mods[1]]
          for (let i = 0; i < n; i++) src[i] = a0[i] + a1[i]
          for (let k = 2; k < mods.length; k++) {
            const ak = this.out[mods[k]]
            for (let i = 0; i < n; i++) src[i] += ak[i]
          }
        }
        for (let i = 0; i < n; i++) {
          g += dg
          const t = (ph + src[i] * TWO32) | 0
          const idx = t >>> FRAC_SHIFT
          const a = tab[idx]
          buf[i] = (a + (tab[idx + 1] - a) * (t & FRAC_MASK) * FRAC_SCALE) * g
          ph = (ph + inc) | 0
        }
      }
      this.phase[op] = ph
    }
  }

  /** Per-sample path for algorithms 4 and 6, whose feedback loop spans several operators. */
  private renderLoop(n: number, tab: Float32Array): void {
    const alg = this.alg
    const from = alg.fbFrom
    const to = alg.fbTo
    const fs = this.fbShift
    const out = this.out
    const g = this.g0
    const dg = this.modSum // reuse as 6-element scratch
    for (let op = 0; op < 6; op++) dg[op] = (this.g1[op] - this.g0[op]) / n
    let y0 = this.fb0
    let y = this.fb1
    for (let i = 0; i < n; i++) {
      for (let op = 5; op >= 0; op--) {
        g[op] += dg[op]
        const mods = alg.mods[op]
        let mod = 0
        for (let k = 0; k < mods.length; k++) mod += out[mods[k]][i]
        let t = this.phase[op] + mod * TWO32
        if (op === to && fs) t += (y0 + y) * fs
        const ti = t | 0
        const idx = ti >>> FRAC_SHIFT
        const a = tab[idx]
        out[op][i] = (a + (tab[idx + 1] - a) * (ti & FRAC_MASK) * FRAC_SCALE) * g[op]
        this.phase[op] = (this.phase[op] + this.inc[op]) | 0
      }
      y0 = y
      y = out[from][i]
    }
    this.fb0 = y0
    this.fb1 = y
    for (let op = 0; op < 6; op++) g[op] = this.g1[op]
  }
}
