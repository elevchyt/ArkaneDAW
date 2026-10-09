import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest, T_HCUT24, T_PEAK } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, sine } from '../sdk/test-utils'
import { maxAbsDiff, rms, standardTests, testSignal } from '../fx-common/suite'

describe('parametric-eq', () => {
  standardTests(factory, manifest)
  it('is flat with all gains at 0 dB', () => {
    const input = testSignal(0.5)
    const r = renderEffect(factory, { params: defaultParams(manifest), input })
    expect(maxAbsDiff(r.L, input.L)).toBeLessThan(1e-6)
    expect(maxAbsDiff(r.R, input.R)).toBeLessThan(1e-6)
  })
  it('a +6 dB peak doubles a sine at its frequency', () => {
    const input = sine(1000, 0.5, 0.25)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), 'b4.type': T_PEAK, 'b4.freq': 1000, 'b4.gain': 6.0206 }, input })
    expect(rms(r.L, 12000) / rms(input.L, 12000)).toBeCloseTo(2, 1)
  })
  it('a 24 dB high cut at 1 kHz removes 8 kHz', () => {
    const input = sine(8000, 0.5, 0.5)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), 'b7.type': T_HCUT24, 'b7.freq': 1000, 'b7.q': 0.71 }, input })
    expect(rms(r.L, 12000) / rms(input.L, 12000)).toBeLessThan(0.01)
  })
})
