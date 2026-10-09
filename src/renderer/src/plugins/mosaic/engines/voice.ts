// Generic polyphonic Part: wraps an EngineVoice with amp env, filter (+env), LFO, glide and
// poly/mono/legato handling. Rendering runs in CHUNK-sized control-rate slices.
import type { NoteOn } from '../../sdk/types'
import { ADSR, SVF } from '../../sdk/dsp'
import { CHUNK, Mods, clamp, mtof, type EngineVoice, type PartEngine, type PartParams, type PartPost } from './common'

/** 4-pole ladder lowpass (TPT stages, tanh-saturated feedback). */
export class Ladder {
  private s1 = 0
  private s2 = 0
  private s3 = 0
  private s4 = 0
  private G = 0
  private k = 0
  private y4 = 0
  set(fc: number, res: number, sr: number): void {
    const g = Math.tan((Math.PI * clamp(fc, 20, sr * 0.45)) / sr)
    this.G = g / (1 + g)
    this.k = res * 3.9
  }
  reset(): void {
    this.s1 = this.s2 = this.s3 = this.s4 = this.y4 = 0
  }
  process(x: number): number {
    const G = this.G
    let u = x * (1 + this.k * 0.45) - this.k * this.y4
    u = u > 3 ? 1 : u < -3 ? -1 : (u * (27 + u * u)) / (27 + 9 * u * u)
    let v = (u - this.s1) * G
    const y1 = v + this.s1
    this.s1 = y1 + v
    v = (y1 - this.s2) * G
    const y2 = v + this.s2
    this.s2 = y2 + v
    v = (y2 - this.s3) * G
    const y3 = v + this.s3
    this.s3 = y3 + v
    v = (y3 - this.s4) * G
    const y4 = v + this.s4
    this.s4 = y4 + v
    this.y4 = y4
    return y4
  }
}

class PVoice {
  active = false
  releasing = false
  noteId = -1
  key = 60
  age = 0
  vel = 0.8
  gain = 1
  pitch = 60
  target = 60
  noteFine = 0
  modX = 0.5
  modY = 0.5
  lfoPh = 0
  lfoVal = 0
  t = 0
  gPrev = 1
  pan = 0
  amp: ADSR
  fenv: ADSR
  svfL: SVF
  svfR: SVF
  ladL = new Ladder()
  ladR = new Ladder()
  constructor(
    public ev: EngineVoice,
    sr: number
  ) {
    this.amp = new ADSR(sr)
    this.fenv = new ADSR(sr)
    this.svfL = new SVF(sr)
    this.svfR = new SVF(sr)
  }
}

interface Held {
  id: number
  key: number
}

export class PolyPart implements PartEngine {
  private voices: PVoice[]
  private p: PartParams = {}
  private clock = 0
  private lastKey = -1
  private stack: Held[] = []
  private bl = new Float32Array(CHUNK)
  private br = new Float32Array(CHUNK)
  mods = new Mods()

  constructor(
    private sr: number,
    factory: (sr: number) => EngineVoice,
    private post: PartPost | null,
    poly = 32
  ) {
    this.voices = Array.from({ length: poly }, () => new PVoice(factory(sr), sr))
  }

  update(p: PartParams): void {
    this.p = p
    this.post?.update(p)
  }

  active(): number {
    let n = 0
    for (const v of this.voices) if (v.active) n++
    return n
  }

  private alloc(): PVoice {
    let best: PVoice | null = null
    for (const v of this.voices) if (!v.active) return v
    for (const v of this.voices) if (v.releasing && (!best || v.age < best.age)) best = v
    if (best) return best
    for (const v of this.voices) if (!best || v.age < best.age) best = v
    return best!
  }

  private startVoice(v: PVoice, n: NoteOn, key: number, from: number, retrigger: boolean): void {
    const p = this.p
    const m = this.mods
    v.active = true
    v.releasing = false
    v.noteId = n.id
    v.key = key
    v.age = ++this.clock
    v.vel = n.vel
    v.gain = Math.pow(Math.max(0.01, n.vel), (p.velSens ?? 0.6) * 2)
    v.noteFine = n.fine
    v.modX = n.modX
    v.modY = n.modY
    v.pan = n.pan
    v.target = key
    v.pitch = from
    if (!retrigger) {
      v.t = 0
      v.lfoPh = 0
      v.gPrev = 1
      v.amp.reset()
      v.fenv.reset()
      v.svfL.reset()
      v.svfR.reset()
      v.ladL.reset()
      v.ladR.reset()
    }
    const am = Math.pow(2, m.attack)
    const rm = Math.pow(2, m.release)
    v.amp.set(p['amp.a'] * am, p['amp.d'], p['amp.s'], p['amp.r'] * rm)
    v.fenv.set(p['flt.a'] * am, p['flt.d'], p['flt.s'], p['flt.r'] * rm)
    v.amp.gate(true)
    v.fenv.gate(true)
    v.ev.start(key, n.vel, mtof(from + n.fine / 100), p, m, this.sr)
  }

  private releaseVoice(v: PVoice, rel: number): void {
    if (!v.active || v.releasing) return
    v.releasing = true
    v.amp.gate(false)
    v.fenv.gate(false)
    v.ev.release(rel)
  }

  noteOn(n: NoteOn, key: number): void {
    const p = this.p
    const mode = p.mode ?? 0
    const porta = p.porta ?? 0
    if (n.slide) {
      let latest: PVoice | null = null
      for (const v of this.voices) if (v.active && !v.releasing && (!latest || v.age > latest.age)) latest = v
      if (latest) {
        latest.target = key
        this.lastKey = key
        return
      }
    }
    const glideFrom = (porta > 0 || n.porta) && this.lastKey >= 0 ? this.lastKey : key
    if (mode === 0) {
      // re-striking a key: release what's still ringing on it
      for (const v of this.voices) if (v.active && v.key === key && !v.releasing) this.releaseVoice(v, 0.5)
      this.startVoice(this.alloc(), n, key, glideFrom, false)
    } else {
      this.stack = this.stack.filter((h) => h.id !== n.id)
      if (this.stack.length > 16) this.stack.shift()
      this.stack.push({ id: n.id, key })
      const v = this.voices[0]
      const held = v.active && !v.releasing
      if (held && mode === 2) {
        v.target = key
        v.noteId = n.id
        if (porta <= 0 && !n.porta) v.pitch = key
      } else {
        this.startVoice(v, n, key, v.active ? (porta > 0 ? v.pitch : key) : glideFrom, v.active)
      }
    }
    this.lastKey = key
  }

  noteOff(id: number, rel: number): void {
    const mode = this.p.mode ?? 0
    if (mode === 0) {
      for (const v of this.voices) if (v.active && v.noteId === id) this.releaseVoice(v, rel)
      return
    }
    this.stack = this.stack.filter((h) => h.id !== id)
    const v = this.voices[0]
    if (v.noteId !== id) return
    const top = this.stack[this.stack.length - 1]
    if (top) {
      v.target = top.key
      v.noteId = top.id
      if ((this.p.porta ?? 0) <= 0) v.pitch = top.key
      this.lastKey = top.key
    } else this.releaseVoice(v, rel)
  }

  allOff(hard: boolean): void {
    this.stack.length = 0
    for (const v of this.voices) {
      if (hard) {
        v.active = false
        v.amp.reset()
      } else this.releaseVoice(v, 0.5)
    }
    if (hard) this.post?.reset()
  }

  render(L: Float32Array, R: Float32Array, n: number, m: Mods): void {
    this.mods = m
    for (let off = 0; off < n; off += CHUNK) {
      const len = Math.min(CHUNK, n - off)
      for (const v of this.voices) if (v.active) this.renderVoice(v, L, R, off, len, m)
    }
    this.post?.process(L, R, n, m)
  }

  private renderVoice(v: PVoice, L: Float32Array, R: Float32Array, off: number, len: number, m: Mods): void {
    const p = this.p
    const sr = this.sr
    const dt = len / sr
    // glide
    const porta = p.porta ?? 0
    if (v.pitch !== v.target) {
      if (porta <= 0.0005) v.pitch = v.target
      else {
        v.pitch = v.target + (v.pitch - v.target) * Math.exp(-dt / (porta * 0.3))
        if (Math.abs(v.pitch - v.target) < 0.001) v.pitch = v.target
      }
    }
    // LFO (control rate)
    const shape = p['lfo.shape'] | 0
    let ph = v.lfoPh + p['lfo.rate'] * dt
    if (ph >= 1) {
      ph -= Math.floor(ph)
      if (shape === 4) v.lfoVal = Math.random() * 2 - 1
    }
    v.lfoPh = ph
    let lfo: number
    switch (shape) {
      case 0: lfo = Math.sin(ph * 6.283185307179586); break
      case 1: lfo = 1 - 4 * Math.abs(ph - 0.5); break
      case 2: lfo = 2 * ph - 1; break
      case 3: lfo = ph < 0.5 ? 1 : -1; break
      default: lfo = v.lfoVal
    }
    const delay = p['lfo.delay']
    const fade = delay > 0 ? Math.min(1, v.t / delay) : 1
    lfo *= fade
    v.t += dt
    const vib = (p['lfo.pitch'] + m.vibrato) * lfo
    const semis = v.pitch + p.fine / 100 + v.noteFine / 100 + m.bend + vib / 100
    v.ev.setFreq(mtof(semis))

    const bl = this.bl
    const br = this.br
    const alive = v.ev.render(bl, br, len)
    const stereo = v.ev.stereo

    // filter
    const ftype = p['flt.type'] | 0
    if (ftype > 0) {
      let fe = 0
      for (let i = 0; i < len; i++) fe = v.fenv.next()
      const oct =
        p['flt.env'] * fe +
        ((v.key - 60) / 12) * p['flt.key'] +
        p['flt.vel'] * (v.vel - 1) +
        lfo * p['lfo.flt'] +
        (v.modX - 0.5) * 4 +
        m.cutoff
      const fc = clamp(p['flt.cut'] * Math.pow(2, oct), 20, 20000)
      const res = clamp(p['flt.res'] + m.reso + (v.modY - 0.5) * 0.8, 0, 1)
      if (ftype === 2) {
        v.ladL.set(fc, res, sr)
        for (let i = 0; i < len; i++) bl[i] = v.ladL.process(bl[i])
        if (stereo) {
          v.ladR.set(fc, res, sr)
          for (let i = 0; i < len; i++) br[i] = v.ladR.process(br[i])
        }
      } else {
        const q = 0.5 + res * res * 18
        const mode = ftype === 1 ? 0 : ftype === 3 ? 1 : 2
        v.svfL.mode = mode
        v.svfL.set(fc, q)
        for (let i = 0; i < len; i++) bl[i] = v.svfL.process(bl[i])
        if (stereo) {
          v.svfR.mode = mode
          v.svfR.set(fc, q)
          for (let i = 0; i < len; i++) br[i] = v.svfR.process(br[i])
        }
      }
    }

    // amp
    const tdepth = clamp(p['lfo.amp'] + m.tremolo, 0, 1)
    const g1 = v.gain * (1 - tdepth * (0.5 - 0.5 * lfo))
    const g0 = v.gPrev
    v.gPrev = g1
    const dg = (g1 - g0) / len
    const pan = clamp(v.pan, -1, 1)
    const pl = pan > 0 ? 1 - pan : 1
    const pr = pan < 0 ? 1 + pan : 1
    let g = g0
    const amp = v.amp
    if (stereo) {
      for (let i = 0; i < len; i++) {
        g += dg
        const a = amp.next() * g
        L[off + i] += bl[i] * a * pl
        R[off + i] += br[i] * a * pr
      }
    } else {
      for (let i = 0; i < len; i++) {
        g += dg
        const s = bl[i] * amp.next() * g
        L[off + i] += s * pl
        R[off + i] += s * pr
      }
    }
    if (!alive || !amp.active) v.active = false
  }
}
