import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { ADSR, SVF, allocVoice, panGains, type VoiceLike } from '../sdk/dsp'

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
  vel = 1
  pan = 0
  env: ADSR
  fl: SVF
  fr: SVF
  constructor(sr: number) {
    this.env = new ADSR(sr)
    this.fl = new SVF(sr)
    this.fr = new SVF(sr)
  }
}

class Sampler implements InstrumentDSP {
  private p: Record<string, number> = {}
  private sample: SampleData | null = null
  private voices: Voice[]
  private clock = 0
  private bend = 0
  constructor(private ctx: DSPContext) {
    this.voices = Array.from({ length: 32 }, () => new Voice(ctx.sampleRate))
  }
  setParam(id: string, v: number): void {
    this.p[id] = v
  }
  setData(data: unknown): void {
    const d = data as { sample?: SampleData } | null
    this.sample = d?.sample ?? null
  }
  pitchBend(st: number): void {
    this.bend = st
  }
  noteOn(n: NoteOn): void {
    const s = this.sample
    if (!s || !s.channels.length) return
    const v = allocVoice(this.voices, this.clock)
    const p = this.p
    v.active = true
    v.releasing = false
    v.noteId = n.id
    v.key = n.key
    v.age = ++this.clock
    v.vel = n.vel
    v.pan = n.pan
    const semis = (p.pitchToKey ?? 1) >= 0.5 ? n.key - (p.root ?? 60) + n.fine / 100 + this.bend : n.fine / 100 + this.bend
    v.rate = Math.pow(2, semis / 12) * (s.sampleRate / this.ctx.sampleRate)
    const len = s.channels[0].length
    v.pos = (p.reverse ?? 0) >= 0.5 ? len - 1 - (p.start ?? 0) * len : (p.start ?? 0) * len
    v.env.set(Math.max(0.0005, p.attack ?? 0), p.decay ?? 8, p.sustain ?? 1, p.release ?? 0.02)
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
    const s = this.sample
    if (!s) return
    const L = s.channels[0]
    const R = s.channels[1] ?? L
    const len = L.length
    const rev = (this.p.reverse ?? 0) >= 0.5
    const loop = (this.p.loop ?? 0) >= 0.5
    const gain = this.p.gain ?? 1
    const filt = (this.p.cutoff ?? 20000) < 19500
    for (const v of this.voices) {
      if (!v.active) continue
      const [gl, gr] = panGains(v.pan)
      const step = rev ? -v.rate : v.rate
      for (let i = start; i < end; i++) {
        let pos = v.pos
        if (pos >= len - 1 || pos < 0) {
          if (loop) pos = rev ? len - 2 : 0
          else {
            v.active = false
            break
          }
        }
        const i0 = pos | 0
        const f = pos - i0
        let l = L[i0] + (L[i0 + 1] - L[i0]) * f
        let r = R[i0] + (R[i0 + 1] - R[i0]) * f
        if (filt) {
          l = v.fl.process(l)
          r = v.fr.process(r)
        }
        const a = v.env.next() * v.vel * gain
        outL[i] += l * a * gl
        outR[i] += r * a * gr
        v.pos = pos + step
      }
      if (!v.env.active) v.active = false
    }
  }
}

export default { id: 'sampler', kind: 'instrument', create: (ctx) => new Sampler(ctx) } satisfies DSPFactory
