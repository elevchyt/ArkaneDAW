// Shared vitest checks for the effects pack. Imported only by *.test.ts files.
import { expect, it } from 'vitest'
import type { DSPFactory, EffectDSP, PluginManifest } from '../sdk/types'
import { defaultParams, presetParams } from '../sdk/module'
import { renderEffect, sine, stats, SR, type Rendered } from '../sdk/test-utils'

/** Stereo test signal: a chord-ish mix with some stereo difference. */
export function testSignal(seconds: number, amp = 0.5): Rendered {
  const n = Math.ceil(seconds * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    L[i] = amp * (0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.sin(2 * Math.PI * 1375 * t) + 0.1 * Math.sin(2 * Math.PI * 5200 * t))
    R[i] = amp * (0.6 * Math.sin(2 * Math.PI * 330 * t) + 0.3 * Math.sin(2 * Math.PI * 990 * t) + 0.1 * Math.sin(2 * Math.PI * 7000 * t))
  }
  return { L, R }
}

/** Input followed by silence (for tails). */
export function burstThenSilence(seconds: number, burst: number, amp = 0.5): Rendered {
  const s = testSignal(seconds, amp)
  const from = Math.floor(burst * SR)
  s.L.fill(0, from)
  s.R.fill(0, from)
  return s
}

export function maxAbsDiff(a: Float32Array, b: Float32Array, from = 0, delay = 0): number {
  let m = 0
  for (let i = from; i < a.length; i++) {
    const j = i - delay
    const d = Math.abs(a[i] - (j >= 0 ? b[j] : 0))
    if (d > m) m = d
  }
  return m
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

/** Defaults finite + every preset finite & bounded (peak < 4 for a 0.5 sine). */
export function standardTests(factory: DSPFactory, manifest: PluginManifest, opts: { seconds?: number } = {}): void {
  const seconds = opts.seconds ?? 1
  it('manifest is consistent', () => {
    expect(factory.id).toBe(manifest.id)
    expect(factory.kind).toBe('effect')
    expect(manifest.kind).toBe('effect')
    const ids = new Set(manifest.params.map((p) => p.id))
    expect(ids.size).toBe(manifest.params.length)
    for (const p of manifest.params) {
      expect(p.default).toBeGreaterThanOrEqual(p.min)
      expect(p.default).toBeLessThanOrEqual(p.max)
    }
    expect((manifest.presets ?? []).length).toBeGreaterThanOrEqual(5)
    for (const pr of manifest.presets ?? []) {
      for (const [k, v] of Object.entries(pr.params)) {
        const def = manifest.params.find((p) => p.id === k)
        expect(def, `${pr.name}: unknown param ${k}`).toBeDefined()
        expect(v, `${pr.name}.${k}`).toBeGreaterThanOrEqual(def!.min)
        expect(v, `${pr.name}.${k}`).toBeLessThanOrEqual(def!.max)
      }
    }
  })

  it('defaults produce finite, non-silent output', () => {
    const r = renderEffect(factory, { params: defaultParams(manifest), input: testSignal(seconds) })
    const s = stats(r.L)
    const t = stats(r.R)
    expect(s.nan || t.nan).toBe(false)
    expect(s.peak + t.peak).toBeGreaterThan(0.01)
    expect(Math.max(s.peak, t.peak)).toBeLessThan(4)
  })

  for (const preset of manifest.presets ?? []) {
    it(`preset "${preset.name}" is finite and bounded`, () => {
      const r = renderEffect(factory, { params: presetParams(manifest, preset), input: sine(220, seconds, 0.5) })
      const s = stats(r.L)
      const t = stats(r.R)
      expect(s.nan || t.nan).toBe(false)
      expect(Math.max(s.peak, t.peak)).toBeLessThan(4)
    })
  }

  it('reset() and silence give silence', () => {
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as EffectDSP
    for (const [k, v] of Object.entries(defaultParams(manifest))) dsp.setParam(k, v)
    const a = new Float32Array(128).fill(0.5)
    const o = new Float32Array(128)
    const o2 = new Float32Array(128)
    for (let i = 0; i < 50; i++) dsp.process(a, a, o, o2, 0, 128)
    dsp.reset?.()
    const z = new Float32Array(128)
    let peak = 0
    for (let i = 0; i < 20; i++) {
      dsp.process(z, z, o, o2, 0, 128)
      for (let j = 0; j < 128; j++) peak = Math.max(peak, Math.abs(o[j]), Math.abs(o2[j]))
    }
    expect(peak).toBeLessThan(1e-3)
  })

  it('processes in place (aliased buffers) and with sub-block ranges', () => {
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as EffectDSP
    for (const [k, v] of Object.entries(defaultParams(manifest))) dsp.setParam(k, v)
    const src = sine(440, 0.2, 0.5)
    const L = src.L.slice(0, 128 * 40)
    const R = src.R.slice(0, 128 * 40)
    for (let b = 0; b < 40; b++) {
      const l = L.subarray(b * 128, b * 128 + 128)
      const r = R.subarray(b * 128, b * 128 + 128)
      dsp.process(l, r, l, r, 0, 37)
      dsp.process(l, r, l, r, 37, 128)
    }
    expect(stats(L).nan || stats(R).nan).toBe(false)
  })
}

/** mix = 0 must pass the dry signal (optionally delayed by `delay` samples). */
export function dryTest(factory: DSPFactory, manifest: PluginManifest, params: Record<string, number> = { mix: 0 }, tol = 1e-4, delay = 0): void {
  it('mix 0 ≈ input', () => {
    const input = testSignal(0.5)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), ...params }, input })
    expect(maxAbsDiff(r.L, input.L, 2048, delay)).toBeLessThan(tol)
    expect(maxAbsDiff(r.R, input.R, 2048, delay)).toBeLessThan(tol)
  })
}
