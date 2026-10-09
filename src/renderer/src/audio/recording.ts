// Live note recording (typing keyboard / MIDI / on-screen keys) into the current pattern.
// Audio recording lives in audio/audio-recording.ts.
import { useTransport } from '../store/transport'
import { useUI } from '../store/ui'
import { editProject, getProject } from '../store/project'
import { defaultNote } from '../store/factory'
import { patternLength } from './sequence'
import { transport } from './transport'

const pending = new Map<number, { channelId: string; key: number; vel: number; start: number }>()

function snapTick(t: number): number {
  return Math.max(0, Math.round(t))
}

/** Called for every live note on/off. Adds notes to the current pattern while recording+playing. */
export function recordLiveNote(channelId: string, key: number, vel: number, on: boolean, id: number): void {
  const t = useTransport.getState()
  if (!t.recording || !t.playing) return
  const tick = transport.tick()
  if (on) {
    pending.set(id, { channelId, key, vel, start: tick })
    return
  }
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  const project = getProject()
  const patternId = useUI.getState().currentPattern ?? project.patterns[0]?.id
  const pattern = project.patterns.find((x) => x.id === patternId)
  if (!pattern) return
  // In pattern mode the timeline loops; in song mode notes go relative to the song (pattern 0).
  const len = patternLength(pattern, project)
  const start = t.mode === 'pattern' ? p.start % len : p.start
  const dur = Math.max(6, tick - p.start)
  editProject('Record notes', (d) => {
    const pat = d.patterns.find((x) => x.id === patternId)
    if (!pat) return
    ;(pat.notes[p.channelId] ??= []).push(defaultNote({ key: p.key, vel: p.vel, pos: snapTick(start), len: snapTick(dur) }))
  }, { coalesceKey: 'record' })
}
