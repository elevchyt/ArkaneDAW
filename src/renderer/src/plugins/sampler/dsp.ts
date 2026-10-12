import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { ADSR, SVF, allocVoice, panGains, type VoiceLike } from '../sdk/dsp'
import { PRECOMPUTED, declickTimes, processSample } from './process'
import { isResample, lengthFactor, stretchAndShift } from './stretch'

interface SampleData {
  sampleRate: number
  channels: Float32Array[]
}

class Voice implements VoiceLike {
  active = false
  releasing = false
  noteId = -1
  key = 60
  age = 0
  pos = 0
  rate = 1
  /** +1 forward, -1 backward (ping pong loop) */
  dir = 1
  vel = 1
  pan = 0
  /** Cut itself: frames left of the fade-out started by a newer note (0 = not cut) */
  cut = 0
  /** has rendered audio (notes starting at the same instant, e.g. a chord, don't cut each other) */
  started = false
  env: ADSR
  fl: SVF
  fr: SVF
  constructor(sr: number) {
    this.env = new ADSR(sr)
    this.fl = new SVF(sr)
    this.fr = new SVF(sr)
  }
}

const PRE = new Set<string>(PRECOMPUTED)
/** Time / pitch params: they change the sample data in the pitch-keeping stretch modes. */
const STRETCH = new Set(['stretchMode', 'pitch', 'mul', 'time', 'tempo'])
/** Cut itself fade-out: short enough to sound like a stop, long enough not to click. */
const CUT_SECONDS = 0.004

class Sampler implements InstrumentDSP {
  private p: Record<string, number> = {}
  /** original PCM from the pool */
  private raw: SampleData | null = null
  /** raw with the precomputed effects applied (rebuilt lazily when one of them changes) */
  private sample: SampleData | null = null
  private dirty = false
  private voices: Voice[]
  private clock = 0
  private bend = 0
  constructor(private ctx: DSPContext) {
    this.voices = Array.from({ length: 32 }, () => new Voice(ctx.sampleRate))
  }
  setParam(id: string, v: number): void {
    if (this.p[id] !== v) {
      if (PRE.has(id)) this.dirty = true
      else if (STRETCH.has(id)) {
        const mode = id === 'stretchMode' ? v : (this.p.stretchMode ?? 0)
        const tempoOnly = id === 'tempo' && !((this.p.time ?? 0) > 0)
        if ((id === 'stretchMode' || !isResample(mode)) && !tempoOnly) this.dirty = true
      }
    }
    this.p[id] = v
  }
  setData(data: unknown): void {
    const d = data as { sample?: SampleData } | null
    this.raw = d?.sample ?? null
    this.dirty = true
  }
  private current(): SampleData | null {
    if (this.dirty) {
      this.dirty = false
      const r = this.raw
      if (!r) this.sample = null
      else {
        let ch = processSample(r.channels, r.sampleRate, this.p)
        const mode = this.p.stretchMode ?? 0
        // pitch-keeping modes render the stretched / shifted sample here; Resample does it with the playback rate
        if (!isResample(mode) && ch.length) ch = stretchAndShift(ch, r.sampleRate, lengthFactor(this.p, ch[0].length, r.sampleRate), this.p.pitch ?? 0, mode)
        this.sample = { sampleRate: r.sampleRate, channels: ch }
      }
    }
    return this.sample
  }
  pitchBend(st: number): void {
    this.bend = st
  }
  noteOn(n: NoteOn): void {
    const s = this.current()
    if (!s || !s.channels.length) return
    const p = this.p
    if ((p.cutSelf ?? 0) >= 0.5) {
      const frames = Math.max(1, Math.round(CUT_SECONDS * this.ctx.sampleRate))
      for (const o of this.voices) if (o.active && o.started && !o.cut) o.cut = frames
    }
    const v = allocVoice(this.voices, this.clock)
    v.cut = 0
    v.started = false
    v.active = true
    v.releasing = false
    v.noteId = n.id
    v.key = n.key
    v.age = ++this.clock
    v.vel = n.vel
    v.pan = n.pan
    const resample = isResample(p.stretchMode ?? 0)
    const fine = n.fine / 100 + (resample ? (p.pitch ?? 0) / 100 : 0) + this.bend
    const semis = (p.pitchToKey ?? 1) >= 0.5 ? n.key - (p.root ?? 60) + fine : fine
    // Resample: MUL / TIME make the sample longer by playing it slower
    const slow = resample && this.raw ? lengthFactor(p, this.raw.channels[0]?.length ?? 0, this.raw.sampleRate) : 1
    v.rate = (Math.pow(2, semis / 12) * (s.sampleRate / this.ctx.sampleRate)) / slow
    const len = s.channels[0].length
    v.pos = (p.start ?? 0) * len
    v.dir = 1
    const dc = declickTimes(p.declick ?? 0)
    v.env.set(Math.max(0.0005, p.attack ?? 0, dc.attack), p.decay ?? 8, p.sustain ?? 1, Math.max(p.release ?? 0.02, dc.release))
    v.env.reset()
    v.env.gate(true)
    v.fl.reset()
    v.fr.reset()
    const fc = (p.cutoff ?? 20000) * Math.pow(2, (n.modX - 0.5) * 4)
    v.fl.set(fc, (p.res ?? 0.7) + (n.modY - 0.5))
    v.fr.set(fc, (p.res ?? 0.7) + (n.modY - 0.5))
  }
  noteOff(id: number): void {
    if ((this.p.oneShot ?? 1) >= 0.5) return
    for (const v of this.voices) if (v.active && v.noteId === id) {
      v.releasing = true
      v.env.gate(false)
    }
  }
  allNotesOff(hard: boolean): void {
    for (const v of this.voices) {
      if (hard) v.active = false
      else if (v.active) {
        v.releasing = true
        v.env.gate(false)
      }
    }
  }
  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const s = this.current()
    if (!s) return
    const L = s.channels[0]
    const R = s.channels[1] ?? L
    const len = L.length
    const loop = (this.p.loop ?? 0) >= 0.5
    const pingPong = (this.p.pingPong ?? 0) >= 0.5
    // loop region in frames (at least 2 frames wide)
    const ls = Math.max(0, Math.min(len - 2, Math.floor((this.p.loopStart ?? 0) * len)))
    const le = Math.max(ls + 1, Math.min(len - 1, Math.floor((this.p.loopEnd ?? 1) * len)))
    const gain = this.p.gain ?? 1
    const filt = (this.p.cutoff ?? 20000) < 19500
    const cutFrames = Math.max(1, Math.round(CUT_SECONDS * this.ctx.sampleRate))
    for (const v of this.voices) {
      if (!v.active) continue
      if (end > start) v.started = true
      const [gl, gr] = panGains(v.pan)
      for (let i = start; i < end; i++) {
        let pos = v.pos
        if (loop && v.dir > 0 && pos >= le) {
          if (pingPong) {
            v.dir = -1
            pos = le - (pos - le)
          } else pos = ls + (pos - le)
        } else if (loop && v.dir < 0 && pos < ls) {
          v.dir = 1
          pos = ls + (ls - pos)
        }
        if (pos >= len - 1 || pos < 0) {
          v.active = false
          break
        }
        const i0 = pos | 0
        const f = pos - i0
        let l = L[i0] + (L[i0 + 1] - L[i0]) * f
        let r = R[i0] + (R[i0 + 1] - R[i0]) * f
        if (filt) {
          l = v.fl.process(l)
          r = v.fr.process(r)
        }
        let a = v.env.next() * v.vel * gain
        if (v.cut) {
          a *= v.cut / cutFrames
          if (--v.cut === 0) {
            v.active = false
            break
          }
        }
        outL[i] += l * a * gl
        outR[i] += r * a * gr
        v.pos = pos + v.rate * v.dir
      }
      if (!v.env.active) v.active = false
    }
  }
}

export default { id: 'sampler', kind: 'instrument', create: (ctx) => new Sampler(ctx) } satisfies DSPFactory
