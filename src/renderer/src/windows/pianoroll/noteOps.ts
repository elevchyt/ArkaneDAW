// Pure note-list operations (quantize, legato, glue, chop, transpose…). Each returns a NEW sorted array
// and never mutates its input. `ids` = notes to affect; null/empty = every note (FL applies tools to all
// notes when nothing is selected).
import type { Note } from '@/store/types'
import { uid } from '@/store/factory'
import { MAX_KEY } from './music'
import { snapCeil, snapRound } from './snap'

export type IdSet = ReadonlySet<string> | null

const affects = (ids: IdSet, n: Note): boolean => !ids || ids.size === 0 || ids.has(n.id)

export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => a.pos - b.pos || a.key - b.key)
}

export function transpose(notes: Note[], ids: IdSet, semis: number): Note[] {
  const sel = notes.filter((n) => affects(ids, n))
  if (!sel.length) return notes
  let lo = Infinity
  let hi = -Infinity
  for (const n of sel) {
    lo = Math.min(lo, n.key)
    hi = Math.max(hi, n.key)
  }
  const d = Math.max(-lo, Math.min(MAX_KEY - hi, semis))
  if (d === 0) return notes
  return sortNotes(notes.map((n) => (affects(ids, n) ? { ...n, key: n.key + d } : n)))
}

export function nudge(notes: Note[], ids: IdSet, dt: number): Note[] {
  const sel = notes.filter((n) => affects(ids, n))
  if (!sel.length) return notes
  const minPos = Math.min(...sel.map((n) => n.pos))
  const d = Math.max(-minPos, dt)
  if (d === 0) return notes
  return sortNotes(notes.map((n) => (affects(ids, n) ? { ...n, pos: n.pos + d } : n)))
}

/** Quick quantize: snap start times to the grid (lengths unchanged). */
export function quantizeStarts(notes: Note[], ids: IdSet, grid: number): Note[] {
  if (grid <= 0) return notes
  return sortNotes(notes.map((n) => (affects(ids, n) ? { ...n, pos: Math.max(0, snapRound(n.pos, grid)) } : n)))
}

/** Quick legato: extend/shorten each note up to the start of the next (later) note in time. */
export function legato(notes: Note[], ids: IdSet): Note[] {
  const sel = sortNotes(notes.filter((n) => affects(ids, n)))
  const starts = [...new Set(sel.map((n) => n.pos))].sort((a, b) => a - b)
  const next = new Map<string, number>()
  for (const n of sel) {
    // first distinct start time after this note
    let lo = 0
    let hi = starts.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (starts[mid] <= n.pos) lo = mid + 1
      else hi = mid
    }
    if (lo < starts.length) next.set(n.id, starts[lo] - n.pos)
  }
  return sortNotes(notes.map((n) => (next.has(n.id) ? { ...n, len: Math.max(1, next.get(n.id)!) } : n)))
}

/** Glue: merge touching/overlapping notes on the same key into one. */
export function glue(notes: Note[], ids: IdSet): Note[] {
  const sel = sortNotes(notes.filter((n) => affects(ids, n)))
  const removed = new Set<string>()
  const grown = new Map<string, Note>()
  const byKey = new Map<number, Note[]>()
  for (const n of sel) {
    let l = byKey.get(n.key)
    if (!l) byKey.set(n.key, (l = []))
    l.push(n)
  }
  for (const list of byKey.values()) {
    let cur: Note | null = null
    for (const n of list) {
      if (cur && n.pos <= cur.pos + cur.len) {
        const c: Note = cur
        const merged: Note = { ...c, len: Math.max(c.len, n.pos + n.len - c.pos) }
        grown.set(merged.id, merged)
        cur = merged
        removed.add(n.id)
      } else cur = n
    }
  }
  if (!removed.size) return notes
  return sortNotes(notes.filter((n) => !removed.has(n.id)).map((n) => grown.get(n.id) ?? n))
}

/** Quick chop: cut each note into grid-sized pieces. */
export function chop(notes: Note[], ids: IdSet, grid: number, newId: () => string = uid): Note[] {
  if (grid <= 0) return notes
  const out: Note[] = []
  for (const n of notes) {
    if (!affects(ids, n) || n.len <= grid) {
      out.push(n)
      continue
    }
    const end = n.pos + n.len
    let p = n.pos
    let first = true
    while (p < end) {
      const next = Math.min(end, snapCeil(p + 1, grid))
      out.push({ ...n, id: first ? n.id : newId(), pos: p, len: next - p })
      first = false
      p = next
    }
  }
  return sortNotes(out)
}

/** Split one note at tick t (strictly inside). Returns null if t isn't inside the note. */
export function sliceNote(n: Note, t: number, newId: () => string = uid): [Note, Note] | null {
  if (t <= n.pos || t >= n.pos + n.len) return null
  return [
    { ...n, len: t - n.pos },
    { ...n, id: newId(), pos: t, len: n.pos + n.len - t }
  ]
}

/** Span (first start .. last end) of the affected notes, or null. */
export function span(notes: Note[], ids: IdSet): { start: number; end: number } | null {
  let start = Infinity
  let end = -Infinity
  for (const n of notes) {
    if (!affects(ids, n)) continue
    start = Math.min(start, n.pos)
    end = Math.max(end, n.pos + n.len)
  }
  return start === Infinity ? null : { start, end }
}

/** Ctrl+B: copy the affected notes `offset` ticks to the right. Returns new list + ids of the copies. */
export function duplicate(notes: Note[], ids: IdSet, offset: number, newId: () => string = uid): { notes: Note[]; ids: Set<string> } {
  const copies = notes.filter((n) => affects(ids, n)).map((n) => ({ ...n, id: newId(), pos: n.pos + offset }))
  return { notes: sortNotes([...notes, ...copies]), ids: new Set(copies.map((c) => c.id)) }
}

export function setProp<K extends keyof Note>(notes: Note[], ids: IdSet, key: K, value: Note[K]): Note[] {
  let changed = false
  const out = notes.map((n) => {
    if (!affects(ids, n) || n[key] === value) return n
    changed = true
    return { ...n, [key]: value }
  })
  return changed ? out : notes
}

/** Notes starting inside a time range [start, end) (ruler time selection, like FL). */
export function notesInRange(notes: Note[], start: number, end: number): Note[] {
  return notes.filter((n) => n.pos >= start && n.pos < end)
}
