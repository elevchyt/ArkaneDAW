// Studio Drums DSP (AudioWorklet). Multi-velocity sample playback with crossfades between layers,
// round robins, choke groups, per-strip level/pan/tune/decay/mute, per-bus EQ + "Punch" compressor,
// an FDN room, humanize, a 64-voice pool with stealing, and an internal groove player for previews.
//
// PCM arrives once per AudioWorkletGlobalScope (see loader.ts) and lives in the module-level PCM store
// shared by every Studio Drums instance of that audio context.
import type { DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { Biquad, clamp } from '../sdk/dsp'
import { BUSES, STRIPS, STRIP_BUS, type DrumsMessage, type GrooveEvent, type KitJson, type ResolvedDrumsData } from './types'

/** file → 16-bit PCM channels. Shared by all instances in this worklet scope. */
const PCM = new Map<string, Int16Array[]>()
/** Test hook: inspect/fill the shared PCM store. */
export function pcmStore(): Map<string, Int16Array[]> {
  return PCM
}

const MAX_ACTIVE = 64
const SLOTS = 80 // extra slots so stolen voices can fade instead of clicking
const MAX_PER_KEY = 8
const CHUNK = 128
const NS = STRIPS.length
const NB = BUSES.length
const I16 = 1 / 32768
const FLAM_MS = 18
/** Output headroom: a full kit hit (kick + snare + crash) stays below 0 dBFS at default settings. */
const OUT_TRIM = 0.65

interface LayerRT {
  vel: number
  amp: number
  files: string[]
  last: number
}

interface KeyRT {
  key: number
  layers: LayerRT[]
  stereo: boolean
  pan: number
  strip: number
  bus: number
  tune: number
  gain: number
  choke: number
  chokes: number[]
  flam: boolean
  velScale: number
}

class Voice {
  active = false
  key = 0
  strip = 0
  bus = 0
  L: Int16Array = new Int16Array(1)
  R: Int16Array = new Int16Array(1)
  len = 0
  pos = 0
  rate = 1
  amp = 0
  pan = 0
  stereo = false
  gL = 0
  gR = 0
  env = 1
  envMul = 1
  hold = 0
  fade = 1
  fadeStep = 0
  choke = 0
  wait = 0
  age = 0
}

/** Small stereo FDN room (4 lines, Hadamard feedback, damped). */
class Room {
  private lines: Float32Array[]
  private idx = [0, 0, 0, 0]
  private len = [1, 1, 1, 1]
  private g = [0, 0, 0, 0]
  private lp = [0, 0, 0, 0]
  private hpL = 0
  private hpR = 0
  private damp = 0.35
  private hpC: number
  constructor(private sr: number) {
    const max = Math.ceil(sr * 0.1) + 8
    this.lines = [0, 1, 2, 3].map(() => new Float32Array(max))
    this.hpC = Math.exp((-2 * Math.PI * 140) / sr)
    this.setSize(0.4)
  }
  setSize(size: number): void {
    const base = [0.0297, 0.0371, 0.0411, 0.0437]
    const scale = 0.45 + size * 1.5
    const rt60 = 0.22 + size * 1.3
    for (let i = 0; i < 4; i++) {
      this.len[i] = Math.min(this.lines[i].length - 1, Math.max(8, Math.round(base[i] * scale * this.sr)))
      this.g[i] = Math.pow(10, (-3 * (this.len[i] / this.sr)) / rt60)
    }
    this.damp = 0.25 + size * 0.2
  }
  clear(): void {
    for (const l of this.lines) l.fill(0)
    this.lp = [0, 0, 0, 0]
    this.hpL = this.hpR = 0
  }
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, o: number, n: number, wet: number): void {
    const [l0, l1, l2, l3] = this.lines
    const c = this.hpC
    const d = this.damp
    for (let i = 0; i < n; i++) {
      // one-pole high-pass on the input (keeps the kick out of the room)
      const xl = inL[i], xr = inR[i]
      this.hpL = c * this.hpL + (1 - c) * xl
      this.hpR = c * this.hpR + (1 - c) * xr
      const hl = xl - this.hpL
      const hr = xr - this.hpR
      const a0 = l0[this.idx[0]], a1 = l1[this.idx[1]], a2 = l2[this.idx[2]], a3 = l3[this.idx[3]]
      // damping
      this.lp[0] += d * (a0 - this.lp[0])
      this.lp[1] += d * (a1 - this.lp[1])
      this.lp[2] += d * (a2 - this.lp[2])
      this.lp[3] += d * (a3 - this.lp[3])
      const b0 = this.lp[0], b1 = this.lp[1], b2 = this.lp[2], b3 = this.lp[3]
      // Hadamard
      const h0 = (b0 + b1 + b2 + b3) * 0.5
      const h1 = (b0 - b1 + b2 - b3) * 0.5
      const h2 = (b0 + b1 - b2 - b3) * 0.5
      const h3 = (b0 - b1 - b2 + b3) * 0.5
      l0[this.idx[0]] = hl + h0 * this.g[0]
      l1[this.idx[1]] = hr + h1 * this.g[1]
      l2[this.idx[2]] = hl * 0.7 + h2 * this.g[2]
      l3[this.idx[3]] = hr * 0.7 + h3 * this.g[3]
      if (++this.idx[0] >= this.len[0]) this.idx[0] = 0
      if (++this.idx[1] >= this.len[1]) this.idx[1] = 0
      if (++this.idx[2] >= this.len[2]) this.idx[2] = 0
      if (++this.idx[3] >= this.len[3]) this.idx[3] = 0
      outL[o + i] += (a0 + a2) * wet
      outR[o + i] += (a1 + a3) * wet
    }
  }
}

/** Bus compressor with slow-ish attack: lets the transient through and brings up the body ("punch"). */
class Punch {
  private env = 0
  private att: number
  private rel: number
  amount = 0
  constructor(sr: number) {
    this.att = Math.exp(-1 / (0.008 * sr))
    this.rel = Math.exp(-1 / (0.14 * sr))
  }
  reset(): void {
    this.env = 0
  }
  process(L: Float32Array, R: Float32Array, n: number): void {
    const a = this.amount
    if (a <= 0) return
    const thr = Math.pow(10, (-14 - a * 14) / 20)
    const slope = 1 - 1 / (1 + a * 6)
    const makeup = Math.pow(10, (a * 10) / 20)
    let env = this.env
    for (let i = 0; i < n; i++) {
      const x = Math.max(L[i] < 0 ? -L[i] : L[i], R[i] < 0 ? -R[i] : R[i])
      env = x > env ? this.att * (env - x) + x : this.rel * (env - x) + x
      const g = env > thr ? Math.pow(thr / env, slope) * makeup : makeup
      L[i] *= g
      R[i] *= g
    }
    this.env = env
  }
}

interface BusRT {
  L: Float32Array
  R: Float32Array
  used: boolean
  lowL: Biquad
  lowR: Biquad
  highL: Biquad
  highR: Biquad
  low: number
  high: number
  punch: Punch
  room: number
}

class StudioDrums implements InstrumentDSP {
  private sr: number
  private post: (m: unknown) => void
  private voices: Voice[] = []
  private keys: (KeyRT | null)[] = new Array(128).fill(null)
  private kitId = ''
  private velExp = 1.6
  private clock = 0
  // params
  private master = OUT_TRIM
  private dyn = 1
  private humVel = 0
  private humTime = 0
  private room = 0.2
  private tempo = 100
  private sLevel = new Float32Array(NS).fill(1)
  private sPan = new Float32Array(NS)
  private sTune = new Float32Array(NS)
  private sDecay = new Float32Array(NS).fill(100)
  private sMute = new Uint8Array(NS)
  private buses: BusRT[]
  private roomFx: Room
  private roomL = new Float32Array(CHUNK)
  private roomR = new Float32Array(CHUNK)
  // groove player
  private seqEvents: GrooveEvent[] = []
  private seqLen = 0
  private seqIdx = 0
  private seqTick = 0
  private seqOn = false
  private seqLoops = 0
  private seqMaxLoops = 8
  private seqPostCount = 0

  constructor(sr: number, post: (m: unknown) => void) {
    this.sr = sr
    this.post = post
    for (let i = 0; i < SLOTS; i++) this.voices.push(new Voice())
    this.buses = BUSES.map((b) => {
      const mk = (): Biquad => new Biquad(sr)
      const bus: BusRT = { L: new Float32Array(CHUNK), R: new Float32Array(CHUNK), used: false, lowL: mk(), lowR: mk(), highL: mk(), highR: mk(), low: 0, high: 0, punch: new Punch(sr), room: 0 }
      void b
      return bus
    })
    this.buses.forEach((_, i) => this.updateEq(i))
    this.roomFx = new Room(sr)
  }

  // ─── params / data ───
  setParam(id: string, value: number): void {
    switch (id) {
      case 'master': this.master = Math.pow(10, value / 20) * OUT_TRIM; return
      case 'dyn': this.dyn = value / 100; return
      case 'humVel': this.humVel = value / 100; return
      case 'humTime': this.humTime = value; return
      case 'room': this.room = value / 100; return
      case 'roomSize': this.roomFx.setSize(value / 100); return
      case 'tempo': this.tempo = clamp(value, 20, 400); return
    }
    const dot = id.indexOf('.')
    if (dot < 0) return
    if (id.startsWith('bus.')) {
      const [, b, p] = id.split('.')
      const bi = (BUSES as readonly string[]).indexOf(b)
      if (bi < 0) return
      const bus = this.buses[bi]
      if (p === 'low') { bus.low = value; this.updateEq(bi) }
      else if (p === 'high') { bus.high = value; this.updateEq(bi) }
      else if (p === 'punch') { bus.punch.amount = value / 100; if (value <= 0) bus.punch.reset() }
      else if (p === 'room') bus.room = value / 100
      return
    }
    const si = (STRIPS as readonly string[]).indexOf(id.slice(0, dot))
    if (si < 0) return
    const p = id.slice(dot + 1)
    if (p === 'level') this.sLevel[si] = value <= -40 ? 0 : Math.pow(10, value / 20)
    else if (p === 'pan') this.sPan[si] = value
    else if (p === 'tune') this.sTune[si] = value
    else if (p === 'decay') this.sDecay[si] = value
    else if (p === 'mute') this.sMute[si] = value >= 0.5 ? 1 : 0
    else return
    for (const v of this.voices) if (v.active && v.strip === si) this.voiceGains(v)
  }

  private updateEq(bi: number): void {
    const b = this.buses[bi]
    const lowF = bi === 0 ? 70 : 120
    b.lowL.set('lowshelf', lowF, 0.7, b.low)
    b.lowR.set('lowshelf', lowF, 0.7, b.low)
    b.highL.set('highshelf', 6000, 0.7, b.high)
    b.highR.set('highshelf', 6000, 0.7, b.high)
  }

  setData(data: unknown): void {
    const d = data as ResolvedDrumsData | null
    if (!d) return
    if (d.pcm) for (const f in d.pcm) PCM.set(f, d.pcm[f])
    if (d.kitDef) this.loadKit(d.kitDef)
    else if (d.kit !== this.kitId) {
      // kit unavailable (browser mode / error): silence
      this.keys.fill(null)
      this.kitId = d.kit
      this.fadeAll(0.02)
    }
  }

  private loadKit(kit: KitJson): void {
    if (kit.id !== this.kitId) this.fadeAll(0.02)
    this.kitId = kit.id
    this.velExp = kit.velocityExponent || 1.6
    this.keys.fill(null)
    const layerCache = new Map<string, LayerRT[]>()
    for (const k in kit.keys) {
      const key = Number(k)
      const def = kit.keys[k]
      const piece = kit.pieces[def.piece]
      if (!piece || key < 0 || key > 127) continue
      let layers = layerCache.get(def.piece)
      if (!layers) {
        layers = piece.layers.map((l) => ({ vel: l.vel, amp: l.amp, files: l.files, last: -1 }))
        layerCache.set(def.piece, layers)
      }
      const strip = Math.max(0, (STRIPS as readonly string[]).indexOf(def.ch))
      this.keys[key] = {
        key,
        layers,
        stereo: piece.channels > 1,
        pan: piece.pan || 0,
        strip,
        bus: (BUSES as readonly string[]).indexOf(STRIP_BUS[STRIPS[strip]]),
        tune: def.tune ?? 0,
        gain: Math.pow(10, (def.gain ?? 0) / 20),
        choke: def.choke ?? 0,
        chokes: def.chokes ?? [],
        flam: !!def.flam,
        velScale: def.velScale ?? 1
      }
    }
  }

  onMessage(msg: unknown): void {
    const m = msg as DrumsMessage
    if (!m || typeof m !== 'object') return
    if (m.type === 'groove') {
      this.seqLen = Math.max(1, m.lengthTicks || 1)
      this.seqEvents = (Array.isArray(m.events) ? m.events : []).filter((e) => e.t >= 0 && e.t < this.seqLen).sort((a, b) => a.t - b.t)
      this.seqIdx = 0
      this.seqTick = 0
      this.seqLoops = 0
      this.seqMaxLoops = clamp(m.loops ?? 8, 1, 64)
      this.seqOn = true
      this.seqPostCount = 0
    } else if (m.type === 'grooveStop') {
      this.stopGroove()
    }
  }

  private stopGroove(): void {
    const was = this.seqOn
    this.seqOn = false
    this.fadeAll(0.03)
    if (was) this.post({ type: 'groovePos', tick: 0, playing: false })
  }

  // ─── notes ───
  noteOn(note: NoteOn): void {
    this.trigger(note.key, note.vel, note.pan, note.fine)
  }

  noteOff(): void {
    /* one-shots: drums ring out */
  }

  allNotesOff(hard: boolean): void {
    if (this.seqOn) {
      this.seqOn = false
      this.post({ type: 'groovePos', tick: 0, playing: false })
    }
    if (hard) {
      for (const v of this.voices) v.active = false
      this.roomFx.clear()
      for (const b of this.buses) b.punch.reset()
    } else this.fadeAll(0.03)
  }

  private fadeAll(sec: number): void {
    const step = 1 / Math.max(1, sec * this.sr)
    for (const v of this.voices) if (v.active && (v.fadeStep === 0 || v.fadeStep < step)) v.fadeStep = step
  }

  private trigger(key: number, vel01: number, notePan: number, fine: number): void {
    const k = this.keys[key]
    if (!k) return
    let vel = clamp(vel01 * k.velScale, 0, 1)
    if (this.humVel > 0) vel = clamp(vel * (1 + (Math.random() * 2 - 1) * 0.2 * this.humVel), 0.01, 1)
    let wait = this.humTime > 0 ? Math.floor(Math.random() * this.humTime * 0.001 * this.sr) : 0
    // chokes first, so this hit isn't affected
    if (k.chokes.length) {
      const step = 1 / Math.max(1, (k.chokes[0] === 1 ? 0.012 : 0.06) * this.sr)
      for (const v of this.voices) if (v.active && v.choke !== 0 && k.chokes.includes(v.choke) && v.fadeStep < step) v.fadeStep = step
    }
    if (k.flam) {
      this.hit(k, vel * 0.45, notePan, fine, wait)
      wait += Math.round((FLAM_MS / 1000) * this.sr)
    }
    this.hit(k, vel, notePan, fine, wait)
  }

  private hit(k: KeyRT, vel: number, notePan: number, fine: number, wait: number): void {
    const layers = k.layers
    const n = layers.length
    if (!n) return
    const v127 = Math.max(1, vel * 127)
    const exp = this.velExp * this.dyn
    const target = exp > 0 ? Math.pow(v127 / 127, exp) : 1
    // layer selection with a crossfade zone in the middle 50% between layer centres
    let i0 = 0, i1 = -1, w1 = 0
    if (v127 <= layers[0].vel) i0 = 0
    else if (v127 >= layers[n - 1].vel) i0 = n - 1
    else {
      let i = 0
      while (i < n - 2 && v127 >= layers[i + 1].vel) i++
      const w = (v127 - layers[i].vel) / (layers[i + 1].vel - layers[i].vel)
      if (w < 0.25) i0 = i
      else if (w > 0.75) i0 = i + 1
      else {
        i0 = i
        i1 = i + 1
        w1 = (w - 0.25) / 0.5
      }
    }
    if (i1 < 0) this.startVoice(k, layers[i0], Math.min(8, target / layers[i0].amp), notePan, fine, wait)
    else {
      this.startVoice(k, layers[i0], Math.min(8, (target * (1 - w1)) / layers[i0].amp), notePan, fine, wait)
      this.startVoice(k, layers[i1], Math.min(8, (target * w1) / layers[i1].amp), notePan, fine, wait)
    }
  }

  private startVoice(k: KeyRT, layer: LayerRT, amp: number, notePan: number, fine: number, wait: number): void {
    if (amp <= 0.0001) return
    // round robin (never the same file twice in a row when there is a choice)
    const nf = layer.files.length
    let fi = 0
    if (nf === 2) fi = layer.last === 0 ? 1 : 0
    else if (nf > 2) fi = (Math.max(0, layer.last) + 1 + Math.floor(Math.random() * (nf - 1))) % nf
    layer.last = fi
    const pcm = PCM.get(layer.files[fi])
    if (!pcm || !pcm.length || pcm[0].length < 2) return
    // subtle per-hit variation (stronger when a layer has a single sample)
    const varCents = nf === 1 ? 5 : 2
    const varDb = nf === 1 ? 0.6 : 0.25
    const cents = (Math.random() * 2 - 1) * varCents
    amp *= Math.pow(10, ((Math.random() * 2 - 1) * varDb) / 20)

    const v = this.allocVoice(k.key)
    v.active = true
    v.key = k.key
    v.strip = k.strip
    v.bus = k.bus
    v.L = pcm[0]
    v.R = pcm[1] ?? pcm[0]
    v.stereo = k.stereo && pcm.length > 1
    v.len = pcm[0].length
    v.pos = 0
    const semis = k.tune + this.sTune[k.strip] + (fine + cents) / 100
    v.rate = Math.pow(2, semis / 12)
    v.amp = amp * k.gain
    v.pan = clamp((v.stereo ? 0 : k.pan) + notePan, -1, 1)
    v.choke = k.choke
    v.wait = wait
    v.fade = 1
    v.fadeStep = 0
    v.env = 1
    v.hold = Math.round(0.012 * this.sr)
    const d = this.sDecay[k.strip]
    if (d >= 100) v.envMul = 1
    else {
      const tau = 0.012 + 1.8 * Math.pow(d / 100, 2.5)
      v.envMul = Math.exp(-1 / (tau * this.sr))
    }
    v.age = ++this.clock
    this.voiceGains(v)
  }

  private voiceGains(v: Voice): void {
    const s = v.strip
    const g = this.sMute[s] ? 0 : v.amp * this.sLevel[s]
    const pan = clamp(v.pan + this.sPan[s], -1, 1)
    if (v.stereo) {
      // balance
      v.gL = g * (pan > 0 ? 1 - pan : 1)
      v.gR = g * (pan < 0 ? 1 + pan : 1)
    } else {
      const a = ((pan + 1) * Math.PI) / 4
      v.gL = g * Math.cos(a) * Math.SQRT2 * 0.7071
      v.gR = g * Math.sin(a) * Math.SQRT2 * 0.7071
    }
  }

  private allocVoice(key: number): Voice {
    let free: Voice | null = null
    let activeCount = 0
    let sameKey = 0
    let oldest: Voice | null = null
    let oldestSame: Voice | null = null
    for (const v of this.voices) {
      if (!v.active) {
        if (!free) free = v
        continue
      }
      if (v.fadeStep > 0) continue
      activeCount++
      if (!oldest || v.age < oldest.age) oldest = v
      if (v.key === key) {
        sameKey++
        if (!oldestSame || v.age < oldestSame.age) oldestSame = v
      }
    }
    const quick = 1 / Math.max(1, 0.006 * this.sr)
    if (sameKey >= MAX_PER_KEY && oldestSame) oldestSame.fadeStep = 1 / Math.max(1, 0.03 * this.sr)
    else if (activeCount >= MAX_ACTIVE && oldest) oldest.fadeStep = quick
    if (free) return free
    // no free slot: hard-steal the quietest fading (or oldest) voice
    let victim = this.voices[0]
    for (const v of this.voices) if (v.fade * v.env < victim.fade * victim.env) victim = v
    return victim
  }

  // ─── audio ───
  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    let pos = start
    while (pos < end) {
      let n = Math.min(end - pos, CHUNK)
      if (this.seqOn) {
        const fpt = (this.sr * 60) / (this.tempo * 96) // frames per tick
        const ev = this.seqEvents
        while (this.seqIdx < ev.length && ev[this.seqIdx].t <= this.seqTick + 1e-6) {
          const e = ev[this.seqIdx++]
          this.trigger(e.k, clamp(e.v / 127, 0, 1), 0, 0)
        }
        if (this.seqIdx >= ev.length && this.seqTick >= this.seqLen - 1e-6) {
          this.seqTick -= this.seqLen
          this.seqIdx = 0
          if (++this.seqLoops >= this.seqMaxLoops) {
            this.stopGroove()
          }
          continue
        }
        if (this.seqOn) {
          const nextT = this.seqIdx < ev.length ? Math.min(ev[this.seqIdx].t, this.seqLen) : this.seqLen
          const fr = Math.ceil((nextT - this.seqTick) * fpt - 1e-6)
          if (fr < n) n = Math.max(1, fr)
          this.seqTick += n / fpt
          this.seqPostCount += n
          if (this.seqPostCount >= this.sr / 15) {
            this.seqPostCount = 0
            this.post({ type: 'groovePos', tick: this.seqTick, playing: true })
          }
        }
      }
      this.render(outL, outR, pos, n)
      pos += n
    }
  }

  private render(outL: Float32Array, outR: Float32Array, o: number, n: number): void {
    const buses = this.buses
    for (const b of buses) b.used = false
    for (const v of this.voices) {
      if (!v.active) continue
      const b = buses[v.bus]
      if (!b.used) {
        b.L.fill(0, 0, n)
        b.R.fill(0, 0, n)
        b.used = true
      }
      this.renderVoice(v, b.L, b.R, n)
    }
    let anyRoom = false
    const room = this.room
    for (let bi = 0; bi < NB; bi++) {
      const b = buses[bi]
      if (!b.used) continue
      const L = b.L, R = b.R
      if (b.low !== 0) for (let i = 0; i < n; i++) { L[i] = b.lowL.process(L[i]); R[i] = b.lowR.process(R[i]) }
      if (b.high !== 0) for (let i = 0; i < n; i++) { L[i] = b.highL.process(L[i]); R[i] = b.highR.process(R[i]) }
      b.punch.process(L, R, n)
      const send = room * b.room
      if (send > 0) {
        if (!anyRoom) {
          this.roomL.fill(0, 0, n)
          this.roomR.fill(0, 0, n)
          anyRoom = true
        }
        for (let i = 0; i < n; i++) {
          this.roomL[i] += L[i] * send
          this.roomR[i] += R[i] * send
        }
      }
      const m = this.master
      for (let i = 0; i < n; i++) {
        outL[o + i] += L[i] * m
        outR[o + i] += R[i] * m
      }
    }
    if (!anyRoom) {
      this.roomL.fill(0, 0, n)
      this.roomR.fill(0, 0, n)
    }
    // the room keeps ringing after the last hit, so always run it while it has energy
    if (room > 0 || anyRoom) this.roomFx.process(this.roomL, this.roomR, outL, outR, o, n, 0.55 * this.master)
  }

  private renderVoice(v: Voice, bL: Float32Array, bR: Float32Array, n: number): void {
    let i = 0
    if (v.wait > 0) {
      const w = Math.min(v.wait, n)
      v.wait -= w
      i = w
      if (i >= n) return
    }
    const A = v.L, B = v.R, last = v.len - 1, rate = v.rate
    let pos = v.pos, env = v.env, fade = v.fade, hold = v.hold
    const envMul = v.envMul, fstep = v.fadeStep
    const gL = v.gL * I16, gR = v.gR * I16
    const stereo = v.stereo
    for (; i < n; i++) {
      const ip = pos | 0
      if (ip >= last) {
        v.active = false
        break
      }
      const fr = pos - ip
      const g = env * fade
      const a = A[ip] + (A[ip + 1] - A[ip]) * fr
      if (stereo) {
        const b = B[ip] + (B[ip + 1] - B[ip]) * fr
        bL[i] += a * gL * g
        bR[i] += b * gR * g
      } else {
        bL[i] += a * gL * g
        bR[i] += a * gR * g
      }
      pos += rate
      if (hold > 0) hold--
      else env *= envMul
      if (fstep > 0) {
        fade -= fstep
        if (fade <= 0) {
          v.active = false
          break
        }
      }
      if (env < 0.0002) {
        v.active = false
        break
      }
    }
    v.pos = pos
    v.env = env
    v.fade = fade
    v.hold = hold
  }
}

const factory: DSPFactory = {
  id: 'studiodrums',
  kind: 'instrument',
  create: (ctx) => new StudioDrums(ctx.sampleRate, ctx.post)
}

export default factory
