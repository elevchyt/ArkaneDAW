import { describe, expect, it } from 'vitest'
import { makeEmptyProject } from '@/store/factory'
import { PPQ, type AutomationPoint, type Project } from '@/store/types'
import { TEMPO_STEP, buildTempoMap, constantTempo, normToTempo, tempoClips, tempoMap, tempoMapFor, tempoToNorm } from './tempo'

const BAR = PPQ * 4
const pt = (t: number, bpm: number, mode: AutomationPoint['mode'] = 'single'): AutomationPoint => ({ t, v: tempoToNorm(bpm), tension: 0, mode })

/** Project at `tempo` with one tempo automation clip per entry. */
function project(tempo: number, clips: { start: number; length: number; points: AutomationPoint[]; muted?: boolean }[]): Project {
  const p = makeEmptyProject()
  p.tempo = tempo
  clips.forEach((c, i) => {
    p.automations.push({ id: `a${i}`, name: 'Tempo', color: '#fff', target: { kind: 'tempo' }, points: c.points, length: c.length })
    p.playlist.clips.push({ id: `c${i}`, kind: 'automation', ref: `a${i}`, track: i, start: c.start, length: c.length, offset: 0, muted: !!c.muted })
  })
  return p
}

describe('tempo map', () => {
  it('normalizes tempo linearly over 10..522 BPM', () => {
    expect(normToTempo(tempoToNorm(140))).toBeCloseTo(140, 9)
    expect(tempoToNorm(10)).toBe(0)
    expect(tempoToNorm(522)).toBe(1)
    expect(tempoToNorm(900)).toBe(1)
  })

  it('is the plain project tempo without tempo automation', () => {
    const m = tempoMap(project(120, []))
    expect(m.automated).toBe(false)
    expect(m.secondsAt(BAR)).toBeCloseTo(2, 9) // one 4/4 bar at 120 BPM
    expect(m.tickAt(2)).toBeCloseTo(BAR, 9)
  })

  it('steps: project tempo before the clip, the automated tempo inside, its last value after it ends', () => {
    // bar 2 at 60 BPM, bar 3 at 240 BPM (hold points step), then the clip ends
    const m = tempoMap(project(120, [{ start: BAR, length: 2 * BAR, points: [pt(0, 60), pt(BAR, 240, 'hold'), pt(2 * BAR, 240, 'hold')] }]))
    expect(m.automated).toBe(true)
    expect(m.bpmAt(0)).toBe(120)
    expect(m.bpmAt(BAR)).toBeCloseTo(60, 6)
    expect(m.bpmAt(2 * BAR)).toBeCloseTo(240, 6)
    expect(m.bpmAt(10 * BAR)).toBeCloseTo(240, 6) // held after the clip
    expect(m.secondsAt(BAR)).toBeCloseTo(2, 6)
    expect(m.secondsAt(2 * BAR)).toBeCloseTo(2 + 4, 6)
    expect(m.secondsAt(3 * BAR)).toBeCloseTo(2 + 4 + 1, 6)
    expect(m.secondsAt(4 * BAR)).toBeCloseTo(2 + 4 + 1 + 1, 6)
  })

  it('ramps are sampled on the 1/16-beat automation grid and tickAt inverts secondsAt', () => {
    const m = tempoMap(project(100, [{ start: 0, length: 4 * BAR, points: [pt(0, 60), pt(4 * BAR, 180)] }]))
    expect(m.bpmAt(TEMPO_STEP - 1)).toBeCloseTo(60, 6)
    expect(m.bpmAt(2 * BAR)).toBeCloseTo(120, 6)
    let prev = -1
    for (let t = 0; t <= 6 * BAR; t += 37) {
      const s = m.secondsAt(t)
      expect(s).toBeGreaterThan(prev)
      prev = s
      expect(m.tickAt(s)).toBeCloseTo(t, 6)
    }
    // the song plays faster than a constant 60 and slower than a constant 180
    expect(m.secondsAt(4 * BAR)).toBeLessThan(constantTempo(60).secondsAt(4 * BAR))
    expect(m.secondsAt(4 * BAR)).toBeGreaterThan(constantTempo(180).secondsAt(4 * BAR))
  })

  it('where clips overlap the one that starts last wins; muted clips and muted tracks are ignored', () => {
    const p = project(120, [
      { start: 0, length: 4 * BAR, points: [pt(0, 90)] },
      { start: 2 * BAR, length: BAR, points: [pt(0, 150)] },
      { start: 0, length: 8 * BAR, points: [pt(0, 300)], muted: true }
    ])
    const m = tempoMap(p)
    expect(m.bpmAt(BAR)).toBeCloseTo(90, 6)
    expect(m.bpmAt(2 * BAR)).toBeCloseTo(150, 6)
    expect(m.bpmAt(3 * BAR)).toBeCloseTo(90, 6)
    p.playlist.tracks[0].muted = true
    expect(tempoMap(p).bpmAt(BAR)).toBe(120)
  })

  it('pattern mode ignores tempo automation', () => {
    const p = project(120, [{ start: 0, length: BAR, points: [pt(0, 60)] }])
    expect(tempoMapFor(p, 'pattern').automated).toBe(false)
    expect(tempoMapFor(p, 'song').automated).toBe(true)
  })

  it('reuses the map until the tempo or a tempo clip changes', () => {
    const p = project(120, [{ start: 0, length: BAR, points: [pt(0, 60)] }])
    const a = tempoMap(p)
    expect(tempoMap({ ...p, swing: 0.5 })).toBe(a)
    expect(tempoMap({ ...p, tempo: 121 })).not.toBe(a)
    expect(tempoClips(p)).toHaveLength(1)
  })

  it('a flat tempo clip at the project tempo is not automation', () => {
    expect(buildTempoMap({ tempo: 120 }, tempoClips(project(120, [{ start: 0, length: BAR, points: [pt(0, 120)] }]))).automated).toBe(false)
  })
})
