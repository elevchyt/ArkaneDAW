// Audio clip fades (FL playlist): fade-in / fade-out lengths in ticks with a tension per fade, and automatic
// crossfades where two audio clips on the same track overlap. Pure helpers shared by the playlist (drawing,
// editing), live playback and offline export.
import type { Clip } from '../store/types'

/** Shortest fade worth applying (ticks). */
const MIN_FADE = 1

export const fadeIn = (c: Clip): number => Math.max(0, c.fadeIn ?? 0)
export const fadeOut = (c: Clip): number => Math.max(0, c.fadeOut ?? 0)
export const hasFades = (c: Clip): boolean => fadeIn(c) >= MIN_FADE || fadeOut(c) >= MIN_FADE

/**
 * Rising fade shape: progress x (0..1) → gain (0..1). tension 0 = linear, > 0 bows up (fast start,
 * "log"), < 0 bows down (slow start, "exponential"). The fade-out uses the same shape mirrored.
 */
export function fadeShape(x: number, tension = 0): number {
  const t = Math.min(1, Math.max(0, x))
  if (Math.abs(tension) < 1e-3) return t
  return Math.pow(t, Math.pow(4, -Math.max(-1, Math.min(1, tension))))
}

/** Gain of a clip at `t` ticks from its start (both fades applied). */
export function clipGainAt(c: Clip, t: number): number {
  const fi = fadeIn(c)
  const fo = fadeOut(c)
  let g = 1
  if (fi >= MIN_FADE && t < fi) g *= fadeShape(t / fi, c.fadeInTension ?? 0)
  if (fo >= MIN_FADE && t > c.length - fo) g *= fadeShape((c.length - t) / fo, c.fadeOutTension ?? 0)
  return Math.max(0, Math.min(1, g))
}

/** Keep fades inside the clip: fade-in + fade-out never exceed its length. */
export function clampFades(c: Clip): Clip {
  if (c.kind !== 'audio' || (c.fadeIn === undefined && c.fadeOut === undefined)) return c
  let fi = Math.min(fadeIn(c), c.length)
  let fo = Math.min(fadeOut(c), c.length)
  if (fi + fo > c.length) {
    const k = c.length / (fi + fo)
    fi *= k
    fo *= k
  }
  fi = Math.round(fi)
  fo = Math.round(fo)
  if (fi === (c.fadeIn ?? 0) && fo === (c.fadeOut ?? 0)) return c
  return { ...c, fadeIn: fi, fadeOut: fo }
}

/**
 * FL auto-crossfade: where an audio clip that changed now partially overlaps another audio clip on the same
 * track, the earlier clip fades out and the later one fades in across the overlap. Returns `after` with the
 * affected clips replaced (unchanged array when nothing overlaps).
 */
export function autoCrossfade(before: readonly Clip[], after: readonly Clip[]): Clip[] {
  const prev = new Map(before.map((c) => [c.id, c]))
  const moved = (c: Clip) => {
    const o = prev.get(c.id)
    return !o || o.start !== c.start || o.length !== c.length || o.track !== c.track
  }
  const audio = after.filter((c) => c.kind === 'audio')
  const patch = new Map<string, Clip>()
  const cur = (c: Clip) => patch.get(c.id) ?? c
  for (const a of audio) {
    for (const b of audio) {
      if (a === b || a.track !== b.track || a.start >= b.start) continue
      if (!moved(a) && !moved(b)) continue
      const aEnd = a.start + a.length
      const overlap = aEnd - b.start
      // partial overlap only: a clip lying entirely inside another isn't a crossfade
      if (overlap <= 0 || aEnd >= b.start + b.length) continue
      patch.set(a.id, { ...cur(a), fadeOut: overlap })
      patch.set(b.id, { ...cur(b), fadeIn: overlap })
    }
  }
  if (!patch.size) return after as Clip[]
  return after.map((c) => (patch.has(c.id) ? clampFades(patch.get(c.id)!) : c))
}

/** Cut fades that would end up inside a split point (slice / chop / delete space). */
export function splitFades(left: Clip, right: Clip): [Clip, Clip] {
  const l = left.fadeOut !== undefined || left.fadeIn !== undefined ? clampFades({ ...left, fadeOut: 0 }) : left
  const r = right.fadeIn !== undefined || right.fadeOut !== undefined ? clampFades({ ...right, fadeIn: 0 }) : right
  return [l, r]
}

/**
 * Schedule a clip's fades on a gain param. The source starts at `startTime` playing from `intoTicks` ticks
 * into the clip; `tps` = song ticks per second.
 */
export function scheduleClipFades(gain: AudioParam, c: Clip, startTime: number, intoTicks: number, tps: number): void {
  const fi = fadeIn(c)
  const fo = fadeOut(c)
  const timeOf = (tick: number) => startTime + (tick - intoTicks) / tps
  gain.setValueAtTime(clipGainAt(c, intoTicks), startTime)
  const segment = (from: number, to: number) => {
    const a = Math.max(from, intoTicks)
    if (to - a < MIN_FADE || (to - a) / tps < 0.002) return
    const n = Math.max(2, Math.min(256, Math.ceil(((to - a) / tps) * 200)))
    const curve = new Float32Array(n)
    for (let i = 0; i < n; i++) curve[i] = clipGainAt(c, a + ((to - a) * i) / (n - 1))
    gain.setValueCurveAtTime(curve, timeOf(a), (to - a) / tps)
  }
  if (fi >= MIN_FADE) segment(0, fi)
  // a 1 ms gap between the two curves keeps them from overlapping (setValueCurveAtTime throws on overlap)
  if (fo >= MIN_FADE) segment(Math.max(c.length - fo, fi >= MIN_FADE ? fi + 0.001 * tps : 0), c.length)
}
