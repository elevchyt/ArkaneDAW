// Bassline DSP: every kind of bass in one instrument.
// Engines: Analog (2 osc + unison + noise), Acid 303 (diode ladder + accent circuit + slide), 4-op FM,
// Growl (morphing/sync/fold/FM osc + formant filter + tempo-synced wobble), 808/Sub (pitch-env sine), Physical
// (waveguide bass strings). Common: ladder/diode/SVF filter, filter & amp envelopes, LFO, sub-octave layer,
// drive, mono/legato/poly voicing with glide, FL slide notes, output EQ + punch + low-mono chorus.
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { Osc } from '../sdk/dsp'
import { BassFilter, BP, Env, sat, sin1 } from './filters'
import { BassString, type StringParams } from './physical'
import { OutputFX } from './fx'
import { ENG, LFO_SYNC_BEATS, PARAMS } from './params'

const CR = 8 // control-rate interval (samples)
const MAXN = 256 // internal render chunk
const NVOICES = 12
const ENGINE_GAIN = [0.42, 0.5, 0.6, 0.5, 0.72, 0.5]
const OSC_SHAPE = [2, 3, 3, 1, 0] // Saw, Square, Pulse, Tri, Sine -> sdk Osc shapes
const SUB_SHAPE = [0, 1, 3]
const UNI_DET = [
  [0, 0, 0],
  [-0.5, 0.5, 0],
  [-1, 0, 1]
]
// vowel formants (F1, F2) ordered U O A E I -> "yoy / wah" sweeps
const VOWELS = [
  [325, 700],
  [450, 800],
  [750, 1150],
  [450, 1750],
  [300, 2200]
]

class Voice {
  active = false
  releasing = false
  noteId = -1
  key = 48
  age = 0
  vel = 0.8
  accent = false
  level = 1
  pan = 0
  fine = 0
  modX = 0.5
  modY = 0.5
  holders = new Int32Array(8)
  nh = 0
  pitch = 48
  target = 48
  glideCoef = 0
  t = 0
  oscA: Osc[] = [new Osc(), new Osc(), new Osc()]
  oscB: Osc[] = [new Osc(), new Osc(), new Osc()]
  detA = new Float64Array(3)
  detB = new Float64Array(3)
  dtA = new Float64Array(3)
  dtB = new Float64Array(3)
  sub = new Osc()
  filt: BassFilter
  amp: Env
  fenv: Env
  fenvVal = 0
  accCap = 0
  lfoPh = 0
  lfoSh = 0
  // FM
  p1 = 0
  p2 = 0
  p3 = 0
  p4 = 0
  e2 = 1
  e3 = 1
  e4 = 1
  c2 = 0.999
  c3 = 0.999
  c4 = 0.999
  fb1 = 0
  fb2 = 0
  // growl
  pm = 0
  ps = 0
  fA: BP
  fB: BP
  // 808
  ph8 = 0
  penv = 0
  click = 0
  clickPh = 0
  // physical
  str: BassString
  buf = new Float32Array(MAXN)
  constructor(sr: number) {
    this.filt = new BassFilter(sr)
    this.amp = new Env(sr)
    this.fenv = new Env(sr)
    this.fA = new BP(sr)
    this.fB = new BP(sr)
    this.str = new BassString(sr)
  }
  hold(id: number): void {
    if (this.nh < this.holders.length) this.holders[this.nh++] = id
  }
  unhold(id: number): boolean {
    for (let i = 0; i < this.nh; i++)
      if (this.holders[i] === id) {
        this.holders[i] = this.holders[--this.nh]
        return true
      }
    return false
  }
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

export class Bassline implements InstrumentDSP {
  private p: Record<string, number> = {}
  private sr: number
  private voices: Voice[]
  private clock = 0
  private bend = 0
  private lastPitch = 48
  private lastFreq = 65
  // mono key stack
  private stId = new Int32Array(32)
  private stKey = new Int32Array(32)
  private stVel = new Float32Array(32)
  private stN = 0
  private mixL = new Float32Array(MAXN)
  private mixR = new Float32Array(MAXN)
  private fx: OutputFX
  private fxDirty = true
  private gLfoPh = 0
  private sp: StringParams = { model: 0, pickup: 0.18, pluck: 0.2, bright: 0.5, decay: 3, damp: 0.4, buzz: 0.1, pop: 0.5, body: 0.2, mwah: 0, muteTime: 0.08 }
  // oscilloscope
  private scope = new Float32Array(256)
  private scState = 0
  private scCount = 0
  private scTimer = 0
  private scIdx = 0
  private scDecim = 1
  private scDc = 0
  private scPrev = 0
  private scWait = 0
  private scSilentSent = false
  private scPeak = 0

  constructor(private ctx: DSPContext) {
    this.sr = ctx.sampleRate
    for (const d of PARAMS) this.p[d.id] = d.default
    this.voices = Array.from({ length: NVOICES }, () => new Voice(this.sr))
    this.fx = new OutputFX(this.sr)
  }

  setParam(id: string, v: number): void {
    this.p[id] = v
    if (id.startsWith('eq.') || id === 'punch' || id.startsWith('chorus')) this.fxDirty = true
  }

  pitchBend(st: number): void {
    this.bend = st
  }

  onMessage(): void {}

  // ── note handling ─────────────────────────────────────────────────────────

  private glideTo(v: Voice, key: number, time: number): void {
    v.target = key
    v.glideCoef = time > 0.0005 ? Math.exp(-CR / ((time / 3) * this.sr)) : 0
    if (v.glideCoef === 0) v.pitch = key
  }

  private trigger(v: Voice, n: NoteOn, key: number, vel: number): void {
    const p = this.p
    const eng = p.engine | 0
    const wasActive = v.active
    v.active = true
    v.releasing = false
    v.age = ++this.clock
    v.key = key
    v.vel = vel
    v.pan = n.pan
    v.fine = n.fine
    v.modX = n.modX
    v.modY = n.modY
    v.t = 0
    this.setLevel(v, vel)
    const sr = this.sr
    if (eng === ENG.PHYS) {
      v.amp.set(0.0008, 4, 1, p['amp.r'] + 0.12)
    } else {
      v.amp.set(p['amp.a'], p['amp.d'], p['amp.s'], p['amp.r'])
    }
    v.amp.trigger()
    if (eng === ENG.ACID) {
      const d = p['fenv.d']
      v.fenv.set(0.003, v.accent ? Math.min(d, 0.22) : d, 0, 0.02)
    } else v.fenv.set(p['fenv.a'], p['fenv.d'], p['fenv.s'], p['fenv.r'])
    v.fenv.trigger()
    if (!wasActive) {
      v.filt.reset()
      v.fA.reset()
      v.fB.reset()
      v.accCap = 0
      v.p1 = v.p2 = v.p3 = v.p4 = 0
      v.fb1 = v.fb2 = 0
      v.ph8 = 0
      v.pm = v.ps = 0
      v.str.reset()
      v.fenvVal = 0
      for (let u = 0; u < 3; u++) {
        v.oscA[u].phase = u === 0 ? 0 : Math.random()
        v.oscB[u].phase = Math.random()
      }
      v.sub.phase = 0
    }
    // analog drift / unison detune (cents)
    const uni = Math.max(1, Math.min(3, Math.round(p['osc.uni'])))
    const spread = p['osc.spread']
    for (let u = 0; u < 3; u++) {
      const drift = (Math.random() - 0.5) * 3
      v.detA[u] = UNI_DET[uni - 1][u] * spread + drift
      v.detB[u] = UNI_DET[uni - 1][u] * spread * 1.13 + drift + p['osc2.detune'] + p['osc2.semi'] * 100
    }
    // FM operator envelopes
    v.e2 = v.e3 = v.e4 = 1
    v.c2 = Math.exp(-1 / (p['fm.d2'] * sr))
    v.c3 = Math.exp(-1 / (p['fm.d3'] * sr))
    v.c4 = Math.exp(-1 / (p['fm.d4'] * sr))
    // 808
    v.penv = 1
    v.click = 1
    v.clickPh = 0
    if (eng === ENG.PHYS) {
      const sp = this.sp
      sp.model = p['ph.model'] | 0
      sp.pickup = p['ph.pickup']
      sp.pluck = p['ph.pluck']
      sp.bright = p['ph.bright']
      sp.decay = p['ph.decay']
      sp.damp = p['ph.damp']
      sp.buzz = p['ph.buzz']
      sp.pop = p['ph.pop']
      sp.body = p['ph.body']
      sp.mwah = p['ph.mwah']
      sp.muteTime = p['amp.r']
      v.str.excite(sp, vel, mtof(v.pitch + v.fine / 100))
    }
    v.lfoPh = p['lfo.retrig'] >= 0.5 ? 0 : this.gLfoPh
    this.lastFreq = mtof(key)
  }

  private setLevel(v: Voice, vel: number): void {
    const p = this.p
    if ((p.engine | 0) === ENG.ACID) {
      v.accent = vel >= p['acid.thr']
      v.level = v.accent ? 0.55 * (1 + 0.9 * p['acid.accent']) : 0.55
    } else {
      v.accent = false
      const s = p['vel.sens']
      v.level = 1 - s + s * vel
    }
  }

  private release(v: Voice): void {
    if (!v.active || v.releasing) return
    v.releasing = true
    const p = this.p
    if ((p.engine | 0) === ENG.PHYS) {
      v.amp.setRelease(p['amp.r'] + 0.12)
      v.str.mute(true, Math.max(0.03, p['amp.r']), mtof(v.pitch))
    } else v.amp.setRelease(p['amp.r'])
    v.amp.release()
    v.fenv.release()
  }

  /** Bring a releasing voice back without a new attack (slides into a fading note). */
  private resume(v: Voice): void {
    v.releasing = false
    v.amp.resume()
    v.fenv.resume()
    if ((this.p.engine | 0) === ENG.PHYS) v.str.mute(false, 0, 0)
  }

  private glideTime(): number {
    return this.p.glide
  }

  noteOn(n: NoteOn): void {
    const mode = this.p['voice.mode'] | 0
    if (n.slide) {
      this.slide(n, mode)
      return
    }
    if (mode === 0) this.polyOn(n)
    else this.monoOn(n, mode === 2)
    this.lastPitch = n.key
  }

  private polyOn(n: NoteOn): void {
    let v: Voice | null = null
    for (const x of this.voices) if (!x.active) { v = x; break }
    if (!v) {
      for (const x of this.voices) if (x.releasing && (!v || x.age < v.age)) v = x
      if (!v) for (const x of this.voices) if (!v || x.age < v.age) v = x
    }
    const voice = v!
    const g = this.glideTime()
    const from = n.porta || g > 0 ? this.lastPitch : n.key
    voice.nh = 0
    voice.hold(n.id)
    voice.noteId = n.id
    if (voice.active) {
      // stolen voice: fast fade-free retrigger
      voice.pitch = from
    } else voice.pitch = from
    this.glideTo(voice, n.key, from !== n.key ? (g > 0 ? g : 0.08) : 0)
    this.trigger(voice, n, n.key, n.vel)
  }

  private monoOn(n: NoteOn, legato: boolean): void {
    // push to key stack
    this.stackRemove(n.id)
    if (this.stN < this.stId.length) {
      this.stId[this.stN] = n.id
      this.stKey[this.stN] = n.key
      this.stVel[this.stN] = n.vel
      this.stN++
    }
    const v = this.voices[0]
    // release any poly leftovers when switching mode
    for (let i = 1; i < this.voices.length; i++) this.release(this.voices[i])
    const gated = v.active && !v.releasing
    const g = this.glideTime()
    v.noteId = n.id
    if (gated && legato) {
      // 303-style: overlapping notes slide without retriggering the envelopes
      this.glideTo(v, n.key, g)
      v.key = n.key
      v.vel = n.vel
      v.modX = n.modX
      v.modY = n.modY
      this.setLevel(v, n.vel)
      this.lastFreq = mtof(n.key)
      return
    }
    if (!v.active) v.pitch = n.porta || (!legato && g > 0) ? this.lastPitch : n.key
    const glide = n.porta ? (g > 0 ? g : 0.08) : legato ? 0 : g
    this.glideTo(v, n.key, v.pitch !== n.key ? glide : 0)
    this.trigger(v, n, n.key, n.vel)
  }

  /** FL slide note: glide sounding notes to this pitch over the note length, no new attack. */
  private slide(n: NoteOn, mode: number): void {
    // FL semantics: the slide note re-pitches what is already sounding (the slid pitch stays until those notes
    // end; draw another slide note to come back). It only "owns" the voice when it revives a fading one.
    const time = n.length > 0 ? n.length * 0.75 : Math.max(this.p.glide, 0.06)
    if (mode !== 0) {
      const v = this.voices[0]
      if (!v.active) {
        this.monoOn(n, true)
        this.lastPitch = n.key
        return
      }
      if (v.releasing || this.stN === 0) {
        this.resume(v)
        this.stN = 0
        this.stId[0] = n.id
        this.stKey[0] = n.key
        this.stVel[0] = n.vel
        this.stN = 1
        v.noteId = n.id
      } else this.stKey[this.stN - 1] = n.key
      this.glideTo(v, n.key, time)
      v.key = n.key
      this.lastPitch = n.key
      this.lastFreq = mtof(n.key)
      return
    }
    let any = false
    for (const v of this.voices)
      if (v.active && !v.releasing) {
        this.glideTo(v, n.key, time)
        v.key = n.key
        any = true
      }
    if (!any) {
      let best: Voice | null = null
      for (const v of this.voices) if (v.active && (!best || v.age > best.age)) best = v
      if (best) {
        this.resume(best)
        best.nh = 0
        best.hold(n.id)
        this.glideTo(best, n.key, time)
        best.key = n.key
      } else this.polyOn(n)
    }
    this.lastPitch = n.key
    this.lastFreq = mtof(n.key)
  }

  private stackRemove(id: number): boolean {
    for (let i = 0; i < this.stN; i++)
      if (this.stId[i] === id) {
        for (let j = i; j < this.stN - 1; j++) {
          this.stId[j] = this.stId[j + 1]
          this.stKey[j] = this.stKey[j + 1]
          this.stVel[j] = this.stVel[j + 1]
        }
        this.stN--
        return true
      }
    return false
  }

  noteOff(id: number): void {
    const mode = this.p['voice.mode'] | 0
    if (mode !== 0) {
      const wasTop = this.stN > 0 && this.stId[this.stN - 1] === id
      const found = this.stackRemove(id)
      const v = this.voices[0]
      if (this.stN === 0) {
        if (found || v.noteId === id) this.release(v)
      } else if (wasTop && v.active) {
        const k = this.stKey[this.stN - 1]
        v.noteId = this.stId[this.stN - 1]
        this.glideTo(v, k, Math.max(this.p.glide, 0.01))
        v.key = k
      }
      // also release any poly leftovers holding this id
      for (let i = 1; i < this.voices.length; i++) {
        const x = this.voices[i]
        if (x.active && x.unhold(id) && x.nh === 0) this.release(x)
      }
      return
    }
    for (const v of this.voices) if (v.active && v.unhold(id) && v.nh === 0) this.release(v)
  }

  allNotesOff(hard: boolean): void {
    this.stN = 0
    for (const v of this.voices) {
      if (hard) {
        v.active = false
        v.releasing = false
        v.amp.kill()
        v.fenv.kill()
        v.nh = 0
        v.str.reset()
      } else this.release(v)
    }
    if (hard) this.fx.reset()
  }

  // ── audio ──────────────────────────────────────────────────────────────────

  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    for (let s = start; s < end; s += MAXN) {
      const e = Math.min(end, s + MAXN)
      this.render(outL, outR, s, e)
    }
  }

  private render(outL: Float32Array, outR: Float32Array, s: number, e: number): void {
    const n = e - s
    const p = this.p
    if (this.fxDirty) {
      this.fx.setEQ(p['eq.low'], p['eq.mid'], p['eq.high'])
      this.fx.setDyn(p.punch, p.chorus, p['chorus.rate'])
      this.fxDirty = false
    }
    const mixL = this.mixL
    const mixR = this.mixR
    mixL.fill(0, 0, n)
    mixR.fill(0, 0, n)
    let any = false
    for (const v of this.voices) {
      if (!v.active) continue
      any = true
      this.renderVoice(v, n)
      const a = ((Math.max(-1, Math.min(1, v.pan)) + 1) * Math.PI) / 4
      const gl = Math.cos(a) * Math.SQRT2
      const gr = Math.sin(a) * Math.SQRT2
      const b = v.buf
      let pk = 0
      for (let i = 0; i < n; i++) {
        const x = b[i]
        mixL[i] += x * gl
        mixR[i] += x * gr
        if (x > pk) pk = x
        else if (-x > pk) pk = -x
      }
      // auto-free voices that have decayed to silence (held physical strings, closed envelopes)
      if (!v.amp.active || (pk < 1e-6 && v.t > this.sr * 0.25)) {
        v.active = false
        v.releasing = false
        v.nh = 0
      }
    }
    // global LFO phase (for non-retriggered LFOs)
    this.gLfoPh += (this.lfoRate() * n) / this.sr
    this.gLfoPh -= Math.floor(this.gLfoPh)
    if (!any && this.scSilentSent) return
    const gain = p['master.gain'] * 1.15
    for (let i = 0; i < n; i++) {
      mixL[i] *= gain
      mixR[i] *= gain
    }
    this.fx.process(mixL, mixR, 0, n)
    for (let i = 0; i < n; i++) {
      outL[s + i] += mixL[i]
      outR[s + i] += mixR[i]
    }
    this.scopeFeed(n, any)
  }

  private lfoRate(): number {
    const sync = this.p['lfo.sync'] | 0
    if (sync > 0) {
      const beats = LFO_SYNC_BEATS[sync] ?? 1
      return (Math.max(20, this.p.tempo || 140) / 60) / beats
    }
    return this.p['lfo.rate']
  }

  private renderVoice(v: Voice, n: number): void {
    const p = this.p
    const sr = this.sr
    const eng = p.engine | 0
    const buf = v.buf
    const ftype = eng === ENG.ACID ? 2 : p['flt.type'] | 0
    v.filt.mode = ftype
    const cutOct = Math.log2(p['flt.cutoff'])
    const res0 = p['flt.res']
    const envAmt = p['flt.env']
    const keyT = p['flt.key']
    const velCut = eng === ENG.ACID ? 0 : p['flt.vel'] * (v.vel - 0.6) * 3
    const fdrive = p['flt.drive']
    const accAmt = p['acid.accent']
    const lfoWave = p['lfo.wave'] | 0
    const lfoInc = (this.lfoRate() * CR) / sr
    const lfoCut = p['lfo.cutoff']
    const lfoPitch = p['lfo.pitch']
    const lfoAmp = p['lfo.amp']
    const lfoWt = p['lfo.wt']
    const drive = p.drive
    const dmode = p['drv.mode'] | 0
    const dpre = 1 + drive * 9
    const dpost = 1 / (1 + drive * 1.8)
    const subLvl = p['sub.level']
    const subShape = SUB_SHAPE[p['sub.wave'] | 0] ?? 0
    const subMul = (p['sub.oct'] | 0) === 1 ? 0.25 : 0.5
    const eg = ENGINE_GAIN[eng] ?? 0.5
    // engine constants
    const w1 = OSC_SHAPE[p['osc1.wave'] | 0] ?? 2
    const w2 = OSC_SHAPE[p['osc2.wave'] | 0] ?? 2
    const pw1 = (p['osc1.wave'] | 0) === 2 ? p['osc1.pw'] : 0.5
    const l1 = p['osc1.level']
    const l2 = p['osc2.level']
    const nl = p['noise.level']
    const uni = Math.max(1, Math.min(3, Math.round(p['osc.uni'])))
    const uniNorm = 1 / Math.sqrt(uni)
    const accK = 1 - Math.exp(-CR / (0.035 * sr))
    const s8wave = p['s8.wave'] | 0
    const pCoef = Math.exp(-CR / (Math.max(0.002, p['s8.ptime']) * sr))
    const s8pitch = p['s8.pitch']
    const clickAmt = p['s8.click']
    const clickCoef = Math.exp(-1 / (0.004 * sr))
    const clickInc = 1700 / sr
    const fmAlgo = p['fm.algo'] | 0
    const fmVel = 1 - p['fm.vel'] + p['fm.vel'] * v.vel
    const IMAX = 0.8
    const sus = p['fm.sus']
    const fbAmt = p['fm.fb'] * 0.16
    const morph0 = p['wt.morph']
    const sync0 = p['wt.sync']
    const wfm = p['wt.fm']
    const fold = p['wt.fold']
    const vowel0 = p['wt.vowel']
    const fmix = p['wt.formant']
    for (let i0 = 0; i0 < n; i0 += CR) {
      const i1 = i0 + CR < n ? i0 + CR : n
      // ── control tick ──
      v.pitch = v.target + (v.pitch - v.target) * v.glideCoef
      v.lfoPh += lfoInc
      if (v.lfoPh >= 1) {
        v.lfoPh -= Math.floor(v.lfoPh)
        v.lfoSh = Math.random() * 2 - 1
      }
      const ph = v.lfoPh
      let lv: number
      switch (lfoWave) {
        case 0: lv = sin1(ph); break
        case 1: lv = 1 - 4 * Math.abs(ph - 0.5); break
        case 2: lv = 1 - 2 * ph; break
        case 3: lv = 2 * ph - 1; break
        case 4: lv = ph < 0.5 ? 1 : -1; break
        default: lv = v.lfoSh
      }
      let pitch = v.pitch + this.bend + v.fine / 100 + lfoPitch * lv
      if (eng === ENG.SUB808) {
        pitch += s8pitch * v.penv
        v.penv *= pCoef
      } else if (eng === ENG.PHYS) {
        pitch += v.str.bend
        v.str.tick()
      }
      const freq = mtof(pitch)
      const dt = freq / sr
      if (ftype > 0) {
        let oct = cutOct + keyT * (v.pitch - 48) / 12 + envAmt * 7 * v.fenvVal + velCut + (v.modX - 0.5) * 4 + lfoCut * 4 * lv
        let res = res0 + (v.modY - 0.5) * 0.6
        if (eng === ENG.ACID) {
          v.accCap += ((v.accent ? v.fenvVal : 0) - v.accCap) * accK
          oct += accAmt * v.accCap * (2.2 + 2 * res0)
          res += v.accent ? accAmt * 0.06 : 0
        }
        v.filt.set(Math.pow(2, oct), res < 0 ? 0 : res > 1 ? 1 : res, fdrive)
      }
      // ── engine (raw) ──
      switch (eng) {
        case ENG.ANALOG:
        case ENG.ACID: {
          for (let u = 0; u < uni; u++) {
            v.dtA[u] = dt * Math.pow(2, v.detA[u] / 1200)
            v.dtB[u] = dt * Math.pow(2, v.detB[u] / 1200)
            v.oscA[u].pw = Math.min(0.95, Math.max(0.05, pw1 + lfoWt * lv * 0.4))
            v.oscB[u].pw = 0.5
          }
          for (let i = i0; i < i1; i++) {
            let a = 0
            let b = 0
            for (let u = 0; u < uni; u++) {
              a += v.oscA[u].next(w1, v.dtA[u])
              if (l2 > 0) b += v.oscB[u].next(w2, v.dtB[u])
            }
            let x = (a * l1 + b * l2) * uniNorm
            if (nl > 0) x += (Math.random() * 2 - 1) * nl
            buf[i] = x
          }
          break
        }
        case ENG.FM: {
          const r1 = dt * p['fm.r1']
          const r2 = dt * p['fm.r2']
          const r3 = dt * p['fm.r3']
          const r4 = dt * p['fm.r4']
          const k = IMAX * fmVel * (1 + lfoWt * lv * 0.6)
          // soften the index for high notes (key scaling)
          const ks = freq > 150 ? 150 / freq : 1
          const i2 = p['fm.i2'] * k * ks
          const i3 = p['fm.i3'] * k * ks
          const i4 = p['fm.i4'] * k * ks
          for (let i = i0; i < i1; i++) {
            v.e2 = sus + (v.e2 - sus) * v.c2
            v.e3 = sus + (v.e3 - sus) * v.c3
            v.e4 = sus + (v.e4 - sus) * v.c4
            const o4 = sin1(v.p4 + fbAmt * (v.fb1 + v.fb2))
            v.fb2 = v.fb1
            v.fb1 = o4
            let out: number
            switch (fmAlgo) {
              case 0: {
                const o3 = sin1(v.p3 + i4 * v.e4 * o4)
                const o2 = sin1(v.p2 + i3 * v.e3 * o3)
                out = sin1(v.p1 + i2 * v.e2 * o2)
                break
              }
              case 1: {
                const o2 = sin1(v.p2)
                const o3 = sin1(v.p3 + i4 * v.e4 * o4)
                const lv3 = p['fm.i3']
                out = (sin1(v.p1 + i2 * v.e2 * o2) + o3 * lv3 * v.e3) / (1 + lv3 * 0.5)
                break
              }
              case 2: {
                out = sin1(v.p1 + i2 * v.e2 * sin1(v.p2) + i3 * v.e3 * sin1(v.p3) + i4 * v.e4 * o4)
                break
              }
              default: {
                const o3 = sin1(v.p3 + i4 * v.e4 * o4)
                out = sin1(v.p1 + i2 * v.e2 * sin1(v.p2) + i3 * v.e3 * o3)
              }
            }
            v.p1 += r1; if (v.p1 >= 1) v.p1 -= 1
            v.p2 += r2; if (v.p2 >= 1) v.p2 -= Math.floor(v.p2)
            v.p3 += r3; if (v.p3 >= 1) v.p3 -= Math.floor(v.p3)
            v.p4 += r4; if (v.p4 >= 1) v.p4 -= Math.floor(v.p4)
            buf[i] = out
          }
          break
        }
        case ENG.GROWL: {
          const syncR = Math.max(1, sync0 * (1 + lfoWt * (lv * 0.5 + 0.5) * 0.8))
          let morph = morph0 + lfoWt * lv * 0.25
          morph = morph < 0 ? 0 : morph > 1 ? 1 : morph
          let vw = vowel0 + lfoWt * lv * 0.5
          vw = vw < 0 ? 0 : vw > 1 ? 1 : vw
          const vp = vw * 4
          const vi = Math.min(3, vp | 0)
          const vf = vp - vi
          v.fA.set(VOWELS[vi][0] + (VOWELS[vi + 1][0] - VOWELS[vi][0]) * vf, 5)
          v.fB.set(VOWELS[vi][1] + (VOWELS[vi + 1][1] - VOWELS[vi][1]) * vf, 7)
          const seg = morph * 3
          const si = Math.min(2, seg | 0)
          const sf = seg - si
          const sdt = dt * syncR
          const foldG = 0.25 * (1 + fold * 5)
          for (let i = i0; i < i1; i++) {
            v.pm += dt
            if (v.pm >= 1) {
              v.pm -= 1
              if (syncR > 1.001) v.ps = v.pm * syncR
            }
            v.ps += sdt
            if (v.ps >= 1) v.ps -= Math.floor(v.ps)
            let ph2 = v.ps
            if (wfm > 0) {
              ph2 += wfm * 0.7 * sin1(v.pm)
              ph2 -= Math.floor(ph2)
            }
            let a: number
            let b: number
            switch (si) {
              case 0:
                a = sin1(ph2)
                b = tri(ph2)
                break
              case 1:
                a = tri(ph2)
                b = 2 * ph2 - 1 - blep(ph2, sdt)
                break
              default:
                a = 2 * ph2 - 1 - blep(ph2, sdt)
                b = (ph2 < 0.5 ? 1 : -1) + blep(ph2, sdt) - blep(ph2 + 0.5 - Math.floor(ph2 + 0.5), sdt)
            }
            let x = a + (b - a) * sf
            if (fold > 0) x = sin1(x * foldG)
            if (fmix > 0) x = x * (1 - fmix) + (v.fA.process(x) * 1.6 + v.fB.process(x) * 1.1) * fmix
            buf[i] = x
          }
          break
        }
        case ENG.SUB808: {
          for (let i = i0; i < i1; i++) {
            v.ph8 += dt
            if (v.ph8 >= 1) v.ph8 -= 1
            const ph8 = v.ph8
            let x: number
            if (s8wave === 1) x = 1 - 4 * Math.abs(ph8 - 0.5)
            else if (s8wave === 2) x = sat((sin1(ph8) + 0.35 * sin1(2 * ph8) + 0.18 * sin1(3 * ph8)) * 1.2)
            else x = sin1(ph8)
            if (v.click > 0.001 && clickAmt > 0) {
              v.clickPh += clickInc
              x += (sin1(v.clickPh) * 0.8 + (Math.random() * 2 - 1) * 0.4) * v.click * clickAmt
              v.click *= clickCoef
            }
            buf[i] = x
          }
          break
        }
        default: {
          v.str.setFreq(freq)
          v.str.updateMwah(freq)
          for (let i = i0; i < i1; i++) buf[i] = v.str.process()
        }
      }
      // ── common chain: filter -> drive -> amp (+ sub layer) ──
      const subDt = dt * subMul
      const ampMod = lfoAmp > 0 ? 1 - lfoAmp * (0.5 - 0.5 * lv) : 1
      const lvl = v.level * ampMod
      for (let i = i0; i < i1; i++) {
        let x = buf[i] * eg
        v.fenvVal = v.fenv.next()
        if (ftype > 0) x = v.filt.process(x)
        if (drive > 0.001) x = shape(x * dpre, dmode) * dpost
        const a = v.amp.next()
        if (subLvl > 0) x += v.sub.next(subShape, subDt) * subLvl * 0.5
        buf[i] = x * a * lvl
      }
    }
    v.t += n
  }

  // ── oscilloscope (trigger-aligned ~20 fps snapshots) ─────────────────────────
  private scopeFeed(n: number, any: boolean): void {
    const L = this.mixL
    const R = this.mixR
    const interval = (this.sr / 20) | 0
    for (let i = 0; i < n; i++) {
      const x = (L[i] + R[i]) * 0.5
      this.scTimer++
      switch (this.scState) {
        case 0:
          if (this.scTimer >= interval) {
            this.scTimer = 0
            this.scState = 1
            this.scWait = 0
            this.scDecim = Math.max(1, Math.round((2.2 * this.sr) / Math.max(20, this.lastFreq) / 256))
          }
          break
        case 1: {
          // rising zero crossing (DC-tracked) or give up after a while
          this.scDc += (x - this.scDc) * 0.001
          const y = x - this.scDc
          if ((this.scPrev <= 0 && y > 0) || ++this.scWait > 4096) {
            this.scState = 2
            this.scIdx = 0
            this.scCount = 0
            this.scPeak = 0
          }
          this.scPrev = y
          break
        }
        default:
          if (this.scCount++ % this.scDecim === 0) {
            this.scope[this.scIdx++] = x
            const ax = x < 0 ? -x : x
            if (ax > this.scPeak) this.scPeak = ax
            if (this.scIdx >= 256) {
              this.scState = 0
              this.scCount = 0
              const silent = this.scPeak < 1e-4
              if (!silent || !this.scSilentSent) {
                this.ctx.post({ type: 'scope', data: this.scope.slice(), freq: this.lastFreq, peak: this.scPeak })
              }
              this.scSilentSent = silent && !any
            }
          }
      }
    }
  }
}

/** Triangle phase-aligned with sine (peak at 0.25). */
function tri(ph: number): number {
  return ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4
}

function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt
    return t + t - t * t - 1
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt
    return t * t + t + t + 1
  }
  return 0
}

function shape(x: number, mode: number): number {
  switch (mode) {
    case 1: {
      // tube: asymmetric, even harmonics
      const y = x + 0.25 * x * x
      return sat(y) * 0.95
    }
    case 2: {
      // fuzz: hard-ish clip
      let y = x * 1.6
      y = y > 1 ? 1 : y < -1 ? -1 : y
      return 1.5 * (y - (y * y * y) / 3)
    }
    case 3:
      return sin1(x * 0.18)
    default:
      return sat(x)
  }
}

export default { id: 'bassline', kind: 'instrument', create: (ctx) => new Bassline(ctx) } satisfies DSPFactory
