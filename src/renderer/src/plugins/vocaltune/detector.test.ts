import { describe, expect, it } from 'vitest'
import { PitchDetector } from './detector'
import { SR } from '../sdk/test-utils'

function tone(freq: number, seconds: number, shape: 'sine' | 'saw', amp = 0.5, sr = SR): Float32Array {
  const n = Math.ceil(seconds * sr)
  const x = new Float32Array(n)
  let ph = 0
  for (let i = 0; i < n; i++) {
    x[i] = shape === 'sine' ? Math.sin(2 * Math.PI * ph) * amp : (2 * ph - 1) * amp
    ph += freq / sr
    if (ph >= 1) ph -= 1
  }
  return x
}

/** Median detected frequency over the second half of the signal (0 when mostly unvoiced). */
function detect(x: Float32Array, sr = SR): { freq: number; voicedRatio: number } {
  const d = new PitchDetector(sr)
  const fs: number[] = []
  let total = 0
  for (let i = 0; i < x.length; i++) {
    if (d.push(x[i]) && i > x.length / 2) {
      total++
      if (d.voiced) fs.push(d.freq)
    }
  }
  fs.sort((a, b) => a - b)
  return { freq: fs.length ? fs[fs.length >> 1] : 0, voicedRatio: total ? fs.length / total : 0 }
}

const cents = (a: number, b: number): number => 1200 * Math.log2(a / b)

describe('vocaltune pitch detector', () => {
  for (const shape of ['sine', 'saw'] as const) {
    for (const f of [65, 110, 196, 220, 261.63, 329.6, 440, 587.3, 880, 1100]) {
      it(`${shape} ${f} Hz within ±5 cents`, () => {
        const r = detect(tone(f, 0.4, shape))
        expect(r.voicedRatio).toBeGreaterThan(0.95)
        expect(Math.abs(cents(r.freq, f))).toBeLessThan(5)
      })
    }
  }

  it('works at 44.1 kHz too', () => {
    for (const f of [110, 261.63, 880]) {
      const r = detect(tone(f, 0.4, 'saw', 0.5, 44100), 44100)
      expect(Math.abs(cents(r.freq, f))).toBeLessThan(5)
    }
  })

  it('silence is unvoiced', () => {
    expect(detect(new Float32Array(SR / 2)).voicedRatio).toBe(0)
  })

  it('white noise is unvoiced', () => {
    const x = new Float32Array(SR)
    let s = 12345
    for (let i = 0; i < x.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      x[i] = (s / 4294967296 - 0.5) * 0.6
    }
    expect(detect(x).voicedRatio).toBeLessThan(0.05)
  })

  it('tracks a pitch change quickly (< 40 ms)', () => {
    const a = tone(220, 0.3, 'saw')
    const b = tone(330, 0.3, 'saw')
    const x = new Float32Array(a.length + b.length)
    x.set(a)
    x.set(b, a.length)
    const d = new PitchDetector(SR)
    let settledAt = -1
    for (let i = 0; i < x.length; i++) {
      if (d.push(x[i]) && i > a.length && settledAt < 0 && d.voiced && Math.abs(cents(d.freq, 330)) < 10) settledAt = i
    }
    expect(settledAt).toBeGreaterThan(0)
    expect((settledAt - a.length) / SR).toBeLessThan(0.04)
  })
})
