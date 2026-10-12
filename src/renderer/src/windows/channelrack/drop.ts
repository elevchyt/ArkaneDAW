import { host } from '@/platform'
import { importSampleFile } from '@/audio/samples'
import { addInstrumentChannel, addSamplerChannel } from '@/store/actions'
import { guardPack } from '@/packs/guard'
import { initAudio } from '@/audio/transport'
import { droppedMidi, importMidiAsChannels, importMidiIntoChannel } from '@/midi/import'

export const AUDIO_EXT = /\.(wav|mp3|ogg|flac|aif|aiff|m4a|opus|webm)$/i

/** Paths dragged from the internal browser or from the OS file manager. */
export function droppedPaths(e: React.DragEvent): string[] {
  const internal = e.dataTransfer.getData('application/x-arkane-paths')
  if (internal) return JSON.parse(internal) as string[]
  const out: string[] = []
  if (host) for (const f of Array.from(e.dataTransfer.files)) out.push(host.pathForFile(f))
  return out.filter(Boolean)
}

export async function handleChannelRackDrop(e: React.DragEvent): Promise<void> {
  e.preventDefault()
  const plugin = e.dataTransfer.getData('application/x-arkane-plugin')
  if (plugin) {
    guardPack(plugin, () => addInstrumentChannel(plugin))
    return
  }
  // Capture everything synchronously: DataTransfer is emptied once the handler yields.
  const paths = droppedPaths(e)
  const midi = droppedMidi(e, paths)
  for (const src of midi) await importMidiAsChannels(src)
  if (!paths.some((p) => AUDIO_EXT.test(p))) return
  await initAudio()
  for (const path of paths) {
    if (!AUDIO_EXT.test(path)) continue
    const s = await importSampleFile(path)
    if (s) addSamplerChannel(s.id, s.name)
  }
}

/** True when a drag may carry files (OS files or browser rows): used to highlight a channel as a MIDI drop target. */
export const dragHasFiles = (e: React.DragEvent): boolean =>
  e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-arkane-paths')

/** Drop on one channel: a MIDI file replaces that channel's notes in the current pattern. Returns false when nothing was a MIDI file. */
export function handleChannelDrop(e: React.DragEvent, channelId: string, patternId: string): boolean {
  const midi = droppedMidi(e, droppedPaths(e))
  if (!midi.length) return false
  e.preventDefault()
  e.stopPropagation()
  void importMidiIntoChannel(midi[0], channelId, patternId)
  return true
}
