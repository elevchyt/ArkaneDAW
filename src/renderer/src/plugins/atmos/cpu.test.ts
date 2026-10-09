import { expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { presetParams } from '../sdk/module'
import { SR, note } from '../sdk/test-utils'
import type { InstrumentDSP } from '../sdk/types'

const BLOCK = 128

/** Average µs per 128-frame block with 8 sounding voices (+ all FX). */
function bench(params: Record<string, number>, voices = 8, blocks = 3000): number {
  const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
  for (const k in params) dsp.setParam(k, params[k])
  for (let v = 0; v < voices; v++) dsp.noteOn(note(45 + v * 3, { id: v + 1 }))
  const L = new Float32Array(BLOCK)
  const R = new Float32Array(BLOCK)
  for (let b = 0; b < 500; b++) dsp.process(L, R, 0, BLOCK) // warm-up / JIT
  const t0 = performance.now()
  for (let b = 0; b < blocks; b++) {
    L.fill(0)
    R.fill(0)
    dsp.process(L, R, 0, BLOCK)
  }
  return ((performance.now() - t0) / blocks) * 1000
}

it('CPU: 8 voices + FX per 128-frame block stays under ~1 ms', () => {
  const rows: [string, number][] = []
  for (const preset of manifest.presets!) rows.push([preset.name, bench(presetParams(manifest, preset), 8, 1500)])
  // worst case: every layer on, 8x unison, dense grains, tuned noise bank, formant filter, all FX
  const worst = {
    ...presetParams(manifest, manifest.presets![0]),
    'wave.unison': 8, 'wave.sub': 0.5, 'gran.on': 1, 'gran.density': 80, 'gran.size': 1000, 'noise.on': 1, 'noise.tune': 0.5,
    'filter.mode': 4, 'fx.drive': 0.3, 'fx.chorus': 0.5, 'fx.delay': 0.3, 'fx.reverb': 0.6, 'fx.shimmer': 0.5
  }
  const worstUs = bench(worst)
  rows.sort((a, b) => b[1] - a[1])
  const avg = rows.reduce((s, r) => s + r[1], 0) / rows.length
  console.log(
    `Atmos CPU (µs per 128-frame block, 8 voices + FX, node ${process.version}):\n` +
      `  worst-case all-layers: ${worstUs.toFixed(0)} µs\n  preset average: ${avg.toFixed(0)} µs\n` +
      rows.slice(0, 6).map(([n, us]) => `  ${n.padEnd(20)} ${us.toFixed(0)} µs`).join('\n') +
      `\n  (real-time budget per block @48k: ${((BLOCK / SR) * 1e6).toFixed(0)} µs)`
  )
  expect(worstUs).toBeLessThan(1500) // generous to avoid flakiness on loaded CI machines; typical ≈ 0.4 ms
  expect(avg).toBeLessThan(1000)
}, 120000)
