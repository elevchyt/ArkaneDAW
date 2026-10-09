// Offline render of the whole song (File > Export > WAV, Ctrl+R).
import { getProject } from '../store/project'
import { useUI } from '../store/ui'
import { PPQ } from '../store/types'
import { host } from '../platform'
import { AudioEngine } from './engine'
import { prepareContext } from './context'
import { patternHits, patternLength, songHits, songLength } from './sequence'
import { encodeWav, getBuffer } from './samples'
import { useTransport } from '../store/transport'
import type { ScheduledEvent } from '../plugins/sdk/types'

export interface RenderOptions {
  sampleRate?: number
  tailSeconds?: number
  mode?: 'song' | 'pattern'
}

/** Render the project to an AudioBuffer using an OfflineAudioContext. */
export async function renderProject(opts: RenderOptions = {}): Promise<AudioBuffer> {
  const p = getProject()
  const sr = opts.sampleRate ?? 48000
  const tail = opts.tailSeconds ?? 2
  const mode = opts.mode ?? (useTransport.getState().mode === 'song' && p.playlist.clips.length ? 'song' : 'pattern')
  const pattern = p.patterns.find((x) => x.id === useUI.getState().currentPattern) ?? p.patterns[0]
  const lenTicks = mode === 'song' ? songLength(p) : patternLength(pattern, p)
  const tps = (p.tempo * PPQ) / 60
  const seconds = lenTicks / tps + tail
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * sr), sampleRate: sr })
  await prepareContext(ctx)
  const engine = new AudioEngine(ctx)
  engine.sync(p)
  // Wait for all plugin nodes (wasm compile, sample decode) before scheduling.
  await Promise.all([...engine.channels.values()].map((c) => c.instrument?.ready))
  await Promise.all(engine.mixer.flatMap((m) => m.slots.map((s) => s?.plugin.ready)))
  const start = 0.05
  const at = (tick: number) => start + tick / tps
  const hits = mode === 'song' ? songHits(p, 0, lenTicks) : patternHits(p, pattern, 0, 0, lenTicks)
  const byCh = new Map<string, ScheduledEvent[]>()
  for (const h of hits) {
    const id = engine.nextNoteId()
    const n = h.note
    const list = byCh.get(h.channelId) ?? []
    list.push({ kind: 'on', time: at(h.start), note: { id, key: n.key, vel: n.vel, pan: n.pan, fine: n.fine, rel: n.rel, modX: n.modX, modY: n.modY, porta: n.porta, slide: n.slide, color: n.color, length: (h.end - h.start) / tps } })
    list.push({ kind: 'off', time: at(h.end), id, key: n.key, rel: n.rel })
    byCh.set(h.channelId, list)
  }
  for (const [ch, evs] of byCh) engine.schedule(ch, evs)
  if (mode === 'song') {
    for (const clip of p.playlist.clips) {
      if (clip.kind !== 'audio' || clip.muted || p.playlist.tracks[clip.track]?.muted) continue
      const buf = getBuffer(clip.ref)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      const strip = clip.channelId ? engine.channels.get(clip.channelId) : null
      src.connect(strip ? strip.input : engine.mixer[0].input)
      src.start(at(clip.start), clip.offset / tps, clip.length / tps)
    }
  }
  const out = await ctx.startRendering()
  engine.dispose()
  return out
}

export async function exportAudio(format: 'wav'): Promise<void> {
  void format
  const ui = useUI.getState()
  ui.setHint('Rendering…')
  const buf = await renderProject()
  const wav = encodeWav(buf, 24)
  if (host) {
    const r = await host.dialog.save({ title: 'Export WAV', defaultPath: `${getProject().name}.wav`, filters: [{ name: 'WAV', extensions: ['wav'] }] })
    if (r.canceled || !r.filePath) return
    await host.fsp.writeFile(r.filePath, Buffer.from(wav))
    ui.setHint(`Exported ${r.filePath}`)
  } else {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
    a.download = `${getProject().name}.wav`
    a.click()
    ui.setHint('Exported WAV')
  }
}
