// Shared-memory block protocol between the 'arkane-vst-bridge' AudioWorklet, the native bridge addon and the
// arkane-vsthost sidecar. Mirror of native/vsthost/src/protocol.h — keep both in sync.
//
// This module is pure (no DOM / Node APIs) so it can be bundled into the worklet and unit-tested in Node.
import type { ScheduledEvent } from '../../plugins/sdk/types'

export const MAGIC = 0x41524b42
export const VERSION = 1
export const BLOCK = 128
export const SLOTS = 32
export const MAX_EVENTS = 64
export const HEADER_BYTES = 256
export const SLOT_BYTES = 4096
export const EVENTS_OFFSET = 64
export const EVENT_BYTES = 24
export const AUDIO_IN_OFFSET = EVENTS_OFFSET + MAX_EVENTS * EVENT_BYTES // 1600
export const AUDIO_OUT_OFFSET = AUDIO_IN_OFFSET + 2 * BLOCK * 4 // 2624
export const TOTAL_BYTES = HEADER_BYTES + SLOTS * SLOT_BYTES

export const H = {
  MAGIC: 0,
  VERSION: 1,
  SLOTS: 2,
  BLOCK: 3,
  IN_WRITE: 4,
  OUT_WRITE: 5,
  STATUS: 6,
  XRUNS: 7,
  SIDECAR_BELL: 8,
  BRIDGE_BELL: 9,
  LATENCY_BLOCKS: 10,
  PLAYING: 11,
  DROPPED: 12,
  SIDECAR_ALIVE: 13
} as const
/** f64 indices (byte offset / 8) of the transport anchor in the header */
export const F64_TEMPO = 128 / 8
export const F64_ANCHOR_TIME = 136 / 8
export const F64_ANCHOR_PPQ = 144 / 8

export const Status = { STARTING: 0, RUNNING: 1, CRASHED: 2, CLOSED: 3 } as const

export const Ev = { NOTE_ON: 1, NOTE_OFF: 2, PARAM: 3, PITCHBEND: 4, ALL_NOTES_OFF: 5, MIDI: 6 } as const

/** Plugins receive the channel pitch as MIDI pitch bend assuming the common ±2 semitone range. */
export const PITCH_BEND_RANGE = 2

/** An event on its way to the worklet. `time` is AudioContext time in seconds; 0 = as soon as possible. */
export interface WireEvent {
  time: number
  type: number
  a: number
  b: number
  v: number
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)

/** Convert the engine's ScheduledEvents to wire events (VST params are normalized 0..1, ids are numeric). */
export function toWireEvents(events: ScheduledEvent[]): WireEvent[] {
  const out: WireEvent[] = []
  for (const e of events) {
    switch (e.kind) {
      case 'on':
        out.push({ time: e.time, type: Ev.NOTE_ON, a: e.note.key | 0, b: e.note.id | 0, v: clamp(e.note.vel, 0, 1) })
        break
      case 'off':
        out.push({ time: e.time, type: Ev.NOTE_OFF, a: e.key | 0, b: e.id | 0, v: clamp(e.rel, 0, 1) })
        break
      case 'param': {
        const id = Number(e.id)
        if (!Number.isInteger(id) || id < 0) break
        out.push({ time: e.time, type: Ev.PARAM, a: id | 0, b: 0, v: clamp(e.value, 0, 1) })
        break
      }
      case 'bend':
        out.push({ time: e.time, type: Ev.PITCHBEND, a: 0, b: 0, v: clamp(e.semitones / PITCH_BEND_RANGE, -1, 1) })
        break
    }
  }
  return out
}

/** Initialise a SharedArrayBuffer for the protocol. */
export function initHeader(sab: SharedArrayBuffer): void {
  const i32 = new Int32Array(sab, 0, HEADER_BYTES / 4)
  i32.fill(0)
  i32[H.MAGIC] = MAGIC | 0
  i32[H.VERSION] = VERSION
  i32[H.SLOTS] = SLOTS
  i32[H.BLOCK] = BLOCK
  const f64 = new Float64Array(sab, 0, HEADER_BYTES / 8)
  f64[F64_TEMPO] = 120
}

/** main thread → worklet */
export type ToBridge =
  | { type: 'events'; events: ScheduledEvent[] }
  | { type: 'wire'; events: WireEvent[] }
  | { type: 'clearScheduled' }
  | { type: 'panic'; hard: boolean }
  | { type: 'bypass'; bypass: boolean }
  | { type: 'flush'; id: number }
  | { type: 'dispose' }

/** worklet → main thread */
export type FromBridge = { type: 'stats'; xruns: number; dropped: number; latencyBlocks: number } | { type: 'flushed'; id: number }

export interface BridgeOptions {
  kind: 'instrument' | 'effect'
  /** Fixed pipeline latency in blocks (output of block k is played at block k + latency). */
  latencyBlocks: number
  /** Raise the latency automatically on repeated xruns. */
  adaptive?: boolean
  /** Offline rendering: wait (spin) for each block instead of pipelining. */
  sync?: boolean
  maxLatencyBlocks?: number
}

export interface BridgeStats {
  xruns: number
  dropped: number
  latencyBlocks: number
}

/**
 * The real-time half of the bridge, written against plain typed arrays so it runs both inside the
 * AudioWorkletProcessor and in unit tests. One call to process() per render quantum; never blocks
 * (except in sync/offline mode).
 */
export class BridgeCore {
  readonly i32: Int32Array
  readonly f32: Float32Array
  readonly f64: Float64Array
  private queue: WireEvent[] = []
  private immediate: WireEvent[] = []
  latency: number
  bypass = false
  xruns = 0
  dropped = 0
  private blocks = 0
  private recentXruns: number[] = []
  private readonly maxLatency: number

  private readonly opts: BridgeOptions

  constructor(sab: SharedArrayBuffer, opts: BridgeOptions) {
    this.opts = opts
    this.i32 = new Int32Array(sab)
    this.f32 = new Float32Array(sab)
    this.f64 = new Float64Array(sab)
    this.latency = opts.sync ? 0 : Math.max(1, Math.min(SLOTS - 4, Math.round(opts.latencyBlocks)))
    this.maxLatency = Math.min(SLOTS - 4, opts.maxLatencyBlocks ?? 24)
    Atomics.store(this.i32, H.LATENCY_BLOCKS, this.latency)
  }

  /** Queue events (any order). time <= 0 → next block, offset 0. */
  push(events: WireEvent[]): void {
    for (const e of events) {
      if (!(e.time > 0)) {
        this.immediate.push(e)
        continue
      }
      // insertion keeping time order (events usually arrive nearly sorted → scan from the end)
      let i = this.queue.length
      while (i > 0 && this.queue[i - 1].time > e.time) i--
      this.queue.splice(i, 0, e)
    }
  }

  /** Drop scheduled (future) events; immediate ones (e.g. a pending panic) are kept. */
  clearScheduled(): void {
    this.queue.length = 0
  }

  pending(): number {
    return this.queue.length + this.immediate.length
  }

  /**
   * Process one render quantum.
   * @param frame AudioContext frame at the start of this quantum (currentFrame)
   */
  process(frame: number, sampleRate: number, inL: Float32Array | null, inR: Float32Array | null, outL: Float32Array, outR: Float32Array): void {
    const i32 = this.i32
    this.blocks++
    if (Atomics.load(i32, H.STATUS) !== Status.RUNNING) {
      outL.fill(0)
      outR.fill(0)
      // Don't let a backlog build up while the sidecar starts / after it crashed.
      const until = (frame + BLOCK) / sampleRate
      while (this.queue.length && this.queue[0].time < until) this.queue.shift()
      this.immediate.length = 0
      return
    }
    const k = Atomics.load(i32, H.IN_WRITE)
    let outW = Atomics.load(i32, H.OUT_WRITE)
    if (((k - outW) | 0) >= SLOTS - 2) {
      // sidecar fell far behind (hung?) — don't overwrite unread slots
      this.dropped++
      Atomics.store(i32, H.DROPPED, this.dropped)
      this.emitInputOrSilence(inL, inR, outL, outR)
      return
    }
    const slot = k & (SLOTS - 1)
    const base = HEADER_BYTES + slot * SLOT_BYTES
    const shift = this.opts.kind === 'instrument' ? this.latency * BLOCK : 0
    const winStart = frame + shift
    const winEnd = winStart + BLOCK

    // events
    let n = 0
    const evBase32 = (base + EVENTS_OFFSET) >> 2
    const put = (e: WireEvent, offset: number): void => {
      const w = evBase32 + n * (EVENT_BYTES >> 2)
      i32[w] = e.type
      i32[w + 1] = offset
      i32[w + 2] = e.a
      i32[w + 3] = e.b
      this.f64[(base + EVENTS_OFFSET + n * EVENT_BYTES + 16) >> 3] = e.v
      n++
    }
    while (this.immediate.length && n < MAX_EVENTS) put(this.immediate.shift()!, 0)
    while (this.queue.length && n < MAX_EVENTS) {
      const e = this.queue[0]
      const f = Math.round(e.time * sampleRate)
      if (f >= winEnd) break
      this.queue.shift()
      put(e, f <= winStart ? 0 : f - winStart)
    }

    // slot header + transport
    const hb = base >> 2
    i32[hb] = k
    i32[hb + 1] = n
    const playing = Atomics.load(i32, H.PLAYING) === 1
    i32[hb + 2] = playing ? 1 : 0
    i32[hb + 3] = BLOCK
    const tempo = this.f64[F64_TEMPO] || 120
    const t = winStart / sampleRate
    const ppq = playing ? this.f64[F64_ANCHOR_PPQ] + ((t - this.f64[F64_ANCHOR_TIME]) * tempo) / 60 : this.f64[F64_ANCHOR_PPQ]
    this.f64[(base + 16) >> 3] = tempo
    this.f64[(base + 24) >> 3] = ppq
    this.f64[(base + 32) >> 3] = winStart

    // input audio
    const in32 = (base + AUDIO_IN_OFFSET) >> 2
    if (inL) this.f32.set(inL, in32)
    else this.f32.fill(0, in32, in32 + BLOCK)
    if (inR ?? inL) this.f32.set((inR ?? inL)!, in32 + BLOCK)
    else this.f32.fill(0, in32 + BLOCK, in32 + 2 * BLOCK)
    Atomics.store(i32, H.IN_WRITE, (k + 1) | 0)

    // output: block k - latency
    const r = (k - this.latency) | 0
    if (this.opts.sync) {
      const deadline = Date.now() + 2000
      while (((Atomics.load(i32, H.OUT_WRITE) - r) | 0) <= 0 && Date.now() < deadline) {
        /* spin: offline rendering only */
      }
    }
    outW = Atomics.load(i32, H.OUT_WRITE)
    if (r < 0 && !this.opts.sync && this.blocks <= this.latency) {
      outL.fill(0)
      outR.fill(0)
    } else if (((outW - r) | 0) > 0) {
      const o32 = (HEADER_BYTES + (r & (SLOTS - 1)) * SLOT_BYTES + AUDIO_OUT_OFFSET) >> 2
      outL.set(this.f32.subarray(o32, o32 + BLOCK))
      outR.set(this.f32.subarray(o32 + BLOCK, o32 + 2 * BLOCK))
    } else {
      outL.fill(0)
      outR.fill(0)
      this.onXrun()
    }
    if (this.bypass && this.opts.kind === 'effect') this.emitInputOrSilence(inL, inR, outL, outR)
  }

  stats(): BridgeStats {
    return { xruns: this.xruns, dropped: this.dropped, latencyBlocks: this.latency }
  }

  private emitInputOrSilence(inL: Float32Array | null, inR: Float32Array | null, outL: Float32Array, outR: Float32Array): void {
    if (this.opts.kind === 'effect' && this.bypass && inL) {
      outL.set(inL)
      outR.set(inR ?? inL)
    } else {
      outL.fill(0)
      outR.fill(0)
    }
  }

  private onXrun(): void {
    this.xruns++
    Atomics.store(this.i32, H.XRUNS, this.xruns)
    if (!this.opts.adaptive || this.opts.sync || this.blocks < 64) return
    const now = this.blocks
    this.recentXruns.push(now)
    while (this.recentXruns.length && now - this.recentXruns[0] > 400) this.recentXruns.shift()
    if (this.recentXruns.length >= 3 && this.latency < this.maxLatency) {
      this.latency++
      this.recentXruns.length = 0
      Atomics.store(this.i32, H.LATENCY_BLOCKS, this.latency)
    }
  }
}

/** Pick the starting latency from the context's output buffer size: one hardware callback + 1 block margin. */
export function initialLatencyBlocks(baseLatency: number | undefined, sampleRate: number): number {
  const frames = (baseLatency && baseLatency > 0 ? baseLatency : 0.01) * sampleRate
  return Math.max(2, Math.min(SLOTS - 4, Math.ceil(frames / BLOCK) + 1))
}
