import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, SR, writeWav } from '../sdk/test-utils'
import { burstThenSilence, dryTest, rms, standardTests, testSignal } from '../fx-common/suite'

describe('reverb', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)

  for (const mode of [0, 1, 2]) {
    it(`mode ${mode}: tail decays after the input stops`, () => {
      const input = burstThenSilence(4, 0.3)
      const r = renderEffect(factory, { params: { ...defaultParams(manifest), mode, decay: 1, mix: 1 }, input })
      const early = rms(r.L, Math.floor(0.3 * SR), Math.floor(0.6 * SR))
      const late = rms(r.L, Math.floor(3.3 * SR), Math.floor(3.6 * SR))
      expect(early).toBeGreaterThan(0.01)
      expect(late).toBeLessThan(early * 1e-3)
    })
    it(`mode ${mode}: stable at maximum decay / size / damping`, () => {
      const input = burstThenSilence(6, 0.5, 0.9)
      const r = renderEffect(factory, { params: { ...defaultParams(manifest), mode, decay: 20, size: 1, damp: 20000, lowcut: 20, mix: 1 }, input })
      const a = rms(r.L, Math.floor(1.5 * SR), Math.floor(2.5 * SR))
      const b = rms(r.L, Math.floor(4.5 * SR), Math.floor(5.5 * SR))
      expect(Number.isFinite(b)).toBe(true)
      expect(b).toBeLessThan(a * 1.02)
      expect(b).toBeGreaterThan(a * 0.2) // still ringing (long decay)
    })
  }

  it('wet level is in a sensible range', () => {
    const input = testSignal(2, 0.5)
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), mix: 1 }, input })
    const ratio = rms(r.L, SR) / rms(input.L, SR)
    expect(ratio).toBeGreaterThan(0.2)
    expect(ratio).toBeLessThan(2)
  })

  it.skipIf(!process.env.WAV)('writes demo wavs', async () => {
    const n = 4 * SR
    const L = new Float32Array(n)
    for (let k = 0; k < 4; k++) for (let i = 0; i < 2000; i++) L[k * 12000 + i] = Math.sin(i * 0.06) * Math.exp(-i / 400) * 0.8
    for (const pr of manifest.presets!) {
      const r = renderEffect(factory, { params: { ...defaultParams(manifest), ...pr.params }, input: { L, R: L.slice() } })
      await writeWav(`/tmp/reverb-${pr.name.replace(/\W+/g, '_')}.wav`, r)
    }
  })
})
