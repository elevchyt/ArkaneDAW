import { describe, expect, it } from 'vitest'
import { note, renderInstrument, SR } from '../sdk/test-utils'
import sampler from './dsp'

// 1 s of DC: every playing voice adds a constant, so the output level counts the voices
const sample = { sampleRate: SR, channels: [new Float32Array(SR).fill(0.25)] }
const level = (L: Float32Array, t: number): number => L[Math.round(t * SR)]

function play(cutSelf: number, notes: { at: number; dur: number; key: number }[]): Float32Array {
  return renderInstrument(sampler, {
    data: { sample },
    params: { cutSelf, pitchToKey: 0, release: 0.003 },
    notes: notes.map((n) => ({ at: n.at, dur: n.dur, note: note(n.key, { vel: 1 }) })),
    seconds: 0.6
  }).L
}

describe('sampler cut itself', () => {
  const twoHits = [
    { at: 0, dur: 0.05, key: 60 },
    { at: 0.2, dur: 0.05, key: 60 }
  ]

  it('off: one-shot hits overlap', () => {
    const L = play(0, twoHits)
    expect(level(L, 0.3)).toBeCloseTo(2 * level(L, 0.1), 3)
  })

  it('on: a new hit stops the previous one (with a short fade, no click)', () => {
    const L = play(1, twoHits)
    expect(level(L, 0.3)).toBeCloseTo(level(L, 0.1), 3)
    // fade: right after the second hit both voices still sound, the old one decaying
    const at = Math.round(0.201 * SR)
    expect(L[at]).toBeGreaterThan(level(L, 0.1) * 1.3)
    let jump = 0
    for (let i = Math.round(0.2 * SR) + 1; i < Math.round(0.21 * SR); i++) jump = Math.max(jump, Math.abs(L[i] - L[i - 1]))
    expect(jump).toBeLessThan(0.01)
  })

  it('on: notes starting together (a chord) all sound', () => {
    const L = play(1, [
      { at: 0, dur: 0.05, key: 60 },
      { at: 0, dur: 0.05, key: 64 }
    ])
    expect(level(L, 0.1)).toBeCloseTo(0.5, 3)
  })
})
