// Mosaic — flagship workstation DSP. Up to 4 Parts (each an engine + amp/filter/LFO), Super Knob
// macro, quick-edit offsets and a master FX chain. See model.ts for the data layout.
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { createPartEngine } from './engines'
import { Mods, type PartEngine, type PartParams } from './engines/common'
import { MasterFX, type FXParams } from './fx'
import { PARAMS } from './manifest'
import { NUM_DESTS, NUM_PARTS, SUPER_DESTS, SUPER_DEST_INDEX, normalizeData, resolvePart, type EngineId, type WSData } from './model'

const BLOCK = 128

class PartRT {
  eng: PartEngine
  p: PartParams
  on = false
  gain = 0
  panL = 1
  panR = 1
  constructor(
    public engine: EngineId,
    sr: number
  ) {
    this.eng = createPartEngine(engine, sr)
    this.p = {}
  }
}

const D = SUPER_DEST_INDEX

class Mosaic implements InstrumentDSP {
  private sr: number
  private params: Record<string, number> = {}
  private parts: (PartRT | null)[] = [null, null, null, null]
  private data: WSData = normalizeData(undefined)
  private mods: Mods[] = Array.from({ length: NUM_PARTS }, () => new Mods())
  /** super knob offsets: [part][dest] (part 4 = global/fx) */
  private sup = new Float64Array((NUM_PARTS + 1) * NUM_DESTS)
  private fx: MasterFX
  private fxp: FXParams
  private bend = 0
  private pl = new Float32Array(BLOCK)
  private pr = new Float32Array(BLOCK)
  private bl = new Float32Array(BLOCK)
  private br = new Float32Array(BLOCK)
  private masterGain = 0.8

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    for (const d of PARAMS) this.params[d.id] = d.default
    this.fx = new MasterFX(this.sr)
    this.fxp = {
      eqLow: 0, eqMid: 0, eqMidF: 1000, eqHigh: 0,
      choOn: false, choRate: 0.6, choDepth: 0.5, choMix: 0.5,
      phaOn: false, phaRate: 0.3, phaDepth: 0.6, phaFb: 0.4, phaMix: 0.5,
      dlyOn: false, dlyTime: 375, dlyFb: 0.35, dlyTone: 0.6, dlyPP: true, dlyMix: 0.2,
      revOn: true, revSize: 0.6, revDecay: 2.2, revDamp: 0.5, revPre: 15, revMix: 0.22
    }
    this.setData(this.data)
  }

  setParam(id: string, v: number): void {
    this.params[id] = v
  }

  setData(d: unknown): void {
    const data = normalizeData(d)
    this.data = data
    for (let i = 0; i < NUM_PARTS; i++) {
      const def = data.parts[i]
      let rt = this.parts[i]
      if (!rt || rt.engine !== def.engine) {
        if (!def.on && !rt) continue
        rt = new PartRT(def.engine, this.sr)
        this.parts[i] = rt
      }
      rt.p = resolvePart(def)
      rt.eng.update(rt.p)
      if (rt.on && !def.on) rt.eng.allOff(false)
      rt.on = def.on
    }
  }

  pitchBend(st: number): void {
    this.bend = st
  }

  noteOn(n: NoteOn): void {
    const v127 = Math.max(1, Math.round(n.vel * 127))
    for (const rt of this.parts) {
      if (!rt || !rt.on) continue
      const p = rt.p
      if (n.key < p.keyLo || n.key > p.keyHi || v127 < p.velLo || v127 > p.velHi) continue
      rt.eng.noteOn(n, n.key + (p.transpose | 0))
    }
  }

  noteOff(id: number, _key: number, rel: number): void {
    for (const rt of this.parts) rt?.eng.noteOff(id, rel)
  }

  allNotesOff(hard: boolean): void {
    for (const rt of this.parts) rt?.eng.allOff(hard)
    if (hard) this.fx.reset()
  }

  private computeMods(): void {
    const P = this.params
    const s = P.super ?? 0
    const sup = this.sup
    sup.fill(0)
    for (const a of this.data.superKnob) {
      const di = D[a.dest]
      if (di === undefined) continue
      const v = a.amt * s
      if (SUPER_DESTS[di].fx) sup[NUM_PARTS * NUM_DESTS + di] += v
      else if (a.part < 0) for (let i = 0; i < NUM_PARTS; i++) sup[i * NUM_DESTS + di] += v
      else if (a.part < NUM_PARTS) sup[a.part * NUM_DESTS + di] += v
    }
    const G = NUM_PARTS * NUM_DESTS
    const rotaryFast = P.rotary + sup[G + D.rotary] >= 0.5 ? 1 : 0
    for (let i = 0; i < NUM_PARTS; i++) {
      const m = this.mods[i]
      const o = i * NUM_DESTS
      m.cutoff = P['q.cutoff'] * 4 + sup[o + D.cutoff]
      m.reso = P['q.reso'] * 0.5 + sup[o + D.reso]
      m.attack = P['q.attack'] * 3 + sup[o + D.attack]
      m.release = P['q.release'] * 3 + sup[o + D.release]
      m.level = sup[o + D.level]
      m.bright = sup[o + D.bright]
      m.drive = sup[o + D.drive]
      m.vibrato = sup[o + D.vibrato]
      m.detune = sup[o + D.detune]
      m.tremolo = sup[o + D.tremolo]
      m.bend = this.bend
      m.rotaryFast = rotaryFast
    }
    const f = this.fxp
    const c01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
    f.eqLow = P['eq.low'] + sup[G + D.eqLow]
    f.eqMid = P['eq.mid']
    f.eqMidF = P['eq.midf']
    f.eqHigh = P['eq.high'] + sup[G + D.eqHigh]
    f.choOn = P['cho.on'] >= 0.5
    f.choRate = P['cho.rate']
    f.choDepth = P['cho.depth']
    f.choMix = c01(P['cho.mix'] + sup[G + D.chorus])
    f.phaOn = P['pha.on'] >= 0.5
    f.phaRate = P['pha.rate']
    f.phaDepth = P['pha.depth']
    f.phaFb = P['pha.fb']
    f.phaMix = c01(P['pha.mix'] + sup[G + D.phaser])
    f.dlyOn = P['dly.on'] >= 0.5
    f.dlyTime = P['dly.time']
    f.dlyFb = P['dly.fb']
    f.dlyTone = P['dly.tone']
    f.dlyPP = P['dly.pp'] >= 0.5
    f.dlyMix = c01(P['dly.mix'] + sup[G + D.delay])
    f.revOn = P['rev.on'] >= 0.5
    f.revSize = P['rev.size']
    f.revDecay = P['rev.decay']
    f.revDamp = P['rev.damp']
    f.revPre = P['rev.pre']
    f.revMix = c01(P['rev.mix'] + sup[G + D.reverb])
  }

  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const n = end - start
    if (n <= 0) return
    this.computeMods()
    const bl = this.bl
    const br = this.br
    bl.fill(0, 0, n)
    br.fill(0, 0, n)
    const pl = this.pl
    const pr = this.pr
    for (let i = 0; i < NUM_PARTS; i++) {
      const rt = this.parts[i]
      if (!rt) continue
      if (!rt.on && rt.eng.active() === 0) continue
      pl.fill(0, 0, n)
      pr.fill(0, 0, n)
      rt.eng.render(pl, pr, n, this.mods[i])
      // part level & pan (smoothed per block)
      const lvl = Math.max(0, rt.p.level + this.mods[i].level)
      const target = lvl * lvl * 1.5
      const pan = rt.p.pan
      const gl = pan > 0 ? 1 - pan : 1
      const gr = pan < 0 ? 1 + pan : 1
      const g0 = rt.gain
      const dg = (target - g0) / n
      let g = g0
      for (let k = 0; k < n; k++) {
        g += dg
        bl[k] += pl[k] * g * gl
        br[k] += pr[k] * g * gr
      }
      rt.gain = target
    }
    this.fx.process(bl, br, n, this.fxp)
    const mt = this.params.master ?? 0.8
    const m1 = mt * mt * 1.25
    const m0 = this.masterGain
    this.masterGain = m1
    const dm = (m1 - m0) / n
    let m = m0
    for (let k = 0; k < n; k++) {
      m += dm
      outL[start + k] += limit(bl[k] * m)
      outR[start + k] += limit(br[k] * m)
    }
  }
}

/** Transparent below 0.85, soft knee to an asymptote of 1.2. */
function limit(x: number): number {
  const a = x < 0 ? -x : x
  if (a <= 0.85) return x
  const s = 0.85 + 0.35 * Math.tanh((a - 0.85) / 0.35)
  return x < 0 ? -s : s
}

export default { id: 'mosaic', kind: 'instrument', create: (ctx) => new Mosaic(ctx) } satisfies DSPFactory
