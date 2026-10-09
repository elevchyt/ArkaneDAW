import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, SR } from '../sdk/test-utils'
import { dryTest, maxAbsDiff, rms, standardTests, testSignal } from '../fx-common/suite'

function hits(): { L: Float32Array; R: Float32Array } {
  const n = SR
  const L = new Float32Array(n)
  for (let k = 0; k < 4; k++) for (let i = 0; i < 9000; i++) L[k * 12000 + i] = Math.sin(i * 0.02) * 0.6 * Math.exp(-i / 2500)
  return { L, R: L.slice() }
}

describe('transient', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)
  it('neutral settings are transparent', () => {
    const input = testSignal(0.3)
    const r = renderEffect(factory, { params: defaultParams(manifest), input })
    expect(maxAbsDiff(r.L, input.L)).toBeLessThan(1e-6)
  })
  it('attack + boosts the onset, sustain - shortens the tail', () => {
    const input = hits()
    const a = renderEffect(factory, { params: { ...defaultParams(manifest), attack: 100 }, input })
    expect(rms(a.L, 0, 400)).toBeGreaterThan(rms(input.L, 0, 400) * 1.2)
    const s = renderEffect(factory, { params: { ...defaultParams(manifest), sustain: -100 }, input })
    expect(rms(s.L, 5000, 9000)).toBeLessThan(rms(input.L, 5000, 9000) * 0.7)
  })
})
