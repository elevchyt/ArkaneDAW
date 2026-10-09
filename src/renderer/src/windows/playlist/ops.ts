// Pure clip-editing operations. All functions return new objects and never mutate inputs.
import type { Clip } from '@/store/types'

export type IdGen = () => string

let counter = 0
/** Fallback id generator for tests; the UI passes `uid`. */
export const seqId: IdGen = () => `c${++counter}`

export const MIN_CLIP = 6 // ticks

/** Positive modulo. */
export const mod = (a: number, n: number): number => (n > 0 ? ((a % n) + n) % n : a)

/** Clamp a move delta so no clip goes before 0 or outside the track range. */
export function clampMove(clips: readonly Clip[], dTick: number, dTrack: number, trackCount: number): { dTick: number; dTrack: number } {
  if (clips.length === 0) return { dTick, dTrack }
  let minStart = Infinity
  let minTrack = Infinity
  let maxTrack = -Infinity
  for (const c of clips) {
    minStart = Math.min(minStart, c.start)
    minTrack = Math.min(minTrack, c.track)
    maxTrack = Math.max(maxTrack, c.track)
  }
  return {
    dTick: Math.max(dTick, -minStart) + 0,
    dTrack: Math.min(Math.max(dTrack, -minTrack), trackCount - 1 - maxTrack) + 0
  }
}

/** Apply a (pre-clamped) move to the clips whose ids are in `ids`. */
export function moveClips(clips: readonly Clip[], ids: ReadonlySet<string>, dTick: number, dTrack: number): Clip[] {
  if (dTick === 0 && dTrack === 0) return clips as Clip[]
  return clips.map((c) => (ids.has(c.id) ? { ...c, start: c.start + dTick, track: c.track + dTrack } : c))
}

/** Drag the right edge: new end tick. `maxLen` caps audio clips at their source length. */
export function resizeRight(c: Clip, newEnd: number, maxLen = Infinity): Clip {
  const length = Math.min(maxLen, Math.max(MIN_CLIP, newEnd - c.start))
  return length === c.length ? c : { ...c, length }
}

/**
 * Drag the left edge: moves start and offset together so content stays in place.
 * `wrap` (pattern length) lets pattern clips extend left by looping; otherwise offset is clamped at 0.
 */
export function trimLeft(c: Clip, newStart: number, wrap = 0): Clip {
  const end = c.start + c.length
  let start = Math.min(Math.max(0, newStart), end - MIN_CLIP)
  let offset = c.offset + (start - c.start)
  if (offset < 0) {
    if (wrap > 0) offset = mod(offset, wrap)
    else {
      start -= offset
      offset = 0
    }
  }
  if (start === c.start) return c
  return { ...c, start, length: end - start, offset }
}

/** Slip edit: move the content inside the clip. */
export function slipClip(c: Clip, dTick: number, origOffset: number, wrap = 0, maxOffset = Infinity): Clip {
  let offset = origOffset - dTick
  if (wrap > 0) offset = mod(offset, wrap)
  else offset = Math.min(Math.max(0, offset), maxOffset)
  return offset === c.offset ? c : { ...c, offset }
}

/** Split a clip at an absolute tick. Returns null when `at` is not strictly inside. */
export function sliceClip(c: Clip, at: number, gen: IdGen = seqId): [Clip, Clip] | null {
  if (at <= c.start || at >= c.start + c.length) return null
  const leftLen = at - c.start
  return [
    { ...c, length: leftLen },
    { ...c, id: gen(), start: at, length: c.length - leftLen, offset: c.offset + leftLen }
  ]
}

/** Slice every clip on tracks [tr0, tr1] crossing `at`. */
export function sliceAt(clips: readonly Clip[], at: number, tr0: number, tr1: number, gen: IdGen = seqId): Clip[] {
  const lo = Math.min(tr0, tr1)
  const hi = Math.max(tr0, tr1)
  const out: Clip[] = []
  for (const c of clips) {
    if (c.track < lo || c.track > hi) {
      out.push(c)
      continue
    }
    const parts = sliceClip(c, at, gen)
    if (parts) out.push(...parts)
    else out.push(c)
  }
  return out
}

/** Chop a clip into pieces of `size` ticks (FL "Chop"). */
export function chopClip(c: Clip, size: number, gen: IdGen = seqId): Clip[] {
  if (size <= 0 || c.length <= size) return [c]
  const out: Clip[] = []
  for (let s = 0; s < c.length; s += size) {
    const len = Math.min(size, c.length - s)
    out.push({ ...c, id: s === 0 ? c.id : gen(), start: c.start + s, length: len, offset: c.offset + s })
  }
  return out
}

/** Ctrl+Ins: insert `len` ticks of silence at `at` (splitting clips that cross it). */
export function insertSpace(clips: readonly Clip[], at: number, len: number, gen: IdGen = seqId): Clip[] {
  const out: Clip[] = []
  for (const c of clips) {
    if (c.start >= at) out.push({ ...c, start: c.start + len })
    else if (c.start + c.length > at) {
      const [a, b] = sliceClip(c, at, gen)!
      out.push(a, { ...b, start: b.start + len })
    } else out.push(c)
  }
  return out
}

/** Ctrl+Del: remove the time range [from, to) and close the gap. */
export function deleteSpace(clips: readonly Clip[], from: number, to: number, gen: IdGen = seqId): Clip[] {
  const len = to - from
  if (len <= 0) return clips as Clip[]
  const out: Clip[] = []
  for (const c of clips) {
    const end = c.start + c.length
    if (end <= from) out.push(c)
    else if (c.start >= to) out.push({ ...c, start: c.start - len })
    else if (c.start >= from && end <= to) continue // fully inside: removed
    else if (c.start < from && end > to) {
      // spans the whole range: keep head, shift tail
      const head = { ...c, length: from - c.start }
      const tail = { ...c, id: gen(), start: from, length: end - to, offset: c.offset + (to - c.start) }
      out.push(head, tail)
    } else if (c.start < from) out.push({ ...c, length: from - c.start })
    else out.push({ ...c, start: from, length: end - to, offset: c.offset + (to - c.start) })
  }
  return out
}

/** Bounding range of a set of clips. */
export function span(clips: readonly Clip[]): { start: number; end: number; minTrack: number; maxTrack: number } | null {
  if (!clips.length) return null
  let start = Infinity
  let end = -Infinity
  let minTrack = Infinity
  let maxTrack = -Infinity
  for (const c of clips) {
    start = Math.min(start, c.start)
    end = Math.max(end, c.start + c.length)
    minTrack = Math.min(minTrack, c.track)
    maxTrack = Math.max(maxTrack, c.track)
  }
  return { start, end, minTrack, maxTrack }
}

/** Copies of `clips` shifted by `dTick` (and tracks), with fresh ids. */
export function cloneShifted(clips: readonly Clip[], dTick: number, dTrack = 0, gen: IdGen = seqId): Clip[] {
  return clips.map((c) => ({ ...c, id: gen(), start: c.start + dTick, track: c.track + dTrack }))
}

/**
 * Ctrl+B: duplicate to the right. The span is rounded up to `grid` (a bar in FL) so
 * repeated duplication lines up.
 */
export function duplicateRight(clips: readonly Clip[], grid: number, gen: IdGen = seqId): Clip[] {
  const s = span(clips)
  if (!s) return []
  const len = s.end - s.start
  const shift = grid > 1 ? Math.ceil(len / grid) * grid : len
  return cloneShifted(clips, shift, 0, gen)
}

/** Paint tool: copies of `proto` laid end to end from its start up to (and covering) `toTick`. */
export function paintRepeat(proto: Clip, toTick: number, gen: IdGen = seqId): Clip[] {
  const out: Clip[] = []
  if (proto.length <= 0) return out
  for (let s = proto.start + proto.length; s <= toTick; s += proto.length) out.push({ ...proto, id: gen(), start: s })
  return out
}

/** What changed between two clip arrays (by reference): ids removed and clips added/modified. */
export function diffClips(before: readonly Clip[], after: readonly Clip[]): { removed: Set<string>; upserts: Clip[] } {
  const prev = new Map(before.map((c) => [c.id, c]))
  const next = new Set<string>()
  const upserts: Clip[] = []
  for (const c of after) {
    next.add(c.id)
    if (prev.get(c.id) !== c) upserts.push(c)
  }
  const removed = new Set<string>()
  for (const c of before) if (!next.has(c.id)) removed.add(c.id)
  return { removed, upserts }
}

/** Apply a diff onto a (draft) clip array in place. */
export function applyClipDiff(target: Clip[], removed: ReadonlySet<string>, upserts: readonly Clip[]): void {
  if (removed.size) {
    let w = 0
    for (let r = 0; r < target.length; r++) if (!removed.has(target[r].id)) target[w++] = target[r]
    target.length = w
  }
  if (!upserts.length) return
  const index = new Map<string, number>()
  for (let i = 0; i < target.length; i++) index.set(target[i].id, i)
  for (const c of upserts) {
    const i = index.get(c.id)
    if (i === undefined) {
      index.set(c.id, target.length)
      target.push(c)
    } else target[i] = c
  }
}
