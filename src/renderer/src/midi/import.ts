// MIDI file import (FILE › Import MIDI file…, MIDI files dropped on the channel rack or on a channel).
import { host } from '@/platform'
import { editProject, getProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { findChannel, findPattern, newPluginState } from '@/store/actions'
import { CHANNEL_COLORS, PATTERN_COLORS, makeChannel, uid } from '@/store/factory'
import type { Channel, Note, Pattern, Project } from '@/store/types'
import { barTicks } from '@/audio/sequence'
import { getPlugin } from '@/plugins/registry'
import { showOnlyChannelRack } from '@/store/io'
import { MIDI_EXT, allNotes, initialTempo, midiParts, targetFor, toNotes } from './convert'
import { parseMidi, type MidiFile } from './smf'

export { MIDI_EXT }

/** A MIDI file from disk (Electron) or a dropped File (plain-browser dev mode). */
export type MidiSource = string | File

const baseName = (src: MidiSource): string => (typeof src === 'string' ? (src.split(/[\\/]/).pop() ?? src) : src.name).replace(MIDI_EXT, '')

export async function readMidi(src: MidiSource): Promise<MidiFile> {
  if (typeof src !== 'string') return parseMidi(await src.arrayBuffer())
  if (!host) throw new Error('No file access')
  return parseMidi(await host.fsp.readFile(src))
}

function report(msg: string): void {
  useUI.getState().setHint(msg)
}

async function load(src: MidiSource): Promise<MidiFile | null> {
  try {
    return await readMidi(src)
  } catch (err) {
    console.warn('MIDI import failed', err)
    report(`Can't read ${baseName(src)}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** Pattern length after loading notes: auto patterns stay auto, explicit ones grow to whole bars of content. */
function fitLength(pat: Pattern, notes: Note[], p: Pick<Project, 'timeSig'>): void {
  if (!pat.length) return
  const end = notes.reduce((m, n) => Math.max(m, n.pos + n.len), 0)
  const bar = barTicks(p)
  if (end > pat.length) pat.length = Math.ceil(end / bar) * bar
}

/** Nothing has been written yet: an imported file may set the tempo and time signature. */
const isBlank = (p: Project): boolean => p.patterns.every((x) => Object.values(x.notes).every((n) => n.length === 0)) && p.playlist.clips.length === 0

/**
 * Drop on a channel: the file's notes (all tracks merged) replace that channel's notes in the current pattern.
 * One undo step.
 */
export async function importMidiIntoChannel(src: MidiSource, channelId: string, patternId: string): Promise<boolean> {
  const file = await load(src)
  if (!file) return false
  const notes = allNotes(file)
  const p = getProject()
  const ch = findChannel(p, channelId)
  if (!ch || !findPattern(p, patternId)) return false
  editProject(`Load MIDI into ${ch.name}`, (d) => {
    const pat = findPattern(d, patternId)
    if (!pat) return
    pat.notes[channelId] = notes
    fitLength(pat, notes, d)
  })
  useUI.getState().set({ selectedChannels: [channelId], pianoRollChannel: channelId })
  report(`${baseName(src)}: ${notes.length} notes loaded into ${ch.name}`)
  return true
}

/**
 * FILE › Import MIDI file / drop on the channel rack: one new channel per part (track × MIDI channel) with a
 * matching built-in instrument, all in a new pattern that is placed at the start of the first empty playlist
 * track. A blank project also takes the file's tempo and time signature. One undo step.
 */
export async function importMidiAsChannels(src: MidiSource): Promise<boolean> {
  const file = await load(src)
  if (!file) return false
  const parts = midiParts(file)
  if (!parts.length) {
    report(`${baseName(src)} has no notes`)
    return false
  }
  const p = getProject()
  const blank = isBlank(p)
  const name = baseName(src)
  const channels: Channel[] = parts.map((part, i) => {
    const [pluginId, presetName] = targetFor(part)
    const preset = getPlugin(pluginId)?.manifest.presets?.find((x) => x.name === presetName)
    return makeChannel(part.name, newPluginState(pluginId, preset), {
      color: CHANNEL_COLORS[(p.channels.length + i) % CHANNEL_COLORS.length],
      ...(part.drums ? { rootNote: 36 } : {})
    })
  })
  const pattern: Pattern = {
    id: uid(),
    name,
    color: PATTERN_COLORS[p.patterns.length % PATTERN_COLORS.length],
    notes: Object.fromEntries(parts.map((part, i) => [channels[i].id, toNotes(part.notes, file.ppq)])),
    length: 0
  }
  const tempo = initialTempo(file)
  editProject(`Import MIDI ${name}`, (d) => {
    if (blank) {
      if (tempo) d.tempo = Math.min(522, Math.max(10, tempo))
      if (file.timeSig) d.timeSig = file.timeSig
      // a blank project's empty default channels/patterns would only be clutter
      d.patterns = d.patterns.filter((x) => Object.values(x.notes).some((n) => n.length))
    }
    d.channels.push(...channels)
    d.patterns.push(pattern)
    const used = new Set(d.playlist.clips.map((c) => c.track))
    let track = 0
    while (used.has(track) && track < d.playlist.tracks.length - 1) track++
    const end = Object.values(pattern.notes).flat().reduce((m, n) => Math.max(m, n.pos + n.len), 0)
    const bar = barTicks(d)
    d.playlist.clips.push({ id: uid(), kind: 'pattern', ref: pattern.id, track, start: 0, length: Math.max(1, Math.ceil(end / bar)) * bar, offset: 0, muted: false })
  })
  useUI.getState().set({ currentPattern: pattern.id, selectedChannels: [channels[0].id], pianoRollChannel: channels[0].id })
  if (blank) showOnlyChannelRack()
  const total = parts.reduce((s, x) => s + x.notes.length, 0)
  report(`${name}: ${parts.length} channel${parts.length === 1 ? '' : 's'}, ${total} notes${blank && tempo ? `, ${Math.round(tempo * 100) / 100} BPM` : ''}`)
  return true
}

export async function importMidiDialog(): Promise<void> {
  if (!host) return
  const r = await host.dialog.open({
    title: 'Import MIDI file',
    filters: [{ name: 'MIDI file', extensions: ['mid', 'midi', 'smf', 'kar', 'rmi'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return
  await importMidiAsChannels(r.filePaths[0])
}

/** MIDI sources in a drop (browser rows, OS files). Read synchronously: DataTransfer empties after the handler yields. */
export function droppedMidi(e: React.DragEvent, paths: string[]): MidiSource[] {
  const fromPaths = paths.filter((x) => MIDI_EXT.test(x))
  if (fromPaths.length || host) return fromPaths
  return Array.from(e.dataTransfer.files).filter((f) => MIDI_EXT.test(f.name))
}
