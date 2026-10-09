// Pure helpers that turn the project model into timed events. Shared by live playback and export.
import { PPQ, TICKS_PER_STEP, type Automation, type AutomationPoint, type Clip, type Note, type Pattern, type Project } from '../store/types'

export const barTicks = (p: Pick<Project, 'timeSig'>): number => (PPQ * 4 * p.timeSig[0]) / p.timeSig[1]

/** FL-style automatic pattern length: content rounded up to whole bars, at least one bar. */
export function patternLength(pattern: Pattern, project: Pick<Project, 'timeSig'>): number {
  if (pattern.length > 0) return pattern.length
  const bar = barTicks(project)
  let end = 0
  for (const notes of Object.values(pattern.notes)) for (const n of notes) end = Math.max(end, n.pos + Math.max(n.len, 1))
  return Math.max(bar, Math.ceil(end / bar) * bar)
}

/** End of the arrangement (last clip end rounded up to a bar). */
export function songLength(project: Project): number {
  const bar = barTicks(project)
  let end = 0
  for (const c of project.playlist.clips) end = Math.max(end, c.start + c.length)
  return Math.max(bar, Math.ceil(end / bar) * bar)
}

export interface NoteHit {
  channelId: string
  note: Note
  start: number // absolute song tick
  end: number // absolute song tick (truncated to clip end)
}

export function swingOffset(note: Note, swing: number): number {
  if (swing <= 0) return 0
  return note.pos % (TICKS_PER_STEP * 2) === TICKS_PER_STEP ? swing * TICKS_PER_STEP * 0.66 : 0
}

/** Notes of one pattern that START in [from, to) where pattern-local tick 0 sits at `origin`. */
export function patternHits(
  project: Project,
  pattern: Pattern,
  origin: number,
  from: number,
  to: number,
  clip?: Pick<Clip, 'start' | 'length' | 'offset'>,
  mutedChannels?: Set<string>
): NoteHit[] {
  const out: NoteHit[] = []
  const swing = project.swing
  for (const [channelId, notes] of Object.entries(pattern.notes)) {
    if (mutedChannels?.has(channelId)) continue
    for (const n of notes) {
      if (n.muted) continue
      const local = n.pos + swingOffset(n, swing)
      if (clip && (local < clip.offset || local >= clip.offset + clip.length)) continue
      const start = origin + local
      if (start < from || start >= to) continue
      let end = start + Math.max(1, n.len)
      if (clip) end = Math.min(end, clip.start + clip.length)
      out.push({ channelId, note: n, start, end })
    }
  }
  return out
}

/** All note hits in song mode for [from, to). */
export function songHits(project: Project, from: number, to: number): NoteHit[] {
  const out: NoteHit[] = []
  const tracks = project.playlist.tracks
  const muted = new Set(project.channels.filter((c) => c.muted).map((c) => c.id))
  for (const clip of project.playlist.clips) {
    if (clip.kind !== 'pattern' || clip.muted || tracks[clip.track]?.muted) continue
    if (clip.start >= to || clip.start + clip.length <= from) continue
    const pattern = project.patterns.find((p) => p.id === clip.ref)
    if (!pattern) continue
    // Pattern clips longer than their pattern loop the pattern (FL behaviour when stretched).
    const plen = patternLength(pattern, project)
    const origin0 = clip.start - clip.offset
    const firstLoop = Math.max(0, Math.floor((from - origin0) / plen) - 1)
    for (let k = firstLoop; origin0 + k * plen < Math.min(to, clip.start + clip.length); k++) {
      const origin = origin0 + k * plen
      for (const h of patternHits(project, pattern, origin, from, to, undefined, muted)) {
        if (h.start < clip.start || h.start >= clip.start + clip.length) continue
        h.end = Math.min(h.end, clip.start + clip.length)
        out.push(h)
      }
    }
  }
  return out
}

/** Evaluate an automation clip at a tick within the clip (0..length). Returns 0..1. */
export function automationValue(a: Automation, t: number): number {
  const pts = a.points
  if (pts.length === 0) return 0.5
  if (t <= pts[0].t) return pts[0].v
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]
    const p1 = pts[i + 1]
    if (t >= p0.t && t < p1.t) return interpolate(p0, p1, (t - p0.t) / Math.max(1, p1.t - p0.t))
  }
  return pts[pts.length - 1].v
}

function interpolate(p0: AutomationPoint, p1: AutomationPoint, x: number): number {
  switch (p1.mode) {
    case 'hold':
      return p0.v
    case 'stairs': {
      const steps = 4 + Math.round(Math.abs(p1.tension) * 12)
      return p0.v + (p1.v - p0.v) * (Math.floor(x * steps) / steps)
    }
    case 'pulse':
      return x < 0.5 + p1.tension * 0.45 ? p0.v : p1.v
    case 'wave': {
      const cycles = 1 + Math.round(Math.abs(p1.tension) * 15)
      return p0.v + (p1.v - p0.v) * (0.5 - 0.5 * Math.cos(x * Math.PI * 2 * cycles))
    }
    case 'smooth': {
      const s = x * x * (3 - 2 * x)
      return p0.v + (p1.v - p0.v) * s
    }
    case 'double': {
      const c = tensionCurve(x < 0.5 ? x * 2 : (x - 0.5) * 2, p1.tension)
      const mid = (p0.v + p1.v) / 2
      return x < 0.5 ? p0.v + (mid - p0.v) * c : mid + (p1.v - mid) * c
    }
    default:
      return p0.v + (p1.v - p0.v) * tensionCurve(x, p1.tension)
  }
}

function tensionCurve(x: number, tension: number): number {
  if (Math.abs(tension) < 0.001) return x
  const k = Math.pow(2, tension * 6) // >1 bows down, <1 bows up
  return Math.pow(x, k)
}
