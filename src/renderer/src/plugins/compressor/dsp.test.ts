import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, sine } from '../sdk/test-utils'
import { dryTest, rms, standardTests } from '../fx-common/suite'

describe('compressor', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)
  it('reduces level above threshold by roughly the ratio', () => {
    const input = sine(1000, 1, 0.5) // ~ -6 dBFS peak
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), threshold: -26, ratio: 4, knee: 0, auto: 0, detector: 0, attack: 1, release: 50 }, input })
    const outPeakDb = 20 * Math.log10(rms(r.L, 24000) * Math.SQRT2)
    // -6 dB in, 20 dB over threshold -> 5 dB over at 4:1 -> about -21 dB
    expect(outPeakDb).toBeGreaterThan(-23)
    expect(outPeakDb).toBeLessThan(-18)
  })
  it('side-chain input drives gain reduction', () => {
    const dsp = factory.create({ sampleRate: 48000, post: () => {} })
    for (const [k, v] of Object.entries({ ...defaultParams(manifest), sidechain: 1, threshold: -30, ratio: 20, auto: 0 })) dsp.setParam(k, v)
    const x = new Float32Array(128).fill(0.1)
    const sc = new Float32Array(128).fill(0.9)
    const oL = new Float32Array(128), oR = new Float32Array(128)
    for (let i = 0; i < 100; i++) (dsp as any).process(x, x, oL, oR, 0, 128, sc, sc)
    expect(oL[127]).toBeLessThan(0.02)
  })
})
