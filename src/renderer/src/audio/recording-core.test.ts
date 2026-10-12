import { describe, expect, it } from 'vitest'
import {
  assembleTake,
  compensationSec,
  detectOnset,
  firstFreeTrack,
  inRanges,
  median,
  quantizeRecordedNote,
  recordQuantizeGrid,
  sweptRanges,
  grownPatternLength,
  countInPlan
} from './recording-core'

describe('record quantize grid', () => {
  it('quantizes only for musical snap values', () => {
    expect(recordQuantizeGrid('step', [4, 4])).toBe(24)
    expect(recordQuantizeGrid('beat', [4, 4])).toBe(96)
    expect(recordQuantizeGrid('bar', [3, 4])).toBe(288)
    expect(recordQuantizeGrid('1/2step', [4, 4])).toBe(12)
    expect(recordQuantizeGrid('beat', [6, 8])).toBe(48)
    expect(recordQuantizeGrid('line', [4, 4])).toBe(0)
    expect(recordQuantizeGrid('cell', [4, 4])).toBe(0)
    expect(recordQuantizeGrid('none', [4, 4])).toBe(0)
  })

  it('moves the start but keeps the played length', () => {
    expect(quantizeRecordedNote(30, 40, 24, { start: true, end: false })).toEqual({ pos: 24, len: 40 })
    expect(quantizeRecordedNote(37, 10, 24, { start: true, end: false })).toEqual({ pos: 48, len: 10 })
  })

  it('quantizes the end to at least one grid unit', () => {
    expect(quantizeRecordedNote(30, 40, 24, { start: true, end: true })).toEqual({ pos: 24, len: 48 })
    expect(quantizeRecordedNote(48, 3, 24, { start: true, end: true })).toEqual({ pos: 48, len: 24 })
  })

  it('leaves timing as played without a grid', () => {
    expect(quantizeRecordedNote(30.4, 40.2, 0, { start: true, end: true })).toEqual({ pos: 30, len: 40 })
    expect(quantizeRecordedNote(-3, 0.2, 0, { start: true, end: false })).toEqual({ pos: 0, len: 1 })
  })
})

describe('count-in', () => {
  it('counts the first number of the time signature, one beat unit each', () => {
    expect(countInPlan(120, [4, 4], 1)).toEqual({ beatsPerBar: 4, beatSec: 0.5, total: 4 })
    expect(countInPlan(120, [3, 4], 1)).toEqual({ beatsPerBar: 3, beatSec: 0.5, total: 3 })
    expect(countInPlan(120, [6, 8], 1)).toEqual({ beatsPerBar: 6, beatSec: 0.25, total: 6 })
    expect(countInPlan(120, [7, 8], 2)).toEqual({ beatsPerBar: 7, beatSec: 0.25, total: 14 })
  })
})

describe('pattern recording runs past the pattern end', () => {
  const bar = 384
  it('grows a set pattern length to whole bars covering the note', () => {
    expect(grownPatternLength(bar, 400, bar)).toBe(bar * 2)
    expect(grownPatternLength(bar, bar * 3, bar)).toBe(bar * 3)
    expect(grownPatternLength(bar * 2, 500, bar)).toBe(bar * 2)
  })
  it('leaves an automatic length (0) alone', () => {
    expect(grownPatternLength(0, 5000, bar)).toBe(0)
  })
  it('swept ranges wrap for replace recording', () => {
    expect(sweptRanges(100, 50, bar)).toEqual([[100, 150]])
    expect(sweptRanges(350, 100, bar)).toEqual([
      [350, 384],
      [0, 66]
    ])
    expect(sweptRanges(10, 500, bar)).toEqual([[0, 384]])
    expect(sweptRanges(1000, 200, Infinity)).toEqual([[1000, 1200]])
    expect(inRanges(20, sweptRanges(350, 100, bar))).toBe(true)
    expect(inRanges(200, sweptRanges(350, 100, bar))).toBe(false)
  })
})

describe('first free playlist track', () => {
  it('skips tracks with overlapping clips and locked tracks', () => {
    const clips = [
      { track: 0, start: 0, length: 384 },
      { track: 1, start: 384, length: 384 },
      { track: 2, start: 100, length: 10 }
    ]
    expect(firstFreeTrack(clips, 0, 384, 10)).toBe(1)
    expect(firstFreeTrack(clips, 0, 400, 10)).toBe(3)
    expect(firstFreeTrack(clips, 0, 400, 10, (i) => i === 3)).toBe(4)
    expect(firstFreeTrack(clips, 0, 400, 3)).toBe(-1)
  })
})

describe('audio take assembly / latency trim', () => {
  const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i)
  it('drops samples before the compensated start frame', () => {
    const chunks = [
      { frame: 1000, data: [ramp(0, 100)] },
      { frame: 1100, data: [ramp(100, 100)] }
    ]
    const [x] = assembleTake(chunks, 1030, 1)
    expect(x.length).toBe(170)
    expect(x[0]).toBe(30)
    expect(x[169]).toBe(199)
  })
  it('pads with silence when capture started late, and fills gaps', () => {
    const chunks = [
      { frame: 1010, data: [ramp(1, 10)] },
      { frame: 1030, data: [ramp(50, 5)] }
    ]
    const [x] = assembleTake(chunks, 1000, 1)
    expect(x.length).toBe(35)
    expect(x[9]).toBe(0)
    expect(x[10]).toBe(1)
    expect(x[25]).toBe(0)
    expect(x[30]).toBe(50)
  })
  it('honours the end frame and duplicates mono into stereo', () => {
    const [l, r] = assembleTake([{ frame: 0, data: [ramp(0, 100)] }], 10, 2, 50)
    expect(l.length).toBe(40)
    expect(r[0]).toBe(10)
  })
  it('is idempotent for duplicated chunks', () => {
    const c = { frame: 0, data: [ramp(0, 10)] }
    expect(Array.from(assembleTake([c, c], 0, 1)[0])).toEqual(Array.from(ramp(0, 10)))
  })
  it('computes the compensation offset', () => {
    const base = { auto: true, outputLatency: 0.02, baseLatency: 0.01, inputLatency: 0.005, calibratedMs: null, offsetMs: 0 }
    expect(compensationSec(base)).toBeCloseTo(0.035)
    expect(compensationSec({ ...base, calibratedMs: 12 })).toBeCloseTo(0.012)
    expect(compensationSec({ ...base, auto: false, offsetMs: 5 })).toBeCloseTo(0.005)
  })
  it('finds loopback click onsets', () => {
    const x = new Float32Array(1000)
    for (let i = 0; i < 1000; i++) x[i] = (Math.sin(i) * 0.001) as number
    x[640] = 0.4
    expect(detectOnset(x, 100)).toBe(640)
    expect(detectOnset(new Float32Array(100), 10)).toBe(-1)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})
