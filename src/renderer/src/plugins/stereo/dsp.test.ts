import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, SR } from '../sdk/test-utils'
import { maxAbsDiff, rms, standardTests, testSignal } from '../fx-common/suite'

describe('stereo', () => {
  standardTests(factory, manifest)
  it('defaults are an exact pass-through', () => {
    const input = testSignal(0.3)
    const r = renderEffect(factory, { params: defaultParams(manifest), input })
    expect(maxAbsDiff(r.L, input.L)).toBeLessThan(1e-6)
    expect(maxAbsDiff(r.R, input.R)).toBeLessThan(1e-6)
  })
  it('width 0 = mono', () => {
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), width: 0 }, input: testSignal(0.3) })
    expect(maxAbsDiff(r.L, r.R)).toBeLessThan(1e-6)
  })
  it('swap swaps channels', () => {
    const input = testSignal(0.3)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), swap: 1 }, input })
    expect(maxAbsDiff(r.L, input.R)).toBeLessThan(1e-6)
  })
  it('mono bass removes low-frequency side content only', () => {
    const n = SR / 2
    const L = new Float32Array(n), R = new Float32Array(n)
    for (let i = 0; i < n; i++) { const lo = Math.sin(2 * Math.PI * 50 * i / SR) * 0.4; const hi = Math.sin(2 * Math.PI * 3000 * i / SR) * 0.4; L[i] = lo + hi; R[i] = -lo - hi }
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), monoBass: 200 }, input: { L, R } })
    // pure side signal: bass part removed, highs kept
    expect(rms(r.L, 4800)).toBeGreaterThan(0.25)
    expect(rms(r.L, 4800)).toBeLessThan(0.3)
  })
})
