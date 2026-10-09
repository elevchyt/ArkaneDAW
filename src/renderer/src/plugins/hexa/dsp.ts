// Hexa — DX7-style 6-operator FM synthesizer (AudioWorklet side).
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { Biquad, panGains } from '../sdk/dsp'
import { CHUNK, SIN_CLEAN, SIN_VINTAGE, Voice, noteToLog2, type ModState } from './engine'
import { PMS_TAB, lfoDelayTimes, lfoHz, portaSeconds } from './tables'
import { G, VOICE_PARAM_MAP, VCED_MAX, initVoice } from './voice'

const MAX_VOICES = 32
/** Output scale: one carrier at full level (2 cycles) ≈ 0.22 peak at 0 dB volume. */
const OUT_SCALE = 0.11

interface HeldNote {
  id: number
  key: number
  vel: number
}

export class HexaSynth implements InstrumentDSP {
  readonly patch: Uint8Array = initVoice()
  private readonly sr: number
  readonly voices: Voice[]
  private polyN = 16
  private mono = false
  private porta = 0
  private bendRange = 2
  private bendParam = 0
  private hostBend = 0
  private gainDb = 0
  private vintage = false
  private dirty = false
  private clock = 0
  private lastPitch = noteToLog2(60)
  private readonly held: HeldNote[] = []
  // LFO (global, like the DX7)
  private lfoPhase = 0
  private lfoSH = 0.5
  private lfoRand = 1
  private delayT = 0
  private readonly mod: ModState
  private readonly mixL = new Float32Array(CHUNK)
  private readonly mixR = new Float32Array(CHUNK)
  private readonly lpL: Biquad
  private readonly lpR: Biquad
  private wheelDest = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice(this.sr))
    this.mod = {
      lfo: 0.5, delay: 1, bend: 0, pmd: 0, amd: 0, wheelRange: (50 * 165) >> 7, wheelPitch: true, wheelAmp: false, wheel: 0, pms: 0,
      opOn: new Uint8Array([1, 1, 1, 1, 1, 1]), tab: SIN_CLEAN, sampleRate: this.sr
    }
    this.lpL = new Biquad(this.sr)
    this.lpR = new Biquad(this.sr)
    this.lpL.set('lp', Math.min(10500, this.sr * 0.45), 0.6)
    this.lpR.set('lp', Math.min(10500, this.sr * 0.45), 0.6)
  }

  setParam(id: string, value: number): void {
    const vp = VOICE_PARAM_MAP.get(id)
    if (vp) {
      const b = Math.min(VCED_MAX[vp.off], Math.max(0, Math.round(value + vp.add)))
      if (this.patch[vp.off] !== b) {
        this.patch[vp.off] = b
        this.dirty = true
      }
      return
    }
    if (id.length === 6 && id.startsWith('op') && id.endsWith('.on')) {
      const i = +id[2] - 1
      if (i >= 0 && i < 6) this.mod.opOn[i] = value >= 0.5 ? 1 : 0
      return
    }
    switch (id) {
      case 'master.gain': this.gainDb = value; break
      case 'master.vintage': this.vintage = value >= 0.5; this.mod.tab = this.vintage ? SIN_VINTAGE : SIN_CLEAN; break
      case 'master.poly': {
        const n = value >= 0.5 ? 32 : 16
        if (n < this.polyN) for (let i = n; i < MAX_VOICES; i++) this.voices[i].kill()
        this.polyN = n
        break
      }
      case 'master.mono': {
        const m = value >= 0.5
        if (m !== this.mono) {
          this.allNotesOff(false)
          this.held.length = 0
        }
        this.mono = m
        break
      }
      case 'master.porta': this.porta = value; break
      case 'master.bendRange': this.bendRange = value; break
      case 'master.bend': this.bendParam = value; break
      case 'mw.wheel': this.mod.wheel = Math.min(1, Math.max(0, value)); break
      case 'mw.range': this.mod.wheelRange = (Math.round(value) * 165) >> 7; break
      case 'mw.dest': this.wheelDest = Math.round(value); break
    }
  }

  setData(): void {
    // The voice lives entirely in params; cartridge data is UI-side only.
  }

  pitchBend(semitones: number): void {
    this.hostBend = semitones
  }

  private transposed(key: number): number {
    return key + this.patch[G.trnp] - 24
  }

  private glideCoef(forced: boolean): number {
    const t = portaSeconds(this.porta) || (forced ? 0.06 : 0)
    return t > 0 ? Math.exp(-1 / (t * this.sr)) : 0
  }

  private lfoKeyDown(): void {
    if (this.patch[G.lfks]) this.lfoPhase = 0.5
    this.delayT = 0
  }

  private trigger(v: Voice, n: { id: number; key: number }, vel: number, pan: number, modX: number, modY: number, glideFrom: number | null, forcedGlide: boolean): void {
    const retrigger = v.active
    v.active = true
    v.releasing = false
    v.noteId = n.id
    v.key = n.key
    v.age = ++this.clock
    v.pan = pan
    const [gl, gr] = panGains(pan)
    v.gl = gl
    v.gr = gr
    v.wheel = modY > 0.5 ? Math.min(1, (modY - 0.5) * 2) : 0
    v.bright = (modX - 0.5) * 4
    const note = this.transposed(n.key)
    v.start(this.patch, note, vel, retrigger, this.patch[G.oks] !== 0)
    v.target = noteToLog2(note)
    v.glideCoef = this.glideCoef(forcedGlide)
    v.pitch = glideFrom !== null && v.glideCoef > 0 ? glideFrom : v.target
    this.lastPitch = v.target
  }

  private alloc(): Voice {
    let best: Voice | null = null
    const n = this.polyN
    for (let i = 0; i < n; i++) if (!this.voices[i].active) return this.voices[i]
    for (let i = 0; i < n; i++) {
      const v = this.voices[i]
      if (v.releasing && (!best || v.age < best.age)) best = v
    }
    if (best) return best
    for (let i = 0; i < n; i++) {
      const v = this.voices[i]
      if (!best || v.age < best.age) best = v
    }
    return best!
  }

  noteOn(n: NoteOn): void {
    const vel = Math.max(1, Math.min(127, Math.round(n.vel * 127)))
    if (this.dirty) this.refresh()
    if (n.slide) {
      // glide the most recent sounding voice to the new pitch without retriggering
      let v: Voice | null = null
      for (const x of this.voices) if (x.active && !x.releasing && (!v || x.age > v.age)) v = x
      if (v) {
        const note = this.transposed(n.key)
        v.setNote(this.patch, note)
        v.key = n.key
        v.target = noteToLog2(note)
        v.glideCoef = this.glideCoef(true)
        this.lastPitch = v.target
        return
      }
    }
    if (this.mono) {
      this.held.push({ id: n.id, key: n.key, vel })
      if (this.held.length > 64) this.held.shift()
      const v = this.voices[0]
      if (v.active && !v.releasing) {
        // legato (DX7 "fingered" portamento): no envelope retrigger
        const note = this.transposed(n.key)
        v.noteId = n.id
        v.key = n.key
        v.setNote(this.patch, note)
        v.target = noteToLog2(note)
        v.glideCoef = this.glideCoef(n.porta)
        this.lastPitch = v.target
        return
      }
      this.lfoKeyDown()
      this.trigger(v, n, vel, n.pan, n.modX, n.modY, this.lastPitch, n.porta)
      return
    }
    this.lfoKeyDown()
    this.trigger(this.alloc(), n, vel, n.pan, n.modX, n.modY, this.lastPitch, n.porta)
  }

  noteOff(id: number, _key?: number, _rel?: number): void {
    if (this.mono) {
      const idx = this.held.findIndex((h) => h.id === id)
      if (idx >= 0) this.held.splice(idx, 1)
      const v = this.voices[0]
      if (v.active && !v.releasing && v.noteId === id) {
        const top = this.held[this.held.length - 1]
        if (top) {
          const note = this.transposed(top.key)
          v.noteId = top.id
          v.key = top.key
          v.setNote(this.patch, note)
          v.target = noteToLog2(note)
          v.glideCoef = this.glideCoef(false)
          this.lastPitch = v.target
        } else {
          v.releasing = true
          v.keyup()
        }
      }
      return
    }
    for (const v of this.voices) {
      if (v.active && !v.releasing && v.noteId === id) {
        v.releasing = true
        v.keyup()
      }
    }
  }

  allNotesOff(hard: boolean): void {
    this.held.length = 0
    for (const v of this.voices) {
      if (hard) v.kill()
      else if (v.active && !v.releasing) {
        v.releasing = true
        v.keyup()
      }
    }
  }

  private refresh(): void {
    this.dirty = false
    for (const v of this.voices) if (v.active) v.refresh(this.patch)
  }

  private stepLfo(n: number): void {
    const p = this.patch
    const m = this.mod
    const ph0 = this.lfoPhase
    let ph = ph0 + (lfoHz(p[G.lfs]) * n) / this.sr
    if (ph >= 1) {
      ph -= Math.floor(ph)
      this.lfoRand = (this.lfoRand * 179 + 17) & 0xff
      this.lfoSH = ((this.lfoRand ^ 0x80) + 1) / 256
    }
    this.lfoPhase = ph
    let v: number
    switch (p[G.lfw]) {
      case 0: v = ph < 0.5 ? ph * 2 : 2 - ph * 2; break // triangle
      case 1: v = 1 - ((ph + 0.5) % 1); break // saw down
      case 2: v = (ph + 0.5) % 1; break // saw up
      case 3: v = ph < 0.5 ? 1 : 0; break // square
      case 4: v = 0.5 + 0.5 * Math.sin(2 * Math.PI * ph); break // sine
      default: v = this.lfoSH // sample & hold
    }
    m.lfo = v
    // delay: silent wait, then fade in
    const [d1, d2] = lfoDelayTimes(p[G.lfd])
    this.delayT += n / this.sr
    m.delay = d1 + d2 <= 0 ? 1 : this.delayT < d1 ? 0 : this.delayT < d1 + d2 ? (this.delayT - d1) / d2 : 1
    m.pmd = (p[G.pmd] * 165) >> 7
    m.amd = (p[G.amd] * 165) >> 7
    m.pms = PMS_TAB[p[G.pms] & 7]
    m.bend = (this.hostBend + this.bendParam * this.bendRange) / 12
    m.wheelPitch = this.wheelDest !== 1
    m.wheelAmp = this.wheelDest !== 0
  }

  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    if (this.dirty) this.refresh()
    const gain = OUT_SCALE * Math.pow(10, this.gainDb / 20)
    const vintage = this.vintage
    for (let pos = start; pos < end; pos += CHUNK) {
      const n = Math.min(CHUNK, end - pos)
      this.stepLfo(n)
      const mixL = this.mixL
      const mixR = this.mixR
      mixL.fill(0)
      mixR.fill(0)
      let any = false
      for (let vi = 0; vi < MAX_VOICES; vi++) {
        const v = this.voices[vi]
        if (!v.active) continue
        any = true
        const alive = v.render(n, this.mod)
        const buf = v.buf
        const gl = v.gl
        const gr = v.gr
        for (let i = 0; i < n; i++) {
          mixL[i] += buf[i] * gl
          mixR[i] += buf[i] * gr
        }
        if (!alive) v.kill()
      }
      if (!any && !vintage) continue
      for (let i = 0; i < n; i++) {
        let l = mixL[i] * gain
        let r = mixR[i] * gain
        if (vintage) {
          l = this.lpL.process(dac(l))
          r = this.lpR.process(dac(r))
        }
        outL[pos + i] += l
        outR[pos + i] += r
      }
    }
  }
}

/** DX7-style floating-point DAC: 12-bit mantissa with a 3-bit exponent, hard clipping at full scale. */
function dac(x: number): number {
  if (x > 1) return 1
  if (x < -1) return -1
  const a = x < 0 ? -x : x
  let step = 1 / 2048
  let lim = 0.5
  for (let e = 0; e < 7 && a < lim; e++) {
    step *= 0.5
    lim *= 0.5
  }
  return Math.round(x / step) * step
}

export default { id: 'hexa', kind: 'instrument', create: (ctx) => new HexaSynth(ctx) } satisfies DSPFactory
