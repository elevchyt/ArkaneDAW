import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { SR, sine, stats, type Rendered } from '../sdk/test-utils'
import type { EffectDSP } from '../sdk/types'
import factory, { type KabeeStatus } from './dsp'
import { manifest } from './manifest'
import { KABEE_PRESETS, decodeChain, encodeChain, factoryPresetLabel } from './model'
import { defaultParams, presetParams } from '../sdk/module'

let wasm: WebAssembly.Module

beforeAll(async () => {
  wasm = await WebAssembly.compile(readFileSync(fileURLToPath(new URL('./kabee.wasm', import.meta.url))))
})

const BLOCK = 128

function make(params: Record<string, number>, posts: unknown[] = []): EffectDSP {
  const dsp = factory.create({ sampleRate: SR, wasm, post: (m) => posts.push(m) }) as EffectDSP
  for (const [k, v] of Object.entries({ ...defaultParams(manifest), ...params })) dsp.setParam(k, v)
  dsp.reset?.()
  return dsp
}

function run(dsp: EffectDSP, input: Rendered): Rendered {
  const n = input.L.length
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const il = new Float32Array(BLOCK), ir = new Float32Array(BLOCK), ol = new Float32Array(BLOCK), or = new Float32Array(BLOCK)
  for (let pos = 0; pos < n; pos += BLOCK) {
    il.fill(0)
    ir.fill(0)
    il.set(input.L.subarray(pos, pos + BLOCK))
    ir.set(input.R.subarray(pos, pos + BLOCK))
    // split the block like the worklet does around automation events
    dsp.process(il, ir, ol, or, 0, 37)
    dsp.process(il, ir, ol, or, 37, BLOCK)
    L.set(ol.subarray(0, Math.min(BLOCK, n - pos)), pos)
    R.set(or.subarray(0, Math.min(BLOCK, n - pos)), pos)
  }
  return { L, R }
}

/** Karplus-Strong plucked strings: a few notes like a DI guitar (peaks around -8 dBFS). */
function plucks(freqs: number[], each = 0.6, amp = 0.4, seed = 1): Rendered {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1
  const n = Math.ceil(freqs.length * each * SR)
  const L = new Float32Array(n)
  freqs.forEach((f, k) => {
    const period = Math.round(SR / f)
    const buf = new Float32Array(period).map(() => rnd() * amp)
    const start = Math.round(k * each * SR)
    let prev = 0
    for (let i = 0; i < each * SR * 1.5 && start + i < n; i++) {
      const j = i % period
      const y = buf[j]
      buf[j] = 0.996 * 0.5 * (y + prev)
      prev = y
      L[start + i] += y
    }
  })
  return { L, R: L.slice() }
}

const db = (x: number): number => 20 * Math.log10(Math.max(1e-9, x))

describe('kabee wasm', () => {
  it('passes audio with the default board (Guitar Clean)', () => {
    const out = run(make({}), plucks([82.4, 110, 146.8, 196]))
    const sl = stats(out.L), sr = stats(out.R)
    expect(sl.nan || sr.nan).toBe(false)
    expect(db(sl.rms)).toBeGreaterThan(-40)
    expect(sl.peak).toBeLessThan(2)
  })

  for (const preset of KABEE_PRESETS) {
    it(`factory preset ${factoryPresetLabel(preset)}: finite, sensible level`, () => {
      const params = presetParams(manifest, manifest.presets!.find((p) => p.name === factoryPresetLabel(preset))!)
      const input = preset.mode === 1 ? plucks([41.2, 55, 73.4, 55], 0.6, 0.45) : plucks([82.4, 110, 146.8, 196, 246.9], 0.5)
      const out = run(make(params), input)
      const sl = stats(out.L), sr = stats(out.R)
      expect(sl.nan || sr.nan).toBe(false)
      // presets are level-balanced upstream; allow a generous window
      expect(db(sl.rms)).toBeGreaterThan(-36)
      expect(db(sl.rms)).toBeLessThan(0)
      expect(sl.peak).toBeLessThan(2.5)
    })
  }

  it('tuner detects a 110 Hz sine as A2 and mutes the output', () => {
    const posts: unknown[] = []
    const dsp = make({ tuner: 1 }, posts)
    const out = run(dsp, sine(110, 1.5, 0.3))
    const status = posts.filter((m): m is KabeeStatus => (m as KabeeStatus).type === 'status')
    const freq = status.at(-1)!.tuner
    expect(freq).toBeGreaterThan(109)
    expect(freq).toBeLessThan(111)
    const midi = Math.round(69 + 12 * Math.log2(freq / 440))
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    expect(`${names[midi % 12]}${Math.floor(midi / 12) - 1}`).toBe('A2')
    expect(stats(out.L.subarray(SR)).peak).toBeLessThan(1e-3)
  })

  it('gate silences low-level noise when on', () => {
    let s = 7
    const n = SR * 2
    const noise = new Float32Array(n).map(() => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296 - 0.5) * 2 * 0.0005) // ~ -70 dBFS
    const input = { L: noise, R: noise.slice() }
    const off = stats(run(make({ gate_on: 0, gate_threshold: -50 }), input).L.subarray(SR))
    const on = stats(run(make({ gate_on: 1, gate_threshold: -50 }), input).L.subarray(SR))
    expect(on.nan).toBe(false)
    expect(db(off.rms) - db(on.rms)).toBeGreaterThan(30)
  })

  it('gate learn sets a threshold just above the noise', () => {
    const posts: unknown[] = []
    const dsp = make({ gate_on: 1 }, posts)
    dsp.onMessage?.({ type: 'learn' })
    let s = 3
    const noise = new Float32Array(SR * 2).map(() => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296 - 0.5) * 2 * 0.001)
    run(dsp, { L: noise, R: noise.slice() })
    const status = posts.filter((m): m is KabeeStatus => (m as KabeeStatus).type === 'status')
    expect(status.some((m) => m.learn > 0)).toBe(true)
    const last = status.at(-1)!
    expect(last.learnCount).toBe(1)
    expect(last.learnedDb).toBeGreaterThan(-70)
    expect(last.learnedDb).toBeLessThan(-45)
  })

  it('pedal order changes the sound and reordering stays clean', () => {
    const base = presetParams(manifest, manifest.presets!.find((p) => p.name === 'Guitar Distortion')!)
    const chain = decodeChain(base)
    const input = plucks([110, 146.8, 196])
    const a = run(make(base), input)
    const reversed = { ...base, ...encodeChain([...chain].reverse()) }
    const b = run(make(reversed), input)
    let diff = 0
    for (let i = 0; i < a.L.length; i++) diff += (a.L[i] - b.L[i]) ** 2
    expect(Math.sqrt(diff / a.L.length)).toBeGreaterThan(1e-3)

    // live reorder through a message: no NaN, no blow-up
    const dsp = make(base)
    const first = run(dsp, plucks([110]))
    dsp.onMessage?.({ type: 'chain', ids: [...chain].reverse() })
    const second = run(dsp, plucks([110]))
    expect(stats(first.L).nan || stats(second.L).nan).toBe(false)
    expect(stats(second.L).peak).toBeLessThan(2.5)
  })

  it('bass mode with the preset message', () => {
    const dsp = make({})
    dsp.onMessage?.({ type: 'preset', index: KABEE_PRESETS.findIndex((p) => p.mode === 1 && p.name === 'Punch') })
    const out = run(dsp, plucks([41.2, 55], 0.6, 0.45))
    expect(stats(out.L).nan).toBe(false)
    expect(db(stats(out.L).rms)).toBeGreaterThan(-40)
  })
})
