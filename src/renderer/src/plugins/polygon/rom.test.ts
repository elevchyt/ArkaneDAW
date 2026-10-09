import { describe, expect, it } from 'vitest'
import { WAVE_NAMES } from './waves'
import { getMultiByIndex, hasRecipe, multiCount } from './rom'

describe('polygon virtual ROM', () => {
  it('has a recipe for every wave', () => {
    for (const n of WAVE_NAMES) expect(hasRecipe(n), n).toBe(true)
  })

  it('generates finite, normalized multisamples with seamless loops', () => {
    const times: string[] = []
    let total = 0
    for (let wi = 0; wi < WAVE_NAMES.length; wi++) {
      const t0 = performance.now()
      let worst = 0
      for (let mi = 0; mi < multiCount(wi); mi++) {
        const ms = performance.now()
        const m = getMultiByIndex(wi, mi)
        worst = Math.max(worst, performance.now() - ms)
        let peak = 0
        let finite = true
        for (let i = 0; i < m.data.length; i++) {
          if (!Number.isFinite(m.data[i])) finite = false
          peak = Math.max(peak, Math.abs(m.data[i]))
        }
        expect(finite).toBe(true)
        expect(peak, WAVE_NAMES[wi]).toBeGreaterThan(0.05)
        expect(peak).toBeLessThanOrEqual(1)
        expect(m.data.length).toBe(m.loopEnd + 1)
        if (!m.oneShot) {
          expect(m.data[m.loopEnd]).toBe(m.data[m.loopStart])
          // loop seam: the jump from end-1 -> start should look like any other step
          const seam = Math.abs(m.data[m.loopStart] - m.data[m.loopEnd - 1])
          let maxStep = 0
          for (let i = m.loopStart + 1; i < m.loopEnd; i++) maxStep = Math.max(maxStep, Math.abs(m.data[i] - m.data[i - 1]))
          expect(seam, WAVE_NAMES[wi]).toBeLessThanOrEqual(maxStep * 1.01 + 1e-4)
        }
      }
      const dt = performance.now() - t0
      total += dt
      times.push(`${WAVE_NAMES[wi]}: ${dt.toFixed(1)}ms (worst multi ${worst.toFixed(1)}ms)`)
    }
    console.log(`ROM generation total ${total.toFixed(0)} ms\n` + times.join('\n'))
  }, 60000)
})
