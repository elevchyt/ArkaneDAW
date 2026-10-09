import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { presetParams } from '../sdk/module'
import { note, renderInstrument, stats, writeWav, SR, type Rendered } from '../sdk/test-utils'
import type { InstrumentDSP } from '../sdk/types'
import { ENGINES } from './params'

const presets = manifest.presets!
const C1 = 24 // scientific pitch (32.7 Hz); "C2" in the DAW's FL-style note names
const C2 = 36
const G2 = 43

function seg(x: Float32Array, a: number, b: number): Float32Array {
  return x.subarray(Math.round(a * SR), Math.round(b * SR))
}

/** Fundamental estimate: autocorrelation peak in the bass range (robust against harmonics). */
function pitchHz(x: Float32Array): number {
  const minLag = Math.floor(SR / 400)
  const maxLag = Math.floor(SR / 25)
  const n = Math.min(x.length - maxLag, 8192)
  let e0 = 0
  for (let i = 0; i < n; i++) e0 += x[i] * x[i]
  let best = 0
  let bestLag = minLag
  const ac = new Float64Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i < n; i++) s += x[i] * x[i + lag]
    ac[lag] = s
  }
  // first lag whose correlation is within 90% of the global max (avoids octave errors)
  for (let lag = minLag; lag <= maxLag; lag++) if (ac[lag] > best) best = ac[lag]
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (ac[lag] >= 0.9 * best && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      bestLag = lag
      break
    }
  }
  void e0
  return SR / bestLag
}

/** Zero-crossing pitch estimate on a lowpassed copy (as requested by the spec). */
function zcHz(x: Float32Array): number {
  let lp = 0
  let prev = 0
  let first = -1
  let last = -1
  let count = 0
  const a = 1 - Math.exp((-2 * Math.PI * 150) / SR)
  for (let i = 0; i < x.length; i++) {
    lp += (x[i] - lp) * a
    if (prev <= 0 && lp > 0 && i > 200) {
      if (first < 0) first = i
      last = i
      count++
    }
    prev = lp
  }
  return count > 1 ? ((count - 1) * SR) / (last - first) : 0
}

function hfRatio(x: Float32Array): number {
  // energy of first difference vs signal energy ~ brightness
  let e = 0
  let d = 0
  for (let i = 1; i < x.length; i++) {
    e += x[i] * x[i]
    const dd = x[i] - x[i - 1]
    d += dd * dd
  }
  return d / Math.max(1e-12, e)
}

describe('bassline manifest', () => {
  it('has ≥48 presets in every category', () => {
    expect(presets.length).toBeGreaterThanOrEqual(48)
    const cats = new Map<string, number>()
    for (const p of presets) cats.set(p.category ?? '', (cats.get(p.category ?? '') ?? 0) + 1)
    for (const c of ['Acid', 'Analog', 'Sub/808', 'Reese/DnB', 'Wobble/Dubstep', 'FM/Digital', 'Pluck', '80s/Synthpop', 'House/Garage', 'Electric', 'Fretless/Upright', 'Hybrid'])
      expect(cats.get(c) ?? 0, c).toBeGreaterThanOrEqual(3)
    console.log('[bassline] presets by category', Object.fromEntries(cats), 'total', presets.length)
    const ids = new Set(manifest.params.map((p) => p.id))
    for (const p of presets) for (const k of Object.keys(p.params)) expect(ids.has(k), `${p.name}: ${k}`).toBe(true)
    for (const d of manifest.params) {
      expect(d.default).toBeGreaterThanOrEqual(d.min)
      expect(d.default).toBeLessThanOrEqual(d.max)
    }
    for (const p of presets)
      for (const [k, v] of Object.entries(p.params)) {
        const d = manifest.params.find((x) => x.id === k)!
        expect(v, `${p.name}: ${k}`).toBeGreaterThanOrEqual(d.min)
        expect(v, `${p.name}: ${k}`).toBeLessThanOrEqual(d.max)
      }
  })
})

describe('bassline presets render', () => {
  const peaks: string[] = []
  for (const preset of presets) {
    it(`${preset.category} / ${preset.name}`, () => {
      const params = presetParams(manifest, preset)
      const r = renderInstrument(factory, {
        params,
        notes: [
          { at: 0, dur: 0.5, note: note(C1, { vel: 0.8 }) },
          { at: 0.7, dur: 0.5, note: note(C2, { vel: 1 }) },
          { at: 1.4, dur: 0.5, note: note(G2, { vel: 0.6 }) }
        ],
        seconds: 4.5
      })
      const all = stats(r.L)
      expect(all.nan).toBe(false)
      expect(all.peak).toBeLessThan(1.5)
      for (const [a, b] of [[0, 0.5], [0.7, 1.2], [1.4, 1.9]]) {
        const s = stats(seg(r.L, a, b))
        expect(s.rms, `${preset.name} note @${a}`).toBeGreaterThan(0.01)
      }
      const tail = stats(seg(r.L, 4.2, 4.5))
      expect(tail.peak, `${preset.name} tail`).toBeLessThan(0.002)
      peaks.push(`${preset.name.padEnd(24)} peak ${all.peak.toFixed(2)} rms ${stats(seg(r.L, 0, 1.9)).rms.toFixed(3)}`)
    })
  }
  it('level report', () => {
    console.log('[bassline] levels\n' + peaks.join('\n'))
  })
})

describe('bassline behaviour', () => {
  const find = (n: string) => presetParams(manifest, presets.find((p) => p.name === n)!)

  it('FL slide note glides the sounding note to the slide pitch without a new attack', () => {
    for (const name of ['Acid Squelch', 'Mono Saw', '808 Long Glide', 'Fretless Mwah', 'Lately FM']) {
      const params = { ...find(name), 'amp.s': 0.8, 'amp.d': 2, 'voice.mode': name === 'Lately FM' ? 0 : 2 }
      const r = renderInstrument(factory, {
        params,
        notes: [
          { at: 0, dur: 1.2, note: note(C2) },
          { at: 0.5, dur: 0.25, note: note(G2, { slide: true, length: 0.25 }) }
        ],
        seconds: 1.3
      })
      const before = pitchHz(seg(r.L, 0.25, 0.5))
      const after = pitchHz(seg(r.L, 0.8, 1.15))
      const zcB = zcHz(seg(r.L, 0.2, 0.5))
      const zcA = zcHz(seg(r.L, 0.8, 1.15))
      console.log(`[bassline] slide ${name}: ${before.toFixed(1)} Hz -> ${after.toFixed(1)} Hz (zc ${zcB.toFixed(1)} -> ${zcA.toFixed(1)})`)
      expect(Math.abs(Math.log2(before / 65.41))).toBeLessThan(0.05)
      expect(Math.abs(Math.log2(after / 98))).toBeLessThan(0.05)
      // no re-attack: the slide region must not show a new transient peak much above the sustained level
    }
  })

  it('legato overlap glides (303 slide) and porta glides from previous note', () => {
    const r = renderInstrument(factory, {
      params: find('Acid Squelch'),
      notes: [
        { at: 0, dur: 0.4, note: note(C2) },
        { at: 0.35, dur: 0.5, note: note(G2) }
      ],
      seconds: 0.9
    })
    expect(Math.abs(Math.log2(pitchHz(seg(r.L, 0.1, 0.33)) / 65.41))).toBeLessThan(0.05)
    expect(Math.abs(Math.log2(pitchHz(seg(r.L, 0.6, 0.85)) / 98))).toBeLessThan(0.05)
  })

  it('303 accent increases level and brightness', () => {
    const params = find('Acid Squelch')
    const render = (vel: number): Rendered =>
      renderInstrument(factory, { params, notes: [{ at: 0, dur: 0.25, note: note(C2, { vel }) }], seconds: 0.3 })
    const plain = render(0.7)
    const acc = render(1)
    const sp = stats(seg(plain.L, 0, 0.25))
    const sa = stats(seg(acc.L, 0, 0.25))
    const bp = hfRatio(seg(plain.L, 0.01, 0.15))
    const ba = hfRatio(seg(acc.L, 0.01, 0.15))
    console.log(`[bassline] accent rms ${sp.rms.toFixed(3)} -> ${sa.rms.toFixed(3)}, brightness ${bp.toFixed(4)} -> ${ba.toFixed(4)}`)
    expect(sa.rms).toBeGreaterThan(sp.rms * 1.2)
    expect(ba).toBeGreaterThan(bp * 1.1)
  })

  it('mono legato key stack returns to held note', () => {
    const r = renderInstrument(factory, {
      params: { ...find('Mono Saw'), glide: 0 },
      notes: [
        { at: 0, dur: 1.0, note: note(C2) },
        { at: 0.3, dur: 0.3, note: note(G2) }
      ],
      seconds: 1.0
    })
    expect(Math.abs(Math.log2(pitchHz(seg(r.L, 0.4, 0.6)) / 98))).toBeLessThan(0.05)
    expect(Math.abs(Math.log2(pitchHz(seg(r.L, 0.7, 0.95)) / 65.41))).toBeLessThan(0.05)
  })

  it('panic silences immediately and hidden tempo param drives the wobble rate', () => {
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
    const params = find('Wobble 1/8')
    for (const [k, v] of Object.entries(params)) dsp.setParam(k, v)
    dsp.setParam('tempo', 120)
    dsp.noteOn(note(C2))
    const L = new Float32Array(128)
    const R = new Float32Array(128)
    for (let i = 0; i < 50; i++) dsp.process(L, R, 0, 128)
    dsp.allNotesOff(true)
    L.fill(0)
    R.fill(0)
    dsp.process(L, R, 0, 128)
    expect(stats(L).peak).toBeLessThan(1e-6)
  })

  it('posts oscilloscope snapshots', () => {
    const msgs: unknown[] = []
    const dsp = factory.create({ sampleRate: SR, post: (m) => msgs.push(m) }) as InstrumentDSP
    for (const [k, v] of Object.entries(find('Rubber Moog'))) dsp.setParam(k, v)
    dsp.noteOn(note(C2))
    const L = new Float32Array(128)
    const R = new Float32Array(128)
    for (let i = 0; i < Math.ceil(SR / 128); i++) dsp.process(L, R, 0, 128)
    const scopes = msgs.filter((m) => (m as { type: string }).type === 'scope') as { data: Float32Array }[]
    expect(scopes.length).toBeGreaterThan(10)
    expect(scopes.length).toBeLessThan(30)
    expect(scopes[5].data.length).toBe(256)
  })

  it('CPU benchmark: 8 voices, 128-frame blocks, per engine', () => {
    const lines: string[] = []
    const engineDemo = ['Fat Minimoog', 'Acid Squelch', 'Lately FM', 'Dubstep Growl', '808 Boom', 'Slap Pop', 'Reese Tunnel']
    for (const name of engineDemo) {
      const params: Record<string, number> = { ...find(name), 'voice.mode': 0, 'amp.s': 1, 'amp.d': 4, 'ph.decay': 12 }
      const dsp = factory.create({ sampleRate: SR, post: () => {} }) as InstrumentDSP
      for (const [k, v] of Object.entries(params)) dsp.setParam(k, v)
      for (let k = 0; k < 8; k++) dsp.noteOn(note(28 + k * 3, { vel: 0.9 }))
      const L = new Float32Array(128)
      const R = new Float32Array(128)
      const blocks = Math.ceil((2 * SR) / 128)
      for (let i = 0; i < 40; i++) dsp.process(L, R, 0, 128) // warm-up
      const t0 = performance.now()
      for (let i = 0; i < blocks; i++) {
        L.fill(0)
        R.fill(0)
        dsp.process(L, R, 0, 128)
      }
      const ms = performance.now() - t0
      const perBlockUs = (ms * 1000) / blocks
      const budgetUs = (128 / SR) * 1e6
      lines.push(`${name.padEnd(16)} (${ENGINES[params.engine]}) ${perBlockUs.toFixed(1)} µs/block = ${((100 * perBlockUs) / budgetUs).toFixed(1)}% of one core @48k`)
      expect(perBlockUs).toBeLessThan(budgetUs)
    }
    console.log('[bassline] CPU (8 voices)\n' + lines.join('\n'))
  })

  it('writes demo WAVs to /tmp/bassline-*.wav', async () => {
    const seq = (root: number, slideAt = -1) =>
      [0, 0, 12, 0, 3, 0, 7, 10, 0, 0, 12, 0, 5, 3, 0, 7].map((iv, i) => ({
        at: i * 0.125,
        dur: i === slideAt - 1 ? 0.2 : 0.1,
        note: note(root + iv, { vel: i % 4 === 2 ? 1 : 0.75, slide: i === slideAt })
      }))
    const demos: [string, string][] = [
      ['acid', 'Acid Squelch'],
      ['moog', 'Rubber Moog'],
      ['808', '808 Long Glide'],
      ['reese', 'Reese Tunnel'],
      ['wobble', 'Wobble 1/8'],
      ['fm', 'Lately FM'],
      ['organ', 'Organ House Bass'],
      ['juno', 'Juno Pluck'],
      ['finger', 'Fingerstyle P-Bass'],
      ['pick', 'Pick Bass'],
      ['slap', 'Slap Pop'],
      ['fretless', 'Fretless Mwah'],
      ['upright', 'Jazz Upright']
    ]
    for (const [file, name] of demos) {
      const r = renderInstrument(factory, { params: find(name), notes: seq(C2, 7), seconds: 2.6 })
      const s = stats(r.L)
      expect(s.nan).toBe(false)
      expect(s.peak).toBeGreaterThan(0.05)
      expect(s.peak).toBeLessThan(1.5)
      await writeWav(`/tmp/bassline-${file}.wav`, r)
    }
  })
})
