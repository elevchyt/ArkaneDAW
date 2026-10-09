// Atmos voice engine. Runs in the AudioWorklet: no DOM, no UI imports, no allocation in process().
import type { DSPContext, InstrumentDSP, NoteOn } from '../sdk/types'
import { PARAMS } from './manifest'
import { FRAMES, LEVELS, MAXH, STRIDE, TSIZE, getTable } from './wavetables'
import { TEX_LEN, TEX_ROOT, TEX_SR, getTexture } from './textures'
import { Env, Rng, SmoothRand, Svf, TAU, safety } from './util'
import { Ensemble, PingPong, ShimmerVerb } from './fx'

const K = 32 // control-rate chunk
const MAXCH = 8 // max chunks per sub-block (128 / 32 = 4, with margin)
const SLOTS = 24
const POLY = 16
const MAXG = 12
const VOICE_GAIN = 0.2

const HANN = new Float32Array(1025)
const SINE = new Float32Array(1025)
for (let i = 0; i <= 1024; i++) {
  HANN[i] = 0.5 - 0.5 * Math.cos((TAU * i) / 1024)
  SINE[i] = Math.sin((TAU * i) / 1024)
}

const BANKS = [
  [1, 2, 3, 4],
  [1, 3, 5, 7],
  [1, 1.5, 2, 3],
  [1, 2.76, 5.4, 8.93]
]
const BANK_W = [1, 0.6, 0.45, 0.32]
// U O A E I (F1 F2 F3)
const VOW = [
  [300, 870, 2240],
  [570, 840, 2410],
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010]
]
const VOW_G = [1, 0.6, 0.35]
const SHIM_RATIOS = [2, 1.5, 3, 4, 0.5]

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

class Voice {
  active = false
  releasing = false
  killing = false
  kill = 1
  noteId = -1
  key = 60
  age = 0
  velGain = 1
  pan = 0
  fine = 0
  modX = 0.5
  modY = 0.5
  pitch = 60
  target = 60
  time = 0
  amp: Env
  fenv: Env
  ampLast = 0
  ph = new Float64Array(8)
  subPh = 0
  // grains
  gPos = new Float64Array(MAXG)
  gInc = new Float64Array(MAXG)
  gWin = new Float64Array(MAXG)
  gWinInc = new Float64Array(MAXG)
  gL = new Float64Array(MAXG)
  gR = new Float64Array(MAXG)
  gN = 0
  gTimer = 0
  gScan = 0
  rng: Rng
  // noise
  nL = new Svf()
  nR = new Svf()
  bank = [new Svf(), new Svf(), new Svf(), new Svf()]
  bankG = new Float64Array(4)
  // filter
  fL1 = new Svf()
  fR1 = new Svf()
  fL2 = new Svf()
  fR2 = new Svf()
  form = [new Svf(), new Svf(), new Svf(), new Svf(), new Svf(), new Svf()]
  combL = new Float32Array(4096)
  combR = new Float32Array(4096)
  combW = 0
  combLpL = 0
  combLpR = 0
  // modulation
  dr: SmoothRand[]
  ev: SmoothRand[]
  drRate: number
  // last values (visualisation)
  lastPos = 0
  lastEv = 0
  constructor(sr: number, seed: number) {
    this.amp = new Env(sr, K)
    this.fenv = new Env(sr, K)
    this.rng = new Rng(seed)
    this.dr = [0, 1, 2, 3].map(() => new SmoothRand(this.rng))
    this.ev = [0, 1, 2].map(() => new SmoothRand(this.rng))
    this.drRate = 0.8 + 0.45 * this.rng.uni()
  }
}

export class Atmos implements InstrumentDSP {
  private sr: number
  private p: Record<string, number> = {}
  private voices: Voice[]
  private clock = 0
  private bend = 0
  private lastKey = -1
  private dirty = true
  private envDirty = true
  // assets
  private table: Float32Array | null = null
  private tableIdx = -1
  private tex: Float32Array | null = null
  private texIdx = -1
  // scratch
  private sL = new Float32Array(K)
  private sR = new Float32Array(K)
  private busL = new Float32Array(128)
  private busR = new Float32Array(128)
  private mod = new Float64Array(8)
  // derived (per block)
  private U = 4
  private ru = new Float64Array(8)
  private uGL = new Float64Array(8)
  private uGR = new Float64Array(8)
  private chunkL1 = new Float64Array(MAXCH)
  private chunkL2 = new Float64Array(MAXCH)
  private chunkLvlW = new Float64Array(MAXCH)
  private chunkLvlG = new Float64Array(MAXCH)
  private chunkLvlN = new Float64Array(MAXCH)
  private chunkCut = new Float64Array(MAXCH)
  private sLvlW = 0
  private sLvlG = 0
  private sLvlN = 0
  private sCut = Math.log2(2500)
  private sGain = 1
  // LFOs (global, free-running)
  private lfoPh = [0, 0.25]
  private lfoHold = [0, 0]
  private lfoRnd: SmoothRand[]
  private rng = new Rng(0x51f15e)
  // fx
  private verb: ShimmerVerb
  private delay: PingPong
  private chorus: Ensemble
  private toneLpL = 0
  private toneLpR = 0
  private fxIdle = true
  private idleCount = 0
  // viz
  private vizOn = false
  private vizCount = 0
  private vizPeak = 0
  // cached param values (derived)
  private d = {
    E: 0.4, M: 0.5, S: 0.5, T: 0.5,
    waveOn: true, posBase: 0.3, waveLvl: 0.8, waveTr: 0, envPos: 0, sub: 0,
    granOn: false, granLvl: 0.6, gPos: 0.3, gSize: 0.18, gDens: 16, gSpray: 0.2, gPr: 0.1, gRev: 0, gOct: 0, gShim: 0, gScan: 0.1, gWidth: 0.6, gKt: 1,
    noiseOn: false, noiseLvl: 0.4, nColor: 3000, nTune: 0.5, nQ: 40, nBank: 0, nOct: 0,
    fMode: 1, fPitch: 0, cutOct: 11, res: 0.2, fEnv: 0.2, fKt: 0.4, vowel: 0.5,
    l1Shape: 0, l1Rate: 0.15, l1Depth: 0.2, l1Dest: 0, l2Shape: 0, l2Rate: 0.08, l2Depth: 0.2, l2Dest: 1,
    driftD: 0.3, driftRate: 0.2, evRate: 0.05, lfoRateMul: 1, lfoDepthMul: 1,
    drive: 0, gain: 1, tiltLo: 1, tiltHi: 1, width: 1.2, velSens: 0.4
  }

  constructor(private ctx: DSPContext) {
    this.sr = ctx.sampleRate
    for (const def of PARAMS) this.p[def.id] = def.default
    this.voices = Array.from({ length: SLOTS }, (_, i) => new Voice(this.sr, 0x1234567 + i * 7919))
    this.lfoRnd = [new SmoothRand(this.rng), new SmoothRand(this.rng)]
    this.verb = new ShimmerVerb(this.sr)
    this.delay = new PingPong(this.sr)
    this.chorus = new Ensemble(this.sr)
  }

  setParam(id: string, value: number): void {
    if (!Number.isFinite(value)) return
    this.p[id] = value
    this.dirty = true
    if (id.startsWith('amp.') || id.startsWith('fenv.')) this.envDirty = true
  }

  pitchBend(st: number): void {
    this.bend = st
  }

  onMessage(msg: unknown): void {
    const m = msg as { type?: string; on?: boolean }
    if (m && m.type === 'viz') this.vizOn = !!m.on
  }

  noteOn(n: NoteOn): void {
    if (n.slide) {
      let any = false
      for (const v of this.voices)
        if (v.active && !v.releasing && !v.killing) {
          v.target = n.key
          any = true
        }
      this.lastKey = n.key
      if (any) return
    }
    // polyphony limit: fade out the oldest (prefer releasing) voice
    let live = 0
    for (const v of this.voices) if (v.active && !v.killing) live++
    if (live >= POLY) {
      let victim: Voice | null = null
      for (const v of this.voices) if (v.active && !v.killing && v.releasing && (!victim || v.age < victim.age)) victim = v
      if (!victim) for (const v of this.voices) if (v.active && !v.killing && (!victim || v.age < victim.age)) victim = v
      if (victim) victim.killing = true
    }
    let v: Voice | null = null
    for (const x of this.voices) if (!x.active) {
      v = x
      break
    }
    if (!v) for (const x of this.voices) if (!v || x.age < v.age) v = x
    const p = this.p
    v = v!
    v.active = true
    v.releasing = false
    v.killing = false
    v.kill = 1
    v.noteId = n.id
    v.key = n.key
    v.age = ++this.clock
    v.velGain = 1 - this.d.velSens + this.d.velSens * n.vel
    v.pan = n.pan
    v.fine = n.fine
    v.modX = n.modX
    v.modY = n.modY
    v.target = n.key
    v.pitch = n.porta && this.lastKey >= 0 ? this.lastKey : n.key
    this.lastKey = n.key
    v.time = 0
    v.amp.set(p['amp.attack'], p['amp.decay'], p['amp.sustain'], p['amp.release'])
    v.fenv.set(p['fenv.attack'], p['fenv.decay'], p['fenv.sustain'], p['fenv.release'])
    v.amp.on()
    v.fenv.on()
    v.ampLast = 0
    for (let u = 0; u < 8; u++) v.ph[u] = v.rng.uni()
    v.subPh = 0
    v.gN = 0
    v.gTimer = 0
    v.gScan = 0
    v.nL.reset()
    v.nR.reset()
    for (const b of v.bank) b.reset()
    v.fL1.reset()
    v.fR1.reset()
    v.fL2.reset()
    v.fR2.reset()
    for (const f of v.form) f.reset()
    v.combL.fill(0)
    v.combR.fill(0)
    v.combLpL = v.combLpR = 0
    this.fxIdle = false
    this.idleCount = 0
  }

  noteOff(id: number): void {
    for (const v of this.voices)
      if (v.active && v.noteId === id && !v.releasing) {
        v.releasing = true
        v.amp.off()
        v.fenv.off()
      }
  }

  allNotesOff(hard: boolean): void {
    for (const v of this.voices) {
      if (!v.active) continue
      if (hard) {
        v.active = false
        v.amp.stage = 0
        v.amp.v = 0
      } else {
        v.releasing = true
        v.amp.off()
        v.fenv.off()
      }
    }
    if (hard) {
      this.verb.clear()
      this.delay.clear()
      this.chorus.clear()
    }
  }

  // ─── derived parameters ──────────────────────────────────────────────────
  private derive(): void {
    const p = this.p
    const d = this.d
    const E = (d.E = p['macro.evolve'])
    const M = (d.M = p['macro.motion'])
    const S = (d.S = p['macro.space'])
    const T = (d.T = p['macro.tone'])
    d.waveOn = p['wave.on'] >= 0.5
    d.posBase = p['wave.pos']
    d.waveLvl = d.waveOn ? p['wave.level'] : 0
    d.waveTr = Math.round(p['wave.octave']) * 12 + Math.round(p['wave.semi'])
    d.envPos = p['wave.envAmt']
    d.sub = p['wave.sub']
    d.granOn = p['gran.on'] >= 0.5
    d.granLvl = d.granOn ? p['gran.level'] : 0
    d.gPos = p['gran.pos']
    d.gSize = p['gran.size'] / 1000
    d.gDens = p['gran.density']
    d.gSpray = Math.min(1, Math.max(0, p['gran.spray'] + (M - 0.5) * 0.3))
    d.gPr = p['gran.pitchRand']
    d.gRev = p['gran.reverse']
    d.gOct = Math.round(p['gran.octave'])
    d.gShim = p['gran.shimmer']
    d.gScan = p['gran.scan']
    d.gWidth = Math.min(1, p['gran.width'] * (0.5 + M))
    d.gKt = p['gran.keytrack']
    d.noiseOn = p['noise.on'] >= 0.5
    d.noiseLvl = d.noiseOn ? p['noise.level'] : 0
    d.nColor = Math.min(this.sr * 0.45, p['noise.color'] * Math.pow(2, (T - 0.5) * 3))
    d.nTune = p['noise.tune']
    d.nQ = p['noise.q']
    d.nBank = Math.round(p['noise.bank'])
    d.nOct = Math.round(p['noise.octave'])
    d.fMode = Math.round(p['filter.mode'])
    d.cutOct = Math.log2(p['filter.cutoff']) + (T - 0.5) * 4
    d.res = p['filter.res']
    d.fEnv = p['filter.envAmt']
    d.fPitch = p['fenv.pitch']
    d.fKt = p['filter.keytrack']
    d.vowel = p['filter.vowel']
    d.l1Shape = Math.round(p['lfo1.shape'])
    d.l1Rate = p['lfo1.rate']
    d.l1Depth = p['lfo1.depth']
    d.l1Dest = Math.round(p['lfo1.dest'])
    d.l2Shape = Math.round(p['lfo2.shape'])
    d.l2Rate = p['lfo2.rate']
    d.l2Depth = p['lfo2.depth']
    d.l2Dest = Math.round(p['lfo2.dest'])
    d.lfoRateMul = Math.pow(2, (M - 0.5) * 2)
    d.lfoDepthMul = 2 * M
    d.driftD = p['drift.amount'] * (0.5 + E)
    d.driftRate = p['drift.rate'] * Math.pow(2, (M - 0.5) * 1.5)
    d.evRate = p['evolve.rate']
    d.drive = p['fx.drive']
    d.gain = Math.pow(10, p['master.gain'] / 20)
    d.tiltHi = Math.pow(2, (T - 0.5) * 1.3)
    d.tiltLo = Math.pow(2, -(T - 0.5) * 0.7)
    d.width = p['fx.width']
    d.velSens = p['amp.velSens']
    // unison
    const U = (this.U = Math.max(1, Math.min(8, Math.round(p['wave.unison']))))
    const det = p['wave.detune'] * (0.6 + 0.8 * M)
    const spread = p['wave.spread']
    const norm = 1 / Math.sqrt(U)
    for (let u = 0; u < U; u++) {
      const x = U === 1 ? 0 : (u / (U - 1)) * 2 - 1 // -1..1
      const jitter = U === 1 ? 0 : Math.sin(u * 12.9898) * 0.12
      this.ru[u] = Math.pow(2, (det * (x + jitter)) / 1200)
      const pan = U === 1 ? 0 : spread * (u & 1 ? -1 : 1) * Math.abs(x === 0 ? 0.5 : x)
      const a = ((pan + 1) * Math.PI) / 4
      this.uGL[u] = Math.cos(a) * Math.SQRT2 * norm
      this.uGR[u] = Math.sin(a) * Math.SQRT2 * norm
    }
    // fx
    const verb = this.verb
    verb.mix = Math.min(1, p['fx.reverb'] * 2 * S)
    verb.decay = p['fx.revDecay'] * Math.pow(2, (S - 0.5) * 1.6)
    verb.size = Math.min(1, Math.max(0, p['fx.revSize'] + (S - 0.5) * 0.5))
    verb.dampAmt = Math.min(1, Math.max(0, p['fx.revDamp'] - (T - 0.5) * 0.5))
    verb.modAmt = p['fx.revMod']
    verb.predelay = p['fx.predelay'] / 1000
    verb.shimmer = p['fx.shimmer']
    verb.ratio = SHIM_RATIOS[Math.round(p['fx.shimInterval'])] ?? 2
    verb.freeze = p['fx.freeze'] >= 0.5
    verb.update()
    this.delay.mix = Math.min(1, p['fx.delay'] * 2 * S)
    this.delay.time = p['fx.delayTime'] / 1000
    this.delay.fb = p['fx.delayFb']
    this.chorus.mix = p['fx.chorus']
    this.chorus.rate = p['fx.chorusRate'] * Math.pow(2, M - 0.5)
    this.chorus.depth = Math.min(1, p['fx.chorusDepth'] * (0.5 + M))
    // assets (lazy, first use only)
    const ti = Math.round(p['wave.table'])
    if (d.waveOn && ti !== this.tableIdx) {
      this.table = getTable(ti)
      this.tableIdx = ti
    }
    const xi = Math.round(p['gran.texture'])
    if (d.granOn && xi !== this.texIdx) {
      this.tex = getTexture(xi)
      this.texIdx = xi
    }
    if (this.envDirty) {
      this.envDirty = false
      for (const v of this.voices)
        if (v.active) {
          v.amp.set(p['amp.attack'], p['amp.decay'], p['amp.sustain'], p['amp.release'])
          v.fenv.set(p['fenv.attack'], p['fenv.decay'], p['fenv.sustain'], p['fenv.release'])
        }
    }
  }

  private lfoValue(i: number, shape: number): number {
    const t = this.lfoPh[i]
    switch (shape) {
      case 0:
        return Math.sin(TAU * t)
      case 1:
        return 1 - 4 * Math.abs(t - 0.5)
      case 2:
        return 2 * t - 1
      case 3:
        return t < 0.5 ? 1 : -1
      case 4:
        return this.lfoHold[i]
      default: {
        const r = this.lfoRnd[i]
        return r.a + (r.b - r.a) * (0.5 - 0.5 * Math.cos(Math.PI * r.t))
      }
    }
  }

  private advanceLfo(i: number, rate: number, n: number): void {
    const inc = (rate * this.d.lfoRateMul * n) / this.sr
    this.lfoPh[i] += inc
    if (this.lfoPh[i] >= 1) {
      this.lfoPh[i] -= Math.floor(this.lfoPh[i])
      this.lfoHold[i] = this.rng.next()
    }
    this.lfoRnd[i].step(inc)
  }

  // ─── audio ───────────────────────────────────────────────────────────────
  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    for (let s = start; s < end; s += 128) this.processRange(outL, outR, s, Math.min(end, s + 128))
  }

  private processRange(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    if (this.dirty) {
      this.dirty = false
      this.derive()
    }
    const d = this.d
    const n0 = end - start
    const busL = this.busL
    const busR = this.busR
    busL.fill(0, 0, n0)
    busR.fill(0, 0, n0)
    // global control-rate values per chunk
    let nch = 0
    for (let c0 = 0; c0 < n0; c0 += K, nch++) {
      const n = Math.min(K, n0 - c0)
      this.chunkL1[nch] = this.lfoValue(0, d.l1Shape) * d.l1Depth * d.lfoDepthMul
      this.chunkL2[nch] = this.lfoValue(1, d.l2Shape) * d.l2Depth * d.lfoDepthMul
      this.advanceLfo(0, d.l1Rate, n)
      this.advanceLfo(1, d.l2Rate, n)
      this.sLvlW += (d.waveLvl - this.sLvlW) * 0.3
      this.sLvlG += (d.granLvl - this.sLvlG) * 0.3
      this.sLvlN += (d.noiseLvl - this.sLvlN) * 0.3
      this.sCut += (d.cutOct - this.sCut) * 0.3
      this.chunkLvlW[nch] = this.sLvlW
      this.chunkLvlG[nch] = this.sLvlG
      this.chunkLvlN[nch] = this.sLvlN
      this.chunkCut[nch] = this.sCut
    }
    let any = false
    for (const v of this.voices) {
      if (!v.active) continue
      any = true
      let ci = 0
      for (let c0 = 0; c0 < n0 && v.active; c0 += K, ci++) this.renderVoice(v, c0, Math.min(K, n0 - c0), ci)
    }
    if (any) {
      this.fxIdle = false
      this.idleCount = 0
    }
    if (this.fxIdle) return
    this.fx(n0, any)
    for (let i = 0; i < n0; i++) {
      outL[start + i] += busL[i]
      outR[start + i] += busR[i]
    }
    if (this.vizOn) {
      this.vizCount += n0
      if (this.vizCount >= this.sr / 30) {
        this.vizCount = 0
        this.postViz()
      }
    }
  }

  private postViz(): void {
    let nv = 0
    let pos = 0
    let ev = 0
    for (const v of this.voices)
      if (v.active && !v.killing) {
        nv++
        pos += v.lastPos
        ev += v.lastEv
      }
    this.ctx.post({
      type: 'viz',
      voices: nv,
      pos: nv ? pos / nv : -1,
      ev: nv ? ev / nv : 0,
      lfo1: this.lfoValue(0, this.d.l1Shape),
      lfo2: this.lfoValue(1, this.d.l2Shape),
      level: this.vizPeak
    })
    this.vizPeak = 0
  }

  private renderVoice(v: Voice, c0: number, n: number, ci: number): void {
    const d = this.d
    const sr = this.sr
    const dt = n / sr
    const mod = this.mod
    mod.fill(0)
    mod[d.l1Dest] += this.chunkL1[ci]
    mod[d.l2Dest] += this.chunkL2[ci]
    let volMod = 0
    if (d.l1Dest === 3) volMod += d.l1Depth * d.lfoDepthMul * 0.5 - this.chunkL1[ci] * 0.5
    if (d.l2Dest === 3) volMod += d.l2Depth * d.lfoDepthMul * 0.5 - this.chunkL2[ci] * 0.5
    // drift & evolve (per voice)
    const dr = d.driftD
    const drc = d.driftRate * v.drRate * dt
    const drP = v.dr[0].step(drc) * 0.15 * dr
    const drC = v.dr[1].step(drc * 0.8) * 0.8 * dr
    const drPan = v.dr[2].step(drc * 0.6) * 0.35 * dr
    const drPos = v.dr[3].step(drc * 1.1) * 0.15 * dr
    const E = d.E
    const evc = d.evRate * dt
    const ev0 = v.ev[0].step(evc)
    const ev1 = v.ev[1].step(evc * 0.73)
    const ev2 = v.ev[2].step(evc * 1.31)
    v.time += dt
    const scan = 1 - Math.exp(-v.time / 6)
    v.lastEv = ev0 * E
    // envelopes
    const fe = v.fenv.step(n)
    let ampEnd = v.amp.step(n) * v.velGain * VOICE_GAIN * (volMod > 0 ? Math.max(0, 1 - volMod) : 1)
    if (v.killing) {
      v.kill -= n / (0.012 * sr)
      if (v.kill < 0) v.kill = 0
      ampEnd *= v.kill
    }
    const ampStart = v.ampLast
    v.ampLast = ampEnd
    // pitch
    v.pitch += (v.target - v.pitch) * (1 - Math.exp(-dt / 0.08))
    const pitchMod = this.bend + v.fine / 100 + mod[2] + drP + d.fPitch * fe
    const basePitch = v.pitch + pitchMod
    const sL = this.sL
    const sR = this.sR
    sL.fill(0, 0, n)
    sR.fill(0, 0, n)
    const wavePitch = basePitch + d.waveTr
    // ── wavetable layer
    const lvlW = this.chunkLvlW[ci]
    if (lvlW > 1e-4 && this.table) {
      let pos = d.posBase + d.envPos * fe + mod[0] * 0.5 + E * (0.35 * ev0 + 0.3 * scan) + drPos
      pos = pos - 2 * Math.floor(pos / 2)
      if (pos > 1) pos = 2 - pos
      v.lastPos = pos
      const f = mtof(wavePitch)
      const inc0 = f / sr
      const maxR = this.ru[this.U - 1] > this.ru[0] ? this.ru[this.U - 1] : this.ru[0]
      let l = 0
      while (l < LEVELS - 1 && (MAXH >> l) * f * maxR > 0.45 * sr) l++
      const fp = pos * (FRAMES - 1)
      const fa = fp | 0
      const fb = fa < FRAMES - 1 ? fa + 1 : fa
      const w = fp - fa
      const tbl = this.table
      const bA = (l * FRAMES + fa) * STRIDE
      const bB = (l * FRAMES + fb) * STRIDE
      for (let u = 0; u < this.U; u++) {
        const inc = inc0 * this.ru[u]
        const gl = this.uGL[u] * lvlW
        const gr = this.uGR[u] * lvlW
        let ph = v.ph[u]
        for (let i = 0; i < n; i++) {
          ph += inc
          if (ph >= 1) ph -= 1
          const x = ph * TSIZE
          const j = x | 0
          const fr = x - j
          let a = tbl[bA + j]
          a += (tbl[bA + j + 1] - a) * fr
          let b = tbl[bB + j]
          b += (tbl[bB + j + 1] - b) * fr
          const s = a + (b - a) * w
          sL[i] += s * gl
          sR[i] += s * gr
        }
        v.ph[u] = ph
      }
      if (d.sub > 0) {
        const inc = (f * 0.5) / sr
        const g = d.sub * lvlW * 0.7
        let ph = v.subPh
        for (let i = 0; i < n; i++) {
          ph += inc
          if (ph >= 1) ph -= 1
          const s = SINE[(ph * 1024) | 0] * g
          sL[i] += s
          sR[i] += s
        }
        v.subPh = ph
      }
    }
    // ── granular layer
    const lvlG = this.chunkLvlG[ci]
    if (lvlG > 1e-4 && this.tex) this.renderGrains(v, n, lvlG, pitchMod, mod[5] * 0.3 + E * 0.35 * ev2)
    // ── noise / air layer
    const lvlN = this.chunkLvlN[ci] * (1 + mod[6] > 0 ? 1 + mod[6] : 0)
    if (lvlN > 1e-4) this.renderNoise(v, n, lvlN, basePitch)
    // ── filter + amp → bus
    const cutOct =
      this.chunkCut[ci] + d.fEnv * 6 * fe + (d.fKt * (v.key - 60)) / 12 + mod[1] * 3 + drC + E * 1.2 * ev1 + (v.modX - 0.5) * 4
    const nyq = sr * 0.45
    let fc = Math.pow(2, cutOct)
    if (fc < 20) fc = 20
    else if (fc > nyq) fc = nyq
    let res = d.res + (v.modY - 0.5) * 0.6
    res = res < 0 ? 0 : res > 1 ? 1 : res
    const q = 0.55 * Math.pow(2, res * 4.8)
    let pan = v.pan + mod[4] + drPan
    pan = pan < -1 ? -1 : pan > 1 ? 1 : pan
    const pa = ((pan + 1) * Math.PI) / 4
    const pl = Math.cos(pa) * Math.SQRT2
    const pr = Math.sin(pa) * Math.SQRT2
    const busL = this.busL
    const busR = this.busR
    let a = ampStart
    const da = (ampEnd - ampStart) / n
    switch (d.fMode) {
      case 0:
      case 2:
      case 3: {
        const fL = v.fL1
        const fR = v.fR1
        fL.set(fc, d.fMode === 2 ? Math.max(0.8, q) : q, sr)
        fR.set(fc, d.fMode === 2 ? Math.max(0.8, q) : q, sr)
        if (d.fMode === 0)
          for (let i = 0; i < n; i++) {
            a += da
            busL[c0 + i] += fL.lp(sL[i]) * a * pl
            busR[c0 + i] += fR.lp(sR[i]) * a * pr
          }
        else if (d.fMode === 2) {
          const g = 1.4
          for (let i = 0; i < n; i++) {
            a += da
            busL[c0 + i] += fL.bp(sL[i]) * a * pl * g
            busR[c0 + i] += fR.bp(sR[i]) * a * pr * g
          }
        } else
          for (let i = 0; i < n; i++) {
            a += da
            busL[c0 + i] += fL.hp(sL[i]) * a * pl
            busR[c0 + i] += fR.hp(sR[i]) * a * pr
          }
        break
      }
      case 1: {
        const fL = v.fL1, fR = v.fR1, gL = v.fL2, gR = v.fR2
        fL.set(fc, 0.54, sr)
        fR.set(fc, 0.54, sr)
        gL.set(fc, q * 1.1, sr)
        gR.set(fc, q * 1.1, sr)
        for (let i = 0; i < n; i++) {
          a += da
          busL[c0 + i] += gL.lp(fL.lp(sL[i])) * a * pl
          busR[c0 + i] += gR.lp(fR.lp(sR[i])) * a * pr
        }
        break
      }
      case 4: {
        let vw = d.vowel + mod[7] * 0.5 + E * 0.3 * ev0
        vw = vw < 0 ? 0 : vw > 1 ? 1 : vw
        const vp = vw * 4
        const va = Math.min(3, vp | 0)
        const vf = vp - va
        let shift = Math.sqrt(fc / 1500)
        shift = shift < 0.5 ? 0.5 : shift > 2.2 ? 2.2 : shift
        const qf = 5 + res * 15
        const F = v.form
        for (let j = 0; j < 3; j++) {
          const fr = (VOW[va][j] + (VOW[va + 1][j] - VOW[va][j]) * vf) * shift
          F[j].set(fr, qf, sr)
          F[j + 3].set(fr, qf, sr)
        }
        const g0 = VOW_G[0] * 2.4, g1 = VOW_G[1] * 2.4, g2 = VOW_G[2] * 2.4
        const dl = v.fL1
        const dR = v.fR1
        dl.set(500, 0.6, sr)
        dR.set(500, 0.6, sr)
        for (let i = 0; i < n; i++) {
          a += da
          const xl = sL[i]
          const xr = sR[i]
          busL[c0 + i] += (F[0].bp(xl) * g0 + F[1].bp(xl) * g1 + F[2].bp(xl) * g2 + dl.lp(xl) * 0.25) * a * pl
          busR[c0 + i] += (F[3].bp(xr) * g0 + F[4].bp(xr) * g1 + F[5].bp(xr) * g2 + dR.lp(xr) * 0.25) * a * pr
        }
        break
      }
      default: {
        // comb tuned to the note
        let per = sr / mtof(wavePitch)
        if (per > 4000) per = 4000
        else if (per < 2) per = 2
        let fb = 0.55 + 0.43 * res + mod[7] * 0.1
        fb = fb > 0.985 ? 0.985 : fb < 0 ? 0 : fb
        const dc = 1 - Math.exp((-TAU * Math.min(fc, nyq)) / sr)
        const norm = (1 - fb) * 1.1
        const cL = v.combL
        const cR = v.combR
        let w = v.combW
        let lpL = v.combLpL
        let lpR = v.combLpR
        const pi = per | 0
        const pf = per - pi
        for (let i = 0; i < n; i++) {
          a += da
          const i0 = (w - pi) & 4095
          const i1 = (w - pi - 1) & 4095
          const yl = cL[i0] + (cL[i1] - cL[i0]) * pf
          const yr = cR[i0] + (cR[i1] - cR[i0]) * pf
          lpL += (yl - lpL) * dc
          lpR += (yr - lpR) * dc
          const ol = sL[i] + fb * lpL
          const or = sR[i] + fb * lpR
          cL[w] = ol
          cR[w] = or
          w = (w + 1) & 4095
          busL[c0 + i] += ol * norm * a * pl
          busR[c0 + i] += or * norm * a * pr
        }
        v.combW = w
        v.combLpL = lpL
        v.combLpR = lpR
      }
    }
    if (v.amp.stage === 0 || (v.killing && v.kill <= 0)) {
      v.active = false
      v.killing = false
    }
  }

  private renderGrains(v: Voice, n: number, lvl: number, pitchMod: number, posMod: number): void {
    const d = this.d
    const sr = this.sr
    const tex = this.tex!
    const LEN = TEX_LEN
    v.gScan += d.gScan * 0.08 * (n / sr)
    v.gScan -= Math.floor(v.gScan)
    // spawn
    const interval = sr / d.gDens
    v.gTimer -= n
    const size = Math.max(0.005, d.gSize)
    const overlap = Math.min(MAXG, Math.max(1, d.gDens * size))
    const amp = (lvl * 1.7) / Math.sqrt(overlap)
    let guard = 0
    while (v.gTimer <= 0 && guard++ < 8) {
      const jit = d.gSpray * 0.9
      v.gTimer += interval * (1 + jit * v.rng.next())
      if (v.gN >= MAXG) continue
      const g = v.gN++
      const semis =
        (v.pitch - TEX_ROOT) * d.gKt + d.gOct * 12 + pitchMod + d.gPr * v.rng.next() + (d.gShim > 0 && v.rng.uni() < d.gShim ? 12 : 0)
      const rate = Math.pow(2, semis / 12) * (TEX_SR / sr)
      let pos = d.gPos + v.gScan + posMod + d.gSpray * 0.5 * v.rng.next()
      pos -= Math.floor(pos)
      v.gPos[g] = pos * LEN
      v.gInc[g] = d.gRev > 0 && v.rng.uni() < d.gRev ? -rate : rate
      v.gWin[g] = 0
      v.gWinInc[g] = 1 / (size * sr)
      const pan = d.gWidth * v.rng.next()
      v.gL[g] = Math.sqrt(0.5 * (1 - pan)) * amp * 1.414
      v.gR[g] = Math.sqrt(0.5 * (1 + pan)) * amp * 1.414
    }
    const sL = this.sL
    const sR = this.sR
    for (let g = 0; g < v.gN; g++) {
      let pos = v.gPos[g]
      const inc = v.gInc[g]
      let win = v.gWin[g]
      const wi = v.gWinInc[g]
      const gl = v.gL[g]
      const gr = v.gR[g]
      let m = Math.ceil((1 - win) / wi)
      if (m > n) m = n
      for (let i = 0; i < m; i++) {
        const j = pos | 0
        const a = tex[j]
        const s = (a + (tex[j + 1] - a) * (pos - j)) * HANN[(win * 1024) | 0]
        sL[i] += s * gl
        sR[i] += s * gr
        pos += inc
        if (pos >= LEN) pos -= LEN
        else if (pos < 0) pos += LEN
        win += wi
      }
      if (win >= 1 - 1e-9 || m < n) {
        // retire: swap with last
        const last = --v.gN
        v.gPos[g] = v.gPos[last]
        v.gInc[g] = v.gInc[last]
        v.gWin[g] = v.gWin[last]
        v.gWinInc[g] = v.gWinInc[last]
        v.gL[g] = v.gL[last]
        v.gR[g] = v.gR[last]
        g--
      } else {
        v.gPos[g] = pos
        v.gWin[g] = win
      }
    }
  }

  private renderNoise(v: Voice, n: number, lvl: number, basePitch: number): void {
    const d = this.d
    const sr = this.sr
    const tune = d.nTune
    const broad = (1 - tune) * lvl * 1.2 * Math.sqrt((sr * 0.5) / (1.1 * d.nColor))
    v.nL.set(d.nColor, 0.6, sr)
    v.nR.set(d.nColor, 0.6, sr)
    const f0 = mtof(basePitch + d.nOct * 12)
    const ratios = BANKS[d.nBank] ?? BANKS[0]
    const Q = d.nQ
    const bg = v.bankG
    for (let j = 0; j < 4; j++) {
      const f = f0 * ratios[j]
      if (tune > 0 && f < sr * 0.45 && f < d.nColor * 2.5) {
        v.bank[j].set(f, Q, sr)
        bg[j] = BANK_W[j] * Math.sqrt((Q * sr) / (Math.PI * f)) * tune * lvl * 1.1
      } else bg[j] = 0
    }
    const sL = this.sL
    const sR = this.sR
    const rng = v.rng
    const nL = v.nL
    const nR = v.nR
    const b0 = v.bank[0], b1 = v.bank[1], b2 = v.bank[2], b3 = v.bank[3]
    const g0 = bg[0], g1 = bg[1], g2 = bg[2], g3 = bg[3]
    const doBank = g0 + g1 + g2 + g3 > 0
    for (let i = 0; i < n; i++) {
      const n1 = rng.next()
      const n2 = rng.next()
      let l = nL.lp(n1) * broad
      let r = nR.lp(n2) * broad
      if (doBank) {
        const x0 = b0.bp(n1) * g0
        const x1 = b1.bp(n2) * g1
        const x2 = b2.bp(n1) * g2
        const x3 = b3.bp(n2) * g3
        l += x0 * 0.85 + x1 * 0.5 + x2 * 0.85 + x3 * 0.5
        r += x0 * 0.5 + x1 * 0.85 + x2 * 0.5 + x3 * 0.85
      }
      sL[i] += l
      sR[i] += r
    }
  }

  private fx(n: number, voicesActive: boolean): void {
    const d = this.d
    const L = this.busL
    const R = this.busR
    if (d.drive > 0.001) {
      const dg = 1 + d.drive * 6
      const mk = 1 / (1 + d.drive * 2.2)
      for (let i = 0; i < n; i++) {
        L[i] = softClip(L[i] * dg) * mk
        R[i] = softClip(R[i] * dg) * mk
      }
    }
    if (this.chorus.mix > 0.001) this.chorus.process(L, R, 0, n)
    if (this.delay.mix > 0.001) this.delay.process(L, R, 0, n)
    if (this.verb.mix > 0.001) this.verb.process(L, R, 0, n)
    const tc = 1 - Math.exp((-TAU * 900) / this.sr)
    const lo = d.tiltLo
    const hi = d.tiltHi
    const wd = d.width
    let lpL = this.toneLpL
    let lpR = this.toneLpR
    this.sGain += (d.gain - this.sGain) * 0.5
    const gain = this.sGain
    let peak = 0
    for (let i = 0; i < n; i++) {
      lpL += (L[i] - lpL) * tc
      lpR += (R[i] - lpR) * tc
      const l = lpL * lo + (L[i] - lpL) * hi
      const r = lpR * lo + (R[i] - lpR) * hi
      const m = (l + r) * 0.5
      const s = (l - r) * 0.5 * wd
      const ol = safety((m + s) * gain)
      const or = safety((m - s) * gain)
      L[i] = ol
      R[i] = or
      const ab = Math.max(ol < 0 ? -ol : ol, or < 0 ? -or : or)
      if (ab > peak) peak = ab
    }
    this.toneLpL = lpL
    this.toneLpR = lpR
    if (peak > this.vizPeak) this.vizPeak = peak
    if (!voicesActive && peak < 1e-5 && !this.verb.freeze) {
      this.idleCount += n
      if (this.idleCount > this.sr) {
        this.fxIdle = true
        this.toneLpL = this.toneLpR = 0
      }
    } else this.idleCount = 0
  }
}

function softClip(x: number): number {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}
