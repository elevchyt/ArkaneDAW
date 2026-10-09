import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, sine } from '../sdk/test-utils'
import { dryTest, rms, standardTests } from '../fx-common/suite'

describe('multiband', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)
  it('crossovers sum flat when nothing compresses', () => {
    for (const f of [50, 200, 800, 2500, 8000]) {
      const r = renderEffect(factory, { params: { ...defaultParams(manifest), 'low.ratio': 1, 'mid.ratio': 1, 'high.ratio': 1 }, input: sine(f, 0.5, 0.3) })
      expect(rms(r.L, 12000) / (0.3 / Math.SQRT2)).toBeCloseTo(1, 1)
    }
  })
  it('compresses only the band that is over threshold', () => {
    const p = { ...defaultParams(manifest), 'low.thr': -40, 'low.ratio': 10, 'mid.thr': 0, 'high.thr': 0 }
    const lo = renderEffect(factory, { params: p, input: sine(60, 0.5, 0.5) })
    const hi = renderEffect(factory, { params: p, input: sine(6000, 0.5, 0.5) })
    expect(rms(lo.L, 12000)).toBeLessThan(0.1)
    expect(rms(hi.L, 12000)).toBeGreaterThan(0.3)
  })
})
