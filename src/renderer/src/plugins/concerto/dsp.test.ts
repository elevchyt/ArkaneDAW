import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { note, renderInstrument, stats, SR } from '../sdk/test-utils'
import type { InstrumentDSP, NoteOn } from '../sdk/types'
import { defaultParams } from '../sdk/module'
import factory, { pcmStore } from './dsp'
import { manifest, presets } from './manifest'
import { hasData, hasFfmpeg, instrumentIds, readInstrument, resolved } from './testkit'
import type { ConcertoStatus, ResolvedConcertoData } from './types'

const ok = hasData && hasFfmpeg
const DRY = { ...defaultParams(manifest), reverb: 0 }

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0
  from = Math.max(0, Math.floor(from))
  to = Math.min(x.length, Math.floor(to))
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

/** Normalised-autocorrelation f0 of x[from, from+4096) searched in [fmin, fmax]. */
function pitchAt(x: Float32Array, from: number, fmin: number, fmax: number): number {
  const W = 4096
  const s = Math.floor(from)
  let best = 0, bestLag = 0
  const lagMin = Math.floor(SR / fmax), lagMax = Math.ceil(SR / fmin)
  const corr = (lag: number): number => {
    let ab = 0, aa = 0, bb = 0
    for (let i = 0; i < W; i++) {
      const a = x[s + i], b = x[s + i + lag]
      ab += a * b
      aa += a * a
      bb += b * b
    }
    return ab / Math.sqrt(aa * bb + 1e-20)
  }
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const c = corr(lag)
    if (c > best) { best = c; bestLag = lag }
  }
  // parabolic refinement
  const a = corr(bestLag - 1), b = best, c = corr(bestLag + 1)
  const d = a - 2 * b + c
  return SR / (bestLag + (d !== 0 ? (0.5 * (a - c)) / d : 0))
}

const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

function mkDsp(data: ResolvedConcertoData, params: Record<string, number> = DRY, posts?: unknown[]): InstrumentDSP {
  const dsp = factory.create({ sampleRate: SR, post: (m) => posts?.push(m) }) as InstrumentDSP
  dsp.setData!(data)
  for (const [k, v] of Object.entries(params)) dsp.setParam(k, v)
  return dsp
}

/** Render with explicit events: [time s, 'on'|'off', NoteOn]. */
function renderEvents(dsp: InstrumentDSP, events: [number, 'on' | 'off', NoteOn][], seconds: number): { L: Float32Array; R: Float32Array } {
  const n = Math.ceil(seconds * SR)
  const L = new Float32Array(n), R = new Float32Array(n)
  const ev = events.map(([t, k, nn]) => ({ f: Math.round(t * SR), k, nn })).sort((a, b) => a.f - b.f)
  let e = 0
  for (let pos = 0; pos < n; ) {
    while (e < ev.length && ev[e].f <= pos) {
      const x = ev[e++]
      if (x.k === 'on') dsp.noteOn(x.nn)
      else dsp.noteOff(x.nn.id, x.nn.key, 0.5)
    }
    const end = Math.min(n, pos + 128, e < ev.length ? Math.max(pos + 1, ev[e].f) : n)
    dsp.process(L, R, pos, end)
    pos = end
  }
  return { L, R }
}

describe.skipIf(!ok)('Concerto DSP', () => {
  const data: Record<string, ResolvedConcertoData> = {}
  beforeAll(async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    for (const id of instrumentIds()) data[id] = await resolved([id])
  }, 300_000)
  afterAll(() => vi.restoreAllMocks())

  it('every instrument & articulation renders across its range: finite, non-silent, louder with velocity', () => {
    const failures: string[] = []
    let renders = 0
    for (const id of instrumentIds()) {
      const def = readInstrument(id)
      def.articulations.forEach((a, ai) => {
        const [lo, hi] = def.range
        const keys = [lo, Math.round((lo + hi) / 2), hi]
        for (const key of keys) {
          // sustains are measured over their body (some loud samples swell in slowly), one-shots from the attack
          const sus = a.kind === 'sustain'
          const [m0, m1] = sus ? [0.3, 1.1] : [0, 0.6]
          const levels = [0.25, 0.6, 1].map((vel) => {
            const r = renderInstrument(factory, { data: data[id], params: { ...DRY, art: ai }, seconds: sus ? 1.2 : 0.7, notes: [{ at: 0.01, dur: sus ? 1.1 : 0.5, note: note(key, { vel }) }] })
            renders++
            const s = stats(r.L), t = stats(r.R)
            if (s.nan || t.nan) failures.push(`${id}/${a.id}/${key} NaN`)
            if (s.peak > 2) failures.push(`${id}/${a.id}/${key} peak ${s.peak.toFixed(2)}`)
            return Math.hypot(rms(r.L, SR * m0, SR * m1), rms(r.R, SR * m0, SR * m1))
          })
          if (!(levels[0] > 2e-4)) failures.push(`${id}/${a.id}/${key} silent at low velocity (${levels[0].toExponential(2)})`)
          if (!(levels[1] > levels[0] * 1.2 && levels[2] > levels[1] * 1.2)) failures.push(`${id}/${a.id}/${key} not louder with velocity: ${levels.map((x) => x.toExponential(2)).join(' < ')}`)
        }
      })
    }
    console.log(`[concerto] ${renders} renders checked`)
    expect(failures).toEqual([])
  }, 300_000)

  it('rendering a long sustained note through many loop cycles has no clicks', () => {
    for (const id of ['violins', 'flute', 'choir', 'organ', 'cello']) {
      const r = renderInstrument(factory, { data: data[id], params: DRY, seconds: 9, notes: [{ at: 0, dur: 9, note: note(67, { vel: 0.8 }) }] })
      const x = r.L
      // second-difference spikes vs their local typical size (after the attack)
      let maxRatio = 0
      const blk = 2400
      for (let b = SR; b + blk < x.length - 2; b += blk) {
        let sum = 0, mx = 0
        for (let i = b; i < b + blk; i++) {
          const d2 = Math.abs(x[i + 1] - 2 * x[i] + x[i - 1])
          sum += d2
          if (d2 > mx) mx = d2
        }
        const avg = sum / blk
        if (avg > 1e-6) maxRatio = Math.max(maxRatio, mx / avg)
      }
      expect(stats(x).nan).toBe(false)
      expect(rms(x, SR * 7, SR * 9), id).toBeGreaterThan(rms(x, SR * 1, SR * 3) * 0.4) // keeps sustaining
      expect(maxRatio, id).toBeLessThan(40)
    }
  })

  it('keyswitch C0.. selects the articulation (and reports it); the param does too', () => {
    const posts: unknown[] = []
    const sus = renderEvents(mkDsp(data.violins), [[0, 'on', note(64, { id: 1, vel: 0.8 })], [1.8, 'off', note(64, { id: 1 })]], 2)
    const dsp = mkDsp(data.violins, DRY, posts)
    const n = note(64, { id: 2, vel: 0.8 })
    const ks = note(13, { id: 3 }) // C#0 = 2nd articulation (spiccato)
    const st = renderEvents(dsp, [[0, 'on', ks], [0.02, 'off', ks], [0.05, 'on', n], [1.8, 'off', n]], 2)
    expect(rms(st.L, 0, SR * 0.04)).toBe(0) // the keyswitch itself is silent
    const last = posts.filter((m) => (m as ConcertoStatus).type === 'status').pop() as ConcertoStatus
    expect(last.art).toBe(1)
    // spiccato dies away, the sustain keeps going
    expect(rms(st.L, SR * 1.2, SR * 1.7)).toBeLessThan(rms(sus.L, SR * 1.2, SR * 1.7) * 0.05)
    // pizzicato via the param
    const pz = renderInstrument(factory, { data: data.violins, params: { ...DRY, art: 2 }, seconds: 2, notes: [{ at: 0, dur: 1.8, note: note(64, { vel: 0.8 }) }] })
    expect(rms(pz.L, SR * 1.2, SR * 1.7)).toBeLessThan(rms(sus.L, SR * 1.2, SR * 1.7) * 0.1)
    // keyswitch keys never sound, even with no articulation there
    const none = renderInstrument(factory, { data: data.violins, params: DRY, seconds: 0.5, notes: [{ at: 0, dur: 0.4, note: note(16, { vel: 1 }) }] })
    expect(stats(none.L).peak).toBe(0)
  })

  it('legato: overlapping notes glide from one pitch to the other without a gap; release returns to the held note', () => {
    const params = { ...DRY, legato: 1, glide: 250 }
    const dsp = mkDsp(data.violin, params)
    const a = note(67, { id: 10, vel: 0.8 })
    const b = note(72, { id: 11, vel: 0.8 })
    const r = renderEvents(dsp, [[0, 'on', a], [1.0, 'on', b], [2.0, 'off', b], [3.0, 'off', a]], 3.6)
    const x = r.L
    const fA = midiHz(67), fB = midiHz(72)
    const p0 = pitchAt(x, SR * 0.6, 300, 700)
    const pMid = pitchAt(x, SR * 1.08, 300, 700)
    const pB = pitchAt(x, SR * 1.6, 300, 700)
    const pBack = pitchAt(x, SR * 2.6, 300, 700)
    expect(Math.abs(p0 / fA - 1)).toBeLessThan(0.03)
    expect(pMid).toBeGreaterThan(fA * 1.04) // on its way up …
    expect(pMid).toBeLessThan(fB * 0.97) // … not there yet
    expect(Math.abs(pB / fB - 1)).toBeLessThan(0.03)
    expect(Math.abs(pBack / fA - 1)).toBeLessThan(0.03) // returned to the held note
    // no dip in level across the transition
    const before = rms(x, SR * 0.7, SR * 0.95)
    for (let t = 1.0; t < 1.4; t += 0.05) expect(rms(x, SR * t, SR * (t + 0.05))).toBeGreaterThan(before * 0.35)
    // polyphonic mode: both notes sound together
    const poly = renderEvents(mkDsp(data.violin, DRY), [[0, 'on', note(67, { id: 20 })], [1.0, 'on', note(72, { id: 21 })]], 1.8)
    expect(rms(poly.L, SR * 1.4, SR * 1.7)).toBeGreaterThan(rms(x, SR * 1.4, SR * 1.7) * 1.15)
  })

  it('legato + glide: notes released during the legato crossfade still die out (no stuck sustain)', () => {
    // Baroque Trumpet solo preset: legato on, 70 ms glide. Short overlapping notes are released while the
    // new note is still fading in; the envelope used to keep re-attacking and hang near full level forever.
    const params = { ...DRY, legato: 1, glide: 70 }
    const dsp = mkDsp(data.trumpet, params)
    const ev: [number, 'on' | 'off', NoteOn][] = []
    const keys = [60, 62, 64, 65, 67]
    keys.forEach((k, i) => {
      const n = note(k, { id: 100 + i, vel: 0.8 })
      ev.push([i * 0.15, 'on', n], [i * 0.15 + 0.17, 'off', n])
    })
    const r = renderEvents(dsp, ev, 4)
    const playing = rms(r.L, SR * 0.2, SR * 0.6)
    expect(playing).toBeGreaterThan(1e-4)
    expect(rms(r.L, SR * 3.4, SR * 4)).toBeLessThan(playing * 0.01)
  })

  it('harpsichord: note-off damps the string and plays the jack release sample', () => {
    const held = renderInstrument(factory, { data: data.harpsichord, params: DRY, seconds: 1.6, notes: [{ at: 0, dur: 1.5, note: note(60, { vel: 0.8 }) }] })
    const short = renderInstrument(factory, { data: data.harpsichord, params: DRY, seconds: 1.6, notes: [{ at: 0, dur: 0.4, note: note(60, { vel: 0.8 }) }] })
    expect(rms(short.L, SR * 0.41, SR * 0.5)).toBeGreaterThan(1e-4) // release noise right after the key-up
    expect(rms(short.L, SR * 1.0, SR * 1.4)).toBeLessThan(rms(held.L, SR * 1.0, SR * 1.4) * 0.1)
  })

  it('layers: an ensemble preset plays every layer within its key split; seating moves the image', () => {
    const preset = presets.find((p) => p.name === 'Choir + Organ')!
    return resolved((preset.data as { layers: never[] }).layers).then((d) => {
      const both = renderInstrument(factory, { data: d, params: DRY, seconds: 1, notes: [{ at: 0, dur: 0.9, note: note(60, { vel: 0.8 }) }] })
      const choir = renderInstrument(factory, { data: data.choir, params: DRY, seconds: 1, notes: [{ at: 0, dur: 0.9, note: note(60, { vel: 0.8 }) }] })
      const diff = both.L.map((x, i) => x - choir.L[i])
      expect(rms(diff, SR * 0.3, SR * 0.8)).toBeGreaterThan(rms(choir.L, SR * 0.3, SR * 0.8) * 0.2) // the organ layer is there
      // below the choir split only the organ sounds
      const low = renderInstrument(factory, { data: d, params: DRY, seconds: 1, notes: [{ at: 0, dur: 0.9, note: note(30, { vel: 0.8 }) }] })
      expect(rms(low.L)).toBeGreaterThan(1e-4)
      // violins sit left, basses right
      const v = renderInstrument(factory, { data: data.violins, params: DRY, seconds: 0.8, notes: [{ at: 0, dur: 0.7, note: note(67) }] })
      expect(rms(v.L)).toBeGreaterThan(rms(v.R) * 1.3)
      const b = renderInstrument(factory, { data: data.bass, params: DRY, seconds: 0.8, notes: [{ at: 0, dur: 0.7, note: note(40) }] })
      expect(rms(b.R)).toBeGreaterThan(rms(b.L) * 1.3)
      const c = renderInstrument(factory, { data: data.violins, params: { ...DRY, seat: 1 }, seconds: 0.8, notes: [{ at: 0, dur: 0.7, note: note(67) }] })
      // centred: much less left-heavy than the orchestral seat (the recording itself leans slightly left)
      expect(rms(c.L) / rms(c.R)).toBeLessThan((rms(v.L) / rms(v.R)) * 0.75)
    })
  }, 120_000)

  it('expression, brightness, attack, vibrato, reverb and tuning behave', () => {
    const base = (p: Record<string, number>) => renderInstrument(factory, { data: data.violins, params: { ...DRY, ...p }, seconds: 1.5, notes: [{ at: 0, dur: 1, note: note(67, { vel: 0.8 }) }] })
    const ref = base({})
    expect(rms(base({ expr: 50 }).L, SR * 0.4, SR * 0.9)).toBeLessThan(rms(ref.L, SR * 0.4, SR * 0.9) * 0.4)
    expect(rms(base({ attack: 800 }).L, 0, SR * 0.1)).toBeLessThan(rms(ref.L, 0, SR * 0.1) * 0.3)
    const wet = base({ reverb: 60 })
    expect(rms(wet.L, SR * 1.2, SR * 1.5)).toBeGreaterThan(rms(ref.L, SR * 1.2, SR * 1.5) * 2)
    expect(stats(base({ bright: 20, vibrato: 100 }).L).nan).toBe(false)
    const f440 = pitchAt(base({}).L, SR * 0.6, 300, 600)
    const f415 = pitchAt(base({ pitch: 2 }).L, SR * 0.6, 300, 600)
    expect(f415 / f440).toBeGreaterThan(0.93)
    expect(f415 / f440).toBeLessThan(0.96)
  })

  it('a second instance plays from the shared PCM store; missing data is silent', () => {
    expect(pcmStore().size).toBeGreaterThan(500)
    const r = renderInstrument(factory, { data: { layers: data.harp.layers, defs: data.harp.defs }, params: DRY, seconds: 0.4, notes: [{ at: 0, dur: 0.3, note: note(60) }] })
    expect(rms(r.L)).toBeGreaterThan(1e-3)
    const s = renderInstrument(factory, { data: { layers: [{ inst: 'nope', lo: 0, hi: 127, gain: 0, transpose: 0 }], error: 'no-host' }, params: DRY, seconds: 0.3, notes: [{ at: 0, dur: 0.2, note: note(60) }] })
    expect(stats(s.L).peak).toBe(0)
  })

  it('allNotesOff(hard) silences immediately, including the hall', () => {
    const dsp = mkDsp(data.strings, { ...DRY, reverb: 60 })
    const L = new Float32Array(SR), R = new Float32Array(SR)
    for (const k of [48, 55, 60, 64]) dsp.noteOn(note(k, { id: k }))
    for (let p = 0; p < SR / 2; p += 128) dsp.process(L, R, p, p + 128)
    expect(rms(L, 0, SR / 2)).toBeGreaterThan(1e-3)
    dsp.allNotesOff(true)
    for (let p = SR / 2; p < SR; p += 128) dsp.process(L, R, p, Math.min(SR, p + 128))
    expect(stats(L.subarray(SR / 2 + 128)).peak).toBe(0)
  })

  it('benchmark: 64 voices (3-layer ensemble, chords, filter, vibrato, hall) render much faster than real time', async () => {
    const preset = presets.find((p) => p.name === 'Chamber Orchestra')!
    const d = await resolved((preset.data as { layers: never[] }).layers)
    const posts: unknown[] = []
    const dsp = mkDsp(d, { ...defaultParams(manifest), reverb: 35, size: 70, bright: 70, vibrato: 30, expr: 90 }, posts)
    const seconds = 10
    const n = SR * seconds
    const L = new Float32Array(n), R = new Float32Array(n)
    const chords = [[36, 43, 48, 52, 55, 60, 64, 67, 72, 76, 79, 84], [41, 48, 53, 57, 60, 65, 69, 72, 77, 81, 84, 89], [43, 50, 55, 59, 62, 67, 71, 74, 79, 83, 86, 91]]
    let id = 1
    const t0 = performance.now()
    let maxVoices = 0
    for (let pos = 0, c = 0; pos < n; pos += 128) {
      if (pos % (SR * 2) === 0) {
        for (const k of chords[c % 3]) dsp.noteOn(note(k, { id: id++, vel: 0.62 }))
        c++
      }
      dsp.process(L, R, pos, Math.min(n, pos + 128))
      if (pos % (SR / 4) === 0) dsp.process(L, R, 0, 0)
    }
    const ms = performance.now() - t0
    for (const m of posts) if ((m as ConcertoStatus).type === 'status') maxVoices = Math.max(maxVoices, (m as ConcertoStatus).voices)
    const factor = ms / 1000 / seconds
    console.log(`[concerto bench] ${seconds} s with up to ${maxVoices} voices + hall in ${ms.toFixed(0)} ms → ${(factor * 100).toFixed(1)}% of real time (one core)`)
    expect(stats(L).nan).toBe(false)
    expect(maxVoices).toBeGreaterThanOrEqual(48)
    expect(maxVoices).toBeLessThanOrEqual(64)
    expect(factor).toBeLessThan(0.3)
  }, 120_000)
})
