import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { note, renderInstrument, stats } from '../sdk/test-utils'

describe('triosc', () => {
  it('renders audible, finite audio for a note', () => {
    const r = renderInstrument(factory, { params: defaultParams(manifest), notes: [{ at: 0, dur: 0.3, note: note(60) }], seconds: 0.6 })
    const s = stats(r.L)
    expect(s.nan).toBe(false)
    expect(s.peak).toBeGreaterThan(0.05)
    expect(s.peak).toBeLessThan(1.5)
  })
})
