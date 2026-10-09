import { host } from '@/platform'
import { importSampleFile } from '@/audio/samples'
import { addInstrumentChannel, addSamplerChannel } from '@/store/actions'
import { guardPack } from '@/packs/guard'
import { initAudio } from '@/audio/transport'

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
  await initAudio()
  for (const path of droppedPaths(e)) {
    if (!AUDIO_EXT.test(path)) continue
    const s = await importSampleFile(path)
    if (s) addSamplerChannel(s.id, s.name)
  }
}
