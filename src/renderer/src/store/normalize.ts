// Makes a loaded project safe to use. .arkane files are plain JSON and may be written by hand or by other tools
// (scripts, AI agents), so every object is filled up with its defaults, numbers are clamped to their ranges,
// missing / duplicate ids are replaced and references to things that don't exist are dropped.
// A project the app saved itself comes out unchanged.
import {
  makeChannel,
  makeEmptyProject,
  makeMixerTrack,
  makePattern,
  makePlaylistTrack,
  defaultNote,
  uid
} from './factory'
import {
  FX_SLOTS,
  MIXER_INSERTS,
  PLAYLIST_TRACKS,
  PPQ,
  type Automation,
  type AutomationPoint,
  type Channel,
  type Clip,
  type FxSlot,
  type Marker,
  type MixerTrack,
  type Note,
  type Pattern,
  type PluginInstanceState,
  type Project,
  type Sample
} from './types'

type Loose<T> = Partial<T> & Record<string, unknown>

const BAR = PPQ * 4
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = <T>(v: unknown): Loose<T>[] => (Array.isArray(v) ? v.filter(isObj) : []) as Loose<T>[]
const num = (v: unknown, def: number, min = -Infinity, max = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
const int = (v: unknown, def: number, min: number, max: number): number => Math.round(num(v, def, min, max))
const str = (v: unknown, def: string): string => (typeof v === 'string' ? v : def)
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def)
const oneOf = <T extends string>(v: unknown, options: readonly T[], def: T): T => (options.includes(v as T) ? (v as T) : def)

/** Gives every object an id that is unique within its list. */
function ids<T extends { id?: unknown }>(items: T[]): (T & { id: string })[] {
  const seen = new Set<string>()
  return items.map((it) => {
    let id = typeof it.id === 'string' && it.id ? it.id : uid()
    while (seen.has(id)) id = uid()
    seen.add(id)
    return { ...it, id }
  })
}

function plugin(v: unknown): PluginInstanceState | null {
  if (!isObj(v) || typeof v.pluginId !== 'string' || !v.pluginId) return null
  const params: Record<string, number> = {}
  if (isObj(v.params)) for (const [k, x] of Object.entries(v.params)) if (typeof x === 'number' && Number.isFinite(x)) params[k] = x
  return { ...(v as unknown as PluginInstanceState), params }
}

function note(n: Loose<Note>): Note | null {
  if (typeof n.pos !== 'number' || !Number.isFinite(n.pos)) return null
  const d = defaultNote()
  return {
    ...d,
    ...n,
    id: str(n.id, d.id),
    key: int(n.key, d.key, 0, 131),
    pos: Math.max(0, Math.round(n.pos)),
    len: Math.max(1, Math.round(num(n.len, d.len))),
    vel: num(n.vel, d.vel, 0, 1),
    pan: num(n.pan, d.pan, -1, 1),
    rel: num(n.rel, d.rel, 0, 1),
    fine: num(n.fine, d.fine, -120, 120),
    modX: num(n.modX, d.modX, 0, 1),
    modY: num(n.modY, d.modY, 0, 1),
    color: int(n.color, d.color, 0, 15),
    slide: bool(n.slide, false),
    porta: bool(n.porta, false),
    muted: bool(n.muted, false)
  }
}

function channel(c: Loose<Channel> & { id: string }, i: number): Channel {
  const d = makeChannel(`Channel ${i + 1}`, null)
  return {
    ...d,
    ...c,
    name: str(c.name, d.name),
    color: str(c.color, d.color),
    kind: oneOf(c.kind, ['instrument', 'sampler', 'audio', 'automation', 'layer'] as const, d.kind),
    plugin: plugin(c.plugin),
    volume: num(c.volume, d.volume, 0, 1.25),
    pan: num(c.pan, d.pan, -1, 1),
    pitch: num(c.pitch, d.pitch, -1200, 1200),
    mixerTrack: int(c.mixerTrack, d.mixerTrack, -1, MIXER_INSERTS),
    muted: bool(c.muted, false),
    filterGroup: str(c.filterGroup, d.filterGroup)
  }
}

function pattern(p: Loose<Pattern> & { id: string }, i: number, channelIds: Set<string>): Pattern {
  const d = makePattern(i + 1)
  const notes: Record<string, Note[]> = {}
  if (isObj(p.notes))
    for (const [cid, arr] of Object.entries(p.notes)) {
      if (!channelIds.has(cid)) continue
      const ok = ids(list<Note>(arr))
        .map(note)
        .filter((n): n is Note => n !== null)
      if (ok.length) notes[cid] = ok
    }
  return { ...d, ...p, name: str(p.name, d.name), color: str(p.color, d.color), notes, length: Math.max(0, Math.round(num(p.length, 0))) }
}

function mixerTrack(raw: Loose<MixerTrack> | undefined, index: number): MixerTrack {
  const d = makeMixerTrack(index)
  if (!raw) return d
  const slots: (FxSlot | null)[] = Array.from({ length: FX_SLOTS }, (_, s) => {
    const x = Array.isArray(raw.slots) ? raw.slots[s] : null
    const pl = isObj(x) ? plugin(x.plugin) : null
    if (!isObj(x) || !pl) return null
    return { ...(x as unknown as FxSlot), id: str(x.id, uid()), plugin: pl, enabled: bool(x.enabled, true), mix: num(x.mix, 1, 0, 1) }
  })
  const sends = list<{ target: number; level: number }>(raw.sends)
    .map((s) => ({ target: int(s.target, -1, -1, MIXER_INSERTS), level: num(s.level, 1, 0, 1.25) }))
    .filter((s) => s.target >= 0 && s.target !== index)
  return {
    ...d,
    ...raw,
    id: str(raw.id, d.id),
    index,
    name: str(raw.name, d.name),
    color: str(raw.color, d.color),
    volume: num(raw.volume, d.volume, 0, 1.25),
    pan: num(raw.pan, d.pan, -1, 1),
    stereoSep: num(raw.stereoSep, d.stereoSep, -1, 1),
    muted: bool(raw.muted, false),
    solo: bool(raw.solo, false),
    armed: bool(raw.armed, false),
    inputChannel: oneOf(raw.inputChannel, ['mono', 'stereo', 'left', 'right'] as const, d.inputChannel),
    slots,
    sends: Array.isArray(raw.sends) ? sends : d.sends,
    eq: { ...d.eq, ...(isObj(raw.eq) ? raw.eq : {}) },
    fxEnabled: bool(raw.fxEnabled, true)
  }
}

function automation(a: Loose<Automation> & { id: string }, i: number): Automation {
  const points = list<AutomationPoint>(a.points)
    .filter((p) => typeof p.t === 'number' && Number.isFinite(p.t))
    .map((p) => ({
      ...p,
      t: Math.max(0, p.t as number),
      v: num(p.v, 0.5, 0, 1),
      tension: num(p.tension, 0, -1, 1),
      mode: oneOf(p.mode, ['single', 'double', 'hold', 'stairs', 'smooth', 'pulse', 'wave'] as const, 'single')
    }))
    .sort((x, y) => x.t - y.t)
  return {
    ...a,
    id: a.id,
    name: str(a.name, `Automation ${i + 1}`),
    color: str(a.color, '#6e8e9c'),
    target: isObj(a.target) && typeof a.target.kind === 'string' ? (a.target as Automation['target']) : null,
    points,
    length: Math.max(1, Math.round(num(a.length, BAR)))
  }
}

export function normalizeProject(raw: unknown): Project {
  const r = (isObj(raw) ? raw : {}) as Loose<Project>
  const base = makeEmptyProject()

  const channels = ids(list<Channel>(r.channels)).map(channel)
  const channelIds = new Set(channels.map((c) => c.id))
  const patterns = ids(list<Pattern>(r.patterns)).map((p, i) => pattern(p, i, channelIds))
  if (!patterns.length) patterns.push(base.patterns[0])
  const samples: Sample[] = ids(list<Sample>(r.samples)).map((s) => ({
    ...s,
    name: str(s.name, 'Sample'),
    path: typeof s.path === 'string' ? s.path : null,
    duration: num(s.duration, 0, 0),
    sampleRate: num(s.sampleRate, 44100, 1),
    channels: int(s.channels, 2, 1, 32),
    embedded: bool(s.embedded, false)
  }))
  const automations = ids(list<Automation>(r.automations)).map(automation)

  const rawMixer = list<MixerTrack>(r.mixer)
  const mixer = Array.from({ length: MIXER_INSERTS + 1 }, (_, i) => mixerTrack(rawMixer[i], i))

  const rawTracks = list<Project['playlist']['tracks'][number]>(isObj(r.playlist) ? r.playlist.tracks : [])
  const tracks = Array.from({ length: Math.max(PLAYLIST_TRACKS, rawTracks.length) }, (_, i) => {
    const d = makePlaylistTrack(i)
    const t = rawTracks[i]
    return t ? { ...d, ...t, id: str(t.id, d.id), height: num(t.height, d.height, 10), muted: bool(t.muted, false), locked: bool(t.locked, false) } : d
  })

  const patternById = new Map(patterns.map((p) => [p.id, p]))
  const exists = { pattern: patternById, audio: new Set(samples.map((s) => s.id)), automation: new Set(automations.map((a) => a.id)) }
  const clips: Clip[] = ids(list<Clip>(isObj(r.playlist) ? r.playlist.clips : []))
    .filter((c) => (c.kind === 'pattern' || c.kind === 'audio' || c.kind === 'automation') && typeof c.ref === 'string' && exists[c.kind].has(c.ref))
    .map((c) => {
      const fallback = c.kind === 'pattern' ? patternById.get(c.ref as string)?.length || BAR : BAR
      return {
        ...c,
        kind: c.kind as Clip['kind'],
        ref: c.ref as string,
        track: int(c.track, 0, 0, tracks.length - 1),
        start: Math.max(0, Math.round(num(c.start, 0))),
        length: Math.max(1, Math.round(num(c.length, fallback))),
        offset: Math.max(0, num(c.offset, 0)),
        muted: bool(c.muted, false),
        channelId: typeof c.channelId === 'string' && channelIds.has(c.channelId) ? c.channelId : undefined
      }
    })

  const markers: Marker[] = ids(list<Marker>(r.markers))
    .filter((m) => typeof m.pos === 'number' && Number.isFinite(m.pos))
    .map((m) => ({ ...m, pos: Math.max(0, m.pos as number), name: str(m.name, ''), kind: oneOf(m.kind, ['marker', 'loopStart', 'loopEnd', 'timeSig'] as const, 'marker') }))

  const timeSig = (v: unknown): [number, number] =>
    Array.isArray(v) && v.length === 2 ? [int(v[0], 4, 1, 16), [2, 4, 8, 16].includes(v[1]) ? v[1] : 4] : [4, 4]
  const filterGroups = Array.isArray(r.filterGroups) ? r.filterGroups.filter((g): g is string => typeof g === 'string') : []
  for (const g of ['Unsorted', ...channels.map((c) => c.filterGroup)]) if (!filterGroups.includes(g)) filterGroups.push(g)

  return {
    ...base,
    ...r,
    version: 1,
    name: str(r.name, base.name),
    author: str(r.author, ''),
    genre: str(r.genre, ''),
    info: str(r.info, ''),
    tempo: num(r.tempo, base.tempo, 10, 522),
    timeSig: timeSig(r.timeSig),
    swing: num(r.swing, 0, 0, 1),
    masterPitch: num(r.masterPitch, 0, -1200, 1200),
    masterVolume: num(r.masterVolume, base.masterVolume, 0, 1.25),
    patterns,
    channels,
    playlist: { ...(isObj(r.playlist) ? r.playlist : {}), tracks, clips },
    markers,
    mixer,
    automations,
    samples,
    filterGroups
  }
}
