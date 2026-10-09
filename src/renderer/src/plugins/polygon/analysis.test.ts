// Offline analysis of rendered patches: loudness, brightness over time, click detection, DC, stereo width.
import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { presetParams } from '../sdk/module'
import { note, renderInstrument, SR } from '../sdk/test-utils'

function fftMag(x: Float32Array, start: number, n: number): Float64Array {
  const re = new Float64Array(n), im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n))
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) for (let j = 0; j < len / 2; j++) {
      const c = Math.cos(ang * j), s = Math.sin(ang * j)
      const a = i + j, b = a + len / 2
      const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
    }
  }
  const m = new Float64Array(n / 2)
  for (let k = 0; k < n / 2; k++) m[k] = Math.hypot(re[k], im[k])
  return m
}

export function analyse(L: Float32Array, R: Float32Array) {
  const at = [0.02, 0.15, 0.5, 1.0, 1.4, 2.0, 3.0]
  const rows = at.map((t) => {
    const s = Math.round(t * SR)
    let e = 0
    for (let i = s; i < s + 2048 && i < L.length; i++) e += L[i] * L[i]
    const m = fftMag(L, s, 2048)
    let num = 0, den = 0
    for (let k = 1; k < m.length; k++) { num += k * m[k]; den += m[k] }
    return `${t}s:${Math.sqrt(e / 2048).toFixed(3)}/${den > 0 ? Math.round(((num / den) * SR) / 2048) : 0}Hz`
  })
  // clicks: second difference spikes vs local level
  let worst = 0
  for (let i = 2 + 480; i < L.length - 480; i += 1) {
    const d2 = Math.abs(L[i] - 2 * L[i - 1] + L[i - 2])
    if (d2 < 0.02) continue
    let loc = 0
    for (let j = i - 480; j < i + 480; j += 8) loc += Math.abs(L[j] - 2 * L[j - 1] + L[j - 2])
    loc /= 120
    worst = Math.max(worst, d2 / (loc + 1e-4))
  }
  let dc = 0, corr = 0, el = 0, er = 0
  for (let i = 0; i < L.length; i++) { dc += L[i]; corr += L[i] * R[i]; el += L[i] * L[i]; er += R[i] * R[i] }
  return `${rows.join(' ')} | click ${worst.toFixed(1)} | dc ${(dc / L.length).toExponential(1)} | LRcorr ${(corr / Math.sqrt(el * er + 1e-12)).toFixed(2)}`
}

describe('polygon analysis', () => {
  it('single-note C4 analysis of every preset', () => {
    const out: string[] = []
    for (const p of manifest.presets!) {
      const r = renderInstrument(factory, { params: presetParams(manifest, p), notes: [{ at: 0, dur: 1.5, note: note(60) }], seconds: 3.2 })
      out.push(`${p.name.padEnd(20)} ${analyse(r.L, r.R)}`)
    }
    console.log(out.join('\n'))
    expect(out.length).toBeGreaterThan(0)
  }, 120000)
})

/** Loudness proxy: max 100 ms RMS of the mid signal for one note (C4; C2 for basses). */
export function loudness(name: string): number {
  const p = manifest.presets!.find((x) => x.name === name)!
  const key = p.category === 'Bass' ? 36 : 60
  const r = renderInstrument(factory, { params: presetParams(manifest, p), notes: [{ at: 0, dur: 1.8, note: note(key) }], seconds: 2 })
  let best = 0
  const W = 4800
  for (let s = 0; s + W <= r.L.length; s += 2400) {
    let e = 0
    for (let i = s; i < s + W; i++) { const m = (r.L[i] + r.R[i]) * 0.5; e += m * m }
    best = Math.max(best, Math.sqrt(e / W))
  }
  return best
}

describe('polygon loudness', () => {
  it('reports per-preset loudness (target ~0.09)', () => {
    const rows = manifest.presets!.map((p) => [p.name, loudness(p.name)] as const)
    console.log(JSON.stringify(Object.fromEntries(rows.map(([n, l]) => [n, +(0.09 / l).toFixed(2)]))))
    const ls = rows.map((r) => r[1]).sort((a, b) => a - b)
    console.log(`loudness min ${ls[0].toFixed(3)} median ${ls[ls.length >> 1].toFixed(3)} max ${ls[ls.length - 1].toFixed(3)}`)
    // calibrated: every patch within roughly -9 dB .. +3 dB of the 0.08 target
    expect(ls[0]).toBeGreaterThan(0.03)
    expect(ls[ls.length - 1]).toBeLessThan(0.15)
  }, 120000)
})
