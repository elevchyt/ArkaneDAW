import { describe, expect, it } from 'vitest'
import { declickTimes, hasProcessing, processSample, processingKey } from './process'

const ch = (...v: number[]) => Float32Array.from(v)

describe('sampler precomputed effects', () => {
  it('returns the input untouched when nothing is enabled', () => {
    const src = [ch(0.1, 0.2)]
    expect(hasProcessing({})).toBe(false)
    expect(processSample(src, 44100, { normalize: 0 })).toBe(src)
  })

  it('normalizes to a peak of 1 without touching the original', () => {
    const src = [ch(0.25, -0.5), ch(0.1, 0.2)]
    const out = processSample(src, 44100, { normalize: 1 })
    expect(Array.from(out[0])).toEqual([0.5, -1])
    expect(out[1][0]).toBeCloseTo(0.2)
    expect(out[1][1]).toBeCloseTo(0.4)
    expect(Array.from(src[0])).toEqual([0.25, -0.5])
  })

  it('removes DC before normalizing, then reverses', () => {
    const out = processSample([ch(1.5, 0.5)], 44100, { removeDC: 1, normalize: 1, reverse: 1 })
    expect(Array.from(out[0])).toEqual([-1, 1])
  })

  it('flips polarity and swaps stereo', () => {
    const out = processSample([ch(0.5), ch(-0.25)], 44100, { polarity: 1, swapStereo: 1 })
    expect(Array.from(out[0])).toEqual([0.25])
    expect(Array.from(out[1])).toEqual([-0.5])
  })

  it('fades in and out over the given seconds', () => {
    const out = processSample([new Float32Array(8).fill(1)], 4, { fadeIn: 1, fadeOut: 1 }) // 4 frames each
    expect(Array.from(out[0])).toEqual([0, 0.25, 0.5, 0.75, 0.75, 0.5, 0.25, 0])
  })

  it('keys change only with the processing settings', () => {
    expect(processingKey({ normalize: 1, attack: 1 })).toBe(processingKey({ normalize: 1, attack: 2 }))
    expect(processingKey({ normalize: 1 })).not.toBe(processingKey({ normalize: 0 }))
  })

  it('declicking modes', () => {
    expect(declickTimes(0)).toEqual({ attack: 0, release: 0.01 })
    expect(declickTimes(4)).toEqual({ attack: 0, release: 0 })
    expect(declickTimes(99)).toEqual({ attack: 0, release: 0 })
  })
})
