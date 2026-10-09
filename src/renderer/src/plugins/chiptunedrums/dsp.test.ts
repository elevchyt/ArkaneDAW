import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams, presetParams } from '../sdk/module'
import { note, renderInstrument, stats } from '../sdk/test-utils'

describe('chiptunedrums', () => {
  it('ships kit patches', () => {
    expect(manifest.presets!.map((p) => p.name)).toEqual(expect.arrayContaining(['NES Kit', 'Game Boy Kit', 'Arcade Kit']))
  })
  it('every kit plays kick/snare/hat and stays in drum mode', () => {
    for (const preset of manifest.presets!) {
      for (const key of [36, 38, 42]) {
        const r = renderInstrument(factory, { params: { ...presetParams(manifest, preset), mode: 0 }, data: preset.data ?? manifest.defaultData, notes: [{ at: 0, dur: 0.1, note: note(key) }], seconds: 0.6 })
        const s = stats(r.L)
        expect(s.nan).toBe(false)
        expect(s.peak).toBeGreaterThan(0.01)
      }
    }
    expect(defaultParams(manifest).mode).toBe(1)
  })
})
