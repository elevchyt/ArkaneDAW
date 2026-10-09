// Drum Machine DSP (AudioWorklet). See engine.ts for the synthesis and kits.ts for the sounds.
import type { DSPContext, DSPFactory, InstrumentDSP, NoteOn } from '../sdk/types'
import { clamp, dbToGain, panGains, softClip } from '../sdk/dsp'
import { DEFAULT_CHOKE, resolveKey } from './keymap'
import { KIT_BY_ID, readData, type DrumData } from './data'
import { resolveKit, type KitDef, type ResolvedPad } from './kits'
import { SampleEntry, SampleVoice, SynthVoice, recipePeak, type Mods } from './engine'

interface Pad extends ResolvedPad {
  entry: SampleEntry | null
  tune: number
  decay: number
  gain: number
  pan: number
  tone: number
  choke: number
}

// ROM cache shared by every Drum Machine instance in this AudioWorklet global scope (LRU by kit).
const romCache = new Map<string, Map<number, SampleEntry>>()
const ROM_KITS = 6
function romFor(def: KitDef): Map<number, SampleEntry> {
  let m = romCache.get(def.id)
  if (m) {
    romCache.delete(def.id)
    romCache.set(def.id, m)
    return m
  }
  m = new Map()
  romCache.set(def.id, m)
  while (romCache.size > ROM_KITS) romCache.delete(romCache.keys().next().value!)
  return m
}

const SYNTH_VOICES = 24
const SAMPLE_VOICES = 32
const BLOCK = 128
/** keeps a full kit summed under 0 dBFS most of the time */
const HEADROOM = 0.65
const RENDER_BUDGET = 25000 // engine cost units per audio block for background ROM rendering

class DrumMachine implements InstrumentDSP {
  private sr: number
  private p = { tune: 0, drive: 0, comp: 0, character: 0.8, vel: 0.7, gate: 0, gain: 0 }
  private data: DrumData = { kit: '', pads: {} }
  private def: KitDef | null = null
  private sampled = false
  private pads: (Pad | null)[] = new Array(128).fill(null)
  private synth: SynthVoice[]
  private samp: SampleVoice[]
  private clock = 0
  private seed = 1
  private busL = new Float32Array(BLOCK)
  private busR = new Float32Array(BLOCK)
  private compEnv = 0
  private compGain = 1
  private compA: number
  private compR: number
  private pending: SampleEntry[] = []
  private frames = 0
  private lastPost = -1e9

  constructor(private ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.synth = Array.from({ length: SYNTH_VOICES }, () => new SynthVoice(this.sr, 8))
    this.samp = Array.from({ length: SAMPLE_VOICES }, () => new SampleVoice(this.sr))
    this.compA = Math.exp(-1 / (0.004 * this.sr))
    this.compR = Math.exp(-1 / (0.12 * this.sr))
    this.setData({ kit: '808', pads: {} })
  }

  setParam(id: string, v: number): void {
    if (id in this.p) (this.p as Record<string, number>)[id] = v
  }

  setData(d: unknown): void {
    const data = readData(d)
    if (data.kit !== this.data.kit || !this.def) this.loadKit(data.kit)
    this.data = data
    this.applyTweaks()
  }

  private loadKit(id: string): void {
    const { def, pads } = resolveKit(id)
    this.def = def
    this.sampled = KIT_BY_ID[id]?.mode === 'sampled' || def.mode === 'sampled'
    this.pads.fill(null)
    this.pending.length = 0
    const rom = this.sampled ? romFor(def) : null
    for (const rp of pads) {
      let entry: SampleEntry | null = null
      if (rom) {
        entry = rom.get(rp.key) ?? null
        if (!entry) {
          entry = new SampleEntry(rp.recipe, def.conv ?? { rate: 44100, bits: 0, lp: 20000 }, rp.key)
          rom.set(rp.key, entry)
        }
        if (!entry.done) this.pending.push(entry)
      }
      this.pads[rp.key] = { ...rp, entry, tune: 0, decay: 1, gain: 1, pan: rp.recipe.pan ?? 0, tone: 0, choke: DEFAULT_CHOKE[rp.key] ?? 0 }
    }
    // most-used pads first
    const prio = [36, 38, 42, 39, 46, 37, 44, 49, 51]
    this.pending.sort((a, b) => {
      const ia = prio.indexOf(keyOf(this.pads, a))
      const ib = prio.indexOf(keyOf(this.pads, b))
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  }

  private applyTweaks(): void {
    const tw = this.data.pads[this.data.kit] ?? {}
    for (const pad of this.pads) {
      if (!pad) continue
      const t = tw[String(pad.key)] ?? {}
      pad.tune = clamp(t.tune ?? 0, -24, 24)
      pad.decay = clamp(t.decay ?? 1, 0.1, 3)
      const lv = t.level ?? 0
      pad.gain = lv <= -40 ? 0 : dbToGain(clamp(lv, -40, 6))
      pad.pan = clamp(t.pan ?? pad.recipe.pan ?? 0, -1, 1)
      pad.tone = clamp(t.tone ?? 0, -1, 1)
      pad.choke = Math.round(clamp(t.choke ?? DEFAULT_CHOKE[pad.key] ?? 0, 0, 8))
    }
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  noteOn(n: NoteOn): void {
    const m = resolveKey(n.key)
    if (!m) return
    const pad = this.pads[m[0]]
    if (!pad || pad.gain === 0) return
    const choke = pad.choke
    // cut group + retrigger of the same pad (fast fade, like the real voice circuits)
    for (const v of this.synth) if (v.active && (v.key === pad.key || (choke > 0 && v.grp === choke))) v.release(0.005)
    for (const v of this.samp) if (v.active && (v.key === pad.key || (choke > 0 && v.grp === choke))) v.release(0.005)

    const p = this.p
    const vel = clamp(n.vel, 0, 1)
    const vs = clamp(p.vel, 0, 1)
    const vg = 1 - vs + vs * Math.pow(vel, 1.5)
    const ch = clamp(p.character, 0, 1)
    const drift = this.sampled ? 0 : (this.rand() - 0.5) * 0.12 * ch
    const semis = p.tune + pad.tune + m[1] + n.fine / 100 + drift
    const ratio = Math.pow(2, semis / 12)
    const [pl, pr] = panGains(clamp(pad.pan + n.pan, -1, 1))
    const g = vg * pad.gain
    const age = ++this.clock

    if (!this.sampled) {
      const peak = recipePeak(pad.recipe, this.sr)
      const norm = ((pad.recipe.lvl ?? 0.7) * HEADROOM) / peak
      const v = pick(this.synth)
      const mods: Mods = { ratio, decay: pad.decay, tone: pad.tone, vel, sat: ch * 0.15 }
      v.setup(pad.recipe, mods, peak, age)
      v.gainL = norm * g * pl
      v.gainR = norm * g * pr
      v.key = pad.key
      v.noteId = n.id
      v.grp = choke
      v.age = age
    } else if (pad.entry) {
      const e = pad.entry
      if (!e.done) e.finish()
      if (e.len < 2) return
      const v = pick(this.samp)
      v.start(e, ratio, pad.decay, pad.tone, ch)
      const lvl = (pad.recipe.lvl ?? 0.7) * HEADROOM
      v.gainL = lvl * g * pl
      v.gainR = lvl * g * pr
      v.key = pad.key
      v.noteId = n.id
      v.grp = choke
      v.age = age
    }
    if (this.frames - this.lastPost > this.sr / 50) {
      this.lastPost = this.frames
      this.ctx.post({ hit: pad.key })
    }
  }

  noteOff(id: number): void {
    if (this.p.gate < 0.5) return
    for (const v of this.synth) if (v.active && v.noteId === id) v.release(0.04)
    for (const v of this.samp) if (v.active && v.noteId === id) v.release(0.04)
  }

  allNotesOff(hard: boolean): void {
    if (!hard) return // one-shots ring out, like a hardware drum machine
    for (const v of this.synth) v.active = false
    for (const v of this.samp) v.active = false
  }

  onMessage(msg: unknown): void {
    void msg
  }

  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    for (let s = start; s < end; s += BLOCK) this.processChunk(outL, outR, s, Math.min(end, s + BLOCK))
    // background ROM rendering for sample-era kits
    if (this.pending.length) {
      const e = this.pending[0]
      if (e.done || e.advance(RENDER_BUDGET * ((end - start) / BLOCK))) this.pending.shift()
    }
  }

  private processChunk(outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const n = end - start
    const bl = this.busL
    const br = this.busR
    bl.fill(0, 0, n)
    br.fill(0, 0, n)
    let any = false
    for (const v of this.synth) {
      if (!v.active) continue
      any = true
      v.render(bl, br, 0, n)
    }
    for (const v of this.samp) {
      if (!v.active) continue
      any = true
      v.render(bl, br, 0, n)
    }
    this.frames += n
    if (!any && this.compEnv < 1e-5) return

    const p = this.p
    const drive = clamp(p.drive, 0, 1)
    const pre = 1 + 6 * drive
    const post = 1 / (1 + 2.2 * drive)
    const amt = clamp(p.comp, 0, 1)
    const thr = -4 - 20 * amt
    const ratio = 1 + 5 * amt
    const slope = 1 - 1 / ratio
    const makeup = dbToGain(-thr * slope * 0.6)
    const out = dbToGain(clamp(p.gain, -60, 12))
    for (let i = 0; i < n; i++) {
      let L = bl[i]
      let R = br[i]
      if (drive > 0.001) {
        L = softClip(L * pre) * post
        R = softClip(R * pre) * post
      }
      if (amt > 0.001) {
        const a = Math.max(Math.abs(L), Math.abs(R))
        this.compEnv = a > this.compEnv ? a + (this.compEnv - a) * this.compA : a + (this.compEnv - a) * this.compR
        const over = 20 * Math.log10(this.compEnv + 1e-9) - thr
        const target = over > 0 ? Math.pow(10, (-over * slope) / 20) : 1
        this.compGain = target + (this.compGain - target) * 0.995
        const g = this.compGain * makeup
        L *= g
        R *= g
      } else this.compEnv = 0
      outL[start + i] += L * out
      outR[start + i] += R * out
    }
  }
}

function keyOf(pads: (Pad | null)[], e: SampleEntry): number {
  for (const p of pads) if (p && p.entry === e) return p.key
  return -1
}

function pick<V extends { active: boolean; age: number }>(voices: V[]): V {
  let best = voices[0]
  for (const v of voices) {
    if (!v.active) return v
    if (v.age < best.age) best = v
  }
  return best
}

export default { id: 'drummachine', kind: 'instrument', create: (ctx) => new DrumMachine(ctx) } satisfies DSPFactory
