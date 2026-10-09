import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { renderEffect, SR } from '../sdk/test-utils'
import { divIndex } from '../fx-common/divisions'
import { dryTest, standardTests } from '../fx-common/suite'

function impulse(seconds: number) {
  const L = new Float32Array(Math.ceil(seconds * SR))
  L[0] = 1
  return { L, R: L.slice() }
}
function firstPeakAfter(x: Float32Array, from: number): number {
  let best = from, v = 0
  for (let i = from; i < x.length; i++) if (Math.abs(x[i]) > v + 1e-9) { v = Math.abs(x[i]); best = i; if (v > 0.05) break }
  return best
}

describe('delay', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)
  it('syncs to the tempo param (1/4 at 120 BPM = 500 ms)', () => {
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), mode: 0, sync: 1, div: divIndex('1/4'), tempo: 120, mix: 1, feedback: 0 }, input: impulse(1) })
    expect(Math.abs(firstPeakAfter(r.L, 10) - 0.5 * SR)).toBeLessThan(3)
  })
  it('uses ms time when sync is off', () => {
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), mode: 0, sync: 0, time: 100, mix: 1, feedback: 0 }, input: impulse(0.5) })
    expect(Math.abs(firstPeakAfter(r.L, 10) - 0.1 * SR)).toBeLessThan(3)
  })
  it('ping-pong alternates channels', () => {
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), mode: 1, sync: 0, time: 100, mix: 1, feedback: 0.5, lowcut: 20, highcut: 20000 }, input: impulse(0.5) })
    const t1 = Math.round(0.1 * SR), t2 = Math.round(0.2 * SR)
    const near = (x: Float32Array, t: number) => Math.max(...Array.from(x.subarray(t - 5, t + 5)).map(Math.abs))
    expect(near(r.L, t1)).toBeGreaterThan(0.1)
    expect(near(r.R, t1)).toBeLessThan(0.01)
    expect(near(r.R, t2)).toBeGreaterThan(0.05)
  })
  it('100% feedback stays bounded', () => {
    const L = new Float32Array(SR * 4)
    for (let i = 0; i < SR; i++) L[i] = Math.sin(i * 0.03) * 0.9
    const r = renderEffect(factory, { params: { ...defaultParams(manifest), feedback: 1, lowcut: 20, highcut: 20000, mix: 1 }, input: { L, R: L.slice() } })
    let peak = 0
    for (const v of r.L) peak = Math.max(peak, Math.abs(v))
    expect(peak).toBeLessThan(2)
  })
})
