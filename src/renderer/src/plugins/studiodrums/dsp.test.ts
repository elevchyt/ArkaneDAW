import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { note, renderInstrument, stats, SR } from '../sdk/test-utils'
import type { InstrumentDSP } from '../sdk/types'
import factory, { pcmStore } from './dsp'
import { GENRES } from './grooves'
import { defaultParams } from '../sdk/module'
import { manifest } from './manifest'
import { hasFfmpeg, hasKits, kitIds, readKit, resolvedKit } from './testkit'
import type { ResolvedDrumsData } from './types'

const ok = hasKits && hasFfmpeg
const DRY = { ...defaultParams(manifest), room: 0 }

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

/** Render a list of [time, key, velocity] hits. */
function hits(data: ResolvedDrumsData, list: [number, number, number][], seconds: number, params: Record<string, number> = DRY) {
  return renderInstrument(factory, { data, params, seconds, notes: list.map(([at, key, vel]) => ({ at, dur: 0.05, note: note(key, { vel }) })) })
}

describe.skipIf(!ok)('Studio Drums DSP', () => {
  const kits: Record<string, ResolvedDrumsData> = {}
  beforeAll(async () => {
    // deterministic round robins / micro-variation
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    for (const id of kitIds()) kits[id] = await resolvedKit(id)
  }, 120_000)
  afterAll(() => vi.restoreAllMocks())

  it('renders every key of every kit at several velocities: finite, audible, louder with velocity', () => {
    const failures: string[] = []
    for (const id of kitIds()) {
      const kit = readKit(id)
      for (const k of Object.keys(kit.keys).map(Number)) {
        const levels = [0.2, 0.55, 1].map((vel) => {
          const r = hits(kits[id], [[0, k, vel]], 0.5)
          const s = stats(r.L)
          const t = stats(r.R)
          if (s.nan || t.nan) failures.push(`${id}/${k} NaN`)
          if (s.peak > 4) failures.push(`${id}/${k} peak ${s.peak.toFixed(2)}`)
          return Math.max(rms(r.L), rms(r.R))
        })
        if (!(levels[0] > 1e-5)) failures.push(`${id}/${k} silent at low velocity`)
        if (!(levels[1] > levels[0] * 1.15 && levels[2] > levels[1] * 1.15)) failures.push(`${id}/${k} not louder with velocity: ${levels.map((x) => x.toExponential(2)).join(' < ')}`)
      }
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('choke: closed hat cuts a ringing open hat', () => {
    for (const id of ['studio', 'metal', 'bop', 'brushes']) {
      const open = hits(kits[id], [[0, 46, 1]], 2)
      const choked = hits(kits[id], [[0, 46, 1], [0.1, 42, 0.5]], 2)
      const a = rms(open.L, SR * 1.05, SR * 1.6) + rms(open.R, SR * 1.05, SR * 1.6)
      const b = rms(choked.L, SR * 1.05, SR * 1.6) + rms(choked.R, SR * 1.05, SR * 1.6)
      expect(a, id).toBeGreaterThan(1e-4)
      expect(b, id).toBeLessThan(a * 0.02)
    }
  })

  it('crash choke key stops the crash', () => {
    const ring = hits(kits.metal, [[0, 49, 1]], 2.5)
    const grab = hits(kits.metal, [[0, 49, 1], [0.3, 29, 0.8]], 2.5)
    expect(rms(grab.L, SR * 1.5, SR * 2.4)).toBeLessThan(rms(ring.L, SR * 1.5, SR * 2.4) * 0.05)
  })

  it('mute, level and decay strips work', () => {
    const base = rms(hits(kits.studio, [[0, 38, 0.9]], 0.6).L)
    expect(rms(hits(kits.studio, [[0, 38, 0.9]], 0.6, { ...DRY, 'snare.mute': 1 }).L)).toBe(0)
    const quieter = rms(hits(kits.studio, [[0, 38, 0.9]], 0.6, { ...DRY, 'snare.level': -12 }).L)
    expect(quieter / base).toBeGreaterThan(0.2)
    expect(quieter / base).toBeLessThan(0.3)
    const tail = (p: Record<string, number>) => rms(hits(kits.studio, [[0, 43, 1]], 1.5, p).L, SR * 0.6, SR * 1.4)
    expect(tail({ ...DRY, 'tom3.decay': 15 })).toBeLessThan(tail(DRY) * 0.1)
  })

  it('bus EQ, punch and room keep the output finite and change the sound', () => {
    const notes: [number, number, number][] = [[0, 36, 1], [0.25, 38, 1], [0.5, 42, 0.8], [0.75, 49, 1]]
    const dry = hits(kits.metal, notes, 1.5)
    const wet = hits(kits.metal, notes, 1.5, { ...DRY, room: 80, roomSize: 80, 'bus.kick.punch': 80, 'bus.snare.high': 6, 'bus.kick.low': 6 })
    expect(stats(wet.L).nan).toBe(false)
    const diff = wet.L.map((x, i) => x - dry.L[i])
    expect(rms(diff)).toBeGreaterThan(rms(dry.L) * 0.1)
    expect(stats(wet.L).peak).toBeLessThan(4)
  })

  it('a second instance plays from the shared PCM store without receiving PCM', () => {
    const def = kits.vintage.kitDef!
    expect(pcmStore().size).toBeGreaterThan(100)
    const r = hits({ kit: 'vintage', kitDef: def }, [[0, 36, 1]], 0.3)
    expect(rms(r.L)).toBeGreaterThan(1e-3)
  })

  it('is silent (and safe) without a kit definition', () => {
    const r = hits({ kit: 'nope', error: 'no-host' }, [[0, 36, 1], [0.1, 38, 1]], 0.3)
    expect(stats(r.L).peak).toBe(0)
  })

  it('groove preview plays, stops cleanly on grooveStop and after its loop count', () => {
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
    dsp.setData!(kits.studio)
    for (const [k, v] of Object.entries(DRY)) dsp.setParam(k, v)
    dsp.setParam('tempo', 120)
    const g = GENRES.find((x) => x.id === 'rock')!.grooves[1]
    const L = new Float32Array(SR * 6)
    const R = new Float32Array(SR * 6)
    const block = (from: number) => {
      for (let p = from; p < from + SR; p += 128) dsp.process(L, R, p, Math.min(p + 128, from + SR))
    }
    dsp.onMessage!({ type: 'groove', events: g.notes.map((n) => ({ t: n.t, k: n.k, v: n.v })), lengthTicks: g.length, loops: 8 })
    block(0)
    expect(rms(L, 0, SR)).toBeGreaterThan(1e-3)
    dsp.onMessage!({ type: 'grooveStop' })
    block(SR)
    // 30 ms fade: everything after 50 ms of the stop is silent (room is off)
    expect(stats(L.subarray(SR + SR * 0.05, SR * 2)).peak).toBe(0)
    // a single-loop preview stops by itself
    dsp.onMessage!({ type: 'groove', events: g.notes.map((n) => ({ t: n.t, k: n.k, v: n.v })), lengthTicks: g.length, loops: 1 })
    for (let s = 2; s < 6; s++) block(SR * s) // 1 bar at 120 BPM = 2 s, then it stops by itself
    expect(rms(L, SR * 2, SR * 4)).toBeGreaterThan(1e-3)
    expect(stats(L.subarray(SR * 4.1, SR * 6)).peak).toBe(0)
  })

  it('allNotesOff(hard) silences immediately, including a running preview', () => {
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
    dsp.setData!(kits.metal)
    dsp.setParam('room', 60)
    const g = GENRES.find((x) => x.id === 'metal')!.grooves[1]
    dsp.onMessage!({ type: 'groove', events: g.notes.map((n) => ({ t: n.t, k: n.k, v: n.v })), lengthTicks: g.length })
    const L = new Float32Array(SR)
    const R = new Float32Array(SR)
    for (let p = 0; p < SR / 2; p += 128) dsp.process(L, R, p, p + 128)
    dsp.allNotesOff(true)
    for (let p = SR / 2; p < SR; p += 128) dsp.process(L, R, p, Math.min(SR, p + 128))
    expect(stats(L.subarray(SR / 2 + 128)).peak).toBe(0)
  })

  it('benchmark: busy groove renders much faster than real time', () => {
    const g = GENRES.find((x) => x.id === 'metal')!.grooves.find((x) => x.name === 'Blast Beat')!
    const bars = 8
    const tempo = 200
    const secPerTick = 60 / (tempo * 96)
    const list: [number, number, number][] = []
    for (let b = 0; b < bars; b++) for (const n of g.notes) list.push([(b * g.length + n.t) * secPerTick, n.k, n.v / 127])
    const seconds = bars * g.length * secPerTick + 2
    const params = { ...defaultParams(manifest), room: 40, 'bus.kick.punch': 60, 'bus.snare.punch': 50, 'bus.snare.high': 3, humVel: 30, humTime: 5 }
    const t0 = performance.now()
    const r = hits(kits.metal, list, seconds, params)
    const ms = performance.now() - t0
    const factor = ms / 1000 / seconds
    console.log(`[studiodrums bench] ${list.length} hits, ${seconds.toFixed(1)} s of audio in ${ms.toFixed(0)} ms → ${(factor * 100).toFixed(1)}% of real time`)
    expect(stats(r.L).nan).toBe(false)
    expect(factor).toBeLessThan(0.25)
  })
})
