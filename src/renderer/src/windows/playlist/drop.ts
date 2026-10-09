// Drops onto the playlist grid: picker items, audio files from the browser / OS.
import { initAudio } from '@/audio/transport'
import { decode, importSampleFile, registerBuffer } from '@/audio/samples'
import { host } from '@/platform'
import { getProject } from '@/store/project'
import type { ClipKind, Sample } from '@/store/types'
import { AUDIO_EXT, droppedPaths } from '../channelrack/drop'
import { makeClip, placeClips } from './actions'
import { setSelection } from './state'
import { PLAYLIST_TRACKS } from '@/store/types'

export const CLIPSRC_MIME = 'application/x-arkane-clipsrc'

export async function handleGridDrop(e: React.DragEvent, tick: number, track: number): Promise<void> {
  e.preventDefault()
  const src = e.dataTransfer.getData(CLIPSRC_MIME)
  if (src) {
    const s = JSON.parse(src) as { kind: ClipKind; ref: string }
    const c = makeClip(getProject(), s, track, tick)
    placeClips('Add clip', [c])
    setSelection([c.id])
    return
  }
  // Capture data synchronously: DataTransfer is emptied once the handler yields.
  const paths = droppedPaths(e).filter((p) => AUDIO_EXT.test(p))
  const files = host ? [] : Array.from(e.dataTransfer.files).filter((f) => AUDIO_EXT.test(f.name))
  if (!paths.length && !files.length) return
  await initAudio()
  const samples: Sample[] = []
  for (const path of paths) {
    const s = await importSampleFile(path)
    if (s) samples.push(s)
  }
  for (const f of files) {
    // Plain-browser dev mode: decode the File directly into the pool.
    try {
      const buf = await decode(await f.arrayBuffer())
      samples.push(registerBuffer(f.name.replace(/\.[^.]+$/, ''), buf))
    } catch (err) {
      console.warn('decode failed', f.name, err)
    }
  }
  if (!samples.length) return
  const p = getProject()
  const clips = samples.map((s, i) => makeClip(p, { kind: 'audio', ref: s.id }, Math.min(PLAYLIST_TRACKS - 1, track + i), tick))
  placeClips(samples.length > 1 ? 'Add audio clips' : 'Add audio clip', clips)
  setSelection(clips.map((c) => c.id))
}
