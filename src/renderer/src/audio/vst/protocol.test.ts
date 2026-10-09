import { describe, expect, it } from 'vitest'
import {
  AUDIO_IN_OFFSET,
  AUDIO_OUT_OFFSET,
  BLOCK,
  BridgeCore,
  EVENTS_OFFSET,
  EVENT_BYTES,
  Ev,
  F64_ANCHOR_PPQ,
  F64_ANCHOR_TIME,
  F64_TEMPO,
  H,
  HEADER_BYTES,
  MAX_EVENTS,
  SLOTS,
  SLOT_BYTES,
  Status,
  TOTAL_BYTES,
  initHeader,
  initialLatencyBlocks,
  toWireEvents,
  type WireEvent
} from './protocol'

const SR = 48000

interface SeenEvent {
  block: number
  type: number
  offset: number
  a: number
  b: number
  v: number
}

/** Stand-in for bridge + sidecar: processes every pending slot (output = input * 2 + 0.5 per event). */
class FakeSidecar {
  i32: Int32Array
  f32: Float32Array
  f64: Float64Array
  seen: SeenEvent[] = []
  headers: { seq: number; flags: number; tempo: number; ppq: number; pos: number }[] = []
  constructor(sab: SharedArrayBuffer) {
    this.i32 = new Int32Array(sab)
    this.f32 = new Float32Array(sab)
    this.f64 = new Float64Array(sab)
  }
  run(limit = Infinity): void {
    let out = this.i32[H.OUT_WRITE]
    const inW = this.i32[H.IN_WRITE]
    while (out !== inW && limit-- > 0) {
      const base = HEADER_BYTES + (out % SLOTS) * SLOT_BYTES
      const n = this.i32[(base >> 2) + 1]
      this.headers.push({
        seq: this.i32[base >> 2],
        flags: this.i32[(base >> 2) + 2],
        tempo: this.f64[(base + 16) >> 3],
        ppq: this.f64[(base + 24) >> 3],
        pos: this.f64[(base + 32) >> 3]
      })
      for (let i = 0; i < n; i++) {
        const w = (base + EVENTS_OFFSET + i * EVENT_BYTES) >> 2
        this.seen.push({ block: out, type: this.i32[w], offset: this.i32[w + 1], a: this.i32[w + 2], b: this.i32[w + 3], v: this.f64[(base + EVENTS_OFFSET + i * EVENT_BYTES + 16) >> 3] })
      }
      const inp = (base + AUDIO_IN_OFFSET) >> 2
      const o = (base + AUDIO_OUT_OFFSET) >> 2
      for (let i = 0; i < 2 * BLOCK; i++) this.f32[o + i] = this.f32[inp + i] * 2 + 0.5 * n
      out++
      this.i32[H.OUT_WRITE] = out
    }
  }
}

function setup(kind: 'instrument' | 'effect', latencyBlocks: number, adaptive = false) {
  const sab = new SharedArrayBuffer(TOTAL_BYTES)
  initHeader(sab)
  const i32 = new Int32Array(sab)
  i32[H.STATUS] = Status.RUNNING
  const core = new BridgeCore(sab, { kind, latencyBlocks, adaptive })
  const side = new FakeSidecar(sab)
  const L = new Float32Array(BLOCK)
  const R = new Float32Array(BLOCK)
  return { sab, i32, core, side, L, R }
}

const note = (time: number, key = 60, id = 1, vel = 0.8) =>
  ({ kind: 'on', time, note: { id, key, vel, pan: 0, fine: 0, rel: 0.5, modX: 0.5, modY: 0.5, porta: false, slide: false, color: 0, length: 0 } }) as const

describe('toWireEvents', () => {
  it('converts notes, params and bends', () => {
    const w = toWireEvents([
      note(1.5, 64, 7, 1.4),
      { kind: 'off', time: 2, id: 7, key: 64, rel: 0.2 },
      { kind: 'param', time: 0, id: '12', value: 0.3 },
      { kind: 'param', time: 0, id: 'cutoff', value: 0.3 },
      { kind: 'bend', time: 0, semitones: -12 }
    ])
    expect(w).toEqual([
      { time: 1.5, type: Ev.NOTE_ON, a: 64, b: 7, v: 1 },
      { time: 2, type: Ev.NOTE_OFF, a: 64, b: 7, v: 0.2 },
      { time: 0, type: Ev.PARAM, a: 12, b: 0, v: 0.3 },
      { time: 0, type: Ev.PITCHBEND, a: 0, b: 0, v: -1 }
    ])
  })
})

describe('BridgeCore', () => {
  it('lays out the header like protocol.h', () => {
    expect(TOTAL_BYTES).toBe(256 + 32 * 4096)
    expect(AUDIO_IN_OFFSET).toBe(1600)
    expect(AUDIO_OUT_OFFSET).toBe(2624)
    expect(F64_TEMPO * 8).toBe(128)
  })

  it('pipelines with a fixed latency and returns processed audio', () => {
    const { core, side, L, R } = setup('effect', 3)
    const inL = new Float32Array(BLOCK).fill(0.25)
    const outs: number[] = []
    for (let q = 0; q < 6; q++) {
      core.process(q * BLOCK, SR, inL, inL, L, R)
      side.run()
      outs.push(L[0])
    }
    // first 3 blocks: priming silence; then input*2
    expect(outs).toEqual([0, 0, 0, 0.5, 0.5, 0.5])
    expect(core.xruns).toBe(0)
  })

  it('counts an xrun (silence) when the sidecar is late, never blocks', () => {
    const { core, side, L, R } = setup('effect', 2)
    const inL = new Float32Array(BLOCK).fill(1)
    for (let q = 0; q < 4; q++) core.process(q * BLOCK, SR, inL, inL, L, R) // sidecar not running
    expect(core.xruns).toBe(2)
    expect(L.every((x) => x === 0)).toBe(true)
    side.run()
    core.process(4 * BLOCK, SR, inL, inL, L, R)
    expect(L[0]).toBe(2)
  })

  it('raises latency adaptively after repeated xruns', () => {
    const { core, side, L, R } = setup('instrument', 2, true)
    for (let q = 0; q < 100; q++) {
      core.process(q * BLOCK, SR, null, null, L, R)
      side.run()
    }
    expect(core.latency).toBe(2)
    for (let q = 100; q < 105; q++) core.process(q * BLOCK, SR, null, null, L, R) // sidecar stalls: 2 buffered + 3 xruns
    expect(core.latency).toBe(3)
  })

  it('sends instrument events latency-blocks early with exact sample offsets', () => {
    const LAT = 3
    const { core, side, L, R } = setup('instrument', LAT)
    const frame = 10 * BLOCK + 77
    core.push(toWireEvents([note(frame / SR)]))
    for (let q = 0; q < 12; q++) {
      core.process(q * BLOCK, SR, null, null, L, R)
      side.run()
    }
    expect(side.seen).toHaveLength(1)
    const e = side.seen[0]
    // the block whose OUTPUT plays at frame 10*128 is block 10 - LAT
    expect(e.block).toBe(10 - LAT)
    expect(e.offset).toBe(77)
    expect(side.headers[e.block].pos).toBe(10 * BLOCK)
  })

  it('does not shift effect events', () => {
    const { core, side, L, R } = setup('effect', 4)
    core.push([{ time: (5 * BLOCK + 3) / SR, type: Ev.PARAM, a: 1, b: 0, v: 0.5 }])
    for (let q = 0; q < 8; q++) {
      core.process(q * BLOCK, SR, null, null, L, R)
      side.run()
    }
    expect(side.seen[0]).toMatchObject({ block: 5, offset: 3, type: Ev.PARAM, a: 1, v: 0.5 })
  })

  it('delivers immediate events first, keeps order, and spills overflow to the next block', () => {
    const { core, side, L, R } = setup('instrument', 2)
    const evs: WireEvent[] = []
    for (let i = 0; i < MAX_EVENTS + 5; i++) evs.push({ time: 0, type: Ev.PARAM, a: i, b: 0, v: 0 })
    core.push(evs)
    core.process(0, SR, null, null, L, R)
    core.process(BLOCK, SR, null, null, L, R)
    side.run()
    expect(side.seen.filter((e) => e.block === 0)).toHaveLength(MAX_EVENTS)
    expect(side.seen.filter((e) => e.block === 1).map((e) => e.a)).toEqual([64, 65, 66, 67, 68])
    expect(side.seen.every((e) => e.offset === 0)).toBe(true)
  })

  it('late events are played at offset 0', () => {
    const { core, side, L, R } = setup('effect', 2)
    for (let q = 0; q < 4; q++) core.process(q * BLOCK, SR, null, null, L, R)
    side.run()
    core.push([{ time: BLOCK / SR, type: Ev.NOTE_ON, a: 60, b: 1, v: 1 }]) // in the past
    core.process(4 * BLOCK, SR, null, null, L, R)
    side.run()
    expect(side.seen[0]).toMatchObject({ block: 4, offset: 0 })
  })

  it('drops (does not overwrite) blocks when the sidecar is stalled', () => {
    const { core, i32, L, R } = setup('effect', 2)
    for (let q = 0; q < SLOTS + 10; q++) core.process(q * BLOCK, SR, null, null, L, R)
    expect(i32[H.IN_WRITE]).toBe(SLOTS - 2)
    expect(core.dropped).toBe(12)
  })

  it('outputs silence and drains past events while not running', () => {
    const { core, i32, L, R } = setup('instrument', 2)
    i32[H.STATUS] = Status.CRASHED
    core.push(toWireEvents([note(0.0001), note(10)]))
    L.fill(1)
    core.process(0, SR, null, null, L, R)
    expect(L.every((x) => x === 0)).toBe(true)
    expect(core.pending()).toBe(1)
    expect(i32[H.IN_WRITE]).toBe(0)
  })

  it('bypassed effects pass input through', () => {
    const { core, side, L, R } = setup('effect', 2)
    core.bypass = true
    const inL = new Float32Array(BLOCK).fill(0.3)
    core.process(0, SR, inL, inL, L, R)
    side.run()
    expect(L[0]).toBeCloseTo(0.3)
  })

  it('writes tempo / play state / ppq per block from the transport anchor', () => {
    const { core, side, i32, sab, L, R } = setup('effect', 2)
    const f64 = new Float64Array(sab)
    f64[F64_TEMPO] = 150
    f64[F64_ANCHOR_TIME] = 0
    f64[F64_ANCHOR_PPQ] = 8
    i32[H.PLAYING] = 1
    for (let q = 0; q < 3; q++) core.process(q * BLOCK, SR, null, null, L, R)
    side.run()
    const h = side.headers[2]
    expect(h.flags).toBe(1)
    expect(h.tempo).toBe(150)
    expect(h.ppq).toBeCloseTo(8 + ((2 * BLOCK) / SR) * (150 / 60), 9)
  })

  it('picks the initial latency from the output buffer size', () => {
    expect(initialLatencyBlocks(0.01, 48000)).toBe(5) // 480 frames → 4 blocks + 1
    expect(initialLatencyBlocks(0, 48000)).toBe(5)
    expect(initialLatencyBlocks(0.002, 48000)).toBe(2)
  })
})
