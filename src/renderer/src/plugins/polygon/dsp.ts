// Polygon DSP: 4-tone ROMpler voice architecture (JV-1080 / D-50 style) over the procedural virtual ROM.
//   Tone = ROM wave (linear interp, optional bit reduction) -> TVF (SVF LPF/HPF/BPF/PKG + 4-stage env)
//          -> TVA (T1-T4 / L1-L3 env) with pitch env, per-tone LFO (vibrato/filter/tremolo), pan, key range.
//   Patch = up to 4 tones, 32 voices, mono/legato/portamento, "analog feel" drift,
//          DAC sample-rate emulation -> chorus -> ping-pong delay -> lo-fi digital reverb.
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { LFO, SVF, allocVoice, type VoiceLike } from '../sdk/dsp'
import { ROM_SR, getMulti, prepareStep, type Multi } from './rom'
import { Chorus, LoFiReverb, PingPong } from './fx'
import { COMMON_PARAMS, NUM_TONES, toneParams } from './params'
import { WAVE_NAMES } from './waves'

const SUB = 16
const MAX_VOICES = 32
const OUT_GAIN = 0.43
const FMODE = [0, 0, 1, 2, 4] // Off, LPF, HPF, BPF, PKG -> SVF modes
const LFO_SHAPE = [1, 0, 2, 3, 4] // Tri, Sine, Saw, Square, S&H -> sdk LFO shapes
const BIT_Q = [0, 2048, 128]
const DAC = [0, 32000, 24000, 16000]

/** Per-tone parameter block (field names = param id suffixes). */
class ToneP {
  on = 0; wave = 0; level = 0.8; pan = 0; coarse = 0; fine = 0; keyLo = 0; keyHi = 127; velSens = 0.5
  pDepth = 0; pTime = 0.1
  fType = 1; cutoff = 16000; res = 0; fKey = 0.5; fEnv = 0; fVel = 0.3
  fT1 = 0; fT2 = 0; fT3 = 0; fT4 = 0; fL1 = 1; fL2 = 0.5; fL3 = 0.3
  aT1 = 0; aT2 = 0; aT3 = 0; aT4 = 0; aL1 = 1; aL2 = 1; aL3 = 1
  lfoWave = 1; lfoRate = 5; lfoDelay = 0; lfoFade = 0; lfoPitch = 0; lfoFilter = 0; lfoAmp = 0
}

/** JV-style 4-time / 3-level envelope, evaluated at control rate (linear segments in "level" space). */
class Env {
  stage = 0 // 0 idle, 1..3 segments, 4 sustain, 5 release
  val = 0
  private from = 0
  private to = 0
  private dur = 0
  private t = 0
  private T1 = 0; private T2 = 0; private T3 = 0
  private L1 = 0; private L2 = 0; private L3 = 0
  constructor(private ampMode: boolean) {}
  start(T1: number, T2: number, T3: number, L1: number, L2: number, L3: number, from: number): void {
    this.T1 = T1; this.T2 = T2; this.T3 = T3
    this.L1 = L1; this.L2 = L2; this.L3 = L3
    this.val = from
    this.enter(1)
  }
  release(T4: number): void {
    if (this.stage === 0) return
    this.stage = 5
    this.from = this.val
    this.to = 0
    this.dur = T4
    this.t = 0
  }
  private enter(st: number): void {
    this.stage = st
    this.from = this.val
    this.t = 0
    if (st === 1) { this.to = this.L1; this.dur = this.T1 }
    else if (st === 2) { this.to = this.L2; this.dur = this.T2 }
    else if (st === 3) { this.to = this.L3; this.dur = this.T3 }
  }
  advance(dt: number): number {
    const st = this.stage
    if (st === 0 || st === 4) return this.val
    this.t += dt
    while (this.t >= this.dur) {
      this.val = this.to
      this.t -= this.dur
      if (this.stage === 5) {
        this.stage = 0
        this.val = 0
        return 0
      }
      if (this.stage === 3) {
        this.stage = this.ampMode && this.L3 <= 0.0005 ? 0 : 4
        return this.val
      }
      this.enter(this.stage + 1)
    }
    this.val = this.from + (this.to - this.from) * (this.t / this.dur)
    return this.val
  }
}

class ToneVoice {
  active = false
  m: Multi | null = null
  pos = 0
  t = 0
  amp = 0
  gl = 1
  gr = 1
  velAmp = 1
  cutOct = 0
  tva = new Env(true)
  tvf = new Env(false)
  lfo = new LFO()
  flt: SVF
  constructor(sr: number) {
    this.flt = new SVF(sr)
  }
}

class Voice implements VoiceLike {
  active = false
  releasing = false
  noteId = -1
  key = 60
  age = 0
  vel = 0.8
  modX = 0.5
  modY = 0.5
  fine = 0
  pitch = 60
  target = 60
  driftPh = 0
  driftRate = 0.3
  driftOff = 0
  tones: ToneVoice[]
  constructor(sr: number) {
    this.tones = Array.from({ length: NUM_TONES }, () => new ToneVoice(sr))
  }
}

class Polygon implements InstrumentDSP {
  private sr: number
  private romRatio: number
  private tp: ToneP[] = Array.from({ length: NUM_TONES }, () => new ToneP())
  private c: Record<string, number> = {}
  private voices: Voice[]
  private clock = 0
  private bend = 0
  private lastKey = 60
  private monoStack: { id: number; key: number }[] = []
  private prepQueue: number[] = []
  private mixL = new Float32Array(128)
  private mixR = new Float32Array(128)
  private chorus: Chorus
  private delay: PingPong
  private reverb: LoFiReverb
  private dacAcc = 0
  private holdL = 0
  private holdR = 0
  private fxDirty = true

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.romRatio = ROM_SR / this.sr
    this.voices = Array.from({ length: MAX_VOICES }, () => new Voice(this.sr))
    this.chorus = new Chorus(this.sr)
    this.delay = new PingPong(this.sr)
    this.reverb = new LoFiReverb(this.sr)
    for (const d of COMMON_PARAMS) this.c[d.id] = d.default
    for (let n = 1; n <= NUM_TONES; n++) for (const d of toneParams(n)) this.setParam(d.id, d.default)
  }

  setParam(id: string, v: number): void {
    if (id.charCodeAt(0) === 116 /* t */ && id.charCodeAt(2) === 46 /* . */) {
      const k = id.charCodeAt(1) - 49
      const tp = this.tp[k]
      if (!tp) return
      const f = id.slice(3)
      ;(tp as unknown as Record<string, number>)[f] = v
      if (f === 'wave' || (f === 'on' && v >= 0.5)) {
        const wi = Math.round(tp.wave)
        tp.wave = Math.max(0, Math.min(WAVE_NAMES.length - 1, wi))
        if (tp.on >= 0.5 && !this.prepQueue.includes(tp.wave)) this.prepQueue.push(tp.wave)
      }
      return
    }
    this.c[id] = v
    if (id.startsWith('fx.')) this.fxDirty = true
  }

  pitchBend(st: number): void {
    this.bend = st
  }

  private trigger(v: Voice, n: NoteOn, fromPitch: number): void {
    v.active = true
    v.releasing = false
    v.noteId = n.id
    v.key = n.key
    v.age = ++this.clock
    v.vel = n.vel
    v.modX = n.modX
    v.modY = n.modY
    v.fine = n.fine
    v.target = n.key
    v.pitch = fromPitch
    v.driftPh = Math.random()
    v.driftRate = 0.15 + Math.random() * 0.45
    v.driftOff = Math.random() * 2 - 1
    let any = false
    for (let k = 0; k < NUM_TONES; k++) {
      const tp = this.tp[k]
      const tv = v.tones[k]
      if (tp.on < 0.5 || n.key < tp.keyLo || n.key > tp.keyHi) {
        tv.active = false
        continue
      }
      any = true
      tv.active = true
      tv.m = getMulti(tp.wave, n.key + tp.coarse)
      tv.pos = 0
      tv.t = 0
      tv.amp = 0
      tv.tva.start(tp.aT1, tp.aT2, tp.aT3, tp.aL1, tp.aL2, tp.aL3, 0)
      tv.tvf.start(tp.fT1, tp.fT2, tp.fT3, tp.fL1, tp.fL2, tp.fL3, 0)
      tv.flt.reset()
      tv.lfo.phase = 0
      tv.velAmp = 1 - tp.velSens + tp.velSens * Math.pow(n.vel, 1.6)
      tv.cutOct = (tp.fKey * (n.key - 60)) / 12 + tp.fVel * 4 * (n.vel - 1)
      const p = Math.max(-1, Math.min(1, tp.pan + n.pan))
      const a = ((p + 1) * Math.PI) / 4
      tv.gl = Math.cos(a) * Math.SQRT2
      tv.gr = Math.sin(a) * Math.SQRT2
    }
    if (!any) v.active = false
  }

  private releaseVoice(v: Voice): void {
    v.releasing = true
    for (let k = 0; k < NUM_TONES; k++) {
      const tv = v.tones[k]
      if (!tv.active) continue
      tv.tva.release(this.tp[k].aT4)
      tv.tvf.release(this.tp[k].fT4)
    }
  }

  private newest(): Voice | null {
    let best: Voice | null = null
    for (const v of this.voices) if (v.active && !v.releasing && (!best || v.age > best.age)) best = v
    return best
  }

  noteOn(n: NoteOn): void {
    const c = this.c
    if (n.slide) {
      const v = this.newest()
      if (v) v.target = n.key
      this.lastKey = n.key
      return
    }
    const glide = c['com.porta'] > 0 || n.porta
    if (c['com.mono'] >= 0.5) {
      this.monoStack = this.monoStack.filter((s) => s.id !== n.id)
      this.monoStack.push({ id: n.id, key: n.key })
      if (this.monoStack.length > 16) this.monoStack.shift()
      const v = this.voices[0]
      for (let i = 1; i < this.voices.length; i++) if (this.voices[i].active) this.releaseVoice(this.voices[i])
      if (v.active && !v.releasing && c['com.legato'] >= 0.5) {
        v.noteId = n.id
        v.target = n.key
        if (!glide) v.pitch = n.key
      } else {
        this.trigger(v, n, glide && v.active ? v.pitch : glide ? this.lastKey : n.key)
      }
    } else {
      const v = allocVoice(this.voices, this.clock)
      this.trigger(v, n, n.porta ? this.lastKey : n.key)
    }
    this.lastKey = n.key
  }

  noteOff(id: number): void {
    if (this.c['com.mono'] >= 0.5) {
      const top = this.monoStack.length ? this.monoStack[this.monoStack.length - 1] : null
      this.monoStack = this.monoStack.filter((s) => s.id !== id)
      const v = this.voices[0]
      if (top && top.id === id && v.active && v.noteId === id) {
        const prev = this.monoStack[this.monoStack.length - 1]
        if (prev) {
          v.noteId = prev.id
          v.target = prev.key
          if (this.c['com.porta'] <= 0) v.pitch = prev.key
          this.lastKey = prev.key
        } else this.releaseVoice(v)
      }
      return
    }
    for (const v of this.voices) if (v.active && v.noteId === id && !v.releasing) this.releaseVoice(v)
  }

  allNotesOff(hard: boolean): void {
    this.monoStack = []
    for (const v of this.voices) {
      if (!v.active) continue
      if (hard) {
        v.active = false
        for (const tv of v.tones) tv.active = false
      } else this.releaseVoice(v)
    }
    if (hard) {
      this.chorus.clear()
      this.delay.clear()
      this.reverb.clear()
    }
  }

  private renderVoice(v: Voice, start: number, end: number): void {
    const sr = this.sr
    const mixL = this.mixL
    const mixR = this.mixR
    const porta = Math.max(0.03, this.c['com.porta'] > 0 ? this.c['com.porta'] : 0.08)
    const drift = this.c['com.drift']
    const q = BIT_Q[this.c['com.bits'] | 0] ?? 0
    const iq = q ? 1 / q : 0
    for (let s = start; s < end; s += SUB) {
      const e = Math.min(end, s + SUB)
      const n = e - s
      const dt = n / sr
      if (v.pitch !== v.target) {
        v.pitch = v.target + (v.pitch - v.target) * Math.exp(-dt / (porta * 0.3))
        if (Math.abs(v.pitch - v.target) < 0.002) v.pitch = v.target
      }
      v.driftPh += v.driftRate * dt
      if (v.driftPh > 1) v.driftPh -= 1
      const base = v.pitch + this.bend + v.fine / 100 + (drift * (5 * Math.sin(6.283185 * v.driftPh) + 4 * v.driftOff)) / 100
      let alive = false
      for (let k = 0; k < NUM_TONES; k++) {
        const tv = v.tones[k]
        if (!tv.active) continue
        const tp = this.tp[k]
        const m = tv.m!
        tv.t += dt
        // LFO (key-synced, delay + fade-in)
        let lv = 0
        if (tp.lfoPitch > 0 || tp.lfoFilter > 0 || tp.lfoAmp > 0) {
          lv = tv.lfo.next(LFO_SHAPE[tp.lfoWave | 0] ?? 0, tp.lfoRate * dt)
          const lt = tv.t - tp.lfoDelay
          lv *= lt <= 0 ? 0 : tp.lfoFade > 0 && lt < tp.lfoFade ? lt / tp.lfoFade : 1
        }
        // pitch
        let pitch = base + tp.coarse + tp.fine / 100 + (lv * tp.lfoPitch) / 100
        if (tp.pDepth !== 0 && tv.t < tp.pTime) {
          const x = 1 - tv.t / tp.pTime
          pitch += tp.pDepth * x * x
        }
        const inc = this.romRatio * Math.pow(2, (pitch - m.root) / 12)
        // TVA
        const a = tv.tva.advance(dt)
        let target = a * a * tp.level * tv.velAmp
        if (tp.lfoAmp > 0) target *= 1 - tp.lfoAmp * (0.5 + 0.5 * lv)
        const da = (target - tv.amp) / n
        // TVF
        const ft = tp.fType | 0
        if (ft > 0) {
          const fe = tv.tvf.advance(dt)
          const oct = tp.fEnv * fe + tv.cutOct + lv * tp.lfoFilter + (v.modX - 0.5) * 4
          let fc = tp.cutoff * Math.pow(2, oct)
          fc = fc < 20 ? 20 : fc > 20000 ? 20000 : fc
          let r = tp.res + (v.modY - 0.5) * 0.6
          r = r < 0 ? 0 : r > 1 ? 1 : r
          tv.flt.mode = FMODE[ft]
          tv.flt.set(fc, 0.6 * Math.pow(30, r))
        }
        // render
        const d = m.data
        const le = m.loopEnd
        const ll = le - m.loopStart
        const one = m.oneShot
        const flt = tv.flt
        const gl = tv.gl
        const gr = tv.gr
        let pos = tv.pos
        let amp = tv.amp
        let ended = false
        for (let i = s; i < e; i++) {
          const ip = pos | 0
          const x0 = d[ip]
          let x = x0 + (d[ip + 1] - x0) * (pos - ip)
          if (q) x = Math.round(x * q) * iq
          if (ft > 0) x = flt.process(x)
          amp += da
          x *= amp
          mixL[i] += x * gl
          mixR[i] += x * gr
          pos += inc
          if (pos >= le) {
            if (one) {
              ended = true
              break
            }
            pos -= ll
            if (pos >= le) pos = m.loopStart
          }
        }
        tv.pos = pos
        tv.amp = amp
        if (ended || tv.tva.stage === 0) tv.active = false
        else alive = true
      }
      if (!alive) {
        v.active = false
        return
      }
    }
  }

  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    // Build pending ROM multisamples incrementally (at most one per audio block) so preset loads don't stall audio.
    if (start === 0 && this.prepQueue.length && !prepareStep(this.prepQueue[0])) this.prepQueue.shift()
    const c = this.c
    if (this.fxDirty) {
      this.fxDirty = false
      this.chorus.set(c['fx.chType'] | 0, c['fx.chRate'], c['fx.chDepth'])
      this.delay.set(c['fx.dlyTime'], c['fx.dlyFb'])
      this.reverb.set(c['fx.revType'] | 0, c['fx.revTime'], c['fx.revTone'])
    }
    const mixL = this.mixL
    const mixR = this.mixR
    mixL.fill(0, start, end)
    mixR.fill(0, start, end)
    for (const v of this.voices) if (v.active) this.renderVoice(v, start, end)

    const g = c['com.level'] * OUT_GAIN
    const dacRate = DAC[c['com.dac'] | 0] ?? 0
    const dacInc = dacRate ? dacRate / this.sr : 0
    const chL = c['fx.chorus']
    const dlL = c['fx.delay']
    const rvL = c['fx.reverb']
    const chorus = this.chorus
    const delay = this.delay
    const reverb = this.reverb
    for (let i = start; i < end; i++) {
      let l = mixL[i] * g
      let r = mixR[i] * g
      if (dacInc) {
        this.dacAcc += dacInc
        if (this.dacAcc >= 1) {
          this.dacAcc -= 1
          this.holdL = l
          this.holdR = r
        }
        l = this.holdL
        r = this.holdR
      }
      if (chL > 0) {
        chorus.process(l, r)
        l += chorus.oL * chL
        r += chorus.oR * chL
      }
      if (dlL > 0) {
        delay.process(l, r)
        l += delay.oL * dlL
        r += delay.oR * dlL
      }
      if (rvL > 0) {
        reverb.process(l, r)
        l += reverb.oL * rvL
        r += reverb.oR * rvL
      }
      // soft ceiling above -1 dBFS-ish
      if (l > 0.9) l = 0.9 + 0.1 * Math.tanh((l - 0.9) * 10)
      else if (l < -0.9) l = -0.9 + 0.1 * Math.tanh((l + 0.9) * 10)
      if (r > 0.9) r = 0.9 + 0.1 * Math.tanh((r - 0.9) * 10)
      else if (r < -0.9) r = -0.9 + 0.1 * Math.tanh((r + 0.9) * 10)
      outL[i] += l
      outR[i] += r
    }
  }
}

export default { id: 'polygon', kind: 'instrument', create: (ctx) => new Polygon(ctx) } satisfies DSPFactory
