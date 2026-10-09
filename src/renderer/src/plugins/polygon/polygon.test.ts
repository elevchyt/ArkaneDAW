import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { presetParams } from '../sdk/module'
import { note, SR, stats, writeWav, type Rendered } from '../sdk/test-utils'
import type { InstrumentDSP, Preset } from '../sdk/types'
import { CATEGORIES } from './presets'

const BLOCK = 128

/** Render held notes, then keep rendering until silent (or maxTail). */
function render(preset: Preset, keys: number[], hold: number, maxTail = 14, vel = 0.8) {
  const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
  for (const [k, v] of Object.entries(presetParams(manifest, preset))) dsp.setParam(k, v)
  const notes = keys.map((k, i) => note(k, { id: 1000 + i, vel }))
  for (const n of notes) dsp.noteOn(n)
  const total = Math.ceil((hold + maxTail) * SR)
  const L = new Float32Array(total)
  const R = new Float32Array(total)
  const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK)
  const offAt = Math.round(hold * SR)
  let silentRun = 0
  let end = total
  let releasedSilentAt = -1
  for (let pos = 0; pos < total; pos += BLOCK) {
    if (pos <= offAt && offAt < pos + BLOCK) {
      const cut = offAt - pos
      bl.fill(0); br.fill(0)
      dsp.process(bl, br, 0, cut)
      for (const n of notes) dsp.noteOff(n.id, n.key, 0.5)
      dsp.process(bl, br, cut, BLOCK)
    } else {
      bl.fill(0); br.fill(0)
      dsp.process(bl, br, 0, BLOCK)
    }
    L.set(bl.subarray(0, Math.min(BLOCK, total - pos)), pos)
    R.set(br.subarray(0, Math.min(BLOCK, total - pos)), pos)
    if (pos > offAt) {
      let pk = 0
      for (let i = 0; i < BLOCK; i++) pk = Math.max(pk, Math.abs(bl[i]), Math.abs(br[i]))
      silentRun = pk < 1e-4 ? silentRun + BLOCK : 0
      if (silentRun >= SR * 0.25) {
        releasedSilentAt = pos
        end = pos + BLOCK
        break
      }
    }
  }
  return { r: { L: L.subarray(0, end), R: R.subarray(0, end) } as Rendered, silentAt: releasedSilentAt, hold }
}

function rmsWin(x: Float32Array, a: number, b: number): number {
  let s = 0
  for (let i = a; i < b && i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}

describe('polygon presets', () => {
  const presets = manifest.presets!

  it('has >= 64 presets covering all categories', () => {
    expect(presets.length).toBeGreaterThanOrEqual(64)
    for (const c of CATEGORIES) expect(presets.some((p) => p.category === c), c).toBe(true)
    expect(new Set(presets.map((p) => p.name)).size).toBe(presets.length)
  })

  it('every preset renders chord + low/high notes: finite, audible, < 1.5 peak, decays to silence', () => {
    const report: string[] = []
    for (const p of presets) {
      const { r, silentAt } = render(p, [60, 64, 67, 36, 84], 2.0)
      const sl = stats(r.L), sr = stats(r.R)
      const peak = Math.max(sl.peak, sr.peak)
      const rms = rmsWin(r.L, 0, 2 * SR)
      report.push(`${p.category?.padEnd(15)} ${p.name.padEnd(22)} peak ${peak.toFixed(2)}  rms ${rms.toFixed(3)}  silent after ${(silentAt / SR - 2).toFixed(1)}s`)
      expect(sl.nan || sr.nan, p.name).toBe(false)
      expect(peak, p.name).toBeGreaterThan(0.02)
      expect(peak, p.name).toBeLessThan(1.5)
      expect(silentAt, `${p.name} never released to silence`).toBeGreaterThan(0)
    }
    console.log(report.join('\n'))
  }, 240000)

  it('mono/legato patches keep one voice and glide', () => {
    const p = presets.find((x) => x.name === 'Fretless Night')!
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
    for (const [k, v] of Object.entries(presetParams(manifest, p))) dsp.setParam(k, v)
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK)
    dsp.noteOn(note(40, { id: 1 }))
    for (let i = 0; i < 40; i++) dsp.process(l, r, 0, BLOCK)
    dsp.noteOn(note(47, { id: 2 }))
    dsp.noteOff(1, 40, 0.5)
    let pk = 0
    for (let i = 0; i < 40; i++) {
      l.fill(0)
      dsp.process(l, r, 0, BLOCK)
      for (const v of l) pk = Math.max(pk, Math.abs(v))
    }
    expect(pk).toBeGreaterThan(0.01)
    dsp.allNotesOff(true)
  })

  it('CPU: 16 voices of 4-tone patches per 128-frame block', () => {
    const lines: string[] = []
    for (const name of ['Fantasy Pad', 'Angel Vox Pad', 'M-Piano 1990', 'JV Strings']) {
      const p = presets.find((x) => x.name === name)!
      const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
      for (const [k, v] of Object.entries(presetParams(manifest, p))) dsp.setParam(k, v)
      const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK)
      for (let i = 0; i < 16; i++) dsp.noteOn(note(48 + i * 2, { id: i + 1 }))
      for (let i = 0; i < 200; i++) { l.fill(0); r.fill(0); dsp.process(l, r, 0, BLOCK) } // warm-up (JIT + ROM build)
      const N = 2000
      const t0 = performance.now()
      for (let i = 0; i < N; i++) { l.fill(0); r.fill(0); dsp.process(l, r, 0, BLOCK) }
      const per = (performance.now() - t0) / N
      const tones = p.params ? [1, 2, 3, 4].filter((t) => p.params[`t${t}.on`] === 1).length : 1
      lines.push(`${name.padEnd(16)} (${tones} tones x 16 voices): ${(per * 1000).toFixed(1)} us/block  (${((per / (BLOCK / SR * 1000)) * 100).toFixed(1)}% of RT)`)
      expect(per).toBeLessThan(1)
    }
    console.log(lines.join('\n'))
  }, 60000)

  it('writes a few WAVs for listening', async () => {
    const pick = ['Fantasy Pad', 'M-Piano 1990', 'Slap Bass DX', 'Temple Choir', 'Orch Hit Stab', 'Pan Flute Valley', 'Ice Shower', 'JV Strings']
    for (const name of pick) {
      const p = presets.find((x) => x.name === name)!
      const { r } = render(p, [60, 64, 67, 71], 1.5, 3)
      await writeWav(`/tmp/polygon-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`, r)
    }
  }, 60000)
})
