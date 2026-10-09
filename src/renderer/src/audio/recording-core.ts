// Pure helpers for note and audio recording (no DOM / Web Audio) so they can be unit-tested.
import type { Snap } from '../store/ui'
import { PPQ, type Clip } from '../store/types'

// ── note recording ───────────────────────────────────────────────────────────

/**
 * Grid used to quantize recorded notes. FL quantizes live input only when the global snap is a
 * musical value (step, beat, bar and their fractions); Line / Cell / (none) leave timing as played.
 * Returns 0 for "don't quantize".
 */
export function recordQuantizeGrid(snap: Snap, timeSig: [number, number]): number {
  const step = PPQ / 4
  const beat = (PPQ * 4) / timeSig[1]
  switch (snap) {
    case '1/6step':
      return step / 6
    case '1/4step':
      return step / 4
    case '1/3step':
      return step / 3
    case '1/2step':
      return step / 2
    case 'step':
      return step
    case '1/6beat':
      return beat / 6
    case '1/4beat':
      return beat / 4
    case '1/3beat':
      return beat / 3
    case '1/2beat':
      return beat / 2
    case 'beat':
      return beat
    case 'bar':
      return beat * timeSig[0]
    default:
      return 0
  }
}

/** Quantize a played note (start / end independently, like FL's record quantize options). */
export function quantizeRecordedNote(
  pos: number,
  len: number,
  grid: number,
  opts: { start: boolean; end: boolean }
): { pos: number; len: number } {
  let s = grid > 0 && opts.start ? Math.round(pos / grid) * grid : pos
  s = Math.max(0, Math.round(s))
  let l = Math.round(len) // the played duration is kept when only the start moves
  if (grid > 0 && opts.end) l = Math.max(grid, Math.round((s + len) / grid) * grid - s)
  return { pos: s, len: Math.max(1, l) }
}

/**
 * Pattern-mode loop recording: the pattern loops while you play, so positions wrap at the pattern
 * length and a note held across the loop point is cut at the pattern end (it never grows the pattern).
 */
export function wrapPatternNote(pos: number, len: number, patternLen: number): { pos: number; len: number } {
  if (patternLen <= 0) return { pos: Math.max(0, pos), len: Math.max(1, len) }
  const p = ((Math.round(pos) % patternLen) + patternLen) % patternLen
  return { pos: p, len: Math.max(1, Math.min(Math.round(len), patternLen - p)) }
}

/**
 * Ranges (pattern ticks) swept by the playhead since recording input began, used by
 * replace (non-overdub) recording. Wraps at `loopLen`; Infinity = no looping (song mode).
 */
export function sweptRanges(startPos: number, elapsed: number, loopLen: number): [number, number][] {
  if (elapsed <= 0) return []
  if (!Number.isFinite(loopLen)) return [[startPos, startPos + elapsed]]
  if (elapsed >= loopLen) return [[0, loopLen]]
  const s = ((startPos % loopLen) + loopLen) % loopLen
  const e = s + elapsed
  if (e <= loopLen) return [[s, e]]
  return [
    [s, loopLen],
    [0, e - loopLen]
  ]
}

export const inRanges = (t: number, ranges: [number, number][]): boolean => ranges.some(([a, b]) => t >= a && t < b)

/** First playlist track with no clip overlapping [start, end). Returns -1 when all are taken. */
export function firstFreeTrack(clips: readonly Pick<Clip, 'track' | 'start' | 'length'>[], start: number, end: number, tracks: number, locked?: (i: number) => boolean): number {
  for (let i = 0; i < tracks; i++) {
    if (locked?.(i)) continue
    if (!clips.some((c) => c.track === i && c.start < end && c.start + c.length > start)) return i
  }
  return -1
}

// ── audio recording ──────────────────────────────────────────────────────────

export interface Chunk {
  frame: number // context frame of the first sample
  data: Float32Array[] // one array per channel, equal lengths
}

/**
 * Join frame-stamped chunks into contiguous channels starting at `startFrame`.
 * Gaps are filled with silence; samples before `startFrame` are dropped (latency trim),
 * and if capture began after `startFrame` the head is padded with silence so the take stays
 * aligned to the song position it was recorded at.
 */
export function assembleTake(chunks: readonly Chunk[], startFrame: number, channels: number, endFrame?: number): Float32Array[] {
  let last = startFrame
  for (const c of chunks) last = Math.max(last, c.frame + (c.data[0]?.length ?? 0))
  if (endFrame !== undefined) last = Math.min(last, Math.max(startFrame, endFrame))
  const len = Math.max(0, Math.round(last - startFrame))
  const out = Array.from({ length: channels }, () => new Float32Array(len))
  for (const c of chunks) {
    const n = c.data[0]?.length ?? 0
    for (let ch = 0; ch < channels; ch++) {
      const src = c.data[Math.min(ch, c.data.length - 1)]
      if (!src) continue
      const dst = out[ch]
      const off = Math.round(c.frame - startFrame)
      const from = Math.max(0, -off)
      const to = Math.min(n, len - off)
      if (to > from) dst.set(src.subarray(from, to), off + from)
    }
  }
  return out
}

/**
 * Total recording compensation in seconds. With a loopback calibration the measured round trip
 * replaces the reported device latencies; the user offset is always added (positive = later).
 */
export function compensationSec(o: {
  auto: boolean
  outputLatency: number
  baseLatency: number
  inputLatency: number
  calibratedMs: number | null
  offsetMs: number
}): number {
  let s = 0
  if (o.auto) s = o.calibratedMs != null ? o.calibratedMs / 1000 : (o.outputLatency || 0) + (o.baseLatency || 0) + (o.inputLatency || 0)
  return s + o.offsetMs / 1000
}

/**
 * Onset detection for loopback calibration: first sample (after `from`) whose magnitude exceeds
 * max(minLevel, k × noise floor measured before `from`). Returns -1 when nothing is found.
 */
export function detectOnset(x: Float32Array, from: number, minLevel = 0.02, k = 8): number {
  const f = Math.max(0, Math.min(x.length, Math.floor(from)))
  let noise = 0
  for (let i = 0; i < f; i++) noise = Math.max(noise, Math.abs(x[i]))
  const thr = Math.max(minLevel, noise * k)
  for (let i = f; i < x.length; i++) if (Math.abs(x[i]) > thr) return i
  return -1
}

export const median = (xs: number[]): number => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
