import { describe, expect, it } from 'vitest'
import factory, { type PianoDSP } from './dsp'
import { manifest, PATCH_PRESETS, POLYPHONY } from './manifest'
import { CATEGORIES, PATCHES } from './patches'
import { presetParams } from '../sdk/module'
import { note, stats, writeWav, SR } from '../sdk/test-utils'
import type { NoteOn } from '../sdk/types'
import { centroid, findPeak, spectrum } from '../mosaic/analysis'

const BLOCK = 128

type Ev = { t: number; on?: NoteOn; off?: NoteOn; param?: [string, number] }

interface Run {
  L: Float32Array
  R: Float32Array
  dsp: PianoDSP
  /** activeVoices() sampled at the requested probe times */
  probes: number[]
  /** process() time per 128-frame block (ms): mean, median, 99th percentile */
  avgMs: number
  medMs: number
  p99Ms: number
}

/** Offline render with note + param events at sample accuracy (block split at event times). */
function run(params: Record<string, number>, evs: Ev[], seconds: number, probeAt: number[] = [], timeFrom = Infinity): Run {
  const dsp = factory.create({ sampleRate: SR, post: () => {} }) as PianoDSP
  for (const [k, v] of Object.entries(params)) dsp.setParam(k, v)
  const n = Math.ceil(seconds * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const events = evs.map((e) => ({ ...e, s: Math.round(e.t * SR) })).sort((a, b) => a.s - b.s)
  const probes = probeAt.map((t) => Math.round(t * SR)).sort((a, b) => a - b)
  const probeOut: number[] = []
  const bl = new Float32Array(BLOCK)
  const br = new Float32Array(BLOCK)
  const times: number[] = []
  const t0 = Math.round(timeFrom * SR)
  for (let pos = 0; pos < n; pos += BLOCK) {
    bl.fill(0)
    br.fill(0)
    let i = 0
    const ts = pos >= t0 ? performance.now() : 0
    while (i < BLOCK) {
      while (events.length && events[0].s <= pos + i) {
        const e = events.shift()!
        if (e.on) dsp.noteOn(e.on)
        if (e.off) dsp.noteOff(e.off.id, e.off.key, e.off.rel)
        if (e.param) dsp.setParam(e.param[0], e.param[1])
      }
      const next = events.length ? Math.min(BLOCK, events[0].s - pos) : BLOCK
      const end = Math.min(BLOCK, Math.max(i + 1, next))
      dsp.process(bl, br, i, end)
      i = end
    }
    if (pos >= t0) {
      times.push(performance.now() - ts)
    }
    while (probes.length && probes[0] < pos + BLOCK) {
      probes.shift()
      probeOut.push(dsp.activeVoices())
    }
    L.set(bl.subarray(0, Math.min(BLOCK, n - pos)), pos)
    R.set(br.subarray(0, Math.min(BLOCK, n - pos)), pos)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const q = (x: number) => sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))] ?? 0
  const avgMs = times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0
  return { L, R, dsp, probes: probeOut, avgMs, medMs: q(0.5), p99Ms: q(0.99) }
}

const play = (key: number, at: number, dur: number, vel = 0.8, extra: Partial<NoteOn> = {}): Ev[] => {
  const nt = note(key, { vel, ...extra })
  return [{ t: at, on: nt }, { t: at + dur, off: nt }]
}

const patchParams = (i: number, over: Record<string, number> = {}) => ({ ...presetParams(manifest, PATCH_PRESETS[i]), ...over })

function windowRms(x: Float32Array, t0: number, t1: number): number {
  let s = 0
  const a = Math.round(t0 * SR)
  const b = Math.min(x.length, Math.round(t1 * SR))
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}

function windowPeak(x: Float32Array, t0: number, t1: number): number {
  let p = 0
  for (let i = Math.round(t0 * SR); i < Math.min(x.length, Math.round(t1 * SR)); i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

const db = (x: number) => 20 * Math.log10(Math.max(1e-12, x))
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

describe('piano manifest', () => {
  it('has ≥15 patches, each a preset, all categories used', () => {
    expect(PATCHES.length).toBeGreaterThanOrEqual(15)
    expect(manifest.presets?.length).toBe(PATCHES.length)
    for (const c of CATEGORIES) expect(PATCHES.some((p) => p.category === c)).toBe(true)
    const ids = new Set(manifest.params.map((p) => p.id))
    for (const p of PATCHES) for (const k of Object.keys(p.knobs)) expect(ids.has(k), `${p.name}: ${k}`).toBe(true)
    expect(manifest.id).toBe('piano')
    expect(factory.id).toBe('piano')
  })
})

describe('piano patches', () => {
  // chord, then lowest and highest key, then everything released
  const evs: Ev[] = [
    ...[60, 64, 67, 72].flatMap((k) => play(k, 0, 1.6, 0.85)),
    ...play(21, 1.9, 1.2, 0.8),
    ...play(108, 3.2, 0.8, 0.8)
  ]
  const lastOff = 4.0
  PATCHES.forEach((pm, i) => {
    it(`${pm.name}: renders finite, audible, below clip; releases to silence`, async () => {
      const size = presetParams(manifest, PATCH_PRESETS[i]).revSize
      const tail = 3.5 + (0.4 + 6.5 * size * size) * 1.2
      const seconds = lastOff + tail
      const r = run(patchParams(i), evs, seconds, [lastOff + tail - 0.05])
      await writeWav(`/tmp/piano-${slug(pm.name)}.wav`, { L: r.L.subarray(0, Math.round(Math.min(seconds, 7) * SR)), R: r.R.subarray(0, Math.round(Math.min(seconds, 7) * SR)) })
      const sl = stats(r.L)
      const sr = stats(r.R)
      const chord = windowRms(r.L, 0.05, 1.5)
      const low = windowRms(r.L, 1.95, 3.0)
      const high = windowRms(r.L, 3.2, 3.6)
      const end = windowPeak(r.L, seconds - 0.5, seconds) + windowPeak(r.R, seconds - 0.5, seconds)
      console.log(
        `${pm.name.padEnd(16)} peak ${sl.peak.toFixed(3)}/${sr.peak.toFixed(3)}  chord ${db(chord).toFixed(1)} dB  low ${db(low).toFixed(1)} dB  high ${db(high).toFixed(1)} dB  tail ${db(end).toFixed(0)} dB  voices@end ${r.probes[0]}`
      )
      expect(sl.nan || sr.nan).toBe(false)
      expect(sl.peak).toBeLessThan(1.5)
      expect(sr.peak).toBeLessThan(1.5)
      expect(chord).toBeGreaterThan(0.01)
      expect(low).toBeGreaterThan(0.003)
      expect(high).toBeGreaterThan(0.001)
      expect(end).toBeLessThan(2e-3)
      expect(r.probes[0]).toBe(0)
    })
  })
})

describe('sustain pedal', () => {
  const dry = (o: Record<string, number> = {}) => patchParams(0, { rev: 0, chorus: 0, ...o })

  it('holds notes after note-off and releases them (with damper noise) when lifted', async () => {
    const evs: Ev[] = [{ t: 0, param: ['sustain', 1] }, ...play(60, 0.05, 0.3), ...play(64, 0.05, 0.3), { t: 1.5, param: ['sustain', 0] }]
    const ped = run(dry(), evs, 4, [1.0, 1.45, 3.9])
    const nop = run(dry(), [...play(60, 0.05, 0.3), ...play(64, 0.05, 0.3)], 4, [1.0])
    await writeWav('/tmp/piano-pedal.wav', { L: Float32Array.from([...ped.L, ...nop.L]), R: Float32Array.from([...ped.R, ...nop.R]) })
    const held = windowRms(ped.L, 1.0, 1.4)
    const damped = windowRms(nop.L, 1.0, 1.4)
    const after = windowRms(ped.L, 3.2, 3.9)
    console.log(`pedal: held ${db(held).toFixed(1)} dB vs no pedal ${db(damped).toFixed(1)} dB; after lift ${db(after).toFixed(1)} dB; voices ${ped.probes.join(',')}`)
    expect(ped.probes[0]).toBe(2)
    expect(ped.probes[1]).toBe(2)
    expect(nop.probes[0]).toBe(0)
    expect(held).toBeGreaterThan(damped * 30)
    expect(after).toBeLessThan(held / 300)
    expect(ped.probes[2]).toBe(0)
  })

  it('pedal lift adds an audible damper/pedal noise even with no notes', () => {
    const quiet = run(dry({ mech: 0 }), [{ t: 0.1, param: ['sustain', 1] }, { t: 0.5, param: ['sustain', 0] }], 1)
    const noisy = run(dry({ mech: 1 }), [{ t: 0.1, param: ['sustain', 1] }, { t: 0.5, param: ['sustain', 0] }], 1)
    const q = stats(quiet.L).peak
    const nz = windowPeak(noisy.L, 0.5, 0.8)
    console.log(`pedal noise peak (mech 1): ${db(nz).toFixed(1)} dB; mech 0: ${q}`)
    expect(q).toBeLessThan(1e-9)
    expect(nz).toBeGreaterThan(0.002)
    expect(nz).toBeLessThan(0.3)
  })

  it('a note with modY > 0.75 acts as pedal-down (unless disabled)', () => {
    const evs = play(60, 0.05, 0.3, 0.8, { modY: 0.9 })
    const on = run(dry(), evs, 1.5, [1.0])
    const off = run(dry({ modyPedal: 0 }), evs, 1.5, [1.0])
    expect(on.probes[0]).toBe(1)
    expect(off.probes[0]).toBe(0)
    // the next pedal lift damps it
    const lifted = run(dry(), [...evs, { t: 0.6, param: ['sustain', 1] }, { t: 0.7, param: ['sustain', 0] }], 2.5, [2.4])
    expect(lifted.probes[0]).toBe(0)
  })
})

describe('expression', () => {
  it('velocity → louder and brighter on every patch', () => {
    for (let i = 0; i < PATCHES.length; i++) {
      const p = patchParams(i, { rev: 0, chorus: 0, pad: 0, trem: 0, tape: 0 })
      const soft = run(p, play(60, 0, 0.6, 0.25), 0.6)
      const hard = run(p, play(60, 0, 0.6, 1), 0.6)
      const rs = windowRms(soft.L, 0.01, 0.5)
      const rh = windowRms(hard.L, 0.01, 0.5)
      const cs = centroid(soft.L, 240, 8192, SR)
      const ch = centroid(hard.L, 240, 8192, SR)
      console.log(`${PATCHES[i].name.padEnd(16)} vel .25→1: +${db(rh / rs).toFixed(1)} dB, centroid ${cs.toFixed(0)} → ${ch.toFixed(0)} Hz`)
      expect(rh, PATCHES[i].name).toBeGreaterThan(rs * 2)
      expect(ch, PATCHES[i].name).toBeGreaterThan(cs * 1.1)
    }
  })

  it('Dynamics widens the velocity range', () => {
    const range = (dyn: number) => {
      const p = patchParams(0, { rev: 0, dyn })
      const s = windowRms(run(p, play(60, 0, 0.5, 0.3), 0.5).L, 0.01, 0.45)
      const h = windowRms(run(p, play(60, 0, 0.5, 1), 0.5).L, 0.01, 0.45)
      return db(h / s)
    }
    const lo = range(0)
    const hi = range(1)
    console.log(`dynamics 0: ${lo.toFixed(1)} dB, dynamics 1: ${hi.toFixed(1)} dB`)
    expect(hi).toBeGreaterThan(lo + 12)
  })

  it('Tuning param shifts A4', () => {
    const f = (tuning: number) => {
      const r = run(patchParams(0, { rev: 0, tuning, detune: 0 }), play(69, 0, 2, 0.7), 2)
      const size = 32768
      return findPeak(spectrum(r.L, 4800, size), SR, size, tuning, 0.04).f
    }
    const f432 = f(432)
    const f440 = f(440)
    const f448 = f(448)
    console.log(`A4: 432 → ${f432.toFixed(2)} Hz, 440 → ${f440.toFixed(2)} Hz, 448 → ${f448.toFixed(2)} Hz`)
    expect(Math.abs(f432 - 432)).toBeLessThan(0.8)
    expect(Math.abs(f440 - 440)).toBeLessThan(0.8)
    expect(Math.abs(f448 - 448)).toBeLessThan(0.8)
  })

  it('perspective flips the stereo image', () => {
    const bal = (persp: number) => {
      const r = run(patchParams(0, { rev: 0, width: 1, persp }), play(36, 0, 0.5, 0.8), 0.5)
      return db(windowRms(r.L, 0, 0.5) / windowRms(r.R, 0, 0.5))
    }
    const player = bal(0)
    const audience = bal(1)
    console.log(`low C: player L/R ${player.toFixed(1)} dB, audience ${audience.toFixed(1)} dB`)
    expect(player).toBeGreaterThan(2)
    expect(audience).toBeLessThan(-2)
  })
})

describe('polyphony & CPU', () => {
  it('caps at 64 voices with fade-out stealing (no NaN, no clip)', () => {
    const evs: Ev[] = []
    for (let i = 0; i < 100; i++) evs.push(...play(30 + ((i * 7) % 60), i * 0.01, 3, 0.9))
    const r = run(patchParams(0, { sustain: 1 }), evs, 1.5, [0.5, 1.2])
    const s = stats(r.L)
    console.log(`100 notes: voices ${r.probes.join(', ')}, peak ${s.peak.toFixed(3)}`)
    expect(s.nan).toBe(false)
    expect(s.peak).toBeLessThan(1.5)
    for (const v of r.probes) expect(v).toBeLessThanOrEqual(POLYPHONY + 16)
    expect(r.probes[1]).toBeLessThanOrEqual(POLYPHONY)
  })

  it('benchmark: 16 sustained notes + reverb per 128-frame block', { timeout: 60000 }, () => {
    const keys = [36, 40, 43, 48, 52, 55, 60, 64, 67, 71, 72, 76, 79, 83, 84, 88]
    const evs = keys.flatMap((k, i) => play(k, i * 0.002, 6, 0.8))
    const results: string[] = []
    for (const name of ['Concert Grand', 'Honky-Tonk', 'Tine EP', 'Toy Piano', 'Ambient Piano', 'Piano + Pad']) {
      const i = PATCHES.findIndex((p) => p.name === name)
      // warm up the JIT once, then measure 4 s of steady 16-voice sustain
      run(patchParams(i), evs, 2)
      const r = run(patchParams(i, { sustain: 1 }), evs, 4.5, [], 0.5)
      results.push(`${name}: median ${(r.medMs * 1000).toFixed(0)} µs, mean ${(r.avgMs * 1000).toFixed(0)} µs, p99 ${(r.p99Ms * 1000).toFixed(0)} µs`)
      expect(r.medMs).toBeLessThan(1)
    }
    console.log(`CPU per 128-frame block (budget 2667 µs @48k): ${results.join(' | ')}`)
  })
})

describe('Soul Rhodes', () => {
  const idx = PATCHES.findIndex((p) => p.name === 'Soul Rhodes')

  it('is an Electric patch and stays mellow: velocity mostly changes loudness', () => {
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(PATCHES[idx].category).toBe('Electric')
    const p = patchParams(idx, { rev: 0, chorus: 0, trem: 0, tape: 0 })
    const soft = run(p, play(60, 0, 0.6, 0.3), 0.6)
    const hard = run(p, play(60, 0, 0.6, 1), 0.6)
    const tine = run(patchParams(PATCHES.findIndex((x) => x.name === 'Tine EP'), { rev: 0, chorus: 0, trem: 0, tape: 0 }), play(60, 0, 0.6, 1), 0.6)
    const cs = centroid(soft.L, 240, 8192, SR)
    const ch = centroid(hard.L, 240, 8192, SR)
    const ct = centroid(tine.L, 240, 8192, SR)
    const loud = db(windowRms(hard.L, 0.01, 0.5) / windowRms(soft.L, 0.01, 0.5))
    console.log(`Soul Rhodes C4: vel .3→1 +${loud.toFixed(1)} dB, centroid ${cs.toFixed(0)} → ${ch.toFixed(0)} Hz (Tine EP @vel 1: ${ct.toFixed(0)} Hz)`)
    expect(loud).toBeGreaterThan(12)
    expect(ch / cs).toBeLessThan(1.35)
    expect(ch).toBeLessThan(ct * 0.85)
  })

  it('slow 4-chord soul progression → /tmp/piano-soul-rhodes.wav', async () => {
    // Dm9 – G13 – Cmaj9 – Am9 (C3–C5 voicings), gently strummed, 2.6 s per chord, then ring out
    const chords = [
      [50, 53, 57, 60, 64],
      [43, 53, 57, 59, 64],
      [48, 52, 55, 59, 62],
      [45, 55, 60, 64, 71]
    ]
    const len = 2.6
    const evs: Ev[] = []
    chords.forEach((c, i) =>
      c.forEach((k, j) => evs.push(...play(k, 0.1 + i * len + j * 0.018, len - 0.12, 0.5 + 0.08 * Math.sin(i * 2 + j) + (j === 0 ? 0.06 : 0))))
    )
    const seconds = 0.1 + chords.length * len + 2.5
    const r = run(patchParams(idx), evs, seconds, [seconds - 0.05])
    await writeWav('/tmp/piano-soul-rhodes.wav', r)
    const s = stats(r.L)
    const c = centroid(r.L, Math.round(5.5 * SR), 16384, SR)
    console.log(`Soul Rhodes progression: peak ${s.peak.toFixed(3)}, rms ${db(windowRms(r.L, 0.1, 10.5)).toFixed(1)} dB, centroid ${c.toFixed(0)} Hz`)
    expect(s.nan).toBe(false)
    expect(s.peak).toBeLessThan(1)
    expect(windowRms(r.L, 0.1, 10.5)).toBeGreaterThan(0.01)
    expect(c).toBeLessThan(900)
  })
})
