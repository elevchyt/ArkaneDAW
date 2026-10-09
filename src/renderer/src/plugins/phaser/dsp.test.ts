import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect } from '../sdk/test-utils'
import { dryTest, maxAbsDiff, standardTests, testSignal } from '../fx-common/suite'

describe('phaser', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)
  it('mix 100% actually changes the signal', () => {
    const input = testSignal(0.5)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), mix: 1 }, input })
    expect(maxAbsDiff(r.L, input.L, 4800)).toBeGreaterThan(0.05)
  })
})
