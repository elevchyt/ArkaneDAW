import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, SR } from '../sdk/test-utils'
import { rms, standardTests } from '../fx-common/suite'

describe('gate', () => {
  standardTests(factory, manifest)
  it('passes loud signal and silences quiet signal', () => {
    const n = SR
    const L = new Float32Array(n)
    for (let i = 0; i < n; i++) L[i] = Math.sin(i * 0.05) * (i < n / 2 ? 0.5 : 0.001)
    const r = renderEffect(factory, { params: defaultParams(manifest), input: { L, R: L.slice() } })
    expect(rms(r.L, 2000, n / 2)).toBeGreaterThan(0.3)
    expect(rms(r.L, n / 2 + 0.2 * SR, n)).toBeLessThan(1e-5)
  })
  it('range 0 dB = no gating', () => {
    const n = SR / 2
    const L = new Float32Array(n)
    for (let i = 0; i < n; i++) L[i] = Math.sin(i * 0.05) * 0.001
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), range: 0 }, input: { L, R: L.slice() } })
    expect(Math.abs(rms(r.L, 1000) - rms(L, 1000))).toBeLessThan(1e-6)
  })
})
