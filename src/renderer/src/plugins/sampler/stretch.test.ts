import { describe, expect, it } from 'vitest'
import { resampleTo, stretchAndShift, timeStretch } from './stretch'

const SR = 44100
const sine = (hz: number, sec: number) => {
  const a = new Float32Array(Math.round(SR * sec))
  for (let i = 0; i < a.length; i++) a[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR)
  return a
}
/** Frequency from rising zero crossings in the middle half (skips the edges). */
const freq = (a: Float32Array) => {
  const s = Math.floor(a.length / 4)
  const e = Math.floor((a.length * 3) / 4)
  let n = 0
  for (let i = s + 1; i < e; i++) if (a[i - 1] < 0 && a[i] >= 0) n++
  return n / ((e - s) / SR)
}
const rms = (a: Float32Array) => Math.sqrt(a.reduce((m, v) => m + v * v, 0) / a.length)

describe('time stretching', () => {
  it('doubles the length and keeps the pitch', () => {
    const [out] = timeStretch([sine(440, 1)], SR, 2)
    expect(out.length).toBe(SR * 2)
    expect(freq(out)).toBeGreaterThan(430)
    expect(freq(out)).toBeLessThan(450)
    expect(rms(out.subarray(SR / 2, SR))).toBeGreaterThan(0.3) // no holes or cancellation
  })

  it('halves the length and keeps the pitch, on every channel', () => {
    const out = timeStretch([sine(220, 1), sine(220, 1)], SR, 0.5, 2)
    expect(out).toHaveLength(2)
    expect(out[1].length).toBe(SR / 2)
    expect(Math.abs(freq(out[1]) - 220)).toBeLessThan(10)
  })

  it('shifts pitch without changing the length', () => {
    const [out] = stretchAndShift([sine(440, 1)], SR, 1, 1200, 1)
    expect(out.length).toBe(SR)
    expect(Math.abs(freq(out) - 880)).toBeLessThan(15)
  })

  it('is a no-op at factor 1 / 0 cents', () => {
    const src = [sine(100, 0.1)]
    expect(stretchAndShift(src, SR, 1, 0, 1)).toBe(src)
  })

  it('resamples linearly', () => {
    expect(Array.from(resampleTo([Float32Array.from([0, 1])], 3)[0])).toEqual([0, 0.5, 1])
  })
})
