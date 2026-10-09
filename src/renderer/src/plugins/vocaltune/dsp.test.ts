import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { PitchDetector } from './detector'
import { freqToMidi, manifest, midiToFreq } from './manifest'
import { defaultParams, presetParams } from '../sdk/module'
import { Biquad, Osc } from '../sdk/dsp'
import { renderEffect, stats, SR, writeWav, type Rendered } from '../sdk/test-utils'
import { dryTest, standardTests } from '../fx-common/suite'
import type { EffectDSP } from '../sdk/types'

const cents = (a: number, b: number): number => 1200 * Math.log2(a / b)
const mono = (x: Float32Array): Rendered => ({ L: x, R: x.slice() })

/** Phase-continuous tone following a frequency contour f(t). */
function contour(seconds: number, f: (t: number) => number, shape: 'sine' | 'saw' = 'sine', amp = 0.5): Float32Array {
  const n = Math.ceil(seconds * SR)
  const x = new Float32Array(n)
  const osc = new Osc()
  for (let i = 0; i < n; i++) {
    const dt = f(i / SR) / SR
    x[i] = shape === 'sine' ? Math.sin(2 * Math.PI * osc.phase) * amp : osc.next(2, dt) * amp
    if (shape === 'sine') {
      osc.phase += dt
      if (osc.phase >= 1) osc.phase -= 1
    }
  }
  return x
}

/** Detected pitch track of a signal: [{ t (s), f (Hz) }] for voiced analyses. */
function track(x: Float32Array): { t: number; f: number }[] {
  const d = new PitchDetector(SR)
  const out: { t: number; f: number }[] = []
  for (let i = 0; i < x.length; i++) if (d.push(x[i]) && d.voiced) out.push({ t: i / SR, f: d.freq })
  return out
}

function medianFreq(x: Float32Array, from: number, to: number): number {
  const fs = track(x)
    .filter((p) => p.t >= from && p.t <= to)
    .map((p) => p.f)
    .sort((a, b) => a - b)
  return fs.length ? fs[fs.length >> 1] : 0
}

/**
 * Synthetic sung "voice": band-limited glottal saw + 3 formants, note envelopes, light vibrato,
 * a noisy consonant between notes. Notes in C major, each detuned by `detune` cents.
 */
function voice(notes: { midi: number; detune: number }[], noteSec = 0.5, gapSec = 0.08): Float32Array {
  const per = noteSec + gapSec
  const n = Math.ceil((notes.length * per + 0.2) * SR)
  const x = new Float32Array(n)
  const osc = new Osc()
  const f1 = new Biquad(SR), f2 = new Biquad(SR), f3 = new Biquad(SR), tilt = new Biquad(SR), hiss = new Biquad(SR)
  f1.set('bp', 700, 5)
  f2.set('bp', 1150, 6)
  f3.set('bp', 2700, 8)
  tilt.set('lp', 3000, 0.7)
  hiss.set('bp', 5000, 1.5)
  let seed = 99
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const k = Math.min(notes.length - 1, Math.floor(t / per))
    const nt = t - k * per
    const nd = notes[k]
    const inNote = nt < noteSec && t < notes.length * per
    const vib = nt > 0.2 ? 0.25 * Math.sin(2 * Math.PI * 5.5 * nt) * Math.min(1, (nt - 0.2) / 0.1) : 0 // ±25 cents
    const f = midiToFreq(nd.midi + nd.detune / 100 + vib / 1)
    const g = osc.next(2, f / SR)
    const env = inNote ? Math.min(1, nt / 0.03) * Math.min(1, (noteSec - nt) / 0.04) : 0
    const src = tilt.process(g) * env
    seed = (seed * 1664525 + 1013904223) >>> 0
    const nz = (seed / 4294967296 - 0.5) * (!inNote && t < notes.length * per ? 0.25 : 0)
    x[i] = 0.9 * (f1.process(src) * 1.0 + f2.process(src) * 0.6 + f3.process(src) * 0.35) + hiss.process(nz)
  }
  // normalise to ~0.6 peak
  let pk = 0
  for (const v of x) pk = Math.max(pk, Math.abs(v))
  for (let i = 0; i < n; i++) x[i] *= 0.6 / pk
  return x
}

const MELODY = [
  { midi: 60, detune: 35 },
  { midi: 62, detune: -30 },
  { midi: 64, detune: 40 },
  { midi: 65, detune: -38 },
  { midi: 67, detune: 25 },
  { midi: 69, detune: -20 },
  { midi: 67, detune: 30 },
  { midi: 64, detune: -35 }
]

const P = (o: Record<string, number>) => ({ ...defaultParams(manifest), ...o })

describe('vocaltune', () => {
  standardTests(factory, manifest)
  dryTest(factory, manifest)

  it('450 Hz tone, key A chromatic, speed 0 -> 440 Hz (±10 cents)', () => {
    const r = renderEffect(factory, { params: P({ key: 9, scale: 0, speed: 0, humanize: 0 }), input: mono(contour(1.2, () => 450)) })
    const f = medianFreq(r.L, 0.4, 1.2)
    expect(Math.abs(cents(f, 440))).toBeLessThan(10)
    const s = stats(r.L)
    expect(s.nan).toBe(false)
    expect(s.rms).toBeGreaterThan(0.25) // ~level preserved (input RMS 0.354)
    // steady level (no grain-rate amplitude wobble): per-10 ms peak varies by < 1.5 dB
    let lo = 9, hi = 0
    for (let b = Math.floor(0.4 * SR); b + 480 <= r.L.length; b += 480) {
      let pk = 0
      for (let i = b; i < b + 480; i++) pk = Math.max(pk, Math.abs(r.L[i]))
      lo = Math.min(lo, pk)
      hi = Math.max(hi, pk)
    }
    if (process.env.VTDBG) console.log('level wobble dB', 20 * Math.log10(hi / lo), lo, hi)
    expect(20 * Math.log10(hi / lo)).toBeLessThan(1.5)
    // spectral purity: energy at the corrected fundamental vs everything else (THD+N)
    const a = Math.floor(0.5 * SR), N = Math.floor(0.6 * SR)
    let re = 0, im = 0, tot = 0
    for (let i = 0; i < N; i++) {
      const v = r.L[a + i]
      re += v * Math.cos((2 * Math.PI * 440 * i) / SR)
      im += v * Math.sin((2 * Math.PI * 440 * i) / SR)
      tot += v * v
    }
    const fund = (2 * (re * re + im * im)) / N
    const thdn = 10 * Math.log10(Math.max(1e-12, tot - fund) / fund)
    if (process.env.VTDBG) console.log('THD+N dB', thdn)
    expect(thdn).toBeLessThan(-30)
  })

  it('works on a sawtooth and at 44.1 kHz', () => {
    const r = renderEffect(factory, { params: P({ key: 0, scale: 0, speed: 0, humanize: 0 }), input: mono(contour(1, () => 300, 'saw')) })
    // 300 Hz = D4 +16 cents -> D4 293.66
    expect(Math.abs(cents(medianFreq(r.L, 0.4, 1), 293.66))).toBeLessThan(10)
    const n = 44100
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 450 * i) / n)
    const r2 = renderEffect(factory, { params: P({ key: 9, scale: 0, speed: 0 }), input: mono(x), sampleRate: 44100 })
    const d = new PitchDetector(44100)
    const fs: number[] = []
    for (let i = 0; i < n; i++) if (d.push(r2.L[i]) && i > n / 2 && d.voiced) fs.push(d.freq)
    fs.sort((a, b) => a - b)
    expect(Math.abs(cents(fs[fs.length >> 1], 440))).toBeLessThan(10)
  })

  it('a tone gliding between notes ends on scale notes (C major)', () => {
    // 430 Hz -> 530 Hz exponential glide over 1.2 s, then holds 530 Hz (C5 + 22 cents)
    const f = (t: number) => (t < 1.2 ? 430 * Math.pow(530 / 430, t / 1.2) : 530)
    const r = renderEffect(factory, { params: P({ key: 0, scale: 1, speed: 0, humanize: 0 }), input: mono(contour(1.8, f)) })
    expect(Math.abs(cents(medianFreq(r.L, 1.35, 1.8), midiToFreq(72)))).toBeLessThan(10)
    // during the glide the output sits on C-major notes (A4, B4, C5) most of the time
    const major = [0, 2, 4, 5, 7, 9, 11]
    const pts = track(r.L).filter((p) => p.t > 0.1 && p.t < 1.2)
    const onScale = pts.filter((p) => {
      const m = freqToMidi(p.f)
      const n = Math.round(m)
      return major.includes(((n % 12) + 12) % 12) && Math.abs(m - n) < 0.15
    })
    expect(onScale.length / pts.length).toBeGreaterThan(0.8)
    // and the input clearly did not
    const inPts = track(contour(1.8, f)).filter((p) => p.t > 0.1 && p.t < 1.2)
    const inOn = inPts.filter((p) => Math.abs(freqToMidi(p.f) - Math.round(freqToMidi(p.f))) < 0.15)
    expect(inOn.length / inPts.length).toBeLessThan(0.5)
  })

  it('corrects a detuned synthetic voice onto the scale', () => {
    const x = voice(MELODY)
    const r = renderEffect(factory, { params: P({ key: 0, scale: 1, speed: 0, humanize: 0 }), input: mono(x) })
    const per = 0.58
    MELODY.forEach((nd, k) => {
      // middle of each note, before vibrato starts
      const fIn = medianFreq(x, k * per + 0.06, k * per + 0.19)
      const fOut = medianFreq(r.L, k * per + 0.06, k * per + 0.19)
      expect(Math.abs(cents(fIn, midiToFreq(nd.midi)) - nd.detune)).toBeLessThan(12)
      if (process.env.VTDBG) console.log('note', k, cents(fIn, midiToFreq(nd.midi)).toFixed(1), cents(fOut, midiToFreq(nd.midi)).toFixed(1))
      expect(Math.abs(cents(fOut, midiToFreq(nd.midi))), `note ${k}`).toBeLessThan(12)
    })
  })

  it('slow retune speed keeps vibrato, speed 0 flattens it', () => {
    const x = contour(1.5, (t) => midiToFreq(69 + 0.3 * Math.sin(2 * Math.PI * 5.5 * t))) // ±30 cents vibrato on A4
    const depth = (y: Float32Array) => {
      const ms = track(y)
        .filter((p) => p.t > 0.5)
        .map((p) => freqToMidi(p.f))
      return Math.max(...ms) - Math.min(...ms)
    }
    const hard = renderEffect(factory, { params: P({ key: 9, scale: 0, speed: 0, humanize: 0 }), input: mono(x) })
    const soft = renderEffect(factory, { params: P({ key: 9, scale: 0, speed: 300, humanize: 0 }), input: mono(x) })
    const human = renderEffect(factory, { params: P({ key: 9, scale: 0, speed: 0, humanize: 1 }), input: mono(x) })
    const dIn = depth(x), dHard = depth(hard.L), dSoft = depth(soft.L), dHuman = depth(human.L)
    if (process.env.VTDBG) console.log('vibrato depth', { dIn, dHard, dSoft, dHuman })
    expect(dIn).toBeGreaterThan(0.5)
    expect(dHard).toBeLessThan(0.3 * dIn)
    expect(dSoft).toBeGreaterThan(0.6 * dIn)
    expect(dHuman).toBeGreaterThan(dHard * 1.5)
  })

  it('no clicks: robot mode on a sine glide stays smooth', () => {
    // 200 -> 800 Hz glide: the corrected output steps through every semitone
    const x = contour(2, (t) => 200 * Math.pow(4, t / 2), 'sine', 0.5)
    for (const speed of [0, 50]) {
      const r = renderEffect(factory, { params: P({ scale: 0, speed, humanize: 0 }), input: mono(x) })
      // 2nd difference of a 0.5-amp sine at <= 850 Hz is <= 0.5 * (2π·850/48000)^2 ≈ 0.0062
      let worst = 0
      for (let i = 2400; i < r.L.length; i++) worst = Math.max(worst, Math.abs(r.L[i] - 2 * r.L[i - 1] + r.L[i - 2]))
      if (process.env.VTDBG) console.log('d2 worst', speed, worst)
      expect(worst).toBeLessThan(0.02)
    }
  })

  it('unvoiced noise passes through unchanged (delayed at most one period)', () => {
    const n = SR
    const x = new Float32Array(n)
    let s = 7
    for (let i = 0; i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      x[i] = (s / 4294967296 - 0.5) * 0.5
    }
    const r = renderEffect(factory, { params: P({ speed: 0 }), input: mono(x) })
    // find the best alignment within 0..20 ms and check it reconstructs the input
    let best = 0, bestLag = 0
    for (let lag = 0; lag < 960; lag++) {
      let c = 0, ea = 0, eb = 0
      for (let i = 4800; i < n; i++) {
        c += r.L[i] * x[i - lag]
        ea += r.L[i] * r.L[i]
        eb += x[i - lag] * x[i - lag]
      }
      const v = c / Math.sqrt(ea * eb)
      if (v > best) {
        best = v
        bestLag = lag
      }
    }
    expect(best).toBeGreaterThan(0.97)
    expect(bestLag).toBeLessThan(400)
  })

  it('all presets are finite with peaks < 2 on voice, saw and nasty inputs', () => {
    const inputs = [voice(MELODY.slice(0, 4)), contour(1, (t) => 100 + 900 * t, 'saw', 0.9)]
    const nasty = new Float32Array(SR)
    for (let i = 0; i < nasty.length; i++) nasty[i] = i < 12000 ? 1 : i < 24000 ? (i % 400 === 0 ? 1 : 0) : i < 36000 ? (Math.random() * 2 - 1) : 1e-30
    inputs.push(nasty)
    for (const preset of manifest.presets!) {
      for (const x of inputs) {
        const r = renderEffect(factory, { params: presetParams(manifest, preset), input: mono(x) })
        const a = stats(r.L), b = stats(r.R)
        expect(a.nan || b.nan, preset.name).toBe(false)
        expect(Math.max(a.peak, b.peak), preset.name).toBeLessThan(2)
      }
    }
  })

  it('posts pitch to the editor only while it says hello, ~30 Hz', () => {
    const msgs: any[] = []
    const dsp = factory.create({ sampleRate: SR, post: (m) => msgs.push(m) }) as EffectDSP
    const x = contour(4, () => 450)
    const o1 = new Float32Array(128), o2 = new Float32Array(128)
    const run = (from: number, to: number) => {
      for (let p = from; p < to; p += 128) {
        const b = x.subarray(p, p + 128)
        dsp.process(b, b, o1, o2, 0, 128)
      }
    }
    run(0, SR / 2)
    expect(msgs.length).toBe(0)
    dsp.onMessage!({ t: 'ui' })
    run(SR / 2, SR * 1.5)
    const n1 = msgs.length
    expect(n1).toBeGreaterThan(25)
    expect(n1).toBeLessThan(35)
    const last = msgs[msgs.length - 1]
    expect(last.t).toBe('vt')
    expect(last.v).toBe(1)
    expect(last.tgt).toBe(69)
    expect(Math.abs(last.det - freqToMidi(450))).toBeLessThan(0.05)
    expect(Math.abs(last.out - 69)).toBeLessThan(0.05)
    run(SR * 1.5, SR * 4) // no more hellos -> stops after ~2 s
    const n2 = msgs.length
    run(0, SR / 2)
    expect(msgs.length).toBe(n2)
    expect(n2 - n1).toBeLessThan(35)
  })

  it('CPU benchmark per 128-frame block (report)', () => {
    const x = voice(MELODY)
    const dsp = factory.create({ sampleRate: SR, post: () => {} }) as EffectDSP
    for (const [k, v] of Object.entries(P({ scale: 1, speed: 0 }))) dsp.setParam(k, v)
    const o1 = new Float32Array(128), o2 = new Float32Array(128)
    const blocks = Math.floor(x.length / 128)
    // warm-up
    for (let b = 0; b < blocks; b++) dsp.process(x.subarray(b * 128, b * 128 + 128), x.subarray(b * 128, b * 128 + 128), o1, o2, 0, 128)
    const t0 = performance.now()
    const reps = 4
    for (let r = 0; r < reps; r++)
      for (let b = 0; b < blocks; b++) dsp.process(x.subarray(b * 128, b * 128 + 128), x.subarray(b * 128, b * 128 + 128), o1, o2, 0, 128)
    const us = ((performance.now() - t0) * 1000) / (blocks * reps)
    const budget = (128 / SR) * 1e6
    console.log(`[vocaltune] ${us.toFixed(1)} µs per 128-frame block (${((100 * us) / budget).toFixed(2)}% of the ${budget.toFixed(0)} µs real-time budget)`)
    expect(us).toBeLessThan(500)
  })

  it('writes before/after WAVs to /tmp/vocaltune-*.wav', async () => {
    const x = voice(MELODY)
    await writeWav('/tmp/vocaltune-voice-before.wav', mono(x))
    const hard = renderEffect(factory, { params: presetParams(manifest, manifest.presets!.find((p) => p.name === 'Hard Tune (Robot)')!), input: mono(x) })
    await writeWav('/tmp/vocaltune-voice-after-hardtune.wav', hard)
    const nat = renderEffect(factory, { params: P({ key: 0, scale: 1, speed: 70, humanize: 0.5 }), input: mono(x) })
    await writeWav('/tmp/vocaltune-voice-after-natural.wav', nat)
    const glide = contour(2, (t) => 200 * Math.pow(2, t / 2), 'saw', 0.4)
    await writeWav('/tmp/vocaltune-glide-before.wav', mono(glide))
    await writeWav('/tmp/vocaltune-glide-after-robot.wav', renderEffect(factory, { params: P({ scale: 0, speed: 0, humanize: 0 }), input: mono(glide) }))
    expect(stats(hard.L).nan).toBe(false)
  })
})
