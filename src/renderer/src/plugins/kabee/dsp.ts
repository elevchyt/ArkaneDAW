// Kabee DSP shim: runs the upstream C++ engine (kabee.wasm, built by native/kabee/build.sh) inside the AudioWorklet.
//
// The UI module compiles the wasm on the main thread (loadWasm) and the host hands it over as ctx.wasm, so here we
// only need a synchronous `new WebAssembly.Instance` (~140 KB module, fine in a worklet).
//
// Editor -> DSP messages (postToDSP):
//   { type: 'learn' }                         start gate learn (1.5 s noise-floor listen)
//   { type: 'hello' }                         ask for an immediate status message
//   { type: 'chain', ids: number[] }          set the board order (pedal ids); normally done through slot params
//   { type: 'preset', index: number }         load a factory preset's board into the engine
//   { type: 'state', values: Record<string, number> }   apply many params at once
// DSP -> editor (ctx.post, ~25/s while something changes):
//   { type: 'status', input, gateOpen, learn, learnedDb, learnCount, tuner }
import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { MAX_SLOTS, PARAM_BY_SYMBOL } from './model'

export interface KabeeStatus {
  type: 'status'
  /** Input level, dBFS (-96..6), after Input gain. */
  input: number
  gateOpen: boolean
  /** 0 when idle, else learn progress 0..1 */
  learn: number
  learnedDb: number
  learnCount: number
  /** Detected tuner frequency in Hz, 0 = nothing / tuner off. */
  tuner: number
}

export type KabeeMessage =
  | { type: 'learn' }
  | { type: 'hello' }
  | { type: 'chain'; ids: number[] }
  | { type: 'preset'; index: number }
  | { type: 'state'; values: Record<string, number> }

interface KabeeExports {
  memory: WebAssembly.Memory
  _initialize?: () => void
  kabee_alloc(bytes: number): number
  kabee_create(sampleRate: number): number
  kabee_reset(h: number): void
  kabee_set_param(h: number, index: number, value: number): void
  kabee_get_param(h: number, index: number): number
  kabee_process(h: number, inL: number, inR: number, outL: number, outR: number, frames: number): void
  kabee_gate_learn(h: number): void
  kabee_set_chain(h: number, ids: number, count: number): void
  kabee_load_preset(h: number, index: number): void
}

const MAX_BLOCK = 128
const idx = (symbol: string): number => PARAM_BY_SYMBOL[symbol].index
const OUT_INPUT = idx('out_input_level')
const OUT_GATE = idx('out_gate_open')
const OUT_LEARN = idx('out_learn_progress')
const OUT_LEARNED = idx('out_learned_db')
const OUT_LEARN_COUNT = idx('out_learn_count')
const OUT_TUNER = idx('out_tuner_freq')

/** WASI imports the module references (libc++ abort paths, clock); none are called during normal operation. */
function stubImports(module: WebAssembly.Module): WebAssembly.Imports {
  const imports: Record<string, Record<string, () => number>> = {}
  for (const imp of WebAssembly.Module.imports(module)) {
    if (imp.kind !== 'function') continue
    ;(imports[imp.module] ??= {})[imp.name] = () => 52 // ENOSYS
  }
  return imports
}

export class KabeeEngine {
  readonly k: KabeeExports
  readonly h: number
  private inL: number
  private inR: number
  private outL: number
  private outR: number
  private ints: number
  private buffer: ArrayBuffer | null = null
  private f32!: Float32Array
  private i32!: Int32Array

  constructor(module: WebAssembly.Module, sampleRate: number) {
    const instance = new WebAssembly.Instance(module, stubImports(module))
    this.k = instance.exports as unknown as KabeeExports
    this.k._initialize?.()
    this.h = this.k.kabee_create(sampleRate)
    if (!this.h) throw new Error('kabee_create failed')
    this.inL = this.k.kabee_alloc(MAX_BLOCK * 4)
    this.inR = this.k.kabee_alloc(MAX_BLOCK * 4)
    this.outL = this.k.kabee_alloc(MAX_BLOCK * 4)
    this.outR = this.k.kabee_alloc(MAX_BLOCK * 4)
    this.ints = this.k.kabee_alloc(MAX_SLOTS * 4)
    this.views()
  }

  /** (Re)creates the typed-array views; memory.grow detaches the old buffer. */
  private views(): void {
    if (this.buffer === this.k.memory.buffer) return
    this.buffer = this.k.memory.buffer
    this.f32 = new Float32Array(this.buffer)
    this.i32 = new Int32Array(this.buffer)
  }

  set(index: number, v: number): void {
    this.k.kabee_set_param(this.h, index, v)
  }
  get(index: number): number {
    return this.k.kabee_get_param(this.h, index)
  }

  setChain(ids: number[]): void {
    this.views()
    const n = Math.min(ids.length, MAX_SLOTS)
    for (let i = 0; i < n; i++) this.i32[(this.ints >> 2) + i] = ids[i]
    this.k.kabee_set_chain(this.h, this.ints, n)
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    this.views()
    const f = this.f32
    for (let pos = start; pos < end; pos += MAX_BLOCK) {
      const n = Math.min(MAX_BLOCK, end - pos)
      f.set(inL.subarray(pos, pos + n), this.inL >> 2)
      f.set(inR.subarray(pos, pos + n), this.inR >> 2)
      this.k.kabee_process(this.h, this.inL, this.inR, this.outL, this.outR, n)
      outL.set(f.subarray(this.outL >> 2, (this.outL >> 2) + n), pos)
      outR.set(f.subarray(this.outR >> 2, (this.outR >> 2) + n), pos)
    }
  }

  status(): KabeeStatus {
    return {
      type: 'status',
      input: this.get(OUT_INPUT),
      gateOpen: this.get(OUT_GATE) > 0.5,
      learn: this.get(OUT_LEARN),
      learnedDb: this.get(OUT_LEARNED),
      learnCount: this.get(OUT_LEARN_COUNT),
      tuner: this.get(OUT_TUNER)
    }
  }
}

function changed(a: KabeeStatus | null, b: KabeeStatus): boolean {
  if (!a) return true
  return (
    Math.abs(a.input - b.input) >= 0.5 ||
    a.gateOpen !== b.gateOpen ||
    Math.abs(a.learn - b.learn) > 0.005 ||
    a.learnCount !== b.learnCount ||
    Math.abs(a.tuner - b.tuner) > 0.02
  )
}

class KabeeDSP implements EffectDSP {
  private engine: KabeeEngine | null
  private post: (msg: unknown) => void
  private interval: number
  private untilStatus = 0
  private last: KabeeStatus | null = null

  constructor(ctx: DSPContext) {
    this.post = ctx.post
    this.interval = Math.round(ctx.sampleRate / 25)
    this.engine = ctx.wasm ? new KabeeEngine(ctx.wasm, ctx.sampleRate) : null
    if (!this.engine) ctx.post({ type: 'error', message: 'kabee.wasm missing: audio passes through unprocessed' })
  }

  setParam(id: string, value: number): void {
    const p = PARAM_BY_SYMBOL[id]
    if (p && this.engine) this.engine.set(p.index, value)
  }

  onMessage(msg: unknown): void {
    const e = this.engine
    const m = msg as KabeeMessage
    if (!e || !m || typeof m !== 'object') return
    switch (m.type) {
      case 'learn':
        e.k.kabee_gate_learn(e.h)
        break
      case 'hello':
        this.last = null
        this.untilStatus = 0
        break
      case 'chain':
        e.setChain(m.ids)
        break
      case 'preset':
        e.k.kabee_load_preset(e.h, m.index)
        break
      case 'state':
        for (const k in m.values) this.setParam(k, m.values[k])
        break
    }
  }

  reset(): void {
    if (this.engine) this.engine.k.kabee_reset(this.engine.h)
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const e = this.engine
    if (!e) {
      if (outL !== inL) outL.set(inL.subarray(start, end), start)
      if (outR !== inR) outR.set(inR.subarray(start, end), start)
      return
    }
    e.process(inL, inR, outL, outR, start, end)

    this.untilStatus -= end - start
    if (this.untilStatus <= 0) {
      this.untilStatus += this.interval
      const s = e.status()
      if (changed(this.last, s)) {
        this.last = s
        this.post(s)
      }
    }
  }
}

export default {
  id: 'kabee',
  kind: 'effect',
  create: (ctx: DSPContext) => new KabeeDSP(ctx)
} satisfies DSPFactory
