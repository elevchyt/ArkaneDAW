// Playlist editing operations that touch the project (all undoable through editProject).
import { editProject, getProject } from '@/store/project'
import { autoCrossfade, clampFades } from '@/audio/fades'
import { uid, makeChannel, makePlaylistTrack, CHANNEL_COLORS, PATTERN_COLORS } from '@/store/factory'
import { PPQ, PLAYLIST_TRACKS, type Automation, type AutomationTarget, type Clip, type Project, type Sample } from '@/store/types'
import { useUI } from '@/store/ui'
import { patternLength, barTicks } from '@/audio/sequence'
import { getPlugin } from '@/plugins/registry'
import { normalize } from '@/plugins/sdk/params'
import { applyClipDiff, diffClips } from './ops'
import { getPl, setSelection, type ClipSource } from './state'
import { makePoint } from './automation'

export const ticksPerSecond = (p: Pick<Project, 'tempo'>): number => (p.tempo * PPQ) / 60

/** Commit a preview clip array as one undo step (only the differences are written). */
export function commitClips(label: string, before: readonly Clip[], after: readonly Clip[]): void {
  // audio clips: fades stay inside resized clips; new overlaps on a track become crossfades
  after = autoCrossfade(before, after.map(clampFades))
  const diff = diffClips(before, after)
  if (!diff.removed.size && !diff.upserts.length) return
  const r = withAudioChannels(diff.upserts)
  editProject(label, (d) => {
    if (r.channels.length) d.channels.push(...r.channels)
    applyClipDiff(d.playlist.clips, diff.removed, r.clips)
  })
}

/** Natural length (ticks) of a clip source. */
export function sourceLength(p: Project, s: ClipSource): number {
  if (s.kind === 'pattern') {
    const pat = p.patterns.find((x) => x.id === s.ref)
    return pat ? patternLength(pat, p) : barTicks(p)
  }
  if (s.kind === 'audio') {
    const smp = p.samples.find((x) => x.id === s.ref)
    return smp ? Math.max(1, Math.round(smp.duration * ticksPerSecond(p))) : barTicks(p)
  }
  const a = p.automations.find((x) => x.id === s.ref)
  return a ? Math.max(a.length, a.points[a.points.length - 1]?.t ?? 0, PPQ) : barTicks(p)
}

/** Pattern clips loop their pattern: offsets wrap at the pattern length. 0 = no wrap. */
export function clipWrap(p: Project, c: Clip): number {
  if (c.kind !== 'pattern') return 0
  const pat = p.patterns.find((x) => x.id === c.ref)
  return pat ? patternLength(pat, p) : 0
}

/** Max length of an audio clip given its offset (can't play past the sample). */
export function clipMaxLen(p: Project, c: Clip): number {
  if (c.kind !== 'audio') return Infinity
  return Math.max(6, sourceLength(p, { kind: 'audio', ref: c.ref }) - c.offset)
}

export function sourceName(p: Project, s: ClipSource): string {
  if (s.kind === 'pattern') return p.patterns.find((x) => x.id === s.ref)?.name ?? '?'
  if (s.kind === 'audio') return p.samples.find((x) => x.id === s.ref)?.name ?? '?'
  return p.automations.find((x) => x.id === s.ref)?.name ?? '?'
}

export function sourceColor(p: Project, s: ClipSource, channelId?: string): string {
  if (s.kind === 'pattern') return p.patterns.find((x) => x.id === s.ref)?.color ?? PATTERN_COLORS[0]
  if (s.kind === 'audio') {
    const ch = p.channels.find((c) => c.id === channelId) ?? p.channels.find((c) => c.kind === 'audio' && c.sampler?.sampleId === s.ref)
    return ch?.color ?? '#5f8171'
  }
  return p.automations.find((x) => x.id === s.ref)?.color ?? '#7d6e9c'
}

/** Current Draw/Paint source (falls back to the current pattern). */
export function currentSource(): ClipSource | null {
  const p = getProject()
  const s = getPl().source
  if (s) {
    const ok =
      (s.kind === 'pattern' && p.patterns.some((x) => x.id === s.ref)) ||
      (s.kind === 'audio' && p.samples.some((x) => x.id === s.ref)) ||
      (s.kind === 'automation' && p.automations.some((x) => x.id === s.ref))
    if (ok) return s
  }
  const pid = useUI.getState().currentPattern ?? p.patterns[0]?.id
  return pid ? { kind: 'pattern', ref: pid } : null
}

export function selectSource(s: ClipSource): void {
  getPl().set({ source: s })
  if (s.kind === 'pattern') useUI.getState().set({ currentPattern: s.ref })
}

/** Audio clips need an 'audio' channel that owns their playback (FL "Audio clip" channel). */
export function audioChannelFor(p: Project, sample: Sample): { id: string; create: ReturnType<typeof makeChannel> | null } {
  const existing = p.channels.find((c) => c.kind === 'audio' && c.sampler?.sampleId === sample.id)
  if (existing) return { id: existing.id, create: null }
  const ch = makeChannel(sample.name, null, {
    kind: 'audio',
    color: CHANNEL_COLORS[p.channels.length % CHANNEL_COLORS.length],
    sampler: {
      sampleId: sample.id,
      rootKey: 60,
      reverse: false,
      loop: false,
      attack: 0,
      decay: 0,
      sustain: 1,
      release: 0,
      startOffset: 0,
      oneShot: true,
      pitchToKey: false
    }
  })
  return { id: ch.id, create: ch }
}

/** Build a new clip for a source (does not commit). Audio channels are created as needed by `placeClips`. */
export function makeClip(p: Project, s: ClipSource, track: number, start: number): Clip {
  return { id: uid(), kind: s.kind, ref: s.ref, track, start: Math.max(0, start), length: sourceLength(p, s), offset: 0, muted: false }
}

/**
 * Audio clips need an owning 'audio' channel. Returns copies of `clips` with `channelId` filled in
 * plus the channels that must be created.
 */
export function withAudioChannels(clips: readonly Clip[]): { clips: Clip[]; channels: ReturnType<typeof makeChannel>[] } {
  const p = getProject()
  const channels: ReturnType<typeof makeChannel>[] = []
  const out = clips.map((c) => {
    if (c.kind !== 'audio' || c.channelId) return c
    const s = p.samples.find((x) => x.id === c.ref)
    if (!s) return c
    const pending = channels.find((ch) => ch.sampler?.sampleId === s.id)
    if (pending) return { ...c, channelId: pending.id }
    const r = audioChannelFor(p, s)
    if (r.create) channels.push(r.create)
    return { ...c, channelId: r.id }
  })
  return { clips: out, channels }
}

/** Commit new clips (creating audio channels as needed). */
export function placeClips(label: string, clips: readonly Clip[]): void {
  const r = withAudioChannels(clips)
  editProject(label, (d) => {
    d.channels.push(...r.channels)
    d.playlist.clips.push(...r.clips)
  })
}

// ── clip menu ─────────────────────────────────────────────────────────────────
export function renameClipSource(c: Clip, name: string): void {
  editProject('Rename', (d) => {
    if (c.kind === 'pattern') {
      const x = d.patterns.find((x) => x.id === c.ref)
      if (x) x.name = name
    } else if (c.kind === 'automation') {
      const x = d.automations.find((x) => x.id === c.ref)
      if (x) x.name = name
    } else {
      const x = d.samples.find((x) => x.id === c.ref)
      if (x) x.name = name
      const ch = d.channels.find((x) => x.id === c.channelId)
      if (ch) ch.name = name
    }
  })
}

export function colorClipSource(c: Clip, color: string): void {
  editProject('Change color', (d) => {
    if (c.kind === 'pattern') {
      const x = d.patterns.find((x) => x.id === c.ref)
      if (x) x.color = color
    } else if (c.kind === 'automation') {
      const x = d.automations.find((x) => x.id === c.ref)
      if (x) x.color = color
    } else {
      const ch = d.channels.find((x) => x.id === c.channelId)
      if (ch) ch.color = color
    }
  })
}

/** "Make unique": give this clip its own copy of the pattern / automation. */
export function makeUnique(clipId: string): void {
  const p = getProject()
  const c = p.playlist.clips.find((x) => x.id === clipId)
  if (!c || c.kind === 'audio') return
  const newId = uid()
  const srcPat = c.kind === 'pattern' ? p.patterns.find((x) => x.id === c.ref) : undefined
  const srcAuto = c.kind === 'automation' ? p.automations.find((x) => x.id === c.ref) : undefined
  if (!srcPat && !srcAuto) return
  editProject('Make unique', (d) => {
    const clip = d.playlist.clips.find((x) => x.id === clipId)
    if (!clip) return
    if (srcPat) {
      const i = d.patterns.findIndex((x) => x.id === c.ref)
      d.patterns.splice(i + 1, 0, { ...structuredClone(srcPat), id: newId, name: `${srcPat.name} #2` })
    } else if (srcAuto) {
      d.automations.push({ ...structuredClone(srcAuto), id: newId, name: `${srcAuto.name} #2` })
    }
    clip.ref = newId
  })
  if (c.kind === 'pattern') useUI.getState().set({ currentPattern: newId })
}

export function deleteClips(ids: ReadonlySet<string>, label = 'Delete clips'): void {
  if (!ids.size) return
  editProject(label, (d) => {
    d.playlist.clips = d.playlist.clips.filter((c) => !ids.has(c.id))
  })
  const sel = getPl().selected
  if ([...ids].some((id) => sel.has(id))) setSelection([...sel].filter((id) => !ids.has(id)))
}

export function setClipsMuted(ids: ReadonlySet<string>, muted: boolean | 'toggle', label = 'Mute clips'): void {
  if (!ids.size) return
  editProject(label, (d) => {
    for (const c of d.playlist.clips) if (ids.has(c.id)) c.muted = muted === 'toggle' ? !c.muted : muted
  })
}

// ── tracks ────────────────────────────────────────────────────────────────────
export function updateTrack(i: number, patch: Partial<Project['playlist']['tracks'][number]>, label = 'Change track', coalesceKey?: string): void {
  editProject(label, (d) => {
    const t = d.playlist.tracks[i]
    if (t) Object.assign(t, patch)
  }, { coalesceKey })
}

export function soloTrack(i: number): void {
  const tracks = getProject().playlist.tracks
  const soloed = !tracks[i].muted && tracks.every((t, j) => j === i || t.muted)
  editProject('Solo track', (d) => {
    d.playlist.tracks.forEach((t, j) => (t.muted = soloed ? false : j !== i))
  })
}

export function insertTrack(i: number): void {
  editProject('Insert track', (d) => {
    d.playlist.tracks.splice(i, 0, makePlaylistTrack(i))
    d.playlist.tracks.length = PLAYLIST_TRACKS
    d.playlist.tracks.forEach((t, j) => {
      if (/^Track \d+$/.test(t.name)) t.name = `Track ${j + 1}`
    })
    d.playlist.clips = d.playlist.clips.filter((c) => c.track < PLAYLIST_TRACKS - 1 || c.track < i)
    for (const c of d.playlist.clips) if (c.track >= i) c.track++
  })
}

export function deleteTrack(i: number): void {
  editProject('Delete track', (d) => {
    d.playlist.tracks.splice(i, 1)
    d.playlist.tracks.push(makePlaylistTrack(PLAYLIST_TRACKS - 1))
    d.playlist.tracks.forEach((t, j) => {
      if (/^Track \d+$/.test(t.name)) t.name = `Track ${j + 1}`
    })
    d.playlist.clips = d.playlist.clips.filter((c) => c.track !== i)
    for (const c of d.playlist.clips) if (c.track > i) c.track--
  })
}

/** Shift+wheel on a track header: swap with the neighbour (clips follow their track). */
export function moveTrack(i: number, dir: -1 | 1): number {
  const j = i + dir
  if (j < 0 || j >= PLAYLIST_TRACKS) return i
  editProject('Move track', (d) => {
    const t = d.playlist.tracks
    ;[t[i], t[j]] = [t[j], t[i]]
    for (const c of d.playlist.clips) {
      if (c.track === i) c.track = j
      else if (c.track === j) c.track = i
    }
  }, { coalesceKey: 'move-track' })
  return j
}

// ── markers ───────────────────────────────────────────────────────────────────
export function addMarker(pos: number): void {
  const p = getProject()
  const n = p.markers.filter((m) => m.kind === 'marker').length + 1
  editProject('Add marker', (d) => {
    d.markers.push({ id: uid(), pos: Math.max(0, Math.round(pos)), name: `Marker #${n}`, kind: 'marker' })
    d.markers.sort((a, b) => a.pos - b.pos)
  })
}

// ── automation clips ──────────────────────────────────────────────────────────
export function targetLabel(p: Project, t: AutomationTarget): string {
  switch (t.kind) {
    case 'channel': {
      const ch = p.channels.find((c) => c.id === t.channelId)
      return `${ch?.name ?? 'Channel'} - ${t.param[0].toUpperCase()}${t.param.slice(1)}`
    }
    case 'channelPlugin': {
      const ch = p.channels.find((c) => c.id === t.channelId)
      const def = ch?.plugin ? getPlugin(ch.plugin.pluginId)?.manifest.params.find((x) => x.id === t.paramId) : undefined
      return `${ch?.name ?? 'Channel'} - ${def?.name ?? t.paramId}`
    }
    case 'mixer':
      return `${p.mixer[t.track]?.name ?? `Insert ${t.track}`} - ${t.param === 'volume' ? 'Volume' : t.param === 'pan' ? 'Pan' : 'Stereo'}`
    case 'masterVolume':
      return 'Main volume'
    case 'masterPitch':
      return 'Main pitch'
    case 'tempo':
      return 'Tempo'
    default:
      return 'Automation'
  }
}

/** Current normalized (0..1) value of a target, so new clips start flat at the present setting. */
export function targetValue(p: Project, t: AutomationTarget): number {
  switch (t.kind) {
    case 'channel': {
      const ch = p.channels.find((c) => c.id === t.channelId)
      if (!ch) return 0.5
      if (t.param === 'volume') return ch.volume / 1.25
      if (t.param === 'pan') return (ch.pan + 1) / 2
      return 0.5
    }
    case 'channelPlugin': {
      const ch = p.channels.find((c) => c.id === t.channelId)
      const def = ch?.plugin ? getPlugin(ch.plugin.pluginId)?.manifest.params.find((x) => x.id === t.paramId) : undefined
      if (!ch?.plugin || !def) return 0.5
      return normalize(def, ch.plugin.params[t.paramId] ?? def.default)
    }
    case 'mixer': {
      const m = p.mixer[t.track]
      if (!m) return 0.5
      if (t.param === 'volume') return m.volume / 1.25
      if (t.param === 'pan') return (m.pan + 1) / 2
      return (m.stereoSep + 1) / 2
    }
    case 'masterVolume':
      return p.masterVolume / 1.25
    default:
      return 0.5
  }
}

/** Create an automation clip for a target on a track (spans the time selection or the song). */
export function createAutomationClip(target: AutomationTarget, track: number, range?: { start: number; end: number }): string {
  const p = getProject()
  const bar = barTicks(p)
  let end = 0
  for (const c of p.playlist.clips) end = Math.max(end, c.start + c.length)
  const start = range?.start ?? 0
  const len = Math.max(bar, range ? range.end - range.start : Math.max(bar * 4, Math.ceil(end / bar) * bar))
  const v = targetValue(p, target)
  const a: Automation = {
    id: uid(),
    name: targetLabel(p, target),
    color: '#7d6e9c',
    target,
    points: [makePoint(0, v), makePoint(len, v)],
    length: len
  }
  const clip: Clip = { id: uid(), kind: 'automation', ref: a.id, track, start, length: len, offset: 0, muted: false }
  editProject('Add automation clip', (d) => {
    d.automations.push(a)
    d.playlist.clips.push(clip)
    const t = d.playlist.tracks[track]
    if (t && /^Track \d+$/.test(t.name)) t.name = a.name
  })
  getPl().set({ source: { kind: 'automation', ref: a.id } })
  return a.id
}

export function deleteAutomation(id: string): void {
  editProject('Delete automation', (d) => {
    d.automations = d.automations.filter((a) => a.id !== id)
    d.playlist.clips = d.playlist.clips.filter((c) => !(c.kind === 'automation' && c.ref === id))
  })
}

export function setAutomationPoints(id: string, points: Automation['points'], label = 'Edit automation'): void {
  editProject(label, (d) => {
    const a = d.automations.find((x) => x.id === id)
    if (!a) return
    a.points = points
    const last = points[points.length - 1]?.t ?? 0
    if (last > a.length) a.length = last
  })
}
