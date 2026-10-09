import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { defaultParams } from '../sdk/module'
import { note, renderInstrument, stats, writeWav, SR } from '../sdk/test-utils'
import { centroid, envelopeDb, findPeak, spectrum } from './analysis'
import type { WSData } from './model'

const pianoData = (p: Record<string, number> = {}): WSData => ({
  v: 1,
  parts: [
    { on: true, engine: 'piano', p: { 'amp.r': 8, ...p } },
    { on: false, engine: 'piano', p: {} },
    { on: false, engine: 'piano', p: {} },
    { on: false, engine: 'piano', p: {} }
  ],
  superKnob: []
})
const dry = { ...defaultParams(manifest), 'rev.on': 0 }

function play(key: number, vel: number, dur = 3, seconds = 3.5, p: Record<string, number> = {}) {
  return renderInstrument(factory, { params: dry, data: pianoData(p), notes: [{ at: 0, dur, note: note(key, { vel }) }], seconds })
}

describe('mosaic piano model', () => {
  it('has stretched, inharmonic partials (B > 0)', () => {
    const r = play(45, 0.8, 2, 2) // A2 = 110 Hz
    const size = 32768
    const mag = spectrum(r.L, 2400, size)
    const f1 = findPeak(mag, SR, size, 110).f
    const f8 = findPeak(mag, SR, size, 880 * 1.002, 0.02).f
    const ratio = f8 / f1 / 8
    console.log(`A2 f1=${f1.toFixed(2)} f8=${f8.toFixed(2)} f8/(8 f1)=${ratio.toFixed(5)}`)
    expect(ratio).toBeGreaterThan(1.0003)
    expect(ratio).toBeLessThan(1.02)
  })

  it('two-stage decay (fast prompt, slow aftersound) and beating', async () => {
    const r = play(60, 0.8, 6, 6)
    await writeWav('/tmp/mosaic-piano-c4.wav', r)
    const env = envelopeDb(r.L, SR, 0.05)
    const peak = Math.max(...env)
    const at = (t: number) => env[Math.round(t / 0.05)] - peak
    const early = at(0.3) - at(1.3) // dB lost in first second (after attack)
    const late = at(4) - at(5) // dB lost one second, later
    console.log(`C4 decay: early ${early.toFixed(1)} dB/s, late ${late.toFixed(1)} dB/s, @1s ${at(1).toFixed(1)} dB, @5s ${at(5).toFixed(1)} dB`)
    expect(early).toBeGreaterThan(late * 1.5)
    expect(at(5)).toBeLessThan(-12)
    expect(at(5)).toBeGreaterThan(-60)
  })

  it('velocity changes level and brightness', async () => {
    const soft = play(60, 0.25, 1, 1)
    const hard = play(60, 1, 1, 1)
    await writeWav('/tmp/mosaic-piano-vel.wav', { L: Float32Array.from([...soft.L, ...hard.L]), R: Float32Array.from([...soft.R, ...hard.R]) })
    const cs = centroid(soft.L, 480, 8192, SR)
    const ch = centroid(hard.L, 480, 8192, SR)
    const ss = stats(soft.L)
    const sh = stats(hard.L)
    console.log(`vel 0.25: rms ${ss.rms.toFixed(4)} centroid ${cs.toFixed(0)} Hz | vel 1: rms ${sh.rms.toFixed(4)} centroid ${ch.toFixed(0)} Hz`)
    expect(sh.rms).toBeGreaterThan(ss.rms * 2)
    expect(ch).toBeGreaterThan(cs * 1.3)
  })

  it('register: bass rings longer than treble, damper stops the note', async () => {
    const lo = play(33, 0.7, 3, 3)
    const hi = play(96, 0.7, 3, 3)
    const damped = play(60, 0.7, 0.5, 2)
    await writeWav('/tmp/mosaic-piano-reg.wav', { L: Float32Array.from([...lo.L, ...hi.L, ...damped.L]), R: Float32Array.from([...lo.R, ...hi.R, ...damped.R]) })
    const el = envelopeDb(lo.L, SR, 0.1)
    const eh = envelopeDb(hi.L, SR, 0.1)
    const ed = envelopeDb(damped.L, SR, 0.1)
    const lossLo = Math.max(...el) - el[25]
    const lossHi = Math.max(...eh) - eh[25]
    const lossD = Math.max(...ed) - ed[15]
    console.log(`loss @2.5s: A1 ${lossLo.toFixed(1)} dB, C7 ${lossHi.toFixed(1)} dB; damped C4 @1.5s ${lossD.toFixed(1)} dB`)
    expect(lossHi).toBeGreaterThan(lossLo + 6)
    expect(lossD).toBeGreaterThan(50)
  })
})
