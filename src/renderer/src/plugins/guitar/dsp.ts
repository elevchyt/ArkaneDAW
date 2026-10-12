// Guitar DSP. Six modelled strings per guitarist (string.ts); every note is placed on a string and fret
// (fretboard.ts), so a new note on a ringing string cuts it, chords are voiced like real grips and strummed
// string by string, and solo lines hammer on, pull off and slide on the same string.
//
//   note-ons that arrive together (same sample) form a chord → voiced → strummed down / up with per-string delays
//   Solo mode: overlapping notes → hammer-on / pull-off (≤ 5 semitones) or slide; releasing returns to the
//              previous held note (pull-off)
//   Strummer mode: chord keys only choose the grip; the strum keyswitches play it
//   Keyswitches: articulation (sustain / palm mute / muted / harmonics) and down / up / mute strums
//   Double track: a second guitarist plays the same part with his own timing, pick and tuning, panned opposite
//   Electric models go through a magnetic pickup → amp & cab (amp.ts); acoustic models are heard through the
//   force on the bridge and a modelled body (body.ts)
//   Realism: wound and plain strings lose their treble at different rates, hard plucks start a little sharp
//   (tension modulation) and settle, every fretted note is a hair off perfect intonation (Humanize)
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { Biquad, dbToGain } from '../sdk/dsp'
import { Hall } from '../concerto/reverb'
import { GuitarString, type PluckSpec } from './string'
import { Body } from './body'
import { Amp } from './amp'
import { assignChord, chooseString, type StringInfo } from './fretboard'
import { AMP, ART, KS, KS_HI, KS_LO, MODEL, PLAY, STRINGS, TUNINGS, isElectric, params as PARAM_DEFS } from './manifest'

const CTRL = 16 // control-rate period (samples)
const MAX_NOTES = 32
const PICKUP_POS = [0.27, 0.17, 0.085] // neck, middle, bridge (fraction of scale length from the bridge)

const mtof = (k: number): number => 440 * Math.pow(2, (k - 69) / 12)

interface Slot {
  /** note id that owns the string (-1 = none; -2 = a strum) */
  id: number
  key: number
  held: boolean
  /** samples until a scheduled pluck (-1 = none) */
  delay: number
  vel: number
  art: number
  /** >0: start by tapping (hammer-on / pull-off) instead of plucking */
  legato: number
  /** pitch: current (smoothed) and target, in MIDI keys */
  cur: number
  target: number
  glide: number
  /** samples since the note started (vibrato fades in) */
  age: number
  /** release in progress / done */
  released: boolean
  /** pitch offsets in semitones: tension modulation after a pluck (decays) and this note's intonation */
  tm: number
  fine: number
}

class Player {
  strings: GuitarString[] = []
  slots: Slot[] = []
  amp: Amp
  /** body per side (acoustic stereo pair); bodyL alone for electric hollow-bodies */
  bodyL: Body
  bodyR: Body
  pickupLp: Biquad
  pickupLp2: Biquad
  /** mono render buffer */
  buf: Float32Array
  bufL: Float32Array
  bufR: Float32Array
  rnd: number
  // fret / slide squeak noise
  squeak: Biquad
  squeakEnv = 0
  squeakTarget = 0
  squeakLp = 0
  /** extra humanised delay of this guitarist (ms) and tuning offset (cents) */
  late = 0
  cents = 0

  constructor(sr: number, seed: number) {
    for (let s = 0; s < STRINGS; s++) {
      this.strings.push(new GuitarString(sr))
      this.slots.push({ id: -1, key: 0, held: false, delay: -1, vel: 0, art: 0, legato: 0, cur: 60, target: 60, glide: 1, age: 0, released: true, tm: 0, fine: 0 })
    }
    this.amp = new Amp(sr)
    this.bodyL = new Body(sr, seed ^ 0x5bd1e995)
    this.bodyR = new Body(sr, seed ^ 0x27d4eb2f)
    this.pickupLp = new Biquad(sr)
    this.pickupLp2 = new Biquad(sr)
    this.squeak = new Biquad(sr)
    this.squeak.set('bp', 2600, 3)
    this.buf = new Float32Array(1024)
    this.bufL = new Float32Array(1024)
    this.bufR = new Float32Array(1024)
    this.rnd = seed
  }

  random(): number {
    let x = this.rnd
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rnd = x
    return (x >>> 0) / 4294967296
  }

  reset(): void {
    for (const s of this.strings) s.reset()
    for (const sl of this.slots) {
      sl.id = -1
      sl.delay = -1
      sl.held = false
      sl.released = true
    }
    this.amp.reset()
    this.bodyL.reset()
    this.bodyR.reset()
    this.pickupLp.reset()
    this.pickupLp2.reset()
    this.squeak.reset()
    this.squeakEnv = this.squeakTarget = 0
  }
}

interface HeldNote {
  id: number
  key: number
  vel: number
  /** string index (same fingering for both guitarists) */
  string: number
}

class Guitar implements InstrumentDSP {
  private sr: number
  private post: (msg: unknown) => void
  private p: Record<string, number> = {}
  private players: Player[]
  private hall: Hall
  private hallElectric: boolean | null = null
  private wetL = new Float32Array(1024)
  private wetR = new Float32Array(1024)
  // performance state
  private art = 0
  private hand = 3
  private notes: HeldNote[] = []
  private pending: NoteOn[] = []
  private chordKeys: number[] = []
  private lastChord: number[] = []
  private strumKeysHeld = 0
  private strumUp = false
  private lastStrumAt = -1e9
  private clock = 0
  private bend = 0
  private vibPhase = 0
  private ctrl = 0
  private postTimer = 0
  private lastPosted = ''
  private repost = 0
  private keysTmp: number[] = []
  private chordOut = new Int8Array(16)
  private info: StringInfo[] = Array.from({ length: STRINGS }, () => ({ held: false, ringing: false }))

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    for (const d of PARAM_DEFS) this.p[d.id] = d.default
    this.players = [new Player(this.sr, 0x1234567), new Player(this.sr, 0x7654321)]
    this.players[1].late = 9
    this.players[1].cents = 4
    this.hall = new Hall(this.sr)
    this.applyParams()
  }

  // ─── params ─────────────────────────────────────────────────────────────────
  setParam(id: string, value: number): void {
    this.p[id] = value
    if (id === 'art') this.art = Math.round(value)
    this.applyParams()
  }

  private applyParams(): void {
    const p = this.p
    const model = Math.round(p.model)
    const electric = isElectric(model)
    const pickup = electric ? PICKUP_POS[Math.round(p.pickup)] ?? 0.085 : 0
    const amp = Math.round(p.amp)
    for (const pl of this.players) {
      for (const s of pl.strings) s.setPickup(pickup)
      pl.amp.set(amp, p.gain, p.bass, p.mid, p.treble, p.gate)
      pl.bodyL.set(model, p.body)
      pl.bodyR.set(model, p.body)
      // pickup coil resonance: single-coil bright & peaky, humbucker darker, archtop darker still
      if (model === MODEL.SINGLE) pl.pickupLp.set('lp', 5200, 2.2)
      else if (model === MODEL.HUMBUCKER) pl.pickupLp.set('lp', 3300, 1.5)
      else if (model === MODEL.HOLLOW) pl.pickupLp.set('lp', 2600, 1.1)
      else pl.pickupLp.set('lp', 16000, 0.7)
      pl.pickupLp2.set('lp', 9000 + 9000 * p.tone, 0.6)
    }
    if (electric !== this.hallElectric) {
      this.hallElectric = electric
      this.hall.setSize(electric ? 0.35 : 0.22)
    }
    if (!Number.isFinite(this.art)) this.art = 0
  }

  private get open(): number[] {
    return (TUNINGS[Math.round(this.p.tuning)] ?? TUNINGS[0]).strings
  }

  // ─── note input ─────────────────────────────────────────────────────────────
  noteOn(n: NoteOn): void {
    const key = n.key
    if (key >= KS_LO && key <= KS_HI) return this.keyswitch(key, n.vel, true)
    if (Math.round(this.p.mode) === PLAY.STRUMMER) {
      if (!this.chordKeys.includes(key)) this.chordKeys.push(key)
      this.chordKeys.sort((a, b) => a - b)
      this.lastChord = this.chordKeys.slice()
      return
    }
    if (this.pending.length < 16) this.pending.push(n)
  }

  noteOff(id: number, key: number): void {
    if (key >= KS_LO && key <= KS_HI) return this.keyswitch(key, 0, false)
    if (Math.round(this.p.mode) === PLAY.STRUMMER) {
      const i = this.chordKeys.indexOf(key)
      if (i >= 0) this.chordKeys.splice(i, 1)
      if (!this.chordKeys.length && !this.strumKeysHeld) this.dampAll(0.12)
      return
    }
    if (this.pending.some((x) => x.id === id)) this.flush()
    const i = this.notes.findIndex((x) => x.id === id)
    if (i < 0) return
    const note = this.notes[i]
    this.notes.splice(i, 1)
    if (Math.round(this.p.mode) === PLAY.SOLO) return this.soloRelease(note)
    this.releaseString(note.string, note.id)
    // strummed grip let go with no strum key down: the fretting hand mutes the strings
    if (!this.notes.length && !this.strumKeysHeld) for (let s = 0; s < STRINGS; s++) if (this.players[0].slots[s].id === -2) this.dampString(s, 0.12)
  }

  allNotesOff(hard: boolean): void {
    this.pending.length = 0
    this.notes.length = 0
    this.chordKeys.length = 0
    this.strumKeysHeld = 0
    if (hard) {
      for (const pl of this.players) pl.reset()
      this.hall.clear()
    } else this.dampAll(0.1)
  }

  onMessage(msg: unknown): void {
    if ((msg as { type?: string })?.type === 'sync') this.lastPosted = ''
  }

  pitchBend(semitones: number): void {
    this.bend = semitones
  }

  private keyswitch(key: number, vel: number, on: boolean): void {
    if (!on) {
      if (key === KS.STRUM_DOWN || key === KS.STRUM_UP || key === KS.STRUM_MUTE) {
        this.strumKeysHeld = Math.max(0, this.strumKeysHeld - 1)
        const mode = Math.round(this.p.mode)
        const chordHeld = mode === PLAY.STRUMMER ? this.chordKeys.length > 0 : this.notes.length > 0
        if (!this.strumKeysHeld && !chordHeld) this.dampAll(0.12)
      }
      return
    }
    switch (key) {
      case KS.SUSTAIN: this.art = ART.SUSTAIN; return
      case KS.PALM: this.art = ART.PALM; return
      case KS.MUTED: this.art = ART.MUTED; return
      case KS.HARMONIC: this.art = ART.HARMONIC; return
      case KS.STRUM_DOWN:
      case KS.STRUM_UP:
      case KS.STRUM_MUTE: {
        this.strumKeysHeld++
        const mode = Math.round(this.p.mode)
        let keys = mode === PLAY.STRUMMER ? this.chordKeys : this.notes.map((x) => x.key).sort((a, b) => a - b)
        if (!keys.length) keys = this.lastChord
        if (!keys.length) keys = this.open
        this.strumChord(keys, vel, key === KS.STRUM_UP, key === KS.STRUM_MUTE ? ART.MUTED : this.art, -2, key === KS.STRUM_MUTE ? 0.5 : 1)
        return
      }
    }
  }

  // ─── performance ────────────────────────────────────────────────────────────
  /** Note-ons collected since the last render form chords. */
  private flush(): void {
    const pend = this.pending
    if (!pend.length) return
    const mode = Math.round(this.p.mode)
    if (mode === PLAY.SOLO) {
      for (const n of pend) this.soloNote(n)
      pend.length = 0
      return
    }
    if (pend.length === 1) {
      const n = pend[0]
      pend.length = 0
      this.updateInfo()
      const s = chooseString(n.key, this.open, this.info, this.hand)
      const fret = n.key - this.open[s]
      if (fret > 0) this.hand += (fret - this.hand) * 0.5
      this.addNote(n, s)
      this.startString(s, n.key, n.vel, this.art, n.id, 0, 0, n.slide || n.porta)
      return
    }
    // chord
    pend.sort((a, b) => a.key - b.key)
    const keys = this.keysTmp
    keys.length = 0
    for (const n of pend) keys.push(n.key)
    this.lastChord = keys.slice()
    const dir = Math.round(this.p.strum)
    let up = false
    if (dir === 2) up = true
    else if (dir === 3) {
      // alternate down / up while the rhythm keeps going, start a new phrase with a down strum
      const gap = (this.clock - this.lastStrumAt) / this.sr
      up = gap < 0.75 ? !this.strumUp : false
    }
    const vel = pend.reduce((a, n) => Math.max(a, n.vel), 0)
    const ids = pend.map((n) => n.id)
    this.strumChord(keys, vel, up, this.art, ids, dir === 0 ? 0 : 1, pend)
    pend.length = 0
  }

  /**
   * Voice `keys` and pluck them string by string. `ids` = owning note ids (one per key) or -2 for a strum
   * keyswitch. `spread` scales the strum time (0 = together).
   */
  private strumChord(keys: readonly number[], vel: number, up: boolean, art: number, ids: number[] | number, spread: number, notes?: NoteOn[]): void {
    const open = this.open
    const out = this.chordOut
    this.hand = assignChord(keys, open, this.hand, out)
    this.strumUp = up
    this.lastStrumAt = this.clock
    // strings used, low → high
    const used: { s: number; k: number; i: number }[] = []
    for (let i = 0; i < keys.length; i++) {
      let s = out[i]
      if (s < 0 || used.some((u) => u.s === s)) {
        this.updateInfo()
        for (const u of used) this.info[u.s].held = true
        s = chooseString(keys[i], open, this.info, this.hand)
        if (used.some((u) => u.s === s)) continue
      }
      used.push({ s, k: keys[i], i })
    }
    used.sort((a, b) => (up ? b.s - a.s : a.s - b.s))
    // strings not in the grip are muted by the fretting hand (except while a held note owns them)
    for (let s = 0; s < STRINGS; s++) {
      if (used.some((u) => u.s === s)) continue
      const sl = this.players[0].slots[s]
      if (!(sl.held && sl.id >= 0)) this.dampString(s, 0.08)
    }
    const strumMs = this.p.strumTime * spread
    const human = this.p.human
    const first = used.length ? used[0].s : 0
    used.forEach((u, order) => {
      const span = Math.abs(u.s - first) / 5
      const delayMs = strumMs * span
      // down strums lean on the bass strings, up strums mostly catch the treble strings
      const pos = order / Math.max(1, used.length - 1)
      let v = vel * (up ? 0.62 + 0.38 * (u.s / 5) : 1 - 0.12 * pos)
      v = Math.min(1, Math.max(0.05, v))
      let id = typeof ids === 'number' ? ids : ids[u.i]
      if (typeof ids !== 'number' && notes) this.addNote(notes[u.i], u.s)
      else {
        // a strum keyswitch re-plucks strings that held notes own: they stay owned (their note-off releases them)
        const owner = this.notes.find((x) => x.string === u.s && x.key === u.k)
        if (owner) id = owner.id
      }
      this.startString(u.s, u.k, v, art, id, delayMs, 0, false, human)
    })
  }

  private addNote(n: NoteOn, s: number): void {
    // a new note on a string ends the note that owned it
    for (let i = this.notes.length - 1; i >= 0; i--) if (this.notes[i].string === s) this.notes.splice(i, 1)
    if (this.notes.length >= MAX_NOTES) this.notes.shift()
    this.notes.push({ id: n.id, key: n.key, vel: n.vel, string: s })
  }

  /** Schedule a note on string `s` for both guitarists. */
  private startString(s: number, key: number, vel: number, art: number, id: number, delayMs: number, legato: number, slide: boolean, human = this.p.human): void {
    const double = this.p.double >= 0.5
    const glideMs = this.p.glide
    this.players.forEach((pl, pi) => {
      if (pi === 1 && !double) return
      const sl = pl.slots[s]
      const jitter = (pl.random() - 0.5) * 2
      let d = delayMs * (1 + 0.25 * human * jitter) + human * 5 * pl.random()
      if (pi === 1) d += pl.late * (0.5 + pl.random()) * (0.4 + human)
      const fromKey = sl.released ? key : sl.cur
      sl.id = id
      sl.key = key
      sl.held = true
      sl.released = false
      sl.vel = Math.min(1, Math.max(0.02, vel * (1 + (pl.random() - 0.5) * 0.18 * human)))
      sl.art = art
      sl.legato = legato
      sl.target = key
      sl.cur = slide ? fromKey : key
      sl.glide = slide ? 1 - Math.exp(-CTRL / ((glideMs / 1000) * this.sr * 0.35)) : 1
      sl.age = 0
      // a fretted note is never perfectly intonated (finger pressure, fret position): ± ~2.5 cents
      sl.fine = key === this.open[s] ? 0 : (pl.random() - 0.5) * 0.05 * human
      sl.delay = Math.max(0, Math.round((d / 1000) * this.sr))
    })
  }

  private soloNote(n: NoteOn): void {
    const open = this.open
    const prev = this.notes.length ? this.notes[this.notes.length - 1] : null
    const sl = prev ? this.players[0].slots[prev.string] : null
    if (prev && sl && !sl.released) {
      const interval = n.key - sl.target
      const fret = n.key - open[prev.string]
      const reach = fret >= 0 && fret <= 22
      if (reach && (n.slide || n.porta || Math.abs(interval) > 5)) {
        // slide on the same string
        this.notes.push({ id: n.id, key: n.key, vel: n.vel, string: prev.string })
        this.legatoTo(prev.string, n.key, n.id, 0, true)
        return
      }
      if (reach && interval !== 0) {
        // hammer-on (up) / pull-off (down)
        this.notes.push({ id: n.id, key: n.key, vel: n.vel, string: prev.string })
        this.legatoTo(prev.string, n.key, n.id, (interval > 0 ? 0.55 : 0.4) * (0.5 + 0.5 * n.vel), false)
        return
      }
    }
    // new picked note; a monophonic player lets go of the previous string
    this.updateInfo()
    const s = chooseString(n.key, open, this.info, this.hand)
    for (let k = 0; k < STRINGS; k++) if (k !== s && this.players[0].slots[k].held) this.dampString(k, 0.07)
    const fret = n.key - open[s]
    if (fret > 0) this.hand += (fret - this.hand) * 0.6
    this.notes.push({ id: n.id, key: n.key, vel: n.vel, string: s })
    this.startString(s, n.key, n.vel, this.art, n.id, 0, 0, false)
  }

  /** Change the pitch of a sounding string without picking (hammer-on / pull-off / slide). */
  private legatoTo(s: number, key: number, id: number, tapAmount: number, slide: boolean): void {
    const glideMs = this.p.glide
    for (const pl of this.players) {
      const sl = pl.slots[s]
      sl.id = id
      sl.key = key
      sl.target = key
      sl.held = true
      sl.released = false
      sl.age = Math.min(sl.age, Math.round(0.1 * this.sr))
      if (slide) {
        sl.glide = 1 - Math.exp(-CTRL / ((glideMs / 1000) * this.sr * 0.35))
        pl.squeakTarget = Math.max(pl.squeakTarget, 0.5)
      } else {
        sl.glide = 1
        sl.cur = key
        pl.strings[s].setFreq(this.freqOf(pl, sl, 0))
        pl.strings[s].tap(tapAmount, (pl.random() * 0xffffffff) | 1)
      }
    }
  }

  private soloRelease(note: HeldNote): void {
    const back = this.notes.length ? this.notes[this.notes.length - 1] : null
    const sl = this.players[0].slots[note.string]
    if (back && back.string === note.string && !sl.released && sl.id === note.id) {
      // pull-off / slide back to the note still held
      this.legatoTo(note.string, back.key, back.id, Math.abs(back.key - note.key) > 5 ? 0 : 0.35, Math.abs(back.key - note.key) > 5)
      return
    }
    if (sl.id === note.id) this.releaseString(note.string, note.id)
  }

  private releaseString(s: number, id: number): void {
    const open = this.open
    for (const pl of this.players) {
      const sl = pl.slots[s]
      if (sl.id !== id) continue
      sl.held = false
      if (sl.delay >= 0) continue // still waiting for its strum delay: let it pluck, it releases right after
      this.releaseSlot(pl, s, open)
    }
  }

  private releaseSlot(pl: Player, s: number, open: readonly number[]): void {
    const sl = pl.slots[s]
    sl.released = true
    const fretted = sl.key !== open[s]
    const art = sl.art
    const t = art === ART.HARMONIC ? 0.9 : fretted ? 0.09 + 0.06 * this.p.sustain : 0.45
    pl.strings[s].setDamping(t, t * 0.3)
    // finger lifting off a wound string: a small squeak on acoustic models
    const model = Math.round(this.p.model)
    if (fretted && !isElectric(model) && this.p.noise > 0 && pl.random() < 0.35) pl.squeakTarget = Math.max(pl.squeakTarget, 0.12 + 0.2 * pl.random())
  }

  private dampString(s: number, t60: number): void {
    for (const pl of this.players) {
      const sl = pl.slots[s]
      sl.held = false
      sl.released = true
      sl.delay = -1
      pl.strings[s].setDamping(t60, t60 * 0.3)
    }
  }

  private dampAll(t60: number): void {
    for (let s = 0; s < STRINGS; s++) this.dampString(s, t60)
  }

  private updateInfo(): void {
    const pl = this.players[0]
    for (let s = 0; s < STRINGS; s++) {
      const sl = pl.slots[s]
      this.info[s].held = sl.held && !sl.released
      this.info[s].ringing = pl.strings[s].level > 0.01
    }
  }

  // ─── sound ──────────────────────────────────────────────────────────────────
  /** Physical parameters of a pluck for the current model / articulation. */
  private spec(pl: Player, s: number, sl: Slot, out: PluckSpec): void {
    const p = this.p
    const model = Math.round(p.model)
    const f = mtof(sl.key)
    const vel = sl.vel
    const attack = p.attack
    const sus = Math.pow(2, (p.sustain - 0.6) * 3)
    // Tone: how long the treble rings (×0.5 … ×2)
    const bright = Math.pow(2, (p.tone - 0.55) * 2)
    let t60: number
    let t60hi: number
    let cutoff: number
    let scrape: number
    // pick brightness: attack knob + velocity (harder picking = brighter)
    const hard = Math.min(1, 0.65 * attack + 0.45 * vel)
    // wound strings (the low three, four on a steel acoustic) eat their treble faster than plain ones —
    // except on a classical guitar, where the plain nylon trebles are the dull ones
    const wound = s <= (model === MODEL.STEEL ? 3 : 2)
    switch (model) {
      case MODEL.NYLON:
        t60 = 7 * Math.pow(82 / f, 0.5)
        t60hi = wound ? 0.55 : 0.28
        cutoff = 900 * Math.pow(5, hard)
        scrape = 0.05 * attack
        break
      case MODEL.SINGLE:
      case MODEL.HUMBUCKER:
        t60 = 12 * Math.pow(82 / f, 0.45)
        t60hi = wound ? 1.4 : 2.2
        cutoff = 2200 * Math.pow(5, hard)
        scrape = 0.2 * attack
        break
      case MODEL.HOLLOW:
        t60 = 6 * Math.pow(82 / f, 0.45)
        t60hi = wound ? 0.8 : 1.2
        cutoff = 1500 * Math.pow(4.5, hard)
        scrape = 0.12 * attack
        break
      default:
        t60 = 10 * Math.pow(82 / f, 0.45)
        t60hi = wound ? 0.85 : 1.5
        cutoff = 1600 * Math.pow(6, hard)
        scrape = 0.3 * attack
    }
    let pluckPos = p.pickPos * (0.85 + 0.3 * pl.random())
    t60 *= sus
    t60hi *= bright * Math.sqrt(sus)
    // tension modulation: a hard pluck stretches the string and starts sharp (nylon stretches most)
    let tm = vel * vel * (model === MODEL.NYLON ? 0.11 : model === MODEL.STEEL ? 0.06 : 0.04) * Math.pow(f / 110, -0.3)
    switch (sl.art) {
      case ART.PALM:
        t60 = 0.2 * Math.pow(82 / f, 0.25) * (0.7 + 0.6 * p.sustain)
        t60hi = 0.035
        cutoff *= 0.6
        pluckPos = Math.min(pluckPos, 0.1)
        tm *= 0.3
        break
      case ART.MUTED:
        t60 = 0.04
        t60hi = 0.012
        scrape *= 1.6
        tm = 0
        break
      case ART.HARMONIC:
        t60 *= 1.4
        t60hi = Math.max(t60hi * 1.6, 2)
        cutoff = f * 1.5
        pluckPos = 0.5
        scrape *= 0.3
        tm *= 0.3
        break
    }
    sl.tm = sl.legato > 0 ? 0 : tm
    out.vel = vel
    out.cutoff = cutoff
    out.scrape = scrape * (0.4 + 0.6 * vel)
    out.pluckPos = Math.min(0.5, Math.max(0.03, pluckPos))
    out.t60 = t60
    out.t60hi = t60hi
    out.angle = 0.15 + 0.35 * pl.random()
    out.detune = (pl.random() - 0.5) * 2.4
    out.legato = sl.legato > 0 ? sl.legato : 0
    out.seed = (pl.random() * 0xffffffff) | 1
  }

  private pluckSpec: PluckSpec = { vel: 0, cutoff: 1000, scrape: 0, pluckPos: 0, t60: 1, t60hi: 0.5, angle: 0, detune: 0, seed: 1 }

  private freqOf(pl: Player, sl: Slot, vib: number): number {
    return mtof(sl.cur + this.bend + vib + sl.tm + sl.fine) * (pl === this.players[1] ? Math.pow(2, pl.cents / 1200) : 1)
  }

  /** Control rate: glides, vibrato, editor feedback. */
  private control(): void {
    const vibDepth = this.p.vibrato * 0.45 // semitones
    this.vibPhase += (2 * Math.PI * this.p.vibRate * CTRL) / this.sr
    if (this.vibPhase > 2 * Math.PI) this.vibPhase -= 2 * Math.PI
    const lfo = Math.sin(this.vibPhase)
    const onset = 0.22 * this.sr
    // tension modulation settles as the string's amplitude decays (~120 ms)
    const tmDecay = Math.exp(-CTRL / (0.12 * this.sr))
    for (const pl of this.players) {
      for (let s = 0; s < STRINGS; s++) {
        const sl = pl.slots[s]
        if (sl.released && pl.strings[s].level < 1e-4) continue
        const prev = sl.cur
        sl.cur += (sl.target - sl.cur) * sl.glide
        sl.tm *= tmDecay
        if (Math.abs(sl.cur - prev) > 0.004 && !isElectric(Math.round(this.p.model))) pl.squeakTarget = Math.max(pl.squeakTarget, Math.min(0.6, Math.abs(sl.cur - prev) * 4))
        let vib = 0
        if (vibDepth > 0 && sl.held && !sl.released) {
          sl.age += CTRL
          const ramp = sl.age < onset ? 0 : Math.min(1, (sl.age - onset) / (0.35 * this.sr))
          vib = vibDepth * ramp * (0.5 + 0.5 * lfo) // guitar vibrato bends up from the fretted pitch
        } else sl.age += CTRL
        pl.strings[s].setFreq(this.freqOf(pl, sl, vib))
      }
    }
    // fretboard display, ~25 Hz
    this.postTimer -= CTRL
    if (this.postTimer <= 0) {
      this.postTimer = Math.round(this.sr / 25)
      const pl = this.players[0]
      const open = this.open
      let msg = ''
      for (let s = 0; s < STRINGS; s++) {
        const sl = pl.slots[s]
        const on = !sl.released || pl.strings[s].level > 0.02
        msg += on ? `${Math.round(sl.cur - open[s])},` : '-1,'
      }
      msg += this.art
      // on change, and twice a second anyway (an editor that just opened gets the current state)
      if (msg !== this.lastPosted || --this.repost <= 0) {
        this.repost = 12
        this.lastPosted = msg
        const parts = msg.split(',').map(Number)
        this.post({ type: 'frets', frets: parts.slice(0, STRINGS), art: parts[STRINGS] })
      }
    }
  }

  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.flush()
    let o = start
    while (o < end) {
      const n = Math.min(end - o, 512)
      this.render(outL, outR, o, n)
      o += n
    }
  }

  private render(outL: Float32Array, outR: Float32Array, o: number, n: number): void {
    const p = this.p
    const model = Math.round(p.model)
    const electric = isElectric(model)
    const double = p.double >= 0.5
    const width = p.width
    const ampOn = Math.round(p.amp) !== AMP.OFF
    const open = this.open
    const wetL = this.wetL
    const wetR = this.wetR
    wetL.fill(0, 0, n)
    wetR.fill(0, 0, n)
    for (let pi = 0; pi < (double ? 2 : 1); pi++) {
      const pl = this.players[pi]
      const buf = pl.buf
      const bl = pl.bufL
      const br = pl.bufR
      buf.fill(0, 0, n)
      bl.fill(0, 0, n)
      br.fill(0, 0, n)
      for (let i = 0; i < n; i++) {
        if (--this.ctrl <= 0 && pi === 0) {
          this.ctrl = CTRL
          this.control()
        }
        let mono = 0
        let l = 0
        let r = 0
        for (let s = 0; s < STRINGS; s++) {
          const sl = pl.slots[s]
          const str = pl.strings[s]
          if (sl.delay >= 0) {
            if (sl.delay === 0) {
              str.setFreq(this.freqOf(pl, sl, 0))
              this.spec(pl, s, sl, this.pluckSpec)
              str.setFreq(this.freqOf(pl, sl, 0))
              if (sl.legato > 0) str.tap(sl.legato, this.pluckSpec.seed)
              else {
                str.pluck(this.pluckSpec)
                pl.bodyL.knock(sl.vel)
                pl.bodyR.knock(sl.vel)
              }
              if (!sl.held) this.releaseSlot(pl, s, open)
            }
            sl.delay--
          }
          if (str.level < 1e-5 && sl.released) continue
          const y = str.process()
          mono += y
          // strings spread across the stereo image (player's view: low strings left)
          const sp = (s - 2.5) / 2.5
          l += y * (1 - 0.35 * sp)
          r += y * (1 + 0.35 * sp)
        }
        // fret / slide squeak
        if (pl.squeakTarget > 0 || pl.squeakEnv > 1e-4) {
          pl.squeakEnv += (pl.squeakTarget - pl.squeakEnv) * 0.004
          pl.squeakTarget *= 0.9995
          const noise = pl.random() * 2 - 1
          const sq = pl.squeak.process(noise) * pl.squeakEnv * p.noise * 0.08
          mono += sq
          l += sq
          r += sq
        }
        buf[i] = mono
        bl[i] = l * 0.5
        br[i] = r * 0.5
      }
      if (electric || ampOn) {
        // the body (an archtop's top, or an acoustic's under a piezo) colours what the pickup hears
        for (let i = 0; i < n; i++) buf[i] = pl.pickupLp2.process(pl.pickupLp.process(pl.bodyL.process(buf[i])))
        pl.amp.process(buf, 0, n)
        // mono guitar: centred, or hard-ish left / right when double tracked
        const pan = double ? (pi === 0 ? -1 : 1) * width : 0
        const gl = Math.sqrt(0.5 * (1 - pan))
        const gr = Math.sqrt(0.5 * (1 + pan))
        for (let i = 0; i < n; i++) {
          wetL[i] += buf[i] * gl
          wetR[i] += buf[i] * gr
        }
      } else {
        // acoustic: stereo string spread (mic pair); doubled takes go left / right
        const w = double ? width : width * 0.6
        const pan = double ? (pi === 0 ? -0.7 : 0.7) * width : 0
        for (let i = 0; i < n; i++) {
          bl[i] = pl.bodyL.process(bl[i])
          br[i] = pl.bodyR.process(br[i])
          const m = (bl[i] + br[i]) * 0.5
          const sideL = m + (bl[i] - m) * w
          const sideR = m + (br[i] - m) * w
          wetL[i] += sideL * (1 - Math.max(0, pan)) * 0.71 * 1.41
          wetR[i] += sideR * (1 + Math.min(0, pan)) * 0.71 * 1.41
        }
      }
      // squeak decays even when idle
      if (pl.squeakEnv < 1e-4 && pl.squeakTarget < 1e-4) pl.squeakEnv = pl.squeakTarget = 0
    }
    const vol = dbToGain(p.volume) * (double ? 0.75 : 1) * (ampOn ? 1 : electric ? 0.6 : 0.85)
    for (let i = 0; i < n; i++) {
      outL[o + i] += wetL[i] * vol
      outR[o + i] += wetR[i] * vol
    }
    const rev = p.reverb
    if (rev > 0.001) this.hall.process(wetL, wetR, outL, outR, o, n, rev * rev * 0.9 * vol)
    this.clock += n
  }
}

const factory: DSPFactory = {
  id: 'guitar',
  kind: 'instrument',
  create: (ctx) => new Guitar(ctx)
}
export default factory
