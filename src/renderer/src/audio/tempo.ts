// Tempo map: song tick ⇄ seconds when tempo automation clips play (song mode). Pure: shared by live playback,
// offline export, the time display and MIDI recording so they all agree on where a tick is in time.
//
// Tempo automation is sampled on the same 1/16-beat grid as every other automation (transport.ts
// scheduleAutomation) and the tempo is constant inside one grid step. Before the first tempo clip the project
// tempo plays; after a clip ends its last value holds (FL behaviour) until another tempo clip starts.
import { PPQ, type Automation, type Clip, type Project } from '../store/types'
import { automationValue } from './sequence'

export const TEMPO_MIN = 10
export const TEMPO_MAX = 522
/** Automation sampling grid (ticks). */
export const TEMPO_STEP = PPQ / 16

export const clampTempo = (bpm: number): number => Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm))
/** Tempo automation values are linear over the whole tempo range. */
export const tempoToNorm = (bpm: number): number => (clampTempo(bpm) - TEMPO_MIN) / (TEMPO_MAX - TEMPO_MIN)
export const normToTempo = (v: number): number => TEMPO_MIN + Math.min(1, Math.max(0, v)) * (TEMPO_MAX - TEMPO_MIN)

export interface TempoMap {
  /** True when the tempo changes somewhere (song mode with tempo automation). */
  readonly automated: boolean
  bpmAt(tick: number): number
  /** Seconds from tick 0 to `tick`. */
  secondsAt(tick: number): number
  /** Inverse of secondsAt. */
  tickAt(seconds: number): number
}

export function constantTempo(bpm: number): TempoMap {
  const tps = (bpm * PPQ) / 60
  return { automated: false, bpmAt: () => bpm, secondsAt: (t) => t / tps, tickAt: (s) => s * tps }
}

interface TempoClip {
  clip: Clip
  auto: Automation
}

/** Unmuted automation clips that drive the tempo, in playlist order. */
export function tempoClips(p: Project): TempoClip[] {
  const out: TempoClip[] = []
  for (const clip of p.playlist.clips) {
    if (clip.kind !== 'automation' || clip.muted || p.playlist.tracks[clip.track]?.muted) continue
    const auto = p.automations.find((a) => a.id === clip.ref)
    if (auto?.target?.kind === 'tempo') out.push({ clip, auto })
  }
  return out
}

/** Build the tempo map for song mode (pattern mode plays at the project tempo: use constantTempo). */
export function buildTempoMap(p: Pick<Project, 'tempo'>, clips: TempoClip[]): TempoMap {
  if (!clips.length) return constantTempo(p.tempo)
  const end = clips.reduce((m, c) => Math.max(m, c.clip.start + c.clip.length), 0)
  const n = Math.ceil(end / TEMPO_STEP)
  const bpm = new Float64Array(n)
  const cum = new Float64Array(n + 1) // seconds at the start of each step
  let cur = p.tempo
  let changes = false
  for (let i = 0; i < n; i++) {
    const t = i * TEMPO_STEP
    // the clip that starts last wins where clips overlap
    let best: TempoClip | null = null
    for (const c of clips) if (c.clip.start <= t && t < c.clip.start + c.clip.length && (!best || c.clip.start >= best.clip.start)) best = c
    if (best) cur = normToTempo(automationValue(best.auto, t - best.clip.start + best.clip.offset))
    if (cur !== p.tempo) changes = true
    bpm[i] = cur
    cum[i + 1] = cum[i] + (TEMPO_STEP * 60) / (cur * PPQ)
  }
  if (!changes) return constantTempo(p.tempo)
  const last = cur
  const secPerTick = (b: number) => 60 / (b * PPQ)
  return {
    automated: true,
    bpmAt(tick) {
      if (tick < 0) return bpm[0]
      const i = Math.floor(tick / TEMPO_STEP)
      return i < n ? bpm[i] : last
    },
    secondsAt(tick) {
      if (tick <= 0) return tick * secPerTick(bpm[0])
      const i = Math.floor(tick / TEMPO_STEP)
      if (i >= n) return cum[n] + (tick - n * TEMPO_STEP) * secPerTick(last)
      return cum[i] + (tick - i * TEMPO_STEP) * secPerTick(bpm[i])
    },
    tickAt(seconds) {
      if (seconds <= 0) return seconds / secPerTick(bpm[0])
      if (seconds >= cum[n]) return n * TEMPO_STEP + (seconds - cum[n]) / secPerTick(last)
      let lo = 0
      let hi = n - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (cum[mid] <= seconds) lo = mid
        else hi = mid - 1
      }
      return lo * TEMPO_STEP + (seconds - cum[lo]) / secPerTick(bpm[lo])
    }
  }
}

// One-entry memo: rebuilding only when the tempo or a tempo clip / automation / track mute changes, not on
// every unrelated edit (knob drags produce a new project snapshot each frame).
let memo: { tempo: number; key: unknown[]; map: TempoMap } | null = null

/** Tempo map of a project as song mode plays it. */
export function tempoMap(p: Project): TempoMap {
  const clips = tempoClips(p)
  const key = clips.flatMap((c) => [c.clip, c.auto])
  if (memo && memo.tempo === p.tempo && memo.key.length === key.length && memo.key.every((x, i) => x === key[i])) return memo.map
  const map = buildTempoMap(p, clips)
  memo = { tempo: p.tempo, key, map }
  return map
}

/** Tempo map for a transport mode: automation only plays in song mode. */
export function tempoMapFor(p: Project, mode: 'pattern' | 'song'): TempoMap {
  return mode === 'song' ? tempoMap(p) : constantTempo(p.tempo)
}
