import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { ADSR, Osc, SVF, allocVoice, clamp, mtof, panGains, type VoiceLike } from '../sdk/dsp'

class Voice implements VoiceLike {
  active = false
  releasing = false
  noteId = -1
  key = 60
  age = 0
  vel = 1
  pan = 0
  fine = 0
  pitch = 60 // current (glides toward key)
  modX = 0.5
  oscs = [new Osc(), new Osc(), new Osc()]
  amp: ADSR
  fenv: ADSR
  filtL: SVF
  constructor(sr: number) {
    this.amp = new ADSR(sr)
    this.fenv = new ADSR(sr)
    this.filtL = new SVF(sr)
  }
}

class TriOsc implements InstrumentDSP {
  private p: Record<string, number> = {}
  private voices: Voice[]
  private clock = 0
  private bend = 0
  private lastPitch = 60
  constructor(private ctx: DSPContext) {
    this.voices = Array.from({ length: 16 }, () => new Voice(ctx.sampleRate))
  }
  setParam(id: string, v: number): void {
    this.p[id] = v
  }
  pitchBend(st: number): void {
    this.bend = st
  }
  noteOn(n: NoteOn): void {
    const v = allocVoice(this.voices, this.clock)
    v.active = true
    v.releasing = false
    v.noteId = n.id
    v.key = n.key
    v.age = ++this.clock
    v.vel = n.vel
    v.pan = n.pan
    v.fine = n.fine
    v.modX = n.modX
    v.pitch = (this.p['master.glide'] ?? 0) > 0 || n.porta ? this.lastPitch : n.key
    this.lastPitch = n.key
    v.amp.set(this.p['amp.attack'], this.p['amp.decay'], this.p['amp.sustain'], this.p['amp.release'])
    v.fenv.set(0.002, this.p['amp.decay'], 0, this.p['amp.release'])
    v.amp.reset()
    v.fenv.reset()
    v.amp.gate(true)
    v.fenv.gate(true)
    v.filtL.reset()
  }
  noteOff(id: number): void {
    for (const v of this.voices) if (v.active && v.noteId === id && !v.releasing) {
      v.releasing = true
      v.amp.gate(false)
      v.fenv.gate(false)
    }
  }
  allNotesOff(hard: boolean): void {
    for (const v of this.voices) {
      if (hard) {
        v.active = false
        v.amp.reset()
      } else if (v.active) {
        v.releasing = true
        v.amp.gate(false)
      }
    }
  }
  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const p = this.p
    const sr = this.ctx.sampleRate
    const gain = (p['master.gain'] ?? 0.5) * 0.35
    const glide = p['master.glide'] ?? 0
    const glideCoef = glide > 0 ? Math.exp(-1 / (glide * 0.25 * sr)) : 0
    const cutoff = p['filter.cutoff']
    const res = p['filter.res']
    const envAmt = p['filter.env']
    for (const v of this.voices) {
      if (!v.active) continue
      const [pl, pr] = panGains(v.pan)
      for (let i = start; i < end; i++) {
        v.pitch = v.key + (v.pitch - v.key) * glideCoef
        const base = v.pitch + this.bend + v.fine / 100
        let s = 0
        let sl = 0
        let sr2 = 0
        for (let o = 0; o < 3; o++) {
          const vol = p[`osc${o + 1}.vol`]
          if (vol <= 0) continue
          const osc = v.oscs[o]
          osc.pw = p[`osc${o + 1}.pw`]
          const f = mtof(base + p[`osc${o + 1}.coarse`] + p[`osc${o + 1}.fine`] / 100)
          const x = osc.next(p[`osc${o + 1}.shape`], f / sr) * vol
          const [ol, or] = panGains(p[`osc${o + 1}.pan`])
          sl += x * ol
          sr2 += x * or
          s += x
        }
        void s
        const fe = v.fenv.next()
        const fc = clamp(cutoff * Math.pow(2, envAmt * fe * 6 + (v.modX - 0.5) * 4), 30, 20000)
        if ((i & 15) === 0) v.filtL.set(fc, res)
        const a = v.amp.next() * v.vel * gain
        // mono filter on the mid, keep osc panning as a width effect
        const mid = v.filtL.process((sl + sr2) * 0.5)
        const side = (sl - sr2) * 0.5 * (fc / 20000)
        outL[i] += (mid + side) * a * pl
        outR[i] += (mid - side) * a * pr
      }
      if (!v.amp.active) v.active = false
    }
  }
}

export default { id: 'triosc', kind: 'instrument', create: (ctx) => new TriOsc(ctx) } satisfies DSPFactory
