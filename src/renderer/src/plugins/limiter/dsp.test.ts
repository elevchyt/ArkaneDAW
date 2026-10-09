import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams, presetParams } from '../sdk/module'
import { renderEffect, sine, SR } from '../sdk/test-utils'
import { maxAbsDiff, standardTests, testSignal } from '../fx-common/suite'

function peakDb(x: Float32Array, from = 0): number {
  let p = 0
  for (let i = from; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return 20 * Math.log10(p)
}

describe('limiter', () => {
  standardTests(factory, manifest)

  it('never exceeds the ceiling, even with heavy drive and transients', () => {
    for (const la of [0.5, 2, 5]) {
      for (const ceiling of [-0.1, -3, -12]) {
        // loud sine + sharp clicks + noise
        const n = SR
        const L = new Float32Array(n), R = new Float32Array(n)
        let seed = 1
        for (let i = 0; i < n; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0
          const noise = (seed / 4294967296 - 0.5) * 0.6
          const click = i % 4801 === 0 ? 1.8 : 0
          L[i] = Math.sin(i * 0.05) * 0.9 + noise + click
          R[i] = Math.sin(i * 0.031) * 0.7 - noise - click
        }
        const r = renderEffect(factory, { params: { gain: 18, ceiling, release: 30, lookahead: la }, input: { L, R } })
        expect(peakDb(r.L)).toBeLessThanOrEqual(ceiling + 0.1)
        expect(peakDb(r.R)).toBeLessThanOrEqual(ceiling + 0.1)
      }
    }
  })

  it('is transparent (pure delay) below the ceiling', () => {
    const input = testSignal(0.5, 0.3)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), lookahead: 2 }, input })
    expect(maxAbsDiff(r.L, input.L, 2048, Math.round(0.002 * SR))).toBeLessThan(1e-5)
  })

  it('all presets respect their ceiling', () => {
    for (const pr of manifest.presets!) {
      const params = presetParams(manifest, pr)
      const r = renderEffect(factory, { params, input: sine(100, 1, 0.9) })
      expect(peakDb(r.L)).toBeLessThanOrEqual(params.ceiling + 0.1)
    }
  })
})
