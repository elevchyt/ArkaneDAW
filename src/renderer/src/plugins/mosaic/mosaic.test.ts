import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { CATEGORIES } from './presets'
import { presetParams } from '../sdk/module'
import type { InstrumentDSP, Preset } from '../sdk/types'
import { note, renderInstrument, stats, writeWav, SR } from '../sdk/test-utils'
import { centroid } from './analysis'
import type { WSData } from './model'

const presets = manifest.presets ?? []
const BLOCK = 128

function create(preset: Preset, sr = SR): InstrumentDSP {
  const dsp = factory.create({ sampleRate: sr, post: () => {} }) as InstrumentDSP
  dsp.setData?.(preset.data)
  for (const [k, v] of Object.entries(presetParams(manifest, preset))) dsp.setParam(k, v)
  return dsp
}

/** Chord + low + high note held 1.5 s, then render until 0.3 s of silence (or a limit). */
function chordAndTail(preset: Preset) {
  const dsp = create(preset)
  const keys = [60, 64, 67, 36, 84]
  const notes = keys.map((k) => note(k, { vel: 0.8 }))
  const L = new Float32Array(BLOCK)
  const R = new Float32Array(BLOCK)
  const head = { L: new Float32Array(2 * SR), R: new Float32Array(2 * SR) }
  let pos = 0
  let quiet = 0
  let silentAt = -1
  const limit = 45 * SR
  notes.forEach((n) => dsp.noteOn(n))
  let released = false
  while (pos < limit) {
    if (!released && pos >= 1.5 * SR) {
      notes.forEach((n) => dsp.noteOff(n.id, n.key, 0.5))
      released = true
    }
    L.fill(0)
    R.fill(0)
    dsp.process(L, R, 0, BLOCK)
    if (pos < head.L.length) {
      head.L.set(L.subarray(0, Math.min(BLOCK, head.L.length - pos)), pos)
      head.R.set(R.subarray(0, Math.min(BLOCK, head.R.length - pos)), pos)
    }
    if (released) {
      let pk = 0
      for (let i = 0; i < BLOCK; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]))
      quiet = pk < 1e-3 ? quiet + BLOCK : 0
      if (quiet >= 0.3 * SR) {
        silentAt = pos / SR
        break
      }
    }
    pos += BLOCK
  }
  return { head, silentAt }
}

describe('mosaic presets', () => {
  it('has ≥ 80 presets across all Montage-style categories', () => {
    const byCat: Record<string, number> = {}
    for (const p of presets) byCat[p.category ?? '?'] = (byCat[p.category ?? '?'] ?? 0) + 1
    console.log(`presets: ${presets.length}`, byCat)
    expect(presets.length).toBeGreaterThanOrEqual(80)
    for (const c of CATEGORIES) expect(byCat[c] ?? 0).toBeGreaterThanOrEqual(4)
    expect(new Set(presets.map((p) => p.name)).size).toBe(presets.length)
  })

  for (const preset of presets) {
    it(`${preset.category} / ${preset.name}: chord renders cleanly and releases to silence`, () => {
      const { head, silentAt } = chordAndTail(preset)
      const sl = stats(head.L)
      const sr = stats(head.R)
      expect(sl.nan || sr.nan).toBe(false)
      expect(Math.max(sl.rms, sr.rms)).toBeGreaterThan(0.01)
      expect(Math.max(sl.peak, sr.peak)).toBeLessThan(1.5)
      expect(silentAt).toBeGreaterThan(0)
    })
  }
})

describe('mosaic engines', () => {
  it('organ drawbars change the spectrum', () => {
    const base = presets.find((p) => p.name === 'B3 Full Drawbars')!
    const withReg = (reg: string): Preset => {
      const d = structuredClone(base.data) as WSData
      for (let i = 0; i < 9; i++) d.parts[0].p[`db${i + 1}`] = Number(reg[i])
      d.parts[0].p.rotary = 0
      d.parts[0].p.drive = 0
      return { ...base, data: d, params: { ...base.params, 'rev.on': 0 } }
    }
    const render = (p: Preset) =>
      renderInstrument(factory, { params: presetParams(manifest, p), data: p.data, notes: [{ at: 0, dur: 1, note: note(57) }], seconds: 1 })
    const flute = render(withReg('008000000'))
    const full = render(withReg('888888888'))
    const c1 = centroid(flute.L, 4800, 16384, SR)
    const c2 = centroid(full.L, 4800, 16384, SR)
    console.log(`organ centroid: 8' only ${c1.toFixed(0)} Hz, full ${c2.toFixed(0)} Hz`)
    expect(c2).toBeGreaterThan(c1 * 2.5)
  })

  it('key splits route notes to the right part', () => {
    const p = presets.find((x) => x.name === 'Split Bass/Piano')!
    const only = (part: number) => {
      const d = structuredClone(p.data) as WSData
      d.parts.forEach((pt, i) => (pt.on = i === part))
      return d
    }
    const r = (part: number, key: number) =>
      stats(renderInstrument(factory, { params: { ...presetParams(manifest, p), 'rev.on': 0 }, data: only(part), notes: [{ at: 0, dur: 0.3, note: note(key) }], seconds: 0.3 }).L).peak
    expect(r(0, 40)).toBeGreaterThan(0.01) // bass plays low
    expect(r(0, 72)).toBeLessThan(1e-4) // bass silent high
    expect(r(1, 40)).toBeLessThan(1e-4) // piano silent low
    expect(r(1, 72)).toBeGreaterThan(0.01)
  })

  it('super knob morphs the sound (brighter + more reverb)', () => {
    const p = presets.find((x) => x.name === 'Warm Pad')!
    const render = (sv: number) =>
      renderInstrument(factory, { params: { ...presetParams(manifest, p), super: sv }, data: p.data, notes: [{ at: 0, dur: 2, note: note(48) }, { at: 0, dur: 2, note: note(55) }], seconds: 2 })
    const a = centroid(render(0).L, 48000, 32768, SR)
    const b = centroid(render(1).L, 48000, 32768, SR)
    console.log(`super knob centroid ${a.toFixed(0)} → ${b.toFixed(0)} Hz`)
    expect(b).toBeGreaterThan(a * 1.3)
  })

  it('writes demo WAVs per category', async () => {
    const prog = [
      [48, 55, 60, 64],
      [45, 52, 60, 64],
      [41, 53, 57, 60],
      [43, 50, 59, 62]
    ]
    const out: { L: number[]; R: number[] } = { L: [], R: [] }
    for (const cat of CATEGORIES) {
      for (const p of presets.filter((x) => x.category === cat).slice(0, 2)) {
        const notes = prog.flatMap((ch, i) => ch.map((k) => ({ at: i * 0.6, dur: 0.55, note: note(k + (cat === 'Bass' ? -12 : 0), { vel: 0.6 + 0.1 * (i % 3) }) })))
        notes.push({ at: 2.4, dur: 0.8, note: note(72, { vel: 0.8 }) })
        const r = renderInstrument(factory, { params: presetParams(manifest, p), data: p.data, notes, seconds: 3.6 })
        for (let i = 0; i < r.L.length; i++) {
          out.L.push(r.L[i])
          out.R.push(r.R[i])
        }
      }
    }
    await writeWav('/tmp/mosaic-demo.wav', { L: Float32Array.from(out.L), R: Float32Array.from(out.R) })
  })
})

describe('mosaic CPU', () => {
  const bench = (name: string, keys: number[], label: string) => {
    const p = presets.find((x) => x.name === name)!
    const dsp = create(p)
    const L = new Float32Array(BLOCK)
    const R = new Float32Array(BLOCK)
    keys.forEach((k, i) => dsp.noteOn(note(k, { id: 9000 + i, vel: 0.85 } as never)))
    // warm-up (JIT)
    for (let b = 0; b < 200; b++) dsp.process(L, R, 0, BLOCK)
    const blocks = 750 // 2 s
    const t0 = performance.now()
    for (let b = 0; b < blocks; b++) {
      L.fill(0)
      R.fill(0)
      dsp.process(L, R, 0, BLOCK)
    }
    const ms = (performance.now() - t0) / blocks
    console.log(`CPU ${label}: ${(ms * 1000).toFixed(0)} µs / 128-frame block (${((ms / ((BLOCK / SR) * 1000)) * 100).toFixed(1)}% of real time)`)
    return ms
  }
  const sixteen = [36, 40, 43, 48, 52, 55, 60, 64, 67, 72, 76, 79, 84, 88, 91, 96]

  it('16 piano voices + reverb under 1 ms per block', () => {
    const ms = bench('Concert Grand', sixteen, '16 piano voices + reverb')
    expect(ms).toBeLessThan(1)
  })
  it('other engines (informational)', () => {
    bench('B3 Full Drawbars', sixteen.slice(0, 10), 'organ 10 keys + rotary')
    bench('Super Saw Pad', sixteen, 'supersaw 16 voices x7 osc')
    bench('Lush Strings', sixteen, 'strings layer 16 notes (2 parts)')
    bench('Aah Choir', sixteen, 'choir 16 voices')
    bench('FM Bell', sixteen, 'FM 16 voices')
    bench('Nylon Guitar', sixteen, 'pluck 16 voices')
    bench('Piano + Strings', sixteen, 'piano+strings layer (3 parts) 16 notes')
  })
})
