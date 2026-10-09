import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, sine } from '../sdk/test-utils'
import { dryTest, maxAbsDiff, standardTests } from '../fx-common/suite'

describe('bitcrusher', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)
  it('16 bits at full rate is nearly transparent', () => {
    const input = sine(440, 0.2, 0.5)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), bits: 16, rate: 48000 }, input })
    expect(maxAbsDiff(r.L, input.L, 100)).toBeLessThan(1 / 32768 + 1e-6)
  })
  it('4 bits quantises to 8 levels per polarity', () => {
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), bits: 4, rate: 48000 }, input: sine(440, 0.2, 0.9) })
    const vals = new Set(Array.from(r.L.slice(1000)).map((v) => Math.round(v * 1000)))
    expect(vals.size).toBeLessThanOrEqual(17)
  })
})
