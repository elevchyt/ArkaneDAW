// Piano — dedicated piano instrument DSP. Reuses Mosaic's physically-modelled piano (modal strings,
// soundboard) and EP engines and its master FX (chorus / delay / FDN reverb); adds piano
// behaviour on top: sustain pedal (deferred note-offs, damper & pedal noise, sympathetic pedal
// resonance), velocity curve, key-tracked stereo image with player/audience perspective, lid / tone
// voicing, string detune & age, tape wobble, pad layer, 64-voice polyphony with click-free stealing.
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { Mods, clamp, type PartParams } from '../mosaic/engines/common'
import { PianoBody } from '../mosaic/engines/piano'
import { EPPost } from '../mosaic/engines/epiano'
import { MasterFX, type FXParams } from '../mosaic/fx'
import { PARAMS, POLYPHONY } from './manifest'
import { PATCHES, type PatchModel } from './patches'
import { PedalNoise, TapeStage, ToneStage, type ToneSettings } from './post'
import { Voice } from './voice'

const BLOCK = 128
/** Extra voices that may still be fading out after being stolen. */
const SPARE = 16
const STEAL_FADE = 0.006
const RESTRIKE_FADE = 0.12
const REPORT_EVERY = 2400

/** deterministic per-key pseudo random in [0,1) */
const hash = (k: number, salt: number): number => {
  const x = Math.sin(k * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function fxDefaults(): FXParams {
  return {
    eqLow: 0, eqMid: 0, eqMidF: 1000, eqHigh: 0,
    choOn: false, choRate: 0.7, choDepth: 0.5, choMix: 0,
    phaOn: false, phaRate: 0.3, phaDepth: 0.5, phaFb: 0.3, phaMix: 0,
    dlyOn: false, dlyTime: 430, dlyFb: 0.38, dlyTone: 0.35, dlyPP: true, dlyMix: 0,
    revOn: false, revSize: 0.5, revDecay: 2, revDamp: 0.5, revPre: 15, revMix: 0
  }
}

/** Transparent below 0.85, soft knee to an asymptote of 1.2. */
function limit(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= 0.85) return x
  const s = 0.85 + 0.35 * Math.tanh((a - 0.85) / 0.35)
  return x < 0 ? -s : s
}

export class PianoDSP implements InstrumentDSP {
  private sr: number
  private P: Record<string, number> = {}
  private model: PatchModel = PATCHES[0]
  private voices: Voice[]
  private clock = 0
  private pedalDown = false
  private bend = 0
  private bendApplied = 0
  private dirty = true

  // shared engine params (filled per note-on, no allocation)
  private pp: PartParams = {}
  private mods = new Mods()

  // post
  private body: PianoBody
  private bodyP: PartParams = { body: 0.5, variant: 0 }
  private tone: ToneStage
  private toneS: ToneSettings = { hp: 30, lowShelf: 0, midF: 1000, midG: 0, cabG: 0, highShelf: 0, lp: 20000, sat: 0 }
  private tape: TapeStage
  private trem: EPPost
  private tremP: PartParams = { 'trem.mode': 0, 'trem.rate': 4, 'trem.depth': 0 }
  private fx: MasterFX
  private fxp: FXParams = fxDefaults()
  private pedalNoise: PedalNoise
  // sympathetic resonance while the pedal is down (open strings) — reverb-only FDN on a send
  private resFx: MasterFX
  private resP: FXParams = fxDefaults()
  private resSend = 0
  private resTail = 0
  private volG = -1

  private bl = new Float32Array(BLOCK)
  private br = new Float32Array(BLOCK)
  private xl = new Float32Array(BLOCK)
  private xr = new Float32Array(BLOCK)
  private sl = new Float32Array(BLOCK)
  private sr2 = new Float32Array(BLOCK)

  // editor feedback (sounding keys)
  private post: (msg: unknown) => void
  private keyState = new Uint8Array(128)
  private keyScratch = new Uint8Array(128)
  private reportCount = 0
  private reportedPedal = false

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    for (const d of PARAMS) this.P[d.id] = d.default
    this.voices = Array.from({ length: POLYPHONY + SPARE }, () => new Voice(this.sr))
    this.body = new PianoBody(this.sr)
    this.tone = new ToneStage(this.sr)
    this.tape = new TapeStage(this.sr)
    this.trem = new EPPost(this.sr)
    this.fx = new MasterFX(this.sr)
    this.resFx = new MasterFX(this.sr)
    this.pedalNoise = new PedalNoise(this.sr)
    this.resP.revOn = true
    this.resP.revMix = 1
    this.resP.revSize = 0.3
    this.resP.revDecay = 2.2
    this.resP.revDamp = 0.25
    this.resP.revPre = 0
  }

  // ─── params ────────────────────────────────────────────────────────────────
  setParam(id: string, v: number): void {
    this.P[id] = v
    if (id === 'patch') this.model = PATCHES[clamp(Math.round(v), 0, PATCHES.length - 1)]
    else if (id === 'sustain') this.setPedal(v >= 0.5)
    this.dirty = true
  }

  private setPedal(down: boolean): void {
    if (down === this.pedalDown) return
    this.pedalDown = down
    const mech = this.P.mech
    if (down) this.pedalNoise.down(mech)
    else {
      this.pedalNoise.up(mech)
      for (const v of this.voices) if (v.active && v.sustained && !v.held) v.release(0.5)
    }
    this.reportCount = REPORT_EVERY // report soon
  }

  private updatePost(): void {
    const P = this.P
    const m = this.model
    const lid = P.lid
    const tape = P.tape
    const acoustic = m.engine !== 'ep'
    // body: soundboard model for acoustic / toy, cabinet peak for EPs
    this.bodyP.body = P.body
    this.bodyP.variant = Math.max(0, m.bodyType)
    this.body.update(this.bodyP)
    const t = this.toneS
    t.hp = m.hp + tape * 80
    t.lowShelf = m.lowShelf
    t.midF = m.midF
    t.midG = m.midG
    t.cabG = acoustic ? 0 : P.body * 7 - 2
    t.highShelf = m.highShelf - 12 * Math.pow(1 - lid, 1.5) + 2.5 * lid
    t.lp = clamp(m.lp * Math.pow(2, (lid - 1) * 1.2) * Math.pow(2, -tape * 1.6), 1500, 20000)
    t.sat = m.sat + tape * 0.35
    this.tone.set(t)
    this.tremP['trem.mode'] = m.tremMode
    this.tremP['trem.rate'] = P.tremRate
    this.tremP['trem.depth'] = P.trem
    this.trem.update(this.tremP)
    const f = this.fxp
    const rev = P.rev
    const size = P.revSize
    f.choOn = P.chorus > 0.001
    f.choRate = m.chorusRate
    f.choDepth = m.chorusDepth
    f.choMix = P.chorus * 0.9
    f.dlyOn = m.delay > 0 && rev > 0.001
    f.dlyMix = m.delay * Math.min(1, rev * 2.5)
    f.revOn = rev > 0.001
    f.revMix = rev
    f.revSize = size
    f.revDecay = 0.4 + 6.5 * size * size
    f.revDamp = m.revDamp
    f.revPre = m.revPre + size * 20
    this.resP.revDecay = 1.2 + 1.6 * m.decay
    this.dirty = false
  }

  pitchBend(semitones: number): void {
    this.bend = semitones
  }

  // ─── notes ─────────────────────────────────────────────────────────────────
  noteOn(n: NoteOn): void {
    if (n.slide) return
    if (this.dirty) this.updatePost()
    const key = n.key
    const sr = this.sr
    const voices = this.voices
    // re-striking a key: let the old string energy fade under the new strike
    for (const v of voices) if (v.active && !v.fading && v.key === key && !v.releasing) v.startFade(RESTRIKE_FADE, sr)
    // polyphony limit: steal the least important sounding voice with a short fade
    let count = 0
    for (const v of voices) if (v.active && !v.fading) count++
    if (count >= POLYPHONY) this.steal()?.startFade(STEAL_FADE, sr)
    let v: Voice | null = null
    for (const x of voices) if (!x.active) { v = x; break }
    if (!v) {
      // every voice busy fading: take the quietest fade
      for (const x of voices) if (!v || x.fade < v.fade) v = x
      v!.kill()
    }
    this.startVoice(v!, n)
  }

  private steal(): Voice | null {
    let best: Voice | null = null
    let bestRank = 99
    for (const v of this.voices) {
      if (!v.active || v.fading) continue
      // damped first, then pedal-held, then held keys; oldest within a class
      const rank = v.releasing ? 0 : v.sustained ? 1 : 2
      if (rank < bestRank || (rank === bestRank && best && v.age < best.age)) {
        best = v
        bestRank = rank
      }
    }
    return best
  }

  private startVoice(v: Voice, n: NoteOn): void {
    const P = this.P
    const m = this.model
    const key = n.key
    const dyn = P.dyn
    const vel = clamp(n.vel, 0.005, 1)
    // velocity curve: timbre velocity and loudness range both widen with Dynamics
    const vc = Math.pow(vel, 0.6 + 0.8 * dyn)
    const gain = Math.pow(vel, 0.8 + 2.4 * dyn) * m.gain
    const detune = P.detune
    const mistune = (hash(key, 19) - 0.5) * 2 * detune * detune * 10
    const freq = P.tuning * Math.pow(2, (key - 69) / 12 + (n.fine + mistune) / 1200)
    const bright = P.bright
    const mech = P.mech
    const pp = this.pp
    const mods = this.mods
    mods.bright = 0
    mods.drive = 0
    mods.detune = 0
    pp.variant = m.variant
    pp.decay = m.decay
    if (m.engine === 'acoustic') {
      pp.hard = clamp(m.hard + (bright - 0.5) * 0.9, 0, 1)
      pp.unison = clamp(detune * 1.2, 0, 1)
      pp.strike = m.strike
      pp.stretch = m.stretch
      pp.noise = clamp(m.noise * mech * 2.5, 0, 1.6)
      pp.damper = clamp(m.damper * mech * 2.5, 0, 1.6)
      pp.width = P.width
      mods.detune = Math.max(0, detune - 0.5) * 3
      v.ev = v.piano
    } else if (m.engine === 'ep') {
      pp.bark = clamp(m.hard + (bright - 0.5), 0, 1)
      pp.tine = clamp(m.tine * (0.5 + bright), 0, 1)
      pp.drive = m.drive
      v.ev = v.ep
    } else {
      pp.hard = clamp(m.hard + (bright - 0.5) * 0.8, 0, 1)
      pp.detune = detune * 0.6
      pp.noise = clamp(m.noise * mech * 2.5, 0, 1.6)
      v.ev = v.toy
    }
    // mellow patches: velocity mostly drives loudness, the hammer/tine timbre stays soft
    const vt = vc * m.velTimbre + (1 - m.velTimbre) * 0.4
    v.ev.start(key, vt, freq, pp, mods, this.sr)
    if (this.bend !== 0) v.ev.setFreq(freq * Math.pow(2, this.bend / 12))
    v.engineAlive = true
    v.padOn = P.pad > 0.001
    if (v.padOn) {
      v.pad.start(freq, vc, P.pad)
      if (this.bend !== 0) v.pad.setFreq(freq * Math.pow(2, this.bend / 12))
    }
    // stereo image: keys spread across the field (low = left from the player's seat)
    const kp = clamp((key - 64.5) / 43.5, -1, 1) * P.width * 0.75 * (P.persp >= 0.5 ? -1 : 1)
    const pan = clamp(kp + n.pan, -1, 1)
    v.gl = pan > 0 ? 1 - pan : 1
    v.gr = pan < 0 ? 1 + pan : 1
    v.gain = gain
    v.freq = freq
    v.active = true
    v.noteId = n.id
    v.key = key
    v.age = ++this.clock
    v.held = true
    v.sustained = false
    v.releasing = false
    v.pedalNote = P.modyPedal >= 0.5 && n.modY > 0.75
    v.fading = false
    v.fade = 1
    v.fadeStep = 0
  }

  noteOff(id: number, key: number, rel: number): void {
    let found = false
    for (const v of this.voices) {
      if (!v.active || !v.held || v.noteId !== id) continue
      found = true
      this.keyUp(v, rel)
    }
    if (found) return
    for (const v of this.voices) if (v.active && v.held && v.key === key) this.keyUp(v, rel)
  }

  private keyUp(v: Voice, rel: number): void {
    v.held = false
    if (this.pedalDown || v.pedalNote) v.sustained = true
    else v.release(rel)
  }

  allNotesOff(hard: boolean): void {
    for (const v of this.voices) {
      if (hard) v.kill()
      else if (v.active) v.release(0.5)
    }
    if (hard) {
      this.fx.reset()
      this.resFx.reset()
      this.body.reset()
      this.tone.reset()
      this.tape.reset()
      this.trem.reset()
      this.pedalNoise.reset()
      this.resSend = 0
      this.resTail = 0
    }
  }

  /** Number of sounding voices (tests / meters). */
  activeVoices(): number {
    let c = 0
    for (const v of this.voices) if (v.active) c++
    return c
  }

  // ─── render ────────────────────────────────────────────────────────────────
  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const n = end - start
    if (n <= 0) return
    if (this.dirty) this.updatePost()
    const xl = this.xl
    const xr = this.xr
    xl.fill(0, 0, n)
    xr.fill(0, 0, n)

    // pitch bend
    if (this.bend !== this.bendApplied) {
      this.bendApplied = this.bend
      const ratio = Math.pow(2, this.bend / 12)
      for (const v of this.voices) {
        if (!v.active) continue
        v.ev.setFreq(v.freq * ratio)
        v.pad.setFreq(v.freq * ratio)
      }
    }

    let any = false
    for (const v of this.voices) {
      if (!v.active) continue
      any = true
      this.renderVoice(v, n)
    }

    const m = this.model
    const P = this.P
    const acoustic = m.engine === 'acoustic'
    // pedal mechanics excite the instrument body
    this.pedalNoise.process(xl, xr, n)
    if (m.bodyType >= 0) this.body.process(xl, xr, n)

    // sympathetic resonance of the undamped strings while the pedal is down
    const resTarget = acoustic && this.pedalDown ? 0.16 * (0.4 + P.body) : 0
    if (resTarget > 0 || this.resSend > 1e-5 || this.resTail > 0) {
      const s0 = this.resSend
      const s1 = s0 + (resTarget - s0) * Math.min(1, n / (this.sr * 0.03))
      this.resSend = s1 < 1e-5 && resTarget === 0 ? 0 : s1
      const ds = (s1 - s0) / n
      const sl = this.sl
      const sr = this.sr2
      let s = s0
      for (let i = 0; i < n; i++) {
        s += ds
        sl[i] = xl[i] * s
        sr[i] = xr[i] * s
      }
      this.resFx.process(sl, sr, n, this.resP)
      // MasterFX returns 0.7·dry + wet at mix 1: keep the wet part only
      s = s0
      for (let i = 0; i < n; i++) {
        s += ds
        xl[i] += sl[i] - 0.7 * xl[i] * s
        xr[i] += sr[i] - 0.7 * xr[i] * s
      }
      if (this.resSend > 0) this.resTail = this.sr * 4
      else {
        this.resTail -= n
        if (this.resTail <= 0) {
          this.resTail = 0
          this.resFx.reset()
        }
      }
    }

    this.tone.process(xl, xr, n)
    this.tape.process(xl, xr, n, P.tape)
    this.trem.process(xl, xr, n, this.mods)
    this.fx.process(xl, xr, n, this.fxp)

    const vt = P.volume * P.volume * 0.9
    const v0 = this.volG < 0 ? vt : this.volG
    this.volG = vt
    const dv = (vt - v0) / n
    let g = v0
    for (let i = 0; i < n; i++) {
      g += dv
      outL[start + i] += limit(xl[i] * g)
      outR[start + i] += limit(xr[i] * g)
    }

    this.reportCount += n
    if (this.reportCount >= REPORT_EVERY) {
      this.reportCount = 0
      this.reportKeys(any)
    }
  }

  private renderVoice(v: Voice, n: number): void {
    const bl = this.bl
    const br = this.br
    if (v.engineAlive) {
      v.engineAlive = v.ev.render(bl, br, n)
      if (!v.ev.stereo) for (let i = 0; i < n; i++) br[i] = bl[i]
    } else {
      bl.fill(0, 0, n)
      br.fill(0, 0, n)
    }
    if (v.padOn) v.padOn = v.pad.render(bl, br, n)
    const xl = this.xl
    const xr = this.xr
    const gl = v.gain * v.gl
    const gr = v.gain * v.gr
    if (v.fading) {
      let f = v.fade
      const step = v.fadeStep
      for (let i = 0; i < n; i++) {
        f -= step
        if (f <= 0) {
          f = 0
          break
        }
        xl[i] += bl[i] * gl * f
        xr[i] += br[i] * gr * f
      }
      v.fade = f
      if (f <= 0) v.kill()
    } else {
      for (let i = 0; i < n; i++) {
        xl[i] += bl[i] * gl
        xr[i] += br[i] * gr
      }
    }
    if (!v.engineAlive && !v.padOn) v.kill()
  }

  private reportKeys(any: boolean): void {
    const cur = this.keyScratch
    cur.fill(0)
    if (any) for (const v of this.voices) if (v.active && !v.releasing && !v.fading) cur[v.key & 127] = v.held ? 1 : 2
    let changed = false
    const prev = this.keyState
    for (let k = 0; k < 128; k++) if (cur[k] !== prev[k]) { changed = true; break }
    if (!changed && this.reportedPedal === this.pedalDown) return
    this.reportedPedal = this.pedalDown
    prev.set(cur)
    const held: number[] = []
    const sus: number[] = []
    for (let k = 0; k < 128; k++) {
      if (cur[k] === 1) held.push(k)
      else if (cur[k] === 2) sus.push(k)
    }
    this.post({ type: 'keys', held, sus, pedal: this.pedalDown })
  }
}

export default { id: 'piano', kind: 'instrument', create: (ctx) => new PianoDSP(ctx) } satisfies DSPFactory
