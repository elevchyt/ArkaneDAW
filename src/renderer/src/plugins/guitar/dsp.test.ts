import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { assignChord, chooseString } from './fretboard'
import { KS, TUNINGS, presets } from './manifest'
import { note, renderInstrument, stats, SR } from '../sdk/test-utils'

const STD = TUNINGS[0].strings
const rms = (x: Float32Array, a: number, b: number): number => {
  let s = 0
  for (let i = Math.floor(a * SR); i < Math.floor(b * SR); i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, Math.floor(b * SR) - Math.floor(a * SR)))
}
/** Autocorrelation pitch near f0 (parabolic interpolation). */
function pitch(x: Float32Array, at: number, f0: number): number {
  const from = Math.floor(at * SR)
  const len = 4096
  const ac = (L: number): number => {
    let c = 0
    for (let i = from; i < from + len; i++) c += x[i] * x[i + L]
    return c
  }
  const P = SR / f0
  let best = -Infinity
  let bestL = 0
  for (let L = Math.floor(P * 0.92); L <= Math.ceil(P * 1.08); L++) {
    const c = ac(L)
    if (c > best) {
      best = c
      bestL = L
    }
  }
  const a = ac(bestL - 1)
  const b = ac(bestL)
  const c = ac(bestL + 1)
  return SR / (bestL + (a - c) / (2 * (a - 2 * b + c)))
}
const cents = (f: number, key: number): number => 1200 * Math.log2(f / (440 * Math.pow(2, (key - 69) / 12)))
/** Phase of partial `f` (Hann-windowed DFT bin) in a 0.2 s window at `t`. */
function phase(x: Float32Array, t: number, f: number): number {
  const s = Math.floor(t * SR)
  const N = Math.floor(0.2 * SR)
  let re = 0
  let im = 0
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
    const a = (2 * Math.PI * f * (s + i)) / SR
    re += x[s + i] * w * Math.cos(a)
    im -= x[s + i] * w * Math.sin(a)
  }
  return Math.atan2(im, re)
}
/**
 * Offset in cents of the partial near `f` from its phase drift between `t` and `t + span` (exact for a decaying
 * partial, unlike autocorrelation, which a bright decaying tone pulls a few cents sharp).
 */
function partialCents(x: Float32Array, t: number, f: number, span = 0.3): number {
  let d = phase(x, t + span, f) - phase(x, t, f)
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return 1200 * Math.log2(1 + d / (2 * Math.PI * f * span))
}
const play = (params: Record<string, number>, notes: { at: number; dur: number; key: number; vel?: number }[], seconds: number) =>
  renderInstrument(factory, { params: { reverb: 0, human: 0, ...params }, notes: notes.map((n) => ({ at: n.at, dur: n.dur, note: note(n.key, { vel: n.vel ?? 0.8 }) })), seconds })

describe('fretboard', () => {
  it('voices open chords like a guitarist', () => {
    const out = new Int8Array(8)
    assignChord([40, 47, 52, 55, 59, 64], STD, 2, out) // E minor
    expect([...out.slice(0, 6)]).toEqual([0, 1, 2, 3, 4, 5])
    assignChord([48, 52, 55, 60, 64], STD, 2, out) // C major: x32010
    expect([...out.slice(0, 5)]).toEqual([1, 2, 3, 4, 5])
    assignChord([40, 47, 52], STD, 2, out) // E5 power chord: 022xxx
    expect([...out.slice(0, 3)]).toEqual([0, 1, 2])
  })

  it('keeps a stretch playable', () => {
    const out = new Int8Array(8)
    // A minor barre at the 5th fret: 577555
    const keys = [45, 52, 57, 60, 64, 69]
    assignChord(keys, STD, 5, out)
    const frets = keys.map((k, i) => k - STD[out[i]])
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4)
  })

  it('avoids cutting a held note', () => {
    const free = Array.from({ length: 6 }, () => ({ held: false, ringing: false }))
    const s = chooseString(59, STD, free, 0)
    const held = free.map((x, i) => ({ ...x, held: i === s }))
    expect(chooseString(59, STD, held, 0)).not.toBe(s)
  })
})

describe('Guitar DSP', () => {
  it('is in tune on every string and model', () => {
    for (const model of [0, 1, 2, 3, 4]) {
      for (const key of [...STD, 57, 76]) {
        const r = play({ model }, [{ at: 0, dur: 1, key }], 0.85)
        const c = partialCents(r.L, 0.25, 440 * Math.pow(2, (key - 69) / 12))
        expect(Math.abs(c), `model ${model} key ${key}: ${c.toFixed(2)} cents`).toBeLessThan(3)
      }
    }
  })

  it('renders every preset cleanly (chords, riffs, leads)', () => {
    for (const p of presets) {
      const notes = [
        ...[40, 47, 52, 55, 59, 64].map((key) => ({ at: 0, dur: 0.5, key })),
        ...[45, 52, 57].map((key) => ({ at: 0.5, dur: 0.4, key, vel: 1 })),
        { at: 1, dur: 0.3, key: 64 },
        { at: 1.2, dur: 0.3, key: 67 },
        { at: 1.4, dur: 0.6, key: 69 },
        // strummer presets only sound through the strum keys
        { at: 0.1, dur: 0.3, key: KS.STRUM_DOWN },
        { at: 0.6, dur: 0.3, key: KS.STRUM_UP }
      ]
      const r = play(p.params, notes, 2.4)
      const s = stats(r.L)
      expect(s.nan, p.name).toBe(false)
      expect(s.peak, p.name).toBeLessThan(1.3)
      expect(s.rms, p.name).toBeGreaterThan(0.005)
    }
  }, 30000)

  it('strums: a strummed chord builds up later than a struck one', () => {
    const chord = [40, 47, 52, 55, 59, 64].map((key) => ({ at: 0, dur: 1, key }))
    const off = play({ strum: 0 }, chord, 0.5)
    const down = play({ strum: 1, strumTime: 100 }, chord, 0.5)
    expect(rms(down.L, 0, 0.04)).toBeLessThan(rms(off.L, 0, 0.04) * 0.75)
    expect(rms(down.L, 0.15, 0.3)).toBeGreaterThan(rms(off.L, 0.15, 0.3) * 0.5)
  })

  it('palm mutes and dead notes are short; sustain rings', () => {
    const tail = (art: number) => {
      const r = play({ art }, [{ at: 0, dur: 1.5, key: 45 }], 1)
      return rms(r.L, 0.5, 0.9) / rms(r.L, 0, 0.1)
    }
    const sus = tail(0)
    expect(tail(1)).toBeLessThan(sus * 0.05)
    expect(tail(2)).toBeLessThan(sus * 0.01)
  })

  it('keyswitches change the articulation', () => {
    const plain = play({}, [{ at: 0, dur: 1.5, key: 45 }], 1)
    const ks = play({}, [{ at: 0, dur: 0.1, key: KS.PALM }, { at: 0.05, dur: 1.4, key: 45 }], 1)
    expect(rms(ks.L, 0.5, 0.9)).toBeLessThan(rms(plain.L, 0.5, 0.9) * 0.1)
  })

  it('one note per string: a new note on the same string cuts the old one', () => {
    // the same pitch twice can only be one string (low E open), so the first ring is stopped by the second pluck
    const r = play({}, [{ at: 0, dur: 2, key: 40 }, { at: 0.5, dur: 0.05, key: 40 }], 1.2)
    const tail = rms(r.L, 0.9, 1.1)
    const ring = play({}, [{ at: 0, dur: 2, key: 40 }], 1.2)
    expect(tail).toBeLessThan(rms(ring.L, 0.9, 1.1) * 0.5)
  })

  it('solo mode: hammer-ons and slides land on the new pitch without re-picking', () => {
    const r = play({ mode: 1, glide: 40 }, [{ at: 0, dur: 0.6, key: 57 }, { at: 0.5, dur: 0.8, key: 59 }], 1.2)
    expect(Math.abs(cents(pitch(r.L, 0.8, 440 * Math.pow(2, (59 - 69) / 12)), 59))).toBeLessThan(5)
    const s = play({ mode: 1, glide: 40 }, [{ at: 0, dur: 0.6, key: 57 }, { at: 0.5, dur: 0.8, key: 64 }], 1.2)
    expect(Math.abs(cents(pitch(s.L, 0.85, 440 * Math.pow(2, (64 - 69) / 12)), 64))).toBeLessThan(5)
  })

  it('strummer mode: chord keys are silent, strum keys play the chord', () => {
    const chord = [43, 47, 50, 55, 59, 67].map((key) => ({ at: 0, dur: 1, key }))
    const silent = play({ mode: 2 }, chord, 0.4)
    expect(stats(silent.L).peak).toBeLessThan(1e-4)
    const strum = play({ mode: 2 }, [...chord, { at: 0.1, dur: 0.3, key: KS.STRUM_DOWN }, { at: 0.5, dur: 0.3, key: KS.STRUM_UP }], 1)
    expect(rms(strum.L, 0.1, 0.4)).toBeGreaterThan(0.01)
    expect(rms(strum.L, 0.5, 0.8)).toBeGreaterThan(0.01)
  })

  it('hard all-notes-off silences immediately', () => {
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as ReturnType<typeof factory.create> & { allNotesOff(h: boolean): void; noteOn(n: unknown): void; process(l: Float32Array, r: Float32Array, a: number, b: number): void }
    const L = new Float32Array(128)
    const R = new Float32Array(128)
    dsp.noteOn(note(52))
    for (let i = 0; i < 40; i++) dsp.process(L, R, 0, 128)
    dsp.allNotesOff(true)
    L.fill(0)
    R.fill(0)
    dsp.process(L, R, 0, 128)
    expect(stats(L).peak).toBeLessThan(1e-3)
  })
})
