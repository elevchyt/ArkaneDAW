import { describe, expect, it } from 'vitest'
import factory, { HexaSynth } from './dsp'
import { FACTORY_PRESETS, manifest } from './manifest'
import { Env } from './engine'
import { envRateDoublingsPerSec } from './tables'
import { initVoice, opOff, O, voiceToParams } from './voice'
import { defaultParams, presetParams } from '../sdk/module'
import { SR, note, renderInstrument, stats, writeWav } from '../sdk/test-utils'

/** Magnitude of the DFT bin nearest to `freq` (Hann window). */
function mag(x: Float32Array, freq: number, sr = SR): number {
  let re = 0
  let im = 0
  const n = x.length
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    const a = (2 * Math.PI * freq * i) / sr
    re += x[i] * w * Math.cos(a)
    im -= x[i] * w * Math.sin(a)
  }
  return (Math.sqrt(re * re + im * im) * 4) / n
}

/** Voice params with only the listed operators audible (algorithm 32, no feedback). */
function additive(ratios: number[], fb = 0): Record<string, number> {
  const v = initVoice()
  v[134] = 31 // algorithm 32
  v[135] = fb
  for (let n = 1; n <= 6; n++) {
    const b = opOff(n)
    v[b + O.ol] = n <= ratios.length ? 99 : 0
    v[b + O.coarse] = ratios[n - 1] ?? 1
    v[b + O.l4] = 0
  }
  return { ...defaultParams(manifest), ...voiceToParams(v) }
}

describe('hexa presets', () => {
  it('ships at least 32 factory voices with DX-style names', () => {
    expect(FACTORY_PRESETS.length).toBeGreaterThanOrEqual(32)
    for (const p of FACTORY_PRESETS) expect(p.name.length).toBeLessThanOrEqual(10)
    expect(new Set(FACTORY_PRESETS.map((p) => p.name)).size).toBe(FACTORY_PRESETS.length)
  })

  for (const preset of FACTORY_PRESETS) {
    it(`${preset.name}: C2/C4/C6 + chord are finite, audible, bounded and release to silence`, () => {
      const params = presetParams(manifest, preset)
      for (const key of [36, 60, 84]) {
        const r = renderInstrument(factory, { params, notes: [{ at: 0, dur: 0.6, note: note(key) }], seconds: 0.8 })
        const s = stats(r.L)
        expect(s.nan, `key ${key}`).toBe(false)
        expect(s.peak, `key ${key}`).toBeGreaterThan(0.02)
        expect(s.peak, `key ${key}`).toBeLessThan(1.5)
      }
      const chord = renderInstrument(factory, { params, notes: [48, 60, 64, 67].map((k) => ({ at: 0, dur: 1, note: note(k) })), seconds: 9 })
      const s = stats(chord.L)
      expect(s.nan).toBe(false)
      expect(s.peak).toBeGreaterThan(0.02)
      expect(s.peak).toBeLessThan(1.5)
      // release -> silence: the last 100 ms must be (near) silent
      expect(stats(chord.L.subarray(chord.L.length - 4800)).peak).toBeLessThan(1e-3)
    })
  }

  it('writes WAVs for listening', async () => {
    for (const name of ['TINE EP 83', 'LATELY BS', 'BRASS SECT', 'TUBULAR BL', 'MARIMBA 1', 'STRINGS 1', 'FM KICK']) {
      const preset = FACTORY_PRESETS.find((p) => p.name === name)!
      const notes = [
        ...[48, 55, 60, 64].map((k, i) => ({ at: i * 0.35, dur: 0.3, note: note(k) })),
        ...[48, 60, 64, 67].map((k) => ({ at: 1.6, dur: 1.2, note: note(k) }))
      ]
      const r = renderInstrument(factory, { params: presetParams(manifest, preset), notes, seconds: 4.5 })
      await writeWav(`/tmp/hexa-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`, r)
    }
  })
})

describe('hexa FM core', () => {
  const steady = (params: Record<string, number>, key = 69, extra: Record<string, number> = {}) =>
    renderInstrument(factory, { params: { ...params, ...extra }, notes: [{ at: 0, dur: 1, note: note(key) }], seconds: 0.6 }).L.subarray(9600, 9600 + 16384)

  it('INIT-style sine at A4 is 440 Hz and pure', () => {
    const x = steady(additive([1]))
    const f = mag(x, 440)
    expect(f).toBeGreaterThan(0.1)
    expect(mag(x, 880) / f).toBeLessThan(1e-3)
    expect(mag(x, 430) / f).toBeLessThan(0.2)
  })

  it('algorithm 32 with all ops at ratio 1 is one pure sine (all operators add coherently)', () => {
    const one = mag(steady(additive([1])), 440)
    const x = steady(additive([1, 1, 1, 1, 1, 1]))
    const six = mag(x, 440)
    expect(six / one).toBeGreaterThan(5.8)
    expect(six / one).toBeLessThan(6.2)
    for (const h of [2, 3, 4]) expect(mag(x, 440 * h) / six).toBeLessThan(1e-3)
  })

  it('algorithm 32 with ratios 1..6 produces exactly those additive partials', () => {
    const x = steady(additive([1, 2, 3, 4, 5, 6]), 45) // A2 = 110 Hz
    const base = mag(x, 110)
    for (let h = 1; h <= 6; h++) {
      const r = mag(x, 110 * h) / base
      expect(r).toBeGreaterThan(0.9)
      expect(r).toBeLessThan(1.1)
    }
    expect(mag(x, 110 * 7) / base).toBeLessThan(0.01)
    expect(mag(x, 165) / base).toBeLessThan(0.01)
  })

  it('operator-6 feedback turns a sine into a saw-like spectrum', () => {
    // op6 alone as a carrier (alg 32), feedback 0 vs 7
    const solo = (fb: number) => {
      const p = additive([1, 1, 1, 1, 1, 1], fb)
      for (let n = 1; n <= 5; n++) p[`op${n}.ol`] = 0
      return steady(p, 45)
    }
    const clean = solo(0)
    const fb = solo(6) // FB 6 at full level is the classic DX7 "saw"; FB 7 at full level turns chaotic
    expect(mag(clean, 220) / mag(clean, 110)).toBeLessThan(1e-3)
    const h = [1, 2, 3, 4, 5, 6].map((k) => mag(fb, 110 * k))
    // every harmonic present, falling off roughly like a sawtooth (1/n)
    for (let k = 2; k <= 6; k++) {
      expect(h[k - 1] / h[0], `h${k}`).toBeGreaterThan(0.6 / k)
      expect(h[k - 1] / h[0], `h${k}`).toBeLessThan(1.5 / k)
      expect(h[k - 1], `h${k}`).toBeLessThan(h[k - 2])
    }
  })

  it('modulator index rises with output level (more sidebands)', () => {
    const v = initVoice() // alg 1: op1 <- op2
    const run = (ol: number) => {
      v[opOff(2) + O.ol] = ol
      return steady({ ...defaultParams(manifest), ...voiceToParams(v) })
    }
    const lo = run(50)
    const hi = run(85)
    expect(mag(hi, 880) / mag(hi, 440)).toBeGreaterThan(mag(lo, 880) / mag(lo, 440) * 5)
  })

  it('fixed-frequency mode ignores the key', () => {
    const p = additive([1])
    p['op1.mode'] = 1
    p['op1.coarse'] = 3 // 1000 Hz
    p['op1.fine'] = 0
    for (const key of [40, 80]) {
      const x = steady(p, key)
      expect(mag(x, 1000) / mag(x, 990)).toBeGreaterThan(5)
    }
  })

  it('pitch bend and transpose shift the pitch', () => {
    const p = additive([1])
    let x = steady(p, 69, { 'master.bend': 1, 'master.bendRange': 12 })
    expect(mag(x, 880)).toBeGreaterThan(10 * mag(x, 440))
    x = steady(p, 69, { transpose: -12 })
    expect(mag(x, 220)).toBeGreaterThan(10 * mag(x, 440))
  })

  it('all 32 algorithms (incl. the 4 and 6 feedback loops) render bounded audio', () => {
    for (let a = 1; a <= 32; a++) {
      const v = initVoice()
      for (let n = 1; n <= 6; n++) v[opOff(n) + O.ol] = 80
      v[134] = a - 1
      v[135] = 7
      const r = renderInstrument(factory, { params: { ...defaultParams(manifest), ...voiceToParams(v) }, notes: [{ at: 0, dur: 0.3, note: note(60) }], seconds: 0.4 })
      const s = stats(r.L)
      expect(s.nan, `alg ${a}`).toBe(false)
      expect(s.peak, `alg ${a}`).toBeGreaterThan(0.01)
      expect(s.peak, `alg ${a}`).toBeLessThan(1.5)
    }
  })

  it('mono mode is legato (one voice, no retrigger) and glides', () => {
    const p = { ...additive([1]), 'master.mono': 1, 'master.porta': 40 }
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as HexaSynth
    for (const [k, v] of Object.entries(p)) dsp.setParam(k, v)
    const L = new Float32Array(128)
    const R = new Float32Array(128)
    dsp.noteOn(note(60, { id: 1 }))
    for (let i = 0; i < 40; i++) dsp.process(L, R, 0, 128)
    dsp.noteOn(note(72, { id: 2 }))
    for (let i = 0; i < 4; i++) dsp.process(L, R, 0, 128)
    expect(dsp.voices.filter((v) => v.active).length).toBe(1)
    const v = dsp.voices[0]
    expect(v.env[0].ix).toBeGreaterThanOrEqual(2) // envelope not restarted
    expect(v.pitch).toBeLessThan(v.target) // still gliding up
    dsp.noteOff(2, 72, 0.5)
    expect(v.key).toBe(60) // falls back to the held note
  })

  it('Vintage character stays bounded and close to Clean', () => {
    const params = presetParams(manifest, FACTORY_PRESETS[0])
    const clean = renderInstrument(factory, { params, notes: [{ at: 0, dur: 0.5, note: note(60) }], seconds: 0.6 })
    const vint = renderInstrument(factory, { params: { ...params, 'master.vintage': 1 }, notes: [{ at: 0, dur: 0.5, note: note(60) }], seconds: 0.6 })
    const a = stats(clean.L)
    const b = stats(vint.L)
    expect(b.nan).toBe(false)
    expect(Math.abs(b.rms - a.rms) / a.rms).toBeLessThan(0.25)
  })
})

describe('hexa envelopes', () => {
  // Time for a full-level operator (OL 99) to fall from L1=99 to L2=0 at a given R2.
  function decayTime(rate: number, sr = 44100): number {
    const e = new Env(sr)
    const patch = initVoice()
    const b = opOff(1)
    patch.set([99, rate, 99, 99, 99, 0, 0, 0], b)
    e.init(patch, b, 127 << 5, 0, false)
    let t = 0
    const n = 64
    while (e.ix < 1 && t < 10 * sr) { e.step(n); t += n }
    const t0 = t
    while (e.ix < 2 && t < 600 * sr) { e.step(n); t += n }
    return (t - t0) / sr
  }
  function attackTime(rate: number, sr = 44100): number {
    const e = new Env(sr)
    const patch = initVoice()
    const b = opOff(1)
    patch.set([rate, 99, 99, 99, 99, 99, 99, 0], b)
    e.init(patch, b, 127 << 5, 0, false)
    let t = 0
    while (e.ix < 1 && t < 100 * sr) { e.step(16); t += 16 }
    return t / sr
  }

  it('decay follows the DX7 rate table (linear in dB, doubling speed every ~6 rate steps)', () => {
    // Reference points of the DX7 EG rate law (qrate = rate*41/64; 4 qrate steps per doubling)
    for (const [rate, ref] of [[50, 1.38], [60, 0.46], [70, 0.17], [40, 4.4], [30, 12.6]] as const) {
      const t = decayTime(rate)
      expect(t, `R=${rate}`).toBeGreaterThan(ref * 0.85)
      expect(t, `R=${rate}`).toBeLessThan(ref * 1.15)
    }
    expect(decayTime(99)).toBeLessThan(0.01)
    // linear-in-dB: constant doublings/second, independent of sample rate
    expect(Math.abs(decayTime(55, 48000) - decayTime(55, 44100)) / decayTime(55)).toBeLessThan(0.05)
    expect(envRateDoublingsPerSec(56) / envRateDoublingsPerSec(50)).toBeGreaterThan(1.6)
    expect(envRateDoublingsPerSec(56) / envRateDoublingsPerSec(50)).toBeLessThan(2.6)
  })

  it('attack is fast-exponential and monotonic in rate', () => {
    expect(attackTime(99)).toBeLessThan(0.005)
    let prev = 0
    for (const r of [90, 70, 50, 30]) {
      const t = attackTime(r)
      expect(t).toBeGreaterThan(prev)
      prev = t
    }
    // attack is much quicker than a decay over the same range at the same rate
    expect(attackTime(50)).toBeLessThan(decayTime(50) / 2)
  })
})

describe('hexa CPU', () => {
  it('benchmarks 16 voices per 128-frame block', () => {
    const results: string[] = []
    for (const name of ['TINE EP 83', 'BRASS SECT', 'STRINGS 1']) {
      const preset = FACTORY_PRESETS.find((p) => p.name === name)!
      const dsp = factory.create({ sampleRate: SR, post: () => {} }) as HexaSynth
      for (const [k, v] of Object.entries(presetParams(manifest, preset))) dsp.setParam(k, v)
      for (let i = 0; i < 16; i++) dsp.noteOn(note(40 + i * 2, { id: i + 1 }))
      const L = new Float32Array(128)
      const R = new Float32Array(128)
      for (let i = 0; i < 200; i++) dsp.process(L, R, 0, 128) // warm-up / JIT
      const blocks = 2000
      const t0 = performance.now()
      for (let i = 0; i < blocks; i++) dsp.process(L, R, 0, 128)
      const us = ((performance.now() - t0) / blocks) * 1000
      results.push(`${name}: ${us.toFixed(1)} µs/block`)
      expect(dsp.voices.filter((v) => v.active).length).toBe(16)
      expect(us).toBeLessThan(1000)
    }
    // feedback-loop algorithm (per-sample path)
    const p = presetParams(manifest, FACTORY_PRESETS[0])
    p.algo = 4
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as HexaSynth
    for (const [k, v] of Object.entries(p)) dsp.setParam(k, v)
    for (let i = 0; i < 16; i++) dsp.noteOn(note(40 + i * 2, { id: i + 1 }))
    const L = new Float32Array(128)
    const R = new Float32Array(128)
    for (let i = 0; i < 200; i++) dsp.process(L, R, 0, 128)
    const t0 = performance.now()
    for (let i = 0; i < 2000; i++) dsp.process(L, R, 0, 128)
    const us = ((performance.now() - t0) / 2000) * 1000
    results.push(`alg 4 loop: ${us.toFixed(1)} µs/block`)
    expect(us).toBeLessThan(1000)
    console.log(`[hexa cpu] 16 voices, 128 frames @48k (budget 2667 µs): ${results.join(' | ')}`)
  })
})

describe('hexa algorithm diagrams', () => {
  it('lays out all 32 algorithms without overlaps, carriers on the bottom row', async () => {
    const { algoLayout } = await import('./layout')
    const { ALGORITHMS } = await import('./tables')
    for (let a = 0; a < 32; a++) {
      const { nodes } = algoLayout(a)
      const alg = ALGORITHMS[a]
      const seen = new Set(nodes.map((n) => `${n.x},${n.y}`))
      expect(seen.size, `alg ${a + 1}`).toBe(6)
      alg.carriers.forEach((c, op) => c && expect(nodes[op].y, `alg ${a + 1} op ${op + 1}`).toBe(0))
      alg.mods.forEach((ms, t) => ms.forEach((m) => expect(nodes[m].y, `alg ${a + 1}`).toBeGreaterThan(nodes[t].y)))
    }
  })
})
