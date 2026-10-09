import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { MODES, manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, sine, stats } from '../sdk/test-utils'
import { Oversampler4x } from '../fx-common/dsp-util'
import { dryTest, rms, standardTests } from '../fx-common/suite'

describe('distortion', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest, { mix: 0 }, 1e-4, Oversampler4x.LATENCY)
  for (let mode = 0; mode < MODES.length; mode++) {
    it(`${MODES[mode]}: max drive stays bounded and roughly level-matched`, () => {
      const input = sine(110, 0.5, 0.5)
      const r = renderEffect(factory, { params: { ...defaultParams(manifest), mode, drive: 48, tone: 20000 }, input })
      const s = stats(r.L)
      expect(s.nan).toBe(false)
      expect(s.peak).toBeLessThan(1.5)
      expect(rms(r.L, 4800)).toBeGreaterThan(0.03)
    })
  }
})
