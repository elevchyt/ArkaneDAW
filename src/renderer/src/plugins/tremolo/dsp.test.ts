import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect } from '../sdk/test-utils'
import { dryTest, maxAbsDiff, standardTests, testSignal } from '../fx-common/suite'

describe('tremolo', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest, { depth: 0 })
  it('modulates the level', () => {
    const input = testSignal(0.5)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), depth: 1 }, input })
    expect(maxAbsDiff(r.L, input.L, 2000)).toBeGreaterThan(0.2)
  })
})
