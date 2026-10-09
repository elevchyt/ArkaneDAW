// Shared, undoable project operations. Window-specific editing logic lives next to each window;
// anything used from more than one place belongs here.
import { editProject, getProject } from './project'
import { useUI } from './ui'
import { defaultNote, makeChannel, makePattern, uid, CHANNEL_COLORS } from './factory'
import { DEFAULT_NOTE_KEY, TICKS_PER_STEP, type Channel, type Clip, type FxSlot, type Note, type Pattern, type PluginInstanceState, type Project } from './types'
import { getPlugin } from '../plugins/registry'
import { defaultParams, presetParams } from '../plugins/sdk/module'
import type { Preset } from '../plugins/sdk/types'

// ── lookup helpers ─────────────────────────────────────────────────────────────
export const findChannel = (p: Project, id: string | null | undefined): Channel | undefined => p.channels.find((c) => c.id === id)
export const findPattern = (p: Project, id: string | null | undefined): Pattern | undefined => p.patterns.find((x) => x.id === id)

export function currentPatternId(): string {
  const ui = useUI.getState()
  const p = getProject()
  if (ui.currentPattern && findPattern(p, ui.currentPattern)) return ui.currentPattern
  const id = p.patterns[0]?.id
  if (id && ui.currentPattern !== id) useUI.getState().set({ currentPattern: id })
  return id
}

export function newPluginState(pluginId: string, preset?: Preset): PluginInstanceState {
  const mod = getPlugin(pluginId)
  const params = mod ? (preset ? presetParams(mod.manifest, preset) : defaultParams(mod.manifest)) : {}
  const data = preset?.data ?? mod?.manifest.defaultData
  return { pluginId, params, data: data === undefined ? undefined : structuredClone(data), presetName: preset?.name }
}

// ── channels ──────────────────────────────────────────────────────────────────
export function addInstrumentChannel(pluginId: string, opts: { name?: string; preset?: Preset; select?: boolean; mixerTrack?: number } = {}): string {
  const mod = getPlugin(pluginId)
  const p = getProject()
  const ch = makeChannel(opts.name ?? mod?.manifest.name ?? pluginId, newPluginState(pluginId, opts.preset), {
    color: CHANNEL_COLORS[p.channels.length % CHANNEL_COLORS.length],
    mixerTrack: opts.mixerTrack ?? 0
  })
  editProject(`Add channel ${ch.name}`, (d) => {
    d.channels.push(ch)
  })
  if (opts.select !== false) useUI.getState().set({ selectedChannels: [ch.id], pianoRollChannel: ch.id })
  return ch.id
}

/** Sampler channel playing a pool sample (drag a file into the channel rack). */
export function addSamplerChannel(sampleId: string, name: string): string {
  const state = newPluginState('sampler')
  state.data = { sampleId }
  const p = getProject()
  const ch = makeChannel(name, state, { kind: 'sampler', color: CHANNEL_COLORS[p.channels.length % CHANNEL_COLORS.length] })
  editProject(`Add sampler ${name}`, (d) => {
    d.channels.push(ch)
  })
  useUI.getState().set({ selectedChannels: [ch.id], pianoRollChannel: ch.id })
  return ch.id
}

export function replaceChannelPlugin(channelId: string, pluginId: string): void {
  const mod = getPlugin(pluginId)
  editProject('Replace channel plugin', (d) => {
    const c = findChannel(d, channelId)
    if (!c) return
    c.plugin = newPluginState(pluginId)
    c.kind = pluginId === 'sampler' ? 'sampler' : 'instrument'
    if (mod) c.name = mod.manifest.name
  })
}

export function updateChannel(channelId: string, patch: Partial<Channel>, label = 'Change channel', coalesceKey?: string): void {
  editProject(label, (d) => {
    const c = findChannel(d, channelId)
    if (c) Object.assign(c, patch)
  }, { coalesceKey })
}

export function setChannelParam(channelId: string, id: string, value: number): void {
  editProject('Change parameter', (d) => {
    const c = findChannel(d, channelId)
    if (c?.plugin) c.plugin.params[id] = value
  }, { coalesceKey: `cp:${channelId}:${id}` })
}

export function setChannelData(channelId: string, data: unknown): void {
  editProject('Change plugin data', (d) => {
    const c = findChannel(d, channelId)
    if (c?.plugin) c.plugin.data = data
  }, { coalesceKey: `cd:${channelId}` })
}

export function loadChannelPreset(channelId: string, preset: Preset): void {
  editProject(`Preset ${preset.name}`, (d) => {
    const c = findChannel(d, channelId)
    if (!c?.plugin) return
    const mod = getPlugin(c.plugin.pluginId)
    if (!mod) return
    c.plugin.params = presetParams(mod.manifest, preset)
    if (preset.data !== undefined) c.plugin.data = structuredClone(preset.data)
    c.plugin.presetName = preset.name
  })
}

export function deleteChannels(ids: string[]): void {
  const set = new Set(ids)
  editProject('Delete channels', (d) => {
    d.channels = d.channels.filter((c) => !set.has(c.id))
    for (const pat of d.patterns) for (const id of ids) delete pat.notes[id]
    d.playlist.clips = d.playlist.clips.filter((c) => !(c.channelId && set.has(c.channelId)))
  })
  useUI.getState().set({ selectedChannels: [] })
}

export function cloneChannels(ids: string[]): void {
  editProject('Clone channels', (d) => {
    for (const id of ids) {
      const i = d.channels.findIndex((c) => c.id === id)
      if (i < 0) continue
      const copy: Channel = { ...structuredClone(d.channels[i]), id: uid(), name: `${d.channels[i].name} #2` }
      d.channels.splice(i + 1, 0, copy)
    }
  })
}

export function moveChannels(ids: string[], dir: -1 | 1): void {
  editProject('Move channels', (d) => {
    const set = new Set(ids)
    const order = dir < 0 ? d.channels.map((_, i) => i) : d.channels.map((_, i) => d.channels.length - 1 - i)
    for (const i of order) {
      const j = i + dir
      if (!set.has(d.channels[i]?.id) || j < 0 || j >= d.channels.length || set.has(d.channels[j].id)) continue
      ;[d.channels[i], d.channels[j]] = [d.channels[j], d.channels[i]]
    }
  })
}

/** Ctrl+L: route selected channels to free mixer tracks. */
export function routeToFreeInserts(ids: string[]): void {
  editProject('Route to free mixer tracks', (d) => {
    const used = new Set(d.channels.map((c) => c.mixerTrack))
    for (const m of d.mixer) if (m.slots.some(Boolean)) used.add(m.index)
    let next = 1
    for (const id of ids) {
      const c = findChannel(d, id)
      if (!c) continue
      while (used.has(next) && next < d.mixer.length - 1) next++
      c.mixerTrack = next
      used.add(next)
      d.mixer[next].name = c.name
      d.mixer[next].color = c.color
    }
  })
}

// ── steps & notes ─────────────────────────────────────────────────────────────
export function stepNotes(p: Project, patternId: string, channelId: string): Note[] {
  return findPattern(p, patternId)?.notes[channelId] ?? []
}

/** Toggle a step-sequencer step (a note at DEFAULT_NOTE_KEY / channel root, 1 step long). */
export function toggleStep(patternId: string, channelId: string, step: number, force?: boolean): void {
  editProject('Toggle step', (d) => {
    const pat = findPattern(d, patternId)
    if (!pat) return
    const notes = (pat.notes[channelId] ??= [])
    const pos = step * TICKS_PER_STEP
    const idx = notes.findIndex((n) => n.pos === pos)
    const on = force ?? idx < 0
    if (!on && idx >= 0) notes.splice(idx, 1)
    else if (on && idx < 0) {
      const root = findChannel(d, channelId)?.rootNote ?? DEFAULT_NOTE_KEY
      notes.push(defaultNote({ pos, key: root, len: TICKS_PER_STEP }))
      notes.sort((a, b) => a.pos - b.pos)
    }
  }, { coalesceKey: `steps:${patternId}:${channelId}` })
}

export function setPatternNotes(patternId: string, channelId: string, notes: Note[], label = 'Edit notes', coalesceKey?: string): void {
  editProject(label, (d) => {
    const pat = findPattern(d, patternId)
    if (pat) pat.notes[channelId] = notes
  }, { coalesceKey })
}

// ── patterns ──────────────────────────────────────────────────────────────────
export function addPattern(select = true): string {
  const p = getProject()
  let n = p.patterns.length + 1
  while (p.patterns.some((x) => x.name === `Pattern ${n}`)) n++
  const pat = makePattern(n)
  editProject('Add pattern', (d) => {
    d.patterns.push(pat)
  })
  if (select) useUI.getState().set({ currentPattern: pat.id })
  return pat.id
}

export function selectPattern(id: string): void {
  useUI.getState().set({ currentPattern: id })
}

/** F4 / Ctrl+F4: first pattern with no notes, or a new one. */
export function nextEmptyPattern(): string {
  const p = getProject()
  const empty = p.patterns.find((x) => Object.values(x.notes).every((n) => n.length === 0))
  if (empty) {
    selectPattern(empty.id)
    return empty.id
  }
  return addPattern()
}

export function renamePattern(id: string, name: string, color?: string): void {
  editProject('Rename pattern', (d) => {
    const pat = findPattern(d, id)
    if (!pat) return
    pat.name = name
    if (color) pat.color = color
  })
}

export function clonePattern(id: string): string | null {
  const src = findPattern(getProject(), id)
  if (!src) return null
  const copy: Pattern = { ...structuredClone(src), id: uid(), name: `${src.name} #2` }
  editProject('Clone pattern', (d) => {
    const i = d.patterns.findIndex((x) => x.id === id)
    d.patterns.splice(i + 1, 0, copy)
  })
  selectPattern(copy.id)
  return copy.id
}

export function deletePattern(id: string): void {
  editProject('Delete pattern', (d) => {
    d.patterns = d.patterns.filter((x) => x.id !== id)
    d.playlist.clips = d.playlist.clips.filter((c) => !(c.kind === 'pattern' && c.ref === id))
    if (d.patterns.length === 0) d.patterns.push(makePattern(1))
  })
  const p = getProject()
  if (!findPattern(p, useUI.getState().currentPattern)) selectPattern(p.patterns[0].id)
}

// ── playlist ──────────────────────────────────────────────────────────────────
export function addClip(clip: Omit<Clip, 'id'>): string {
  const id = uid()
  editProject('Add clip', (d) => {
    d.playlist.clips.push({ ...clip, id })
  })
  return id
}

// ── mixer ─────────────────────────────────────────────────────────────────────
export function setFxSlot(track: number, slot: number, pluginId: string | null, preset?: Preset): void {
  editProject(pluginId ? 'Add effect' : 'Remove effect', (d) => {
    const t = d.mixer[track]
    if (!t) return
    t.slots[slot] = pluginId ? ({ id: uid(), plugin: newPluginState(pluginId, preset), enabled: true, mix: 1 } satisfies FxSlot) : null
  })
}

export function setFxParam(track: number, slot: number, id: string, value: number): void {
  editProject('Change effect parameter', (d) => {
    const s = d.mixer[track]?.slots[slot]
    if (s) s.plugin.params[id] = value
  }, { coalesceKey: `fx:${track}:${slot}:${id}` })
}

export function setFxData(track: number, slot: number, data: unknown): void {
  editProject('Change effect data', (d) => {
    const s = d.mixer[track]?.slots[slot]
    if (s) s.plugin.data = data
  }, { coalesceKey: `fxd:${track}:${slot}` })
}

export function loadFxPreset(track: number, slot: number, preset: Preset): void {
  editProject(`Preset ${preset.name}`, (d) => {
    const s = d.mixer[track]?.slots[slot]
    if (!s) return
    const mod = getPlugin(s.plugin.pluginId)
    if (!mod) return
    s.plugin.params = presetParams(mod.manifest, preset)
    if (preset.data !== undefined) s.plugin.data = structuredClone(preset.data)
    s.plugin.presetName = preset.name
  })
}

export function updateMixerTrack(index: number, patch: Partial<Project['mixer'][number]>, label = 'Change mixer track', coalesceKey?: string): void {
  editProject(label, (d) => {
    const t = d.mixer[index]
    if (t) Object.assign(t, patch)
  }, { coalesceKey })
}
