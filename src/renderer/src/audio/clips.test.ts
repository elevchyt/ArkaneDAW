import { describe, expect, it } from 'vitest'
import { nearestZeroCross } from './clips'

describe('zero crossings', () => {
  const ramp = Float32Array.from([-3, -2, -1, 1, 2, 3, 2, 1, -1, -2])
  it('finds the nearest sign change', () => {
    expect(nearestZeroCross([ramp], 1, 5)).toBe(3)
    expect(nearestZeroCross([ramp], 7, 5)).toBe(8)
  })
  it('sums channels and gives up outside the radius', () => {
    expect(nearestZeroCross([ramp, ramp.map((v) => -v)], 4, 3)).toBe(4) // silent mix: already zero
    expect(nearestZeroCross([ramp], 5.4, 1)).toBe(5.4)
  })
})
