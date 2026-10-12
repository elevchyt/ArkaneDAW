// Concerto DSP (AudioWorklet): multi-sampled orchestral instruments.
//
// • key / velocity zones with crossfaded velocity layers and round robins
// • sustain loops (crossfade baked into the samples at build time → plain jump, click-free)
// • release samples (harpsichord jacks, piano dampers, cymbal-roll endings), damper / ring-out behaviour per
//   articulation
// • unpitched articulations (cymbals, gongs): every key plays the samples at their recorded rate
// • articulations via param or keyswitches (C0.. = MIDI 12..), up to 3 instrument layers with key splits
// • legato (mono, overlapping notes): the new note starts past its attack and crossfades in while both notes
//   glide in pitch (portamento time = Glide); releasing the top note returns to the held one
// • per-note expression: modX → brightness (filter), modY → vibrato depth; global vibrato, attack, release,
//   expression, brightness; orchestral seating + stage position / width; concert-hall reverb
// • 64-voice polyphony with stealing (extra slots so stolen voices fade instead of clicking)
//
// PCM arrives once per AudioWorkletGlobalScope (see loader.ts) and lives in the module-level store shared by
// every Concerto instance of that audio context.
import type { DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { clamp } from '../sdk/dsp'
import { PITCH_SEMIS } from './manifest'
import { Hall } from './reverb'
import type { ArticulationJson, ConcertoStatus, InstrumentJson, LayerData, ResolvedConcertoData, Zone } from './types'

/** file → 16-bit PCM channels. Shared by all instances in this worklet scope. */
const PCM = new Map<string, Int16Array[]>()
/** Test hook: inspect/fill the shared PCM store. */
export function pcmStore(): Map<string, Int16Array[]> {
  return PCM
}

const MAX_ACTIVE = 64
const SLOTS = 96
const CHUNK = 128
const I16 = 1 / 32768
const KIND_SUSTAIN = 0
const KIND_DECAY = 1
const KIND_RING = 2
/** Output trim: a few sustained chords stay well below 0 dBFS at default settings. */
const OUT_TRIM = 0.9
const STATUS_INTERVAL = 0.25 // s
/** tail releases (cymbal roll endings): the note fades out over this time (s) while its ending fades in */
const TAIL_OUT = 0.2
const TAIL_IN = 0.04

interface FileRT {
  f: string
  pcm: Int16Array[] | null
  loopS: number
  loopE: number
  ofs: number
}

interface LayerRT {
  vel: number
  amp: number
  files: FileRT[]
  last: number
}

interface ZoneRT {
  root: number
  tune: number
  pan: number
  /** ensemble zones carry their own seat */
  hasPan: boolean
  gain: number
  layers: LayerRT[]
}

interface ArtRT {
  id: string
  name: string
  kind: number
  damp: number
  /** play every key at the sample's own rate (cymbals, gongs) */
  unpitched: boolean
  /** release samples are the note's ending, one per velocity layer, at the note's level */
  relTail: boolean
  zones: ZoneRT[]
  /** key → zone indices */
  byKey: Int16Array[]
  release: ZoneRT[]
  relByKey: Int16Array[]
}

interface InstRT {
  id: string
  arts: ArtRT[]
  velExp: number
  pan: number
  width: number
  tone: number
  ksBase: number
  lowest: number
}

interface LayerSlot {
  inst: InstRT | null
  instId: string
  lo: number
  hi: number
  gain: number
  transpose: number
  artPref: string | undefined
}

class Voice {
  active = false
  noteId = -1
  key = 0
  slot = 0
  kind = KIND_SUSTAIN
  released = false
  L: Int16Array = new Int16Array(2)
  R: Int16Array = new Int16Array(2)
  len = 0
  pos = 0
  looping = false
  loopS = 0
  loopE = 0
  /** semitone offset from the sample root (incl. tune, transpose, pitch standard) */
  semis = 0
  /** 1 = pitched; 0 = unpitched (the tuning standard doesn't move it) */
  pitched = 1
  /** index of the velocity layer in its zone (tail releases pick the matching layer) */
  layerIdx = 0
  bend = 0
  bendTarget = 0
  bendStep = 0
  lastRate = 1
  gain = 0
  // stereo placement
  gLL = 0
  gLR = 0
  gRL = 0
  gRR = 0
  pan = 0
  width = 1
  /** the voice's orchestral seat (instrument or ensemble-zone position) */
  seatPan = 0
  seatWidth = 1
  // envelope
  env = 1
  atkStep = 0
  relCoef = 1
  fade = 1
  fadeStep = 0
  // modulation
  vibPhase = 0
  vibAmt = 0
  vibOnset = 0
  brightOfs = 0
  lp1L = 0
  lp2L = 0
  lp1R = 0
  lp2R = 0
  // release-sample trigger info
  art: ArtRT | null = null
  vel = 0
  baseGain = 0
  age = 0
}

interface HeldNote {
  id: number
  key: number
  fine: number
  vel: number
  modX: number
  modY: number
}

function buildZones(zones: Zone[] | undefined, sr: number, fileSR: number): { zones: ZoneRT[]; byKey: Int16Array[] } {
  const scale = sr / fileSR
  const out: ZoneRT[] = (zones ?? []).map((z) => ({
    root: z.root,
    tune: z.tune ?? 0,
    pan: z.pan ?? 0,
    hasPan: z.pan !== undefined,
    gain: Math.pow(10, (z.gain ?? 0) / 20),
    layers: z.layers.map((l) => ({
      vel: l.vel,
      amp: l.amp,
      last: -1,
      files: l.files.map((f) => ({
        f: f.f,
        pcm: null,
        loopS: f.loop ? f.loop[0] * scale : 0,
        loopE: f.loop ? f.loop[1] * scale : 0,
        ofs: f.ofs ? f.ofs * scale : 0
      }))
    }))
  }))
  const lists: number[][] = Array.from({ length: 128 }, () => [])
  ;(zones ?? []).forEach((z, i) => {
    for (let k = Math.max(0, z.lo); k <= Math.min(127, z.hi); k++) lists[k].push(i)
  })
  return { zones: out, byKey: lists.map((l) => Int16Array.from(l)) }
}

function buildInstrument(def: InstrumentJson, sr: number): InstRT {
  const fileSR = def.sampleRate || 48000
  const arts = def.articulations.map((a: ArticulationJson) => {
    const main = buildZones(a.zones, sr, fileSR)
    const rel = buildZones(a.release, sr, fileSR)
    return {
      id: a.id,
      name: a.name,
      kind: a.kind === 'sustain' ? KIND_SUSTAIN : a.kind === 'decay' ? KIND_DECAY : KIND_RING,
      damp: a.damp ?? 0.15,
      unpitched: !!a.unpitched,
      relTail: !!a.releaseTail && !!a.release?.length,
      zones: main.zones,
      byKey: main.byKey,
      release: rel.zones,
      relByKey: rel.byKey
    }
  })
  let lowest = 127
  for (const a of def.articulations) for (const z of a.zones) lowest = Math.min(lowest, z.lo)
  return { id: def.id, arts, velExp: def.velocityExponent || 1.5, pan: def.stage?.pan ?? 0, width: def.stage?.width ?? 1, tone: def.tone ?? 1, ksBase: def.keyswitchBase ?? 12, lowest }
}

class Concerto implements InstrumentDSP {
  private sr: number
  private post: (m: unknown) => void
  private voices: Voice[] = []
  private slots: LayerSlot[] = []
  private insts = new Map<string, InstRT>()
  private clock = 0
  // params
  private artParam = 0
  private artIdx = 0
  private attack = 0
  private release = 0.5
  private vibrato = 0
  private vibRate = 5.4
  private expr = 1
  private exprGain = 1
  private exprSm = 1
  private bright = 1
  private velSens = 1
  private legato = false
  private glide = 0.08
  private reverb = 0.25
  private seat = 0
  private panOfs = 0
  private width = 1
  private pitchSemis = 0
  private volume = OUT_TRIM
  private bendSemis = 0
  // legato state
  private held: HeldNote[] = []
  // buses
  private dL = new Float32Array(CHUNK)
  private dR = new Float32Array(CHUNK)
  private hall: Hall
  private revTail = 0
  // status
  private statusCount = 0
  private lastStatus = ''
  private missing = 0
  private ready = false

  constructor(sr: number, post: (m: unknown) => void) {
    this.sr = sr
    this.post = post
    for (let i = 0; i < SLOTS; i++) this.voices.push(new Voice())
    this.hall = new Hall(sr)
  }

  // ─── params / data ───
  setParam(id: string, value: number): void {
    switch (id) {
      case 'art':
        this.artParam = clamp(Math.round(value), 0, 4)
        this.artIdx = this.artParam
        this.sendStatus(true)
        return
      case 'attack': this.attack = Math.max(0, value) / 1000; return
      case 'release': this.release = clamp(value, 0.01, 10); return
      case 'vibrato': this.vibrato = clamp(value / 100, 0, 1); return
      case 'vibRate': this.vibRate = clamp(value, 1, 12); return
      case 'expr':
        this.expr = clamp(value / 100, 0, 1)
        this.exprGain = this.expr * this.expr
        return
      case 'bright': this.bright = clamp(value / 100, 0, 1); return
      case 'velSens': this.velSens = clamp(value / 100, 0, 1); return
      case 'legato':
        this.legato = value >= 0.5
        if (!this.legato) this.held.length = 0
        return
      case 'glide': this.glide = clamp(value, 0, 4000) / 1000; return
      case 'reverb': this.reverb = clamp(value / 100, 0, 1); return
      case 'size': this.hall.setSize(clamp(value / 100, 0, 1)); return
      case 'seat': this.seat = value >= 0.5 ? 1 : 0; this.updatePans(); return
      case 'pan': this.panOfs = clamp(value / 100, -1, 1); this.updatePans(); return
      case 'width': this.width = clamp(value / 100, 0, 1); this.updatePans(); return
      case 'pitch': this.pitchSemis = PITCH_SEMIS[clamp(Math.round(value), 0, PITCH_SEMIS.length - 1)] ?? 0; return
      case 'volume': this.volume = (value <= -36 ? 0 : Math.pow(10, value / 20)) * OUT_TRIM; return
    }
  }

  pitchBend(semitones: number): void {
    this.bendSemis = clamp(semitones, -24, 24)
  }

  setData(data: unknown): void {
    const d = data as ResolvedConcertoData | null
    if (!d) return
    if (d.pcm) for (const f in d.pcm) PCM.set(f, d.pcm[f])
    if (d.defs) for (const id in d.defs) {
      const prev = this.insts.get(id)
      // rebuild when new (or when PCM may have arrived since)
      if (!prev || d.pcm) this.insts.set(id, buildInstrument(d.defs[id], this.sr))
    }
    const layers: LayerData[] = Array.isArray(d.layers) ? d.layers.slice(0, 3) : []
    const changed = layers.length !== this.slots.length || layers.some((l, i) => l.inst !== this.slots[i]?.instId)
    if (changed) this.fadeAll(0.03)
    this.slots = layers.map((l) => ({
      inst: d.defs?.[l.inst] ? this.insts.get(l.inst) ?? null : null,
      instId: l.inst,
      lo: l.lo ?? 0,
      hi: l.hi ?? 127,
      gain: Math.pow(10, (l.gain ?? 0) / 20),
      transpose: l.transpose ?? 0,
      artPref: l.art
    }))
    // attach PCM, count what's missing
    let missing = 0
    for (const s of this.slots) {
      if (!s.inst) continue
      for (const a of s.inst.arts) for (const zl of [a.zones, a.release]) for (const z of zl) for (const l of z.layers) for (const f of l.files) {
        f.pcm = PCM.get(f.f) ?? null
        if (!f.pcm) missing++
      }
    }
    this.missing = missing
    this.ready = this.slots.length > 0 && this.slots.every((s) => !!s.inst)
    if (changed) this.held.length = 0
    this.sendStatus(true)
  }

  private sendStatus(force: boolean): void {
    let voices = 0
    for (const v of this.voices) if (v.active && v.fadeStep === 0) voices++
    const key = `${this.artIdx}|${this.ready}|${this.missing}|${voices}`
    if (!force && key === this.lastStatus) return
    this.lastStatus = key
    const msg: ConcertoStatus = { type: 'status', art: this.artIdx, voices, ready: this.ready, missing: this.missing }
    this.post(msg)
  }

  // ─── notes ───
  /** The articulation a layer plays for the current articulation index. */
  private artFor(slotIdx: number): ArtRT | null {
    const s = this.slots[slotIdx]
    const inst = s?.inst
    if (!inst || !inst.arts.length) return null
    const primary = this.slots[0]?.inst
    const pArt = primary?.arts[Math.min(this.artIdx, primary.arts.length - 1)]
    if (slotIdx === 0) return pArt ?? inst.arts[0]
    if (pArt) {
      const same = inst.arts.find((a) => a.id === pArt.id)
      if (same) return same
    }
    if (s.artPref) {
      const pref = inst.arts.find((a) => a.id === s.artPref)
      if (pref) return pref
    }
    if (pArt && pArt.kind === KIND_RING) {
      const short = inst.arts.find((a) => a.kind === KIND_RING)
      if (short) return short
    }
    return inst.arts[0]
  }

  private isKeyswitch(key: number): boolean {
    const p = this.slots[0]?.inst
    if (!p) return false
    if (key < p.ksBase || key >= p.ksBase + p.arts.length) return false
    // only below every layer's playable zones
    for (const s of this.slots) if (s.inst && key >= s.inst.lowest) return false
    return true
  }

  noteOn(note: NoteOn): void {
    if (this.isKeyswitch(note.key)) {
      const p = this.slots[0].inst!
      this.artIdx = note.key - p.ksBase
      this.sendStatus(true)
      return
    }
    const vel = clamp(0.8 + (note.vel - 0.8) * this.velSens, 0.01, 1)
    const n: HeldNote = { id: note.id, key: note.key, fine: note.fine, vel, modX: note.modX, modY: note.modY }
    if (this.legato) {
      const prev = this.held.length ? this.held[this.held.length - 1] : null
      this.held.push(n)
      if (prev) {
        this.legatoTo(prev, n)
        return
      }
    }
    this.startNote(n, -1, 0, 0)
  }

  /**
   * Start a note on every layer. legatoFrom ≥ 0: key we come from (start past the attack, crossfade in over
   * `xf` seconds, glide from that pitch).
   */
  private startNote(n: HeldNote, legatoFrom: number, xf: number, glide: number): void {
    const fine = n.fine
    for (let si = 0; si < this.slots.length; si++) {
      const s = this.slots[si]
      if (!s.inst || n.key < s.lo || n.key > s.hi) continue
      const art = this.artFor(si)
      if (!art) continue
      const key = n.key + s.transpose
      if (key < 0 || key > 127) continue
      if (legatoFrom >= 0 && art.kind !== KIND_SUSTAIN) {
        // legato only makes sense for sustained articulations: just retrigger
        this.startArt(si, s, art, n, key, fine, -1, 0, 0)
        continue
      }
      this.startArt(si, s, art, n, key, fine, legatoFrom < 0 ? -1 : legatoFrom + s.transpose, xf, glide)
    }
  }

  private startArt(si: number, s: LayerSlot, art: ArtRT, n: HeldNote, key: number, fine: number, fromKey: number, xf: number, glide: number): void {
    const inst = s.inst!
    // re-striking a string / bar damps the previous note on it
    if (art.kind !== KIND_SUSTAIN && fromKey < 0) {
      const step = 1 / Math.max(1, 0.07 * this.sr)
      for (const v of this.voices) if (v.active && v.slot === si && v.key === n.key && v.fadeStep < step) v.fadeStep = step
    }
    const zl = art.byKey[key]
    const v127 = Math.max(1, n.vel * 127)
    const target = Math.pow(v127 / 127, inst.velExp)
    for (let zi = 0; zi < zl.length; zi++) {
      const z = art.zones[zl[zi]]
      const layers = z.layers
      const ln = layers.length
      if (!ln) continue
      // velocity layer (+ crossfade zone in the middle 40 % between layer centres)
      let i0 = 0, i1 = -1, w1 = 0
      if (v127 <= layers[0].vel) i0 = 0
      else if (v127 >= layers[ln - 1].vel) i0 = ln - 1
      else {
        let i = 0
        while (i < ln - 2 && v127 >= layers[i + 1].vel) i++
        const w = (v127 - layers[i].vel) / (layers[i + 1].vel - layers[i].vel)
        if (w < 0.3) i0 = i
        else if (w > 0.7) i0 = i + 1
        else {
          i0 = i
          i1 = i + 1
          w1 = (w - 0.3) / 0.4
        }
      }
      const zg = z.gain * s.gain
      if (i1 < 0) this.startVoice(si, s, art, z, i0, (zg * target) / layers[i0].amp, n, key, fine, fromKey, xf, glide)
      else {
        this.startVoice(si, s, art, z, i0, (zg * target * Math.cos((w1 * Math.PI) / 2)) / layers[i0].amp, n, key, fine, fromKey, xf, glide)
        this.startVoice(si, s, art, z, i1, (zg * target * Math.sin((w1 * Math.PI) / 2)) / layers[i1].amp, n, key, fine, fromKey, xf, glide)
      }
    }
  }

  private startVoice(si: number, s: LayerSlot, art: ArtRT, z: ZoneRT, li: number, amp: number, n: HeldNote, key: number, fine: number, fromKey: number, xf: number, glide: number): void {
    if (amp <= 0.0002) return
    const layer: LayerRT = z.layers[li]
    const nf = layer.files.length
    let fi = 0
    if (nf === 2) fi = layer.last === 0 ? 1 : 0
    else if (nf > 2) fi = (Math.max(0, layer.last) + 1 + Math.floor(Math.random() * (nf - 1))) % nf
    layer.last = fi
    const file = layer.files[fi]
    const pcm = file.pcm
    if (!pcm || !pcm.length || pcm[0].length < 4) return
    const inst = s.inst!
    const v = this.allocVoice()
    v.active = true
    v.noteId = n.id
    v.key = n.key
    v.slot = si
    v.kind = art.kind
    v.released = false
    v.L = pcm[0]
    v.R = pcm[1] ?? pcm[0]
    v.len = pcm[0].length
    v.looping = art.kind === KIND_SUSTAIN && file.loopE > file.loopS + 8 && file.loopE <= v.len
    v.loopS = file.loopS
    v.loopE = file.loopE
    // unpitched: the same sound on every key (only per-note fine tuning / pitch bend move it)
    v.semis = art.unpitched ? (z.tune + fine) / 100 : key - z.root + (z.tune + fine) / 100
    v.pitched = art.unpitched ? 0 : 1
    v.layerIdx = li
    v.gain = Math.min(6, amp)
    v.baseGain = v.gain
    v.vel = n.vel
    v.art = art
    v.env = 1
    v.atkStep = 0
    v.relCoef = 1
    v.fade = 1
    v.fadeStep = 0
    v.bend = 0
    v.bendTarget = 0
    v.bendStep = 0
    v.vibPhase = Math.random()
    v.vibAmt = art.unpitched ? -1 : clamp((n.modY - 0.5) * 2, -1, 1)
    v.vibOnset = 0
    v.brightOfs = (n.modX - 0.5) * 0.8 + (n.vel - 0.75) * 0.12
    v.lp1L = v.lp2L = v.lp1R = v.lp2R = 0
    v.age = ++this.clock
    if (fromKey >= 0) {
      // legato: start after the attack, crossfade in, glide from the previous pitch
      v.pos = Math.min(file.ofs, Math.max(0, (v.looping ? v.loopS : v.len) - 2))
      v.env = 0
      v.atkStep = 1 / Math.max(1, xf * this.sr)
      if (glide > 0 && !art.unpitched) {
        v.bend = fromKey - key
        v.bendStep = -v.bend / Math.max(1, glide * this.sr)
      }
      v.vibOnset = 0.5
    } else {
      v.pos = 0
      if (this.attack > 0.0005) {
        v.env = 0
        v.atkStep = 1 / Math.max(1, this.attack * this.sr)
      }
    }
    v.seatPan = z.hasPan ? z.pan : inst.pan
    v.seatWidth = z.hasPan ? Math.min(1, inst.width * 0.5 + 0.2) : inst.width
    this.placeVoice(v)
    v.lastRate = this.rateOf(v)
  }

  private placeVoice(v: Voice): void {
    v.pan = this.seat === 0 ? v.seatPan : 0
    v.width = this.seat === 0 ? v.seatWidth : 1
    this.voiceGains(v)
  }

  private voiceGains(v: Voice): void {
    const pos = clamp(v.pan + this.panOfs, -1, 1)
    const w = v.width * this.width
    const pl = clamp(pos - w, -1, 1)
    const pr = clamp(pos + w, -1, 1)
    const al = ((pl + 1) * Math.PI) / 4
    const ar = ((pr + 1) * Math.PI) / 4
    v.gLL = Math.cos(al)
    v.gLR = Math.sin(al)
    v.gRL = Math.cos(ar)
    v.gRR = Math.sin(ar)
  }

  private updatePans(): void {
    for (const v of this.voices) if (v.active) this.placeVoice(v)
  }

  private rateOf(v: Voice): number {
    return Math.pow(2, (v.semis + v.bend + this.pitchSemis * v.pitched + this.bendSemis) / 12)
  }

  noteOff(id: number, key: number): void {
    if (this.legato) {
      const idx = this.held.findIndex((h) => h.id === id)
      if (idx >= 0) {
        const wasTop = idx === this.held.length - 1
        const gone = this.held[idx]
        this.held.splice(idx, 1)
        if (wasTop && this.held.length) {
          // return to the note still held (trills, legato back)
          this.legatoTo(gone, this.held[this.held.length - 1])
          return
        }
        if (!wasTop) return // a lower held note was lifted: nothing sounds for it
      }
    }
    this.releaseNote(id, key)
  }

  private legatoTo(from: HeldNote, to: HeldNote): void {
    const glide = this.glide
    const xf = Math.max(0.045, Math.min(0.35, glide > 0 ? glide * 0.9 : 0.045))
    const fadeStep = 1 / Math.max(1, (xf + 0.02) * this.sr)
    let anySus = false
    for (const v of this.voices) {
      if (!v.active || v.noteId !== from.id) continue
      if (v.kind === KIND_SUSTAIN) {
        anySus = true
        v.fadeStep = Math.max(v.fadeStep, fadeStep)
        if (glide > 0 && v.pitched) {
          v.bendTarget = to.key - from.key
          v.bendStep = (v.bendTarget - v.bend) / Math.max(1, glide * this.sr)
        }
        v.noteId = -2 // detached: no longer answers note-offs
      } else this.releaseVoice(v)
    }
    this.startNote(to, anySus ? from.key : -1, xf, glide)
  }

  private releaseNote(id: number, key: number): void {
    for (const v of this.voices) {
      if (!v.active || v.released || v.noteId !== id || v.key !== key) continue
      this.releaseVoice(v)
    }
  }

  private releaseVoice(v: Voice): void {
    if (v.released) return
    v.released = true
    // stop any fade-in (attack / legato crossfade): attack and release fighting each other settle near full
    // level and the note never dies
    v.atkStep = 0
    if (v.kind === KIND_RING) return
    // tail releases: the recorded ending takes over, the note itself crossfades out
    const tail = !!v.art && v.art.relTail
    const t = tail ? Math.min(TAIL_OUT, this.release) : v.kind === KIND_DECAY ? Math.min(v.art?.damp ?? 0.15, this.release) : this.release
    v.relCoef = Math.exp(-6.9 / Math.max(1, t * this.sr))
    if (tail || (v.kind === KIND_DECAY && v.art && v.art.release.length)) this.triggerRelease(v)
  }

  private triggerRelease(v: Voice): void {
    const art = v.art!
    const s = this.slots[v.slot]
    if (!s?.inst) return
    const key = v.key + s.transpose
    if (key < 0 || key > 127) return
    const zl = art.relByKey[key]
    if (!zl.length) return
    const z = art.release[zl[0]]
    const tail = art.relTail
    const layer = tail ? z.layers[Math.min(v.layerIdx, z.layers.length - 1)] : z.layers[0]
    if (!layer) return
    const nf = layer.files.length
    const fi = nf > 1 ? (layer.last + 1) % nf : 0
    layer.last = fi
    const pcm = layer.files[fi].pcm
    if (!pcm || pcm[0].length < 4) return
    // only worth it when the note is still audible
    if (v.env * v.fade < 0.05) return
    const r = this.allocVoice()
    r.active = true
    r.noteId = -3
    r.key = v.key
    r.slot = v.slot
    r.kind = KIND_RING
    r.released = true
    r.L = pcm[0]
    r.R = pcm[1] ?? pcm[0]
    r.len = pcm[0].length
    r.looping = false
    r.pos = 0
    r.semis = art.unpitched ? 0 : key - z.root
    r.pitched = art.unpitched ? 0 : 1
    r.bend = r.bendTarget = r.bendStep = 0
    // tail: same level as the note (same gain as its layer), fading in while the note fades out
    r.gain = tail ? v.baseGain * Math.min(1, v.env * v.fade) : Math.min(2, 0.55 + 0.6 * v.vel) * (s.gain ?? 1)
    r.env = tail ? 0 : 1
    r.atkStep = tail ? 1 / Math.max(1, TAIL_IN * this.sr) : 0
    r.relCoef = 1
    r.fade = 1
    r.fadeStep = 0
    r.vibAmt = -1
    r.vibOnset = 0
    r.brightOfs = tail ? v.brightOfs : 0
    r.lp1L = r.lp2L = r.lp1R = r.lp2R = 0
    r.art = null
    r.seatPan = v.seatPan
    r.seatWidth = v.seatWidth
    r.age = ++this.clock
    this.placeVoice(r)
    r.lastRate = this.rateOf(r)
  }

  allNotesOff(hard: boolean): void {
    this.held.length = 0
    if (hard) {
      for (const v of this.voices) v.active = false
      this.hall.clear()
      this.revTail = 0
    } else {
      for (const v of this.voices) if (v.active) {
        if (v.kind === KIND_RING) v.fadeStep = Math.max(v.fadeStep, 1 / (0.3 * this.sr))
        else this.releaseVoice(v)
      }
    }
  }

  private fadeAll(sec: number): void {
    const step = 1 / Math.max(1, sec * this.sr)
    for (const v of this.voices) if (v.active && v.fadeStep < step) v.fadeStep = step
  }

  private allocVoice(): Voice {
    let free: Voice | null = null
    let active = 0
    let oldest: Voice | null = null
    for (const v of this.voices) {
      if (!v.active) {
        if (!free) free = v
        continue
      }
      if (v.fadeStep > 0) continue
      active++
      // prefer stealing released voices, then the oldest
      if (!oldest || (v.released && !oldest.released) || (v.released === oldest.released && v.age < oldest.age)) oldest = v
    }
    if (active >= MAX_ACTIVE && oldest) oldest.fadeStep = 1 / Math.max(1, 0.008 * this.sr)
    if (free) return free
    let victim = this.voices[0]
    for (const v of this.voices) if (v.fade * v.env * v.gain < victim.fade * victim.env * victim.gain) victim = v
    return victim
  }

  // ─── audio ───
  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    let pos = start
    while (pos < end) {
      const n = Math.min(end - pos, CHUNK)
      this.render(outL, outR, pos, n)
      pos += n
    }
    this.statusCount += end - start
    if (this.statusCount >= this.sr * STATUS_INTERVAL) {
      this.statusCount = 0
      this.sendStatus(false)
    }
  }

  private render(outL: Float32Array, outR: Float32Array, o: number, n: number): void {
    const dL = this.dL, dR = this.dR
    dL.fill(0, 0, n)
    dR.fill(0, 0, n)
    let any = false
    for (const v of this.voices) {
      if (!v.active) continue
      any = true
      this.renderVoice(v, n)
    }
    // expression gain, smoothed per block
    const e0 = this.exprSm
    const e1 = this.exprGain
    this.exprSm = e1
    const vol = this.volume
    const wet = this.reverb * 0.85
    if (any) {
      this.revTail = this.sr * 6
      const de = (e1 - e0) / n
      for (let i = 0; i < n; i++) {
        const g = (e0 + de * (i + 1)) * vol
        dL[i] *= g
        dR[i] *= g
        outL[o + i] += dL[i]
        outR[o + i] += dR[i]
      }
    }
    // the hall keeps ringing after the last note
    if (this.revTail > 0 && wet > 0) {
      this.hall.process(dL, dR, outL, outR, o, n, wet)
      if (!any) this.revTail -= n
    } else if (!any) this.revTail = 0
  }

  private renderVoice(v: Voice, n: number): void {
    const sr = this.sr
    // pitch: glide + vibrato (delayed onset), linear rate ramp over the block
    if (v.bendStep !== 0) {
      v.bend += v.bendStep * n
      if ((v.bendStep > 0 && v.bend >= v.bendTarget) || (v.bendStep < 0 && v.bend <= v.bendTarget)) {
        v.bend = v.bendTarget
        v.bendStep = 0
      }
    }
    let vibCents = 0
    const depth = clamp(this.vibrato + v.vibAmt, 0, 1)
    if (depth > 0 && v.vibAmt > -1) {
      v.vibOnset = Math.min(1, v.vibOnset + n / (0.35 * sr))
      v.vibPhase += (this.vibRate * n) / sr
      if (v.vibPhase >= 1) v.vibPhase -= 1
      vibCents = Math.sin(v.vibPhase * 2 * Math.PI) * depth * 32 * v.vibOnset * v.vibOnset
    }
    const r0 = v.lastRate
    const r1 = Math.pow(2, (v.semis + v.bend + vibCents / 100 + this.pitchSemis * v.pitched + this.bendSemis) / 12)
    v.lastRate = r1
    const dr = (r1 - r0) / n
    // tone: brightness + per-note modX/velocity + expression, scaled by the instrument's voicing
    const s = this.slots[v.slot]
    const tone = s?.inst ? s.inst.tone : 1
    const b = clamp((this.bright + v.brightOfs - (1 - this.expr) * 0.35) * tone, 0, 1)
    const filt = b < 0.985
    const fc = 220 * Math.pow(2, b * 6.6)
    const a = filt ? 1 - Math.exp((-2 * Math.PI * Math.min(fc, sr * 0.45)) / sr) : 1
    // tremolo-ish amplitude part of vibrato (bow pressure), subtle
    const am = vibCents !== 0 ? 1 + vibCents * 0.0018 : 1

    const A = v.L, B = v.R
    const dL = this.dL, dR = this.dR
    const looping = v.looping
    const loopS = v.loopS, loopE = v.loopE, loopLen = loopE - loopS
    const last = v.len - 1
    let pos = v.pos, env = v.env, fade = v.fade
    const atk = v.atkStep, rel = v.released ? v.relCoef : 1, fstep = v.fadeStep
    const g0 = v.gain * I16 * am
    const gLL = v.gLL * g0, gLR = v.gLR * g0, gRL = v.gRL * g0, gRR = v.gRR * g0
    let l1 = v.lp1L, l2 = v.lp2L, q1 = v.lp1R, q2 = v.lp2R
    let rate = r0
    let i = 0
    for (; i < n; i++) {
      rate += dr
      if (looping) {
        if (pos >= loopE) pos -= loopLen
      } else if (pos >= last) {
        v.active = false
        break
      }
      const ip = pos | 0
      const fr = pos - ip
      let x = A[ip] + (A[ip + 1] - A[ip]) * fr
      let y = B[ip] + (B[ip + 1] - B[ip]) * fr
      if (filt) {
        l1 += a * (x - l1)
        l2 += a * (l1 - l2)
        q1 += a * (y - q1)
        q2 += a * (q1 - q2)
        x = l2
        y = q2
      } else {
        // keep the filter state on the signal so switching it on later doesn't click
        l1 = l2 = x
        q1 = q2 = y
      }
      if (atk > 0 && env < 1 && rel === 1) {
        env += atk
        if (env > 1) env = 1
      }
      env *= rel
      let g = env
      if (fstep > 0) {
        fade -= fstep
        if (fade <= 0) {
          v.active = false
          break
        }
        g *= fade
      }
      dL[i] += (x * gLL + y * gRL) * g
      dR[i] += (x * gLR + y * gRR) * g
      pos += rate
    }
    if (v.released && rel < 1 && env < 0.0001) v.active = false
    v.pos = pos
    v.env = env
    v.fade = fade
    v.lp1L = l1
    v.lp2L = l2
    v.lp1R = q1
    v.lp2R = q2
  }
}

const factory: DSPFactory = {
  id: 'concerto',
  kind: 'instrument',
  create: (ctx) => new Concerto(ctx.sampleRate, ctx.post)
}

export default factory
