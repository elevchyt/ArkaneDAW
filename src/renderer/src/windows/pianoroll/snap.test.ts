import { describe, expect, it } from 'vitest'
import { barOf, beatOf, gridLineTicks, snapCeil, snapFloor, snapRound, snapTicks } from './snap'

const TS: [number, number] = [4, 4]

describe('snapTicks', () => {
  it('resolves fixed snaps in 4/4', () => {
    expect(snapTicks('none', 1, TS)).toBe(0)
    expect(snapTicks('1/6step', 1, TS)).toBe(4)
    expect(snapTicks('1/4step', 1, TS)).toBe(6)
    expect(snapTicks('1/3step', 1, TS)).toBe(8)
    expect(snapTicks('1/2step', 1, TS)).toBe(12)
    expect(snapTicks('step', 1, TS)).toBe(24)
    expect(snapTicks('1/6beat', 1, TS)).toBe(16)
    expect(snapTicks('1/4beat', 1, TS)).toBe(24)
    expect(snapTicks('1/3beat', 1, TS)).toBe(32)
    expect(snapTicks('1/2beat', 1, TS)).toBe(48)
    expect(snapTicks('beat', 1, TS)).toBe(96)
    expect(snapTicks('bar', 1, TS)).toBe(384)
  })

  it('follows time signature', () => {
    expect(snapTicks('bar', 1, [3, 4])).toBe(288)
    expect(snapTicks('beat', 1, [6, 8])).toBe(48)
    expect(barOf([6, 8])).toBe(288)
    expect(beatOf([4, 4])).toBe(96)
  })

  it("'main' follows the global snap", () => {
    expect(snapTicks('main', 1, TS, 'beat')).toBe(96)
    expect(snapTicks('main', 1, TS, 'none')).toBe(0)
    expect(snapTicks('main', 16 / 24, TS, 'line')).toBe(24)
    // degenerate global 'main' falls back to line
    expect(snapTicks('main', 16 / 24, TS, 'main')).toBe(24)
  })

  it("'line' adapts to zoom", () => {
    expect(snapTicks('line', 16 / 24, TS)).toBe(24) // 16 px per step → steps
    expect(snapTicks('line', 2, TS)).toBe(6) // very zoomed in → quarter steps
    expect(snapTicks('line', 0.2, TS)).toBe(96) // zoomed out → beats
    expect(snapTicks('line', 0.02, TS)).toBe(768) // way out → 2 bars
    expect(snapTicks('cell', 16 / 24, TS)).toBe(24)
  })
})

describe('gridLineTicks', () => {
  it('never returns lines closer than minPx', () => {
    for (const ppt of [0.001, 0.01, 0.1, 0.5, 1, 3, 10]) {
      const t = gridLineTicks(ppt, TS)
      expect(t * ppt >= 10 || t >= 384 * 64).toBe(true)
    }
  })
  it('only uses divisions of the bar', () => {
    for (const ppt of [0.05, 0.1, 0.2, 0.5, 1, 2, 5]) {
      const t = gridLineTicks(ppt, [3, 4])
      if (t < 288) expect(288 % t).toBe(0)
    }
  })
})

describe('snap rounding', () => {
  it('floor/round/ceil', () => {
    expect(snapFloor(47, 24)).toBe(24)
    expect(snapFloor(48, 24)).toBe(48)
    expect(snapRound(35, 24)).toBe(24)
    expect(snapRound(36, 24)).toBe(48)
    expect(snapCeil(25, 24)).toBe(48)
    expect(snapCeil(24, 24)).toBe(24)
    expect(snapFloor(-1, 24)).toBe(-24)
  })
  it('grid 0 = free (integer ticks)', () => {
    expect(snapFloor(12.6, 0)).toBe(13)
    expect(snapRound(12.4, 0)).toBe(12)
  })
})
