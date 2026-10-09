import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, sine } from '../sdk/test-utils'
import { dryTest, rms, standardTests } from '../fx-common/suite'

describe('filter', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)
  it('low pass 24 dB at 500 Hz removes 5 kHz but keeps 100 Hz', () => {
    const p = { ...defaultParams(manifest), type: 0, slope: 1, cutoff: 500, res: 0 }
    const hi = renderEffect(factory, { params: p, input: sine(5000, 0.3, 0.5) })
    const lo = renderEffect(factory, { params: p, input: sine(100, 0.3, 0.5) })
    expect(rms(hi.L, 4800) / 0.3535).toBeLessThan(0.01)
    expect(rms(lo.L, 4800) / 0.3535).toBeGreaterThan(0.85)
  })
  it('high pass removes lows', () => {
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), type: 1, cutoff: 2000, res: 0 }, input: sine(100, 0.3, 0.5) })
    expect(rms(r.L, 4800) / 0.3535).toBeLessThan(0.01)
  })
  it('full resonance sweeping through a sine stays bounded', () => {
    for (const type of [0, 1, 2, 3]) {
      const r = renderEffect(factory, { params: { ...defaultParams(manifest), type, res: 1, drive: 24, lfoAmt: 1, lfoRate: 5 }, input: sine(220, 1, 0.5) })
      let peak = 0
      for (const v of r.L) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)) }
      expect(peak).toBeLessThan(4)
    }
  })
})
