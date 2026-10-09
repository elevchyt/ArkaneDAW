// Organ Part: one shared generator bank (91 "tonewheels") for the whole part — each key just
// adds drawbar-weighted gain to the wheels it's wired to, so cost is independent of polyphony.
// Tonewheel (B3: drawbars, single-trigger percussion, key click, leakage, scanner vibrato/chorus,
// tube overdrive, rotary speaker w/ separate horn & drum acceleration), Pipe (principal ranks,
// slow speech + chiff) and Combo (Farfisa-ish bright divide-down tones).
import type { NoteOn } from '../../sdk/types'
import { Biquad } from '../../sdk/dsp'
import { CHUNK, Noise, Reson, TAU, asymSat, clamp, type Mods, type PartEngine, type PartParams } from './common'

const WHEELS = 91
const FIRST = 24 // MIDI note of wheel 0 (C1)
const OFFS = [-12, 7, 0, 12, 19, 24, 28, 31, 36] // drawbar footages in semitones vs 8'
const TBL = 2048
const LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32]

/** Harmonic recipes per variant. */
function harmonics(variant: number, h: number): number {
  if (variant === 0) return h === 1 ? 1 : h === 3 ? 0.02 : h === 2 ? 0.01 : 0
  if (variant === 1) return [0, 1, 0.42, 0.24, 0.12, 0.09, 0.05, 0.04, 0.02][h] ?? 0.012 / h
  // combo: bright square/saw blend
  return (h & 1 ? 1 / h : 0.45 / h) * (h === 1 ? 1 : 0.95)
}

const tables: Float32Array[][] = [] // [variant][level]
function getTables(variant: number): Float32Array[] {
  if (!tables[variant]) {
    tables[variant] = LEVELS.map((H) => {
      const t = new Float32Array(TBL + 1)
      let peak = 0
      for (let i = 0; i < TBL; i++) {
        let s = 0
        for (let h = 1; h <= H; h++) {
          const a = harmonics(variant, h)
          if (a) s += a * Math.sin((TAU * h * i) / TBL)
        }
        t[i] = s
        peak = Math.max(peak, Math.abs(s))
      }
      for (let i = 0; i < TBL; i++) t[i] /= peak || 1
      t[TBL] = t[0]
      return t
    })
  }
  return tables[variant]
}

class Transient {
  env = 0
  dec = 0
  lvl = 0
  f = new Reson()
}

export class OrganPart implements PartEngine {
  private p: PartParams = {}
  private variant = -1
  private tbl: Float32Array[] = []
  private wheelTbl = new Int8Array(WHEELS)
  private inc = new Float64Array(WHEELS)
  private phase = new Float64Array(WHEELS)
  private gain = new Float64Array(WHEELS)
  private target = new Float64Array(WHEELS)
  // keys
  private keyOn = new Uint8Array(128)
  private keyEnv = new Float64Array(128)
  private keyId = new Float64Array(128).fill(-1)
  private keyPerc = new Uint8Array(128)
  private keyModY = new Float64Array(128)
  private held = 0
  private percEnv = 0
  private percAge = 0
  // transients (click/chiff)
  private tr: Transient[] = Array.from({ length: 12 }, () => new Transient())
  private trNext = 0
  private noise = new Noise(777)
  // vibrato scanner
  private vbuf = new Float32Array(1024)
  private vw = 0
  private vph = 0
  // rotary
  private xLP: Biquad
  private xHP: Biquad
  private cab: Biquad
  private hbuf = new Float32Array(2048)
  private hw = 0
  private hornAng = 0
  private drumAng = 0
  private hornSpd = 0.8
  private drumSpd = 0.67
  private mono = new Float32Array(CHUNK)
  private dbAmp = new Float64Array(9)

  constructor(private sr: number) {
    this.xLP = new Biquad(sr)
    this.xHP = new Biquad(sr)
    this.cab = new Biquad(sr)
    this.xLP.set('lp', 800, 0.707)
    this.xHP.set('hp', 800, 0.707)
    this.cab.set('lp', 6500, 0.6)
    for (let w = 0; w < WHEELS; w++) {
      // tonewheel gearing isn't perfectly equal-tempered: tiny fixed deviations
      const dev = (Math.sin(w * 7.31) * 0.6) / 1200
      this.inc[w] = (440 * Math.pow(2, (FIRST + w - 69) / 12 + dev)) / sr
      this.phase[w] = (w * 0.618) % 1
    }
  }

  update(p: PartParams): void {
    this.p = p
    const v = clamp(p.variant | 0, 0, 2)
    if (v !== this.variant) {
      this.variant = v
      this.tbl = getTables(v)
      for (let w = 0; w < WHEELS; w++) {
        const f = this.inc[w] * this.sr
        let lvl = 0
        for (let k = 0; k < LEVELS.length; k++) if (f * LEVELS[k] < Math.min(16000, this.sr * 0.45)) lvl = k
        this.wheelTbl[w] = lvl
      }
    }
    for (let d = 0; d < 9; d++) {
      const db = p[`db${d + 1}`] ?? 0
      this.dbAmp[d] = db <= 0 ? 0 : Math.pow(10, (-(8 - db) * 3) / 20)
    }
  }

  active(): number {
    if (this.held > 0) return this.held
    for (let k = 0; k < 128; k++) if (this.keyEnv[k] > 1e-4) return 1
    for (const t of this.tr) if (t.env > 1e-4) return 1
    return 0
  }

  private spawn(freq: number, bw: number, lvl: number, ms: number): void {
    const t = this.tr[this.trNext]
    this.trNext = (this.trNext + 1) % this.tr.length
    t.f.reset()
    t.f.set(freq, bw, this.sr)
    t.env = 1
    t.lvl = lvl
    t.dec = Math.exp(-1 / (this.sr * ms * 0.001))
  }

  noteOn(n: NoteOn, key: number): void {
    const k = clamp(key, 0, 127)
    if (!this.keyOn[k]) this.held++
    this.keyOn[k] = 1
    this.keyId[k] = n.id
    this.keyModY[k] = n.modY
    const v = this.variant
    // single-trigger percussion: retriggers only when no other key is held; keys struck together
    // with the trigger (within ~30 ms, i.e. a chord) share it
    if (this.held === 1) {
      this.percEnv = 1
      this.percAge = 0
      this.keyPerc.fill(0)
    }
    this.keyPerc[k] = this.percAge < 0.03 ? 1 : 0
    const f = 440 * Math.pow(2, (k - 69) / 12)
    if (v === 0) {
      const c = this.p.click
      if (c > 0) this.spawn(1800 + Math.random() * 2500, 2500, c * 0.5, 2.5 + Math.random() * 2)
    } else if (v === 1) {
      this.spawn(clamp(f * 3, 200, 6000), clamp(f, 150, 1500), 0.25 * (0.3 + this.p.click), 45)
    } else if (this.p.click > 0) this.spawn(3000, 3000, this.p.click * 0.2, 1.5)
  }

  noteOff(id: number): void {
    for (let k = 0; k < 128; k++)
      if (this.keyOn[k] && this.keyId[k] === id) {
        this.keyOn[k] = 0
        this.keyId[k] = -1
        this.held = Math.max(0, this.held - 1)
        if (this.variant === 0 && this.p.click > 0) this.spawn(2500 + Math.random() * 2000, 3000, this.p.click * 0.18, 2)
      }
  }

  allOff(hard: boolean): void {
    this.keyOn.fill(0)
    this.keyId.fill(-1)
    this.held = 0
    if (hard) {
      this.keyEnv.fill(0)
      this.gain.fill(0)
      this.target.fill(0)
      for (const t of this.tr) t.env = 0
      this.hbuf.fill(0)
      this.vbuf.fill(0)
    }
  }

  render(L: Float32Array, R: Float32Array, n: number, m: Mods): void {
    for (let off = 0; off < n; off += CHUNK) this.chunk(L, R, off, Math.min(CHUNK, n - off), m)
  }

  private chunk(L: Float32Array, R: Float32Array, off: number, len: number, m: Mods): void {
    const p = this.p
    const sr = this.sr
    const v = this.variant
    const dt = len / sr
    // key envelopes (speech time per variant)
    const atk = v === 1 ? 0.06 : v === 2 ? 0.004 : 0.0015
    const rel = v === 1 ? 0.12 : v === 2 ? 0.02 : 0.008
    const ka = 1 - Math.exp(-dt / atk)
    const kr = 1 - Math.exp(-dt / rel)
    // percussion
    const perc = p.perc | 0
    const percT = p.percFast >= 0.5 ? 0.2 : 0.9 // T60-ish
    this.percAge += dt
    if (this.percEnv > 0) this.percEnv *= Math.exp((-6.9 * dt) / percT)
    if (this.percEnv < 1e-4) this.percEnv = 0
    const percLvl = v === 0 && perc > 0 ? (p.percSoft >= 0.5 ? 0.5 : 1) : 0
    const db = this.dbAmp
    // drawbar 1' is cancelled while percussion is on (B3 behaviour); normal perc volume ducks the manual
    const cancel9 = percLvl > 0 ? 0 : 1
    const manual = percLvl > 0 && p.percSoft < 0.5 ? 0.7 : 1
    const leak = p.leak * 0.012
    const target = this.target
    target.fill(0)
    let anyFast = false
    for (let k = 0; k < 128; k++) {
      const on = this.keyOn[k]
      let e = this.keyEnv[k]
      if (on) e += (1 - e) * ka
      else if (e > 0) {
        e -= e * kr
        if (e < 1e-4) e = 0
      }
      this.keyEnv[k] = e
      if (e <= 0) continue
      if (on && this.keyModY[k] > 0.75) anyFast = true
      for (let d = 0; d < 9; d++) {
        let a = db[d] * (d === 8 ? cancel9 : 1)
        if (a <= 0) continue
        let mm = k + OFFS[d]
        while (mm < FIRST) mm += 12
        while (mm >= FIRST + WHEELS) mm -= 12
        const w = mm - FIRST
        a *= e * manual
        target[w] += a
        if (leak > 0) {
          if (w + 12 < WHEELS) target[w + 12] += a * leak
          if (w - 7 >= 0) target[w - 7] += a * leak * 0.7
        }
      }
      if (percLvl > 0 && this.keyPerc[k] && this.percEnv > 0) {
        let mm = k + (perc === 1 ? 12 : 19)
        while (mm >= FIRST + WHEELS) mm -= 12
        target[mm - FIRST] += this.percEnv * percLvl * 0.9 * e
      }
    }
    // render wheels with per-chunk linear gain ramps
    const out = this.mono
    out.fill(0, 0, len)
    const tbl = this.tbl
    const gain = this.gain
    const scale = 0.06
    const bend = Math.pow(2, (m.bend + (p.fine ?? 0) / 100) / 12)
    for (let w = 0; w < WHEELS; w++) {
      const g0 = gain[w]
      const g1 = target[w] * scale
      if (g0 === 0 && g1 === 0) continue
      gain[w] = g1 < 1e-7 ? 0 : g1
      const t = tbl[this.wheelTbl[w]]
      const inc = this.inc[w] * bend
      const dg = (g1 - g0) / len
      let ph = this.phase[w]
      let g = g0
      for (let i = 0; i < len; i++) {
        const x = ph * TBL
        const j = x | 0
        const a = t[j]
        out[i] += (a + (t[j + 1] - a) * (x - j)) * g
        g += dg
        ph += inc
        if (ph >= 1) ph -= 1
      }
      this.phase[w] = ph
    }
    // keep idle wheels spinning so phases stay free-running
    for (let w = 0; w < WHEELS; w++) {
      if (gain[w] === 0 && target[w] === 0) {
        const ph = this.phase[w] + this.inc[w] * len
        this.phase[w] = ph - Math.floor(ph)
      }
    }
    // transients
    for (const t of this.tr) {
      if (t.env < 1e-4) continue
      for (let i = 0; i < len; i++) {
        out[i] += t.f.process(this.noise.next()) * t.env * t.lvl
        t.env *= t.dec
      }
    }
    // scanner vibrato / chorus
    const vib = p.vib | 0
    if (vib > 0) {
      const depthMs = [0, 0.25, 0.5, 0.9, 0.25, 0.5, 0.9][vib]
      const chorus = vib >= 4
      const depth = (depthMs / 1000) * sr
      const inc = 6.9 / sr
      let ph = this.vph
      const buf = this.vbuf
      for (let i = 0; i < len; i++) {
        buf[this.vw] = out[i]
        const d = 2 + depth * (1 + Math.sin(TAU * ph))
        const di = d | 0
        const fr = d - di
        const a = buf[(this.vw - di) & 1023]
        const b = buf[(this.vw - di - 1) & 1023]
        const y = a + (b - a) * fr
        out[i] = chorus ? (out[i] + y) * 0.6 : y
        this.vw = (this.vw + 1) & 1023
        ph += inc
        if (ph >= 1) ph -= 1
      }
      this.vph = ph
    }
    // overdrive (tube preamp)
    const drive = clamp(p.drive + m.drive, 0, 1)
    if (drive > 0.01 || v === 0) {
      const g = 1 + drive * drive * 14
      const comp = 1 / (1 + drive * 1.6)
      for (let i = 0; i < len; i++) out[i] = asymSat(out[i] * g, 0.15) * comp
    }
    // rotary speaker
    if (p.rotary >= 0.5) {
      const fast = m.rotaryFast >= 0.5 || anyFast
      const ht = fast ? 6.8 : 0.8
      const dtg = fast ? 5.9 : 0.67
      this.hornSpd += (ht - this.hornSpd) * (1 - Math.exp(-dt / (fast ? 0.35 : 0.7)))
      this.drumSpd += (dtg - this.drumSpd) * (1 - Math.exp(-dt / (fast ? 1.8 : 2.6)))
      const hInc = this.hornSpd / sr
      const dInc = this.drumSpd / sr
      const hDepth = 0.00042 * sr
      const base = 0.0012 * sr + hDepth
      const hm = clamp(p.hornMix, 0, 1)
      const hb = this.hbuf
      for (let i = 0; i < len; i++) {
        const x = out[i]
        const lo = this.xLP.process(x)
        const hi = this.cab.process(this.xHP.process(x))
        hb[this.hw] = hi
        const hc = Math.cos(TAU * this.hornAng)
        const dc = Math.cos(TAU * this.drumAng)
        // horn: doppler (delay ∝ -cos) + AM toward each mic (mics 180° apart)
        const dl = base - hDepth * hc
        const dr = base + hDepth * hc
        const il = dl | 0
        const ir = dr | 0
        const al = hb[(this.hw - il) & 2047]
        const hl = al + (hb[(this.hw - il - 1) & 2047] - al) * (dl - il)
        const ar = hb[(this.hw - ir) & 2047]
        const hr = ar + (hb[(this.hw - ir - 1) & 2047] - ar) * (dr - ir)
        this.hw = (this.hw + 1) & 2047
        const hornL = hl * (1 + 0.45 * hc)
        const hornR = hr * (1 - 0.45 * hc)
        const drumL = lo * (1 + 0.3 * dc)
        const drumR = lo * (1 - 0.3 * dc)
        L[off + i] += (hornL * hm + drumL * (1 - hm)) * 1.4
        R[off + i] += (hornR * hm + drumR * (1 - hm)) * 1.4
        this.hornAng += hInc
        if (this.hornAng >= 1) this.hornAng -= 1
        this.drumAng += dInc
        if (this.drumAng >= 1) this.drumAng -= 1
      }
    } else {
      for (let i = 0; i < len; i++) {
        L[off + i] += out[i]
        R[off + i] += out[i]
      }
    }
  }
}
