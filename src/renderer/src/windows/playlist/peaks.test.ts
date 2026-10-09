import { describe, expect, it } from 'vitest'
import { computePeaks, peakRange } from './peaks'

describe('peaks', () => {
  const n = 10000
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) l[i] = Math.sin(i / 50) * 0.5
  r[5000] = -0.9
  const p = computePeaks([l, r], 44100, 128, 8, 4)
  it('builds a pyramid', () => {
    expect(p.levels.length).toBe(4)
    expect(p.levels[0].min.length).toBe(Math.ceil(n / 128))
    expect(p.levels[1].block).toBe(1024)
  })
  it('finds extremes across channels and levels', () => {
    const [lo, hi] = peakRange(p, 0, n)
    expect(lo).toBeCloseTo(-0.9)
    expect(hi).toBeCloseTo(0.5, 2)
    const [lo2] = peakRange(p, 4990, 5010)
    expect(lo2).toBeCloseTo(-0.9)
    expect(peakRange(p, n + 10, n + 20)).toEqual([0, 0])
  })
})
