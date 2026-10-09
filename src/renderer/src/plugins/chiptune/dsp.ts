// Chiptune DSP — Magical 8bit Plug style NES/GB synth + retro drum mode. Runs in the AudioWorklet.
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { ADSR, TAU, panGains } from '../sdk/dsp'
import { ChipOsc, DUTIES, W, isNoise, noiseRate, waveTable } from './chip'
import { normalizeData, seqFinished, seqNext, type ChipData } from './data'
import { DRUM_GB_WAVE, KIT_MAPS, type DrumDef, type DrumLayer } from './drumkeys'
import { OUT_RATES, PARAMS, SEQ_RATES } from './params'

const CTL = 16 // control-rate interval (samples)
const VOICE_GAIN = 0.32
const DRUM_GAIN = 0.55
const MAX_VOICES = 16
const MAX_DRUMS = 12
const MAX_HELD = 32
const DRUM_LAYERS = 4

const mtofv = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

interface SeqRt {
  on: boolean
  vals: Int8Array
  len: number
  loop: number
  rel: number
}

class Voice {
  active = false
  released = false
  noteId = -1
  key = 60
  age = 0
  vel = 1
  panL = 1
  panR = 1
  fine = 0
  note = 60 // target pitch (incl. arp)
  pitch = 60 // gliding pitch
  oscL = new ChipOsc()
  oscR = new ChipOsc()
  env: ADSR
  fade = 1
  fading = false
  vi = 0
  pi = 0
  di = 0
  pAcc = 0
  t = 0
  frameT = 0
  framePos = 0
  divCount = 1
  ctl = 0
  dtL = 0
  dtR = 0
  duty = 0.5
  noiseShort = false
  // arp
  arpCount = 0
  arpPos = 0
  arpDir = 1
  constructor(sr: number) {
    this.env = new ADSR(sr)
  }
}

class DrumLayerRt {
  def: DrumLayer | null = null
  osc = new ChipOsc()
  dt = 0
  done = true
}

class DrumVoice {
  active = false
  key = 0
  age = 0
  choke = 0
  gain = 1
  chokeRate = 0
  panL = 1
  panR = 1
  tune = 0
  decayMul = 1
  t = 0
  ctl = 0
  layers: DrumLayerRt[] = Array.from({ length: DRUM_LAYERS }, () => new DrumLayerRt())
}

interface Held {
  id: number
  key: number
  vel: number
  pan: number
  fine: number
  order: number
}

class Chiptune implements InstrumentDSP {
  private sr: number
  private invSr: number
  private p: Record<string, number> = {}
  private voices: Voice[]
  private drums: DrumVoice[]
  private clock = 0
  private bend = 0
  private lastPitch = 60
  private data: ChipData = normalizeData(undefined)
  private table = new Float32Array(32)
  private drumTable = waveTable(DRUM_GB_WAVE)
  private seqs: Record<'vol' | 'pitch' | 'duty', SeqRt>
  // held notes for mono / arp
  private held: Held[] = Array.from({ length: MAX_HELD }, () => ({ id: 0, key: 0, vel: 0, pan: 0, fine: 0, order: 0 }))
  private nHeld = 0
  private orderClock = 0
  private arpList = new Float64Array(MAX_HELD * 3)
  private rnd = 22222
  // output chain
  private mixL = new Float32Array(256)
  private mixR = new Float32Array(256)
  private shL = 0
  private shR = 0
  private shAcc = 1
  private dcxL = 0
  private dcyL = 0
  private dcxR = 0
  private dcyR = 0
  private lp1L = 0
  private lp2L = 0
  private lp1R = 0
  private lp2R = 0
  // derived (recomputed in setParam)
  private frameLen = 800
  private glideCoef = 0
  private lpCoef = 1
  private dcR = 0.997
  private stereoRatio = 1

  constructor(private ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.invSr = 1 / this.sr
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice(this.sr))
    this.drums = Array.from({ length: MAX_DRUMS }, () => new DrumVoice())
    for (const d of PARAMS) this.p[d.id] = d.default
    const mk = (): SeqRt => ({ on: false, vals: new Int8Array(64), len: 1, loop: -1, rel: -1 })
    this.seqs = { vol: mk(), pitch: mk(), duty: mk() }
    this.dcR = 1 - (TAU * 15) / this.sr
    this.setData(undefined)
    this.derive()
  }

  // ─── params / data ──────────────────────────────────────────────────────────
  setParam(id: string, v: number): void {
    this.p[id] = v
    this.derive()
  }

  private derive(): void {
    const p = this.p
    this.frameLen = this.sr / (SEQ_RATES[Math.round(p['seq.rate'])] ?? 60)
    const g = p['voice.glide']
    this.glideCoef = g > 0.0005 ? Math.exp(-CTL / (g * 0.3 * this.sr)) : 0
    const fc = p['out.lpf']
    this.lpCoef = fc >= 19990 ? 1 : 1 - Math.exp((-TAU * fc) / this.sr)
    this.stereoRatio = Math.pow(2, (p['out.stereo'] * 0.12) / 12)
    this.seqs.vol.on = p['seq.vol'] >= 0.5
    this.seqs.pitch.on = p['seq.pitch'] >= 0.5
    this.seqs.duty.on = p['seq.duty'] >= 0.5
  }

  setData(d: unknown): void {
    this.data = normalizeData(d)
    for (const k of ['vol', 'pitch', 'duty'] as const) {
      const s = this.data[k]
      const rt = this.seqs[k]
      rt.len = s.values.length
      for (let i = 0; i < rt.len; i++) rt.vals[i] = s.values[i]
      rt.loop = s.loop
      rt.rel = s.release
    }
    waveTable(this.data.wave, this.table)
  }

  pitchBend(st: number): void {
    this.bend = st
  }

  onMessage(msg: unknown): void {
    const m = msg as { type?: string }
    if (m?.type === 'panic') this.allNotesOff(true)
  }

  // ─── notes ──────────────────────────────────────────────────────────────────
  private get drumMode(): boolean {
    return this.p.mode >= 0.5
  }
  private get arpOn(): boolean {
    return Math.round(this.p['arp.mode']) > 0
  }
  private get monoMode(): boolean {
    return this.p['voice.poly'] < 0.5
  }

  private velGain(vel: number): number {
    const s = this.p['voice.vel']
    return 1 - s + s * vel
  }

  /** (Re)start the envelope + sequences of a voice. */
  private trigger(v: Voice): void {
    const p = this.p
    v.released = false
    v.fading = false
    v.fade = 1
    v.t = 0
    v.frameT = 0
    v.framePos = this.frameLen
    v.divCount = Math.max(1, Math.round(p['seq.div']))
    v.vi = v.pi = v.di = 0
    v.pAcc = this.seqs.pitch.on && p['seq.pitchMode'] >= 0.5 ? this.seqs.pitch.vals[0] : 0
    v.env.set(p['env.attack'], p['env.decay'], p['env.sustain'], p['env.release'])
    v.env.reset()
    v.env.gate(true)
    v.ctl = 0
  }

  private start(v: Voice, n: { id: number; key: number; vel: number; pan: number; fine: number }, glideFrom: number | null): void {
    v.active = true
    v.noteId = n.id
    v.key = n.key
    v.vel = n.vel
    const [l, r] = panGains(n.pan)
    v.panL = l
    v.panR = r
    v.fine = n.fine
    v.note = n.key
    v.pitch = glideFrom ?? n.key
    v.age = ++this.clock
    // NES phase reset on key-on gives the consistent "plink"; noise keeps running like the hardware.
    v.oscL.phase = 0
    v.oscR.phase = 0.25
    v.oscR.lfsr = 0x2a5b
    this.trigger(v)
  }

  noteOn(n: NoteOn): void {
    if (this.drumMode) return this.drumOn(n)
    const p = this.p
    const glideOn = p['voice.glide'] > 0.0005
    if (n.slide) {
      // FL slide note: retarget sounding voices without retriggering
      for (const v of this.voices) if (v.active && !v.released) v.note = n.key
      this.lastPitch = n.key
      return
    }
    if (this.arpOn) {
      this.pushHeld(n)
      const v = this.voices[0]
      for (let i = 1; i < MAX_VOICES; i++) this.voices[i].active = false
      if (!v.active || v.released) {
        v.arpPos = 0
        v.arpDir = 1
        v.arpCount = Math.max(1, Math.round(p['arp.speed']))
        this.buildArp()
        this.start(v, n, null)
        if (Math.round(p['arp.mode']) === 2) v.arpPos = this.arpLen - 1
        v.note = v.pitch = this.arpList[v.arpPos]
        if (glideOn && n.porta) v.pitch = this.lastPitch
      } else this.buildArp()
      this.lastPitch = n.key
      return
    }
    if (this.monoMode) {
      this.pushHeld(n)
      const v = this.voices[0]
      for (let i = 1; i < MAX_VOICES; i++) this.voices[i].active = false
      const sounding = v.active && !v.released
      if (sounding && p['voice.legato'] >= 0.5) {
        v.noteId = n.id
        v.key = n.key
        v.note = n.key
        v.vel = n.vel
        if (!glideOn) v.pitch = n.key
      } else {
        this.start(v, n, (sounding || n.porta) && glideOn ? (v.active ? v.pitch : this.lastPitch) : null)
      }
      this.lastPitch = n.key
      return
    }
    // poly
    const limit = Math.max(1, Math.min(MAX_VOICES, Math.round(p['voice.limit'])))
    let v: Voice | null = null
    for (let i = 0; i < limit; i++) if (!this.voices[i].active) { v = this.voices[i]; break }
    if (!v) {
      for (let i = 0; i < limit; i++) { const c = this.voices[i]; if (c.released && (!v || c.age < v.age)) v = c }
      if (!v) for (let i = 0; i < limit; i++) { const c = this.voices[i]; if (!v || c.age < v.age) v = c }
    }
    this.start(v!, n, n.porta && glideOn ? this.lastPitch : null)
    this.lastPitch = n.key
  }

  private pushHeld(n: NoteOn): void {
    for (let i = 0; i < this.nHeld; i++) if (this.held[i].id === n.id) return
    if (this.nHeld >= MAX_HELD) this.removeHeldAt(0)
    const h = this.held[this.nHeld++]
    h.id = n.id
    h.key = n.key
    h.vel = n.vel
    h.pan = n.pan
    h.fine = n.fine
    h.order = ++this.orderClock
  }

  private removeHeldAt(i: number): void {
    const h = this.held[i]
    for (let j = i; j < this.nHeld - 1; j++) this.held[j] = this.held[j + 1]
    this.held[--this.nHeld] = h
  }

  /** Build the arp note list (in place, no allocation): held keys x octaves, sorted by pitch or play order. */
  private buildArp(): number {
    const n = this.nHeld
    const asPlayed = Math.round(this.p['arp.mode']) === 5
    const keys = this.arpList
    const sk = this.arpSort
    let m = 0
    for (let i = 0; i < n; i++) {
      const h = this.held[i]
      const k = asPlayed ? h.order : h.key
      let j = m
      while (j > 0 && sk[j - 1] > k) {
        sk[j] = sk[j - 1]
        keys[j] = keys[j - 1]
        j--
      }
      sk[j] = k
      keys[j] = h.key
      m++
    }
    const oct = Math.max(1, Math.min(3, Math.round(this.p['arp.oct'])))
    for (let o = 1; o < oct; o++) for (let i = 0; i < m; i++) keys[o * m + i] = keys[i] + 12 * o
    this.arpLen = m * oct
    return this.arpLen
  }
  private arpLen = 0
  private arpSort = new Float64Array(MAX_HELD)

  private arpStep(v: Voice): void {
    const len = this.arpLen
    if (len <= 0) return
    const mode = Math.round(this.p['arp.mode'])
    let pos = v.arpPos
    if (mode === 2) pos = pos - 1 < 0 ? len - 1 : pos - 1
    else if (mode === 3) {
      if (len === 1) pos = 0
      else {
        pos += v.arpDir
        if (pos >= len) { v.arpDir = -1; pos = len - 2 }
        else if (pos < 0) { v.arpDir = 1; pos = 1 }
      }
    } else if (mode === 4) {
      let x = this.rnd
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5
      this.rnd = x
      pos = (x >>> 0) % len
    } else pos = (pos + 1) % len
    if (pos >= len) pos = 0
    v.arpPos = pos
    v.note = this.arpList[pos]
    if (this.glideCoef === 0) v.pitch = v.note
    if (this.p['arp.retrig'] >= 0.5) this.trigger(v)
  }

  noteOff(id: number, _key: number, _rel: number): void {
    if (this.drumMode) return
    if (this.arpOn || this.monoMode) {
      let idx = -1
      for (let i = 0; i < this.nHeld; i++) if (this.held[i].id === id) { idx = i; break }
      if (idx < 0) {
        // not tracked (mode switched while held): release matching voices
        for (const v of this.voices) if (v.active && v.noteId === id) this.release(v)
        return
      }
      this.removeHeldAt(idx)
      const v = this.voices[0]
      if (this.arpOn) {
        if (this.nHeld === 0) this.release(v)
        else {
          this.buildArp()
          if (v.arpPos >= this.arpLen) v.arpPos = 0
        }
        return
      }
      if (v.noteId !== id) return
      if (this.nHeld === 0) return this.release(v)
      // mono: fall back to the last held note
      const h = this.held[this.nHeld - 1]
      v.noteId = h.id
      v.key = h.key
      v.note = h.key
      if (this.glideCoef === 0) v.pitch = h.key
      if (this.p['voice.legato'] < 0.5) this.trigger(v)
      return
    }
    for (const v of this.voices) if (v.active && v.noteId === id && !v.released) this.release(v)
  }

  private release(v: Voice): void {
    if (!v.active || v.released) return
    v.released = true
    const s = this.seqs
    if (s.vol.rel >= 0 && v.vi <= s.vol.rel) v.vi = s.vol.rel
    if (s.pitch.rel >= 0 && v.pi <= s.pitch.rel) v.pi = s.pitch.rel
    if (s.duty.rel >= 0 && v.di <= s.duty.rel) v.di = s.duty.rel
    if (s.vol.on) {
      if (s.vol.rel < 0) v.fading = true
    } else v.env.gate(false)
  }

  allNotesOff(hard: boolean): void {
    this.nHeld = 0
    for (const v of this.voices) {
      if (hard) v.active = false
      else this.release(v)
    }
    if (hard) for (const d of this.drums) d.active = false
  }

  // ─── drums ──────────────────────────────────────────────────────────────────
  private drumOn(n: NoteOn): void {
    const p = this.p
    const kit = KIT_MAPS[Math.round(p['drum.kit'])] ?? KIT_MAPS[0]
    const def: DrumDef | undefined = kit.get(n.key)
    if (!def) return
    if (def.choke) for (const d of this.drums) if (d.active && d.choke === def.choke) d.chokeRate = this.invSr / 0.006
    let v: DrumVoice | null = null
    for (const d of this.drums) if (!d.active) { v = d; break }
    if (!v) for (const d of this.drums) if (!v || d.age < v.age) v = d
    const dv = v!
    const tw = this.data.drums[String(n.key)]
    dv.active = true
    dv.key = n.key
    dv.age = ++this.clock
    dv.choke = def.choke ?? 0
    dv.gain = this.velGain(n.vel) * (tw ? tw.level : 1)
    dv.chokeRate = 0
    const [l, r] = panGains(n.pan)
    dv.panL = l
    dv.panR = r
    dv.tune = p['drum.tune'] + (tw ? tw.tune : 0) + n.fine / 100
    dv.decayMul = p['drum.decay'] * (tw ? tw.decay : 1)
    dv.t = 0
    dv.ctl = 0
    for (let i = 0; i < DRUM_LAYERS; i++) {
      const L = dv.layers[i]
      L.def = def.layers[i] ?? null
      L.done = !L.def
      L.dt = 0
      L.osc.reset(0, 1 + i * 977)
    }
  }

  private drumControl(d: DrumVoice, auth: boolean): void {
    for (let i = 0; i < DRUM_LAYERS; i++) {
      const L = d.layers[i]
      const def = L.def
      if (!def || L.done) continue
      const lt = d.t - (def.delay ?? 0)
      if (lt < 0) continue
      let pitch = def.note + d.tune
      const sw = def.sweep ?? 0
      if (sw !== 0) {
        const st = Math.max(0.001, (def.sweepTime ?? 0.1) * Math.sqrt(d.decayMul))
        pitch += sw * (def.curve ? 1 - Math.exp((-3 * lt) / st) : Math.min(1, lt / st))
      }
      if (def.arp && def.arp.length) {
        const step = Math.floor((lt * 60) / Math.max(1, def.arpFrames ?? 1))
        const idx = def.arpLoop ? step % def.arp.length : Math.min(def.arp.length - 1, step)
        pitch += def.arp[idx]
      }
      L.dt = isNoise(def.wave) ? noiseRate(pitch, auth) * this.invSr : Math.min(0.45, mtofv(pitch) * this.invSr)
    }
  }

  private renderDrums(start: number, end: number, auth: boolean): void {
    const mixL = this.mixL
    const mixR = this.mixR
    const quant = this.p['env.quant'] >= 0.5
    const bl = !auth
    const ctlLen = auth ? Math.max(CTL, Math.round(this.sr / 60)) : CTL
    for (const d of this.drums) {
      if (!d.active) continue
      for (let i = start; i < end; i++) {
        if (--d.ctl <= 0) {
          d.ctl = ctlLen
          this.drumControl(d, auth)
        }
        let s = 0
        let alive = false
        for (let k = 0; k < DRUM_LAYERS; k++) {
          const L = d.layers[k]
          const def = L.def
          if (!def || L.done) continue
          alive = true
          const lt = d.t - (def.delay ?? 0)
          if (lt < 0) continue
          const hold = (def.hold ?? 0) * d.decayMul
          const dec = Math.max(0.004, def.decay * d.decayMul)
          let a = lt < hold ? 1 : 1 - (lt - hold) / dec
          if (a <= 0) {
            L.done = true
            continue
          }
          if (quant) a = Math.ceil(a * 15) / 15
          if (L.dt === 0) this.drumControl(d, auth)
          s += L.osc.next(def.wave, L.dt, def.duty ?? 0.5, bl, def.wave === W.GB ? this.drumTable : this.table) * a * def.level
        }
        if (!alive) {
          d.active = false
          break
        }
        if (d.chokeRate > 0) {
          d.gain -= d.chokeRate
          if (d.gain <= 0) {
            d.active = false
            break
          }
        }
        s *= d.gain * DRUM_GAIN
        mixL[i] += s * d.panL
        mixR[i] += s * d.panR
        d.t += this.invSr
      }
    }
  }

  // ─── synth rendering ────────────────────────────────────────────────────────
  private frameTick(v: Voice): void {
    v.frameT = v.t
    const s = this.seqs
    if (--v.divCount <= 0) {
      v.divCount = Math.max(1, Math.round(this.p['seq.div']))
      if (s.vol.on) v.vi = seqNext(v.vi, s.vol.len, s.vol.loop, s.vol.rel, v.released)
      if (s.pitch.on) {
        v.pi = seqNext(v.pi, s.pitch.len, s.pitch.loop, s.pitch.rel, v.released)
        if (this.p['seq.pitchMode'] >= 0.5) {
          const fin = seqFinished(v.pi, s.pitch.len, s.pitch.loop, s.pitch.rel, v.released)
          if (!fin) v.pAcc = Math.max(-60, Math.min(60, v.pAcc + s.pitch.vals[v.pi]))
        }
      }
      if (s.duty.on) v.di = seqNext(v.di, s.duty.len, s.duty.loop, s.duty.rel, v.released)
    }
    if (s.vol.on) {
      if (seqFinished(v.vi, s.vol.len, s.vol.loop, s.vol.rel, v.released)) {
        if (s.vol.vals[v.vi] === 0) v.active = false
        else if (v.released) v.fading = true
      }
    }
    if (this.arpOn && v === this.voices[0] && this.nHeld > 0 && !v.released) {
      if (--v.arpCount <= 0) {
        v.arpCount = Math.max(1, Math.round(this.p['arp.speed']))
        this.arpStep(v)
      }
    }
  }

  private control(v: Voice, wave: number, auth: boolean): void {
    const p = this.p
    const s = this.seqs
    v.pitch = v.note + (v.pitch - v.note) * this.glideCoef
    const tt = auth ? v.frameT : v.t
    let pitch = v.pitch + p['osc.coarse'] + p['osc.fine'] / 100 + v.fine / 100 + this.bend
    if (s.pitch.on) pitch += p['seq.pitchMode'] >= 0.5 ? v.pAcc : s.pitch.vals[v.pi]
    const bt = p['bend.time']
    const ba = p['bend.amt']
    if (ba !== 0 && bt > 0.0005 && tt < bt) pitch += ba * (1 - tt / bt)
    const sw = p['bend.sweep']
    if (sw !== 0) pitch += Math.max(-96, Math.min(96, sw * tt))
    const vd = p['vib.depth']
    if (vd > 0) {
      const td = tt - p['vib.delay']
      if (td > 0) pitch += vd * Math.sin(TAU * p['vib.rate'] * td) * Math.min(1, td / 0.15)
    }
    if (pitch < -12) pitch = -12
    else if (pitch > 136) pitch = 136
    let dt: number
    if (isNoise(wave)) dt = noiseRate(pitch, auth) * this.invSr
    else dt = Math.min(0.45, mtofv(pitch) * this.invSr)
    v.dtL = dt / this.stereoRatio
    v.dtR = Math.min(0.45, dt * this.stereoRatio)
    // duty
    let duty = s.duty.on ? DUTIES[s.duty.vals[v.di] & 3] : wave === W.P12 ? 0.125 : wave === W.P25 ? 0.25 : 0.5
    v.noiseShort = s.duty.on ? (s.duty.vals[v.di] & 1) === 1 : wave === W.NS
    const pw = p['osc.pwm']
    if (pw > 0) {
      const ph = (tt * p['osc.pwmRate']) % 1
      duty += pw * 0.42 * (1 - 4 * Math.abs(ph - 0.5))
      if (auth) duty = Math.round(duty * 16) / 16
      duty = duty < 0.03 ? 0.03 : duty > 0.97 ? 0.97 : duty
    }
    v.duty = duty
  }

  private renderVoices(start: number, end: number, auth: boolean): void {
    const p = this.p
    const mixL = this.mixL
    const mixR = this.mixR
    const baseWave = Math.round(p['osc.wave'])
    const bl = !auth
    const quant = p['env.quant'] >= 0.5
    const volSeq = this.seqs.vol
    const relCoef = Math.exp(-4.6 / Math.max(1, p['env.release'] * this.sr))
    const dac = p['out.dac'] >= 0.5
    const stereo = p['out.stereo'] > 0.001
    const table = this.table
    const gain = VOICE_GAIN
    const invSr = this.invSr
    for (const v of this.voices) {
      if (!v.active) continue
      const vg = this.velGain(v.vel) * gain
      for (let i = start; i < end; i++) {
        let need = false
        if ((v.framePos -= 1) <= 0) {
          v.framePos += this.frameLen
          this.frameTick(v)
          if (!v.active) break
          need = true
        }
        // noise wave picks long/short from duty sequence
        const wave = baseWave === W.NL || baseWave === W.NS ? (v.noiseShort ? W.NS : W.NL) : baseWave
        if (--v.ctl <= 0 || need) {
          v.ctl = CTL
          this.control(v, baseWave, auth)
        }
        let lvl: number
        if (volSeq.on) {
          lvl = volSeq.vals[v.vi] / 15
          if (v.fading) {
            v.fade *= relCoef
            if (v.fade < 1e-4) {
              v.active = false
              break
            }
            lvl *= v.fade
          }
        } else {
          lvl = v.env.next()
          if (!v.env.active) {
            v.active = false
            break
          }
        }
        let a = lvl * vg
        if (quant) a = (Math.round((lvl * this.velGain(v.vel)) * 15) / 15) * gain
        let sL = v.oscL.next(wave, v.dtL, v.duty, bl, table)
        let sR = stereo ? v.oscR.next(wave, v.dtR, v.duty, bl, table) : sL
        if (dac) {
          sL = sL > 0 ? (sL * 1.4) / (1 + 0.4 * sL) : sL
          sR = sR > 0 ? (sR * 1.4) / (1 + 0.4 * sR) : sR
        }
        mixL[i] += sL * a * v.panL
        mixR[i] += sR * a * v.panR
        v.t += invSr
      }
    }
  }

  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    if (end > this.mixL.length) {
      // only if a host ever uses blocks > 256 frames
      this.mixL = new Float32Array(end)
      this.mixR = new Float32Array(end)
    }
    const mixL = this.mixL
    const mixR = this.mixR
    for (let i = start; i < end; i++) mixL[i] = mixR[i] = 0
    const auth = this.p['osc.authentic'] >= 0.5
    this.renderVoices(start, end, auth)
    this.renderDrums(start, end, auth)
    // output: lo-fi S&H -> DC blocker -> gentle 12 dB low-pass -> gain
    const rate = OUT_RATES[Math.round(this.p['out.rate'])] ?? 0
    const shInc = rate > 0 ? rate / this.sr : 0
    const R = this.dcR
    const c = this.lpCoef
    const g = this.p['out.gain'] * 1.1
    for (let i = start; i < end; i++) {
      let l = mixL[i]
      let r = mixR[i]
      if (shInc > 0 && shInc < 1) {
        this.shAcc += shInc
        if (this.shAcc >= 1) {
          this.shAcc -= 1
          this.shL = l
          this.shR = r
        }
        l = this.shL
        r = this.shR
      }
      const yl = l - this.dcxL + R * this.dcyL
      this.dcxL = l
      this.dcyL = yl
      const yr = r - this.dcxR + R * this.dcyR
      this.dcxR = r
      this.dcyR = yr
      let ol = yl
      let or = yr
      if (c < 1) {
        this.lp1L += c * (yl - this.lp1L)
        this.lp2L += c * (this.lp1L - this.lp2L)
        this.lp1R += c * (yr - this.lp1R)
        this.lp2R += c * (this.lp1R - this.lp2R)
        ol = this.lp2L
        or = this.lp2R
      } else {
        this.lp1L = this.lp2L = yl
        this.lp1R = this.lp2R = yr
      }
      outL[i] += ol * g
      outR[i] += or * g
    }
    // denormal guard on filter states
    if (Math.abs(this.dcyL) < 1e-20) this.dcyL = 0
    if (Math.abs(this.dcyR) < 1e-20) this.dcyR = 0
  }
}

export default { id: 'chiptune', kind: 'instrument', create: (ctx) => new Chiptune(ctx) } satisfies DSPFactory
