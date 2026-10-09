import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { MODES, manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, SR } from '../sdk/test-utils'
import { Oversampler4x } from '../fx-common/dsp-util'
import { dryTest, rms, standardTests, testSignal } from '../fx-common/suite'

describe('saturation', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest, { mix: 0 }, 1e-4, Oversampler4x.LATENCY)
  for (let mode = 0; mode < MODES.length; mode++) {
    for (const drive of [0, 12, 30]) {
      it(`${MODES[mode]} @ ${drive} dB: auto-gain keeps RMS within 2 dB`, () => {
        const input = testSignal(1.5, 0.5)
        const r = renderEffect(factory, { params: { ...defaultParams(manifest), mode, drive, bias: 0.5, auto: 1 }, input })
        const a = rms(input.L, SR, Math.floor(1.5 * SR)) + rms(input.R, SR, Math.floor(1.5 * SR))
        const b = rms(r.L, SR, Math.floor(1.5 * SR)) + rms(r.R, SR, Math.floor(1.5 * SR))
        expect(Math.abs(20 * Math.log10(b / a))).toBeLessThan(2)
      })
    }
  }
})
