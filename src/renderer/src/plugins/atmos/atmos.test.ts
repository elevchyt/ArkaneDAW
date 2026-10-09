import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams, presetParams } from '../sdk/module'
import { SR, note, renderInstrument, stats, writeWav } from '../sdk/test-utils'
import type { InstrumentDSP, Preset } from '../sdk/types'

const CATEGORIES = ['Pads', 'Drones', 'Textures', 'Swells/Risers', 'Shimmer', 'Dark', 'Cinematic', 'Granular', 'Air/Noise', 'Choir-ish']
const BLOCK = 128

function make(params: Record<string, number>): InstrumentDSP {
  const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
  for (const k in params) dsp.setParam(k, params[k])
  return dsp
}

/** Upper bound for the audible tail after note-off: amp release + reverb RT60 + delay feedback tail + margin. */
function tailBound(p: Record<string, number>): number {
  const S = p['macro.space']
  const rt = p['fx.reverb'] > 0 ? p['fx.revDecay'] * Math.pow(2, (S - 0.5) * 1.6) : 0
  const dmix = Math.min(1, p['fx.delay'] * 2 * S)
  const dtail = dmix > 0 && p['fx.delayFb'] > 0.01 ? ((p['fx.delayTime'] / 1000) * Math.log(0.001)) / Math.log(p['fx.delayFb']) : 0
  return p['amp.release'] + rt + dtail + 3
}

/** Hold a chord for `hold` s, release, and render until the output stays below -60 dBFS for 0.5 s. */
function chordAndTail(p: Record<string, number>, hold = 4, maxTail = 90) {
  const dsp = make(p)
  const keys = [48, 55, 60, 64]
  keys.forEach((k, i) => dsp.noteOn(note(k, { id: i + 1, vel: 0.8 })))
  const L = new Float32Array(BLOCK)
  const R = new Float32Array(BLOCK)
  let peak = 0
  let sumSq = 0
  let nan = false
  const holdBlocks = Math.round((hold * SR) / BLOCK)
  for (let b = 0; b < holdBlocks; b++) {
    L.fill(0)
    R.fill(0)
    dsp.process(L, R, 0, BLOCK)
    for (let i = 0; i < BLOCK; i++) {
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]))
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nan = true
      if (a > peak) peak = a
      sumSq += L[i] * L[i]
    }
  }
  keys.forEach((k, i) => dsp.noteOff(i + 1, k, 0.5))
  const quietNeeded = Math.round((0.5 * SR) / BLOCK)
  let quiet = 0
  let t = 0
  let decayedAt = -1
  for (let b = 0; b < Math.round((maxTail * SR) / BLOCK); b++) {
    L.fill(0)
    R.fill(0)
    dsp.process(L, R, 0, BLOCK)
    let m = 0
    for (let i = 0; i < BLOCK; i++) {
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nan = true
      m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]))
    }
    if (m > peak) peak = m
    t += BLOCK / SR
    if (m < 0.001) {
      if (++quiet >= quietNeeded) {
        decayedAt = t - 0.5
        break
      }
    } else quiet = 0
  }
  return { peak, rms: Math.sqrt(sumSq / (holdBlocks * BLOCK)), nan, decayedAt }
}

describe('atmos presets', () => {
  const presets = manifest.presets!

  it('has 40+ presets covering every category', () => {
    expect(presets.length).toBeGreaterThanOrEqual(40)
    const counts: Record<string, number> = {}
    for (const p of presets) counts[p.category ?? '?'] = (counts[p.category ?? '?'] ?? 0) + 1
    for (const c of CATEGORIES) expect(counts[c] ?? 0, c).toBeGreaterThanOrEqual(4)
    const ids = new Set(manifest.params.map((p) => p.id))
    for (const p of presets) for (const k of Object.keys(p.params)) expect(ids.has(k), `${p.name}: ${k}`).toBe(true)
    expect(new Set(presets.map((p) => p.name)).size).toBe(presets.length)
  })

  it.each(presets.map((p) => [p.name, p] as [string, Preset]))('%s: chord is finite, audible, bounded and decays', (_n, preset) => {
    const p = presetParams(manifest, preset)
    const r = chordAndTail(p)
    expect(r.nan).toBe(false)
    expect(r.rms).toBeGreaterThan(0.004)
    expect(r.peak).toBeLessThan(1.5)
    expect(r.decayedAt, 'never decayed below -60 dB').toBeGreaterThan(0)
    expect(r.decayedAt).toBeLessThan(tailBound(p))
  })
})

describe('atmos engine', () => {
  it('freeze holds the reverb tail indefinitely without blowing up', () => {
    const p = { ...defaultParams(manifest), 'fx.reverb': 0.8, 'fx.freeze': 0, 'amp.attack': 0.05, 'amp.release': 0.3 }
    const dsp = make(p)
    const L = new Float32Array(BLOCK)
    const R = new Float32Array(BLOCK)
    dsp.noteOn(note(60, { id: 1 }))
    const run = (sec: number) => {
      let pk = 0
      for (let b = 0; b < (sec * SR) / BLOCK; b++) {
        L.fill(0)
        R.fill(0)
        dsp.process(L, R, 0, BLOCK)
        for (let i = 0; i < BLOCK; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]))
      }
      return pk
    }
    run(2)
    dsp.setParam('fx.freeze', 1)
    dsp.noteOff(1, 60, 0.5)
    run(2)
    const late = run(20)
    expect(Number.isFinite(late)).toBe(true)
    expect(late).toBeGreaterThan(0.005)
    expect(late).toBeLessThan(1.3)
    dsp.setParam('fx.freeze', 0)
    run(1)
  })

  it('max shimmer + longest decay stays stable', () => {
    const p = { ...defaultParams(manifest), 'fx.reverb': 1, 'fx.shimmer': 1, 'fx.revDecay': 40, 'macro.space': 1, 'fx.revDamp': 0, 'fx.shimInterval': 3 }
    const r = renderInstrument(factory, { params: p, notes: [48, 60, 67, 72].map((k) => ({ at: 0, dur: 3, note: note(k) })), seconds: 30 })
    const s = stats(r.L)
    expect(s.nan).toBe(false)
    expect(s.peak).toBeLessThan(1.25)
    // still bounded at the very end
    expect(stats(r.L.subarray(r.L.length - SR)).peak).toBeLessThan(1.25)
  })

  it('handles more notes than polyphony, extreme params and panic', () => {
    const p = { ...defaultParams(manifest), 'gran.on': 1, 'noise.on': 1, 'gran.density': 80, 'gran.size': 1000, 'noise.q': 300, 'noise.tune': 1, 'filter.mode': 5, 'filter.res': 1, 'wave.unison': 8, 'amp.attack': 0.001 }
    const notes = Array.from({ length: 24 }, (_, i) => ({ at: i * 0.05, dur: 2, note: note(30 + i * 3, { id: i + 1 }) }))
    const r = renderInstrument(factory, { params: p, notes, seconds: 3 })
    const s = stats(r.L)
    expect(s.nan).toBe(false)
    expect(s.peak).toBeLessThan(1.5)
    const dsp = make(p)
    dsp.noteOn(note(60, { id: 1 }))
    const L = new Float32Array(BLOCK)
    const R = new Float32Array(BLOCK)
    for (let b = 0; b < 50; b++) dsp.process(L, R, 0, BLOCK)
    dsp.allNotesOff(true)
    L.fill(0)
    R.fill(0)
    dsp.process(L, R, 0, BLOCK)
    expect(stats(L).peak).toBe(0)
  })

  it('every layer, filter mode and LFO destination renders finite audio', () => {
    for (let mode = 0; mode < 6; mode++)
      for (let dest = 0; dest < 8; dest++) {
        const p = { ...defaultParams(manifest), 'gran.on': 1, 'noise.on': 1, 'filter.mode': mode, 'lfo1.dest': dest, 'lfo1.depth': 1, 'lfo1.rate': 8, 'lfo1.shape': dest % 6, 'amp.attack': 0.05 }
        const r = renderInstrument(factory, { params: p, notes: [{ at: 0, dur: 0.5, note: note(57) }], seconds: 0.6 })
        const s = stats(r.R)
        expect(s.nan, `mode ${mode} dest ${dest}`).toBe(false)
        expect(s.peak, `mode ${mode} dest ${dest}`).toBeGreaterThan(0.001)
      }
  })

  it('is in tune', () => {
    const p = { ...defaultParams(manifest), 'wave.pos': 0, 'wave.unison': 1, 'filter.cutoff': 20000, 'filter.envAmt': 0, 'filter.keytrack': 0, 'fx.reverb': 0, 'fx.chorus': 0, 'fx.delay': 0, 'drift.amount': 0, 'macro.evolve': 0, 'lfo1.depth': 0, 'lfo2.depth': 0, 'amp.attack': 0.01 }
    const r = renderInstrument(factory, { params: p, notes: [{ at: 0, dur: 2, note: note(69) }], seconds: 2 })
    let zc = 0
    for (let i = SR; i < 2 * SR - 1; i++) if (r.L[i] <= 0 && r.L[i + 1] > 0) zc++
    expect(Math.abs(zc - 440)).toBeLessThanOrEqual(1)
  })

  it('writes WAVs for listening + spectral sanity', async () => {
    const pick = ['Northern Lights', 'Abyssal Drone', 'Glass Cathedral', 'Breathing Fog', 'Distant Choir', 'Aurora Riser', 'Solar Wind', 'Particle Cloud']
    const rows: string[] = []
    for (const name of pick) {
      const preset = manifest.presets!.find((p) => p.name === name)!
      const notes = [48, 55, 60, 64].map((k) => ({ at: 0, dur: 6, note: note(k) }))
      const r = renderInstrument(factory, { params: presetParams(manifest, preset), notes, seconds: 12 })
      await writeWav(`/tmp/atmos-${name.toLowerCase().replace(/\W+/g, '-')}.wav`, r)
      // stereo correlation and a crude brightness measure (zero-crossing rate)
      let lr = 0, ll = 0, rr = 0, zc = 0
      for (let i = SR; i < 6 * SR; i++) {
        lr += r.L[i] * r.R[i]
        ll += r.L[i] * r.L[i]
        rr += r.R[i] * r.R[i]
        if (r.L[i - 1] <= 0 && r.L[i] > 0) zc++
      }
      const corr = lr / Math.sqrt(ll * rr)
      rows.push(`${name.padEnd(18)} corr ${corr.toFixed(2)}  zcr ${(zc / 5).toFixed(0)}/s  rms ${Math.sqrt(ll / (5 * SR)).toFixed(3)}`)
      expect(corr).toBeLessThan(0.995) // genuinely stereo
    }
    console.log(rows.join('\n'))
  }, 60000)
})
