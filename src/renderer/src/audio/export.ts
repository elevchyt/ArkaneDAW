// Offline rendering + export pipeline (File > Export wizard, Ctrl+R).
//
//   renderRaw()      one OfflineAudioContext render of the song/pattern (+ automation), tapped at the master or
//                    at one mixer insert; progress via ctx.suspend() checkpoints; cancellable.
//   exportProject()  plans the files (single mix / playlist stems / mixer stems), renders each, applies the tail
//                    mode, normalize/mono/dither, and encodes (WAV in-process, MP3/OGG/FLAC through system ffmpeg).
import { getProject } from '../store/project'
import { hasFades, scheduleClipFades } from './fades'
import { useUI } from '../store/ui'
import { PPQ, type Project } from '../store/types'
import { constantTempo, tempoMap } from './tempo'
import { host } from '../platform'
import { AudioEngine, usedMixerTracks } from './engine'
import { prepareContext } from './context'
import { automationValue, patternHits, patternLength, songHits, songLength } from './sequence'
import { getBuffer, loadSample } from './samples'
import { clipPlayback, startClip } from './clips'
import { applyAutomation } from './transport'
import { useTransport } from '../store/transport'
import type { ScheduledEvent } from '../plugins/sdk/types'
import {
  DEFAULT_SETTINGS,
  applyTail,
  buildFfmpegArgs,
  encodeWavPcm,
  fileExtension,
  finishSamples,
  isSilent,
  overallProgress,
  splitOutputPaths,
  suspendTimes,
  trimSilence,
  type ExportSettings,
  type RenderMode,
  type TailMode
} from '../windows/export/core'
import { mixerStems, playlistStems, soloPlaylistTrack } from '../windows/export/split'
import { CancelledError, ffmpegEncode, rendererChildProcess, type FfmpegInfo } from '../windows/export/ffmpeg'

export { CancelledError }

/** Silence rendered before tick 0 so plugins have their events before the first note; cropped afterwards. */
const LEAD = 0.05
/** Longest tail rendered for "leave"/"wrap" (it is trimmed once it decays below -90 dB for 1 s). */
export const MAX_TAIL_SECONDS = 10

export type RenderTarget = { kind: 'master' } | { kind: 'mixer'; track: number; masterFx: boolean }

export interface RenderRequest {
  project: Project
  mode: RenderMode
  patternId?: string | null
  sampleRate: number
  tail: TailMode
  target?: RenderTarget
  /** 0..1 progress of this render. */
  onProgress?: (frac: number) => void
  signal?: AbortSignal
  /** Seconds of audio between progress checkpoints. */
  progressStep?: number
}

export interface RawRender {
  /** Stereo output with the lead removed: frame 0 = song tick 0. Includes up to MAX_TAIL_SECONDS of tail unless tail = 'cut'. */
  channels: Float32Array[]
  sampleRate: number
  /** Frame where the arrangement ends. */
  songFrames: number
}

function pickPattern(p: Project, id?: string | null) {
  return p.patterns.find((x) => x.id === id) ?? p.patterns[0]
}

/** Length of what a render covers, in ticks and seconds (no tail). */
export function projectSpan(p: Project, mode: RenderMode, patternId?: string | null): { ticks: number; seconds: number } {
  const pattern = pickPattern(p, patternId)
  const ticks = mode === 'song' ? songLength(p) : pattern ? patternLength(pattern, p) : 0
  return { ticks, seconds: (mode === 'song' ? tempoMap(p) : constantTempo(p.tempo)).secondsAt(ticks) }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError()
}

function raceAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError())
    const onAbort = () => reject(new CancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      }
    )
  })
}

/** Route the engine output so only `target` reaches the destination. */
function applyTarget(engine: AudioEngine, target: RenderTarget): boolean {
  if (target.kind === 'master' || target.track <= 0) return true
  const ctx = engine.ctx
  const strip = engine.mixer[target.track]
  if (!strip) return false
  if (!target.masterFx) {
    // Post-fader insert output straight to the file, bypassing the master strip and master volume.
    engine.masterOut.disconnect()
    strip.post.connect(ctx.destination)
    return true
  }
  // Through the master chain, with nothing else feeding the master: cut every other insert's send to master
  // and channels routed straight to master, then feed this insert's post-fader output into master.
  for (let k = 1; k < engine.mixer.length; k++) engine.mixer[k]?.sends.get(0)?.disconnect()
  for (const c of engine.channels.values()) {
    const t = c.state.mixerTrack
    if (t <= 0 || !engine.mixer[t]) c.pan.disconnect()
  }
  const feed = ctx.createGain()
  strip.post.connect(feed)
  feed.connect(engine.mixer[0]!.input)
  return true
}

/** Render once. Throws CancelledError when `signal` aborts. */
export async function renderRaw(req: RenderRequest): Promise<RawRender> {
  const p = req.project
  const sr = req.sampleRate
  const signal = req.signal
  const mode = req.mode === 'song' && p.playlist.clips.length ? 'song' : 'pattern'
  const pattern = pickPattern(p, req.patternId)
  const { ticks: lenTicks, seconds: songSec } = projectSpan(p, mode, req.patternId)
  // Same tick ⇄ time mapping as live playback (tempo automation only plays in song mode).
  const map = mode === 'song' ? tempoMap(p) : constantTempo(p.tempo)
  const totalSec = LEAD + songSec + (req.tail === 'cut' ? 0 : MAX_TAIL_SECONDS)
  const length = Math.max(1, Math.ceil(totalSec * sr))

  // Audio clips need decoded buffers before scheduling.
  if (mode === 'song') {
    const ids = new Set(p.playlist.clips.filter((c) => c.kind === 'audio' && !c.muted).map((c) => c.ref))
    await Promise.all([...ids].map((id) => {
      const s = p.samples.find((x) => x.id === id)
      return !getBuffer(id) && s ? loadSample(s) : null
    }))
  }
  throwIfAborted(signal)

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: sr })
  await prepareContext(ctx)
  const engine = new AudioEngine(ctx)
  try {
    engine.sync(p)
    // Wait for all plugin nodes (wasm compile, sample decode) before scheduling.
    await Promise.all([...engine.channels.values()].map((c) => c.instrument?.ready))
    await Promise.all(engine.mixer.flatMap((m) => m?.slots.map((s) => s?.plugin.ready) ?? []))
    throwIfAborted(signal)
    const audible = applyTarget(engine, req.target ?? { kind: 'master' })

    const at = (tick: number) => LEAD + map.secondsAt(tick)
    if (map.automated) engine.scheduleTempo(map.bpmAt(0), at(0))
    if (audible && pattern) {
      const muted = new Set(p.channels.filter((c) => c.muted).map((c) => c.id))
      const hits = mode === 'song' ? songHits(p, 0, lenTicks) : patternHits(p, pattern, 0, 0, lenTicks, undefined, muted)
      const byCh = new Map<string, ScheduledEvent[]>()
      for (const h of hits) {
        const id = engine.nextNoteId()
        const n = h.note
        const list = byCh.get(h.channelId) ?? []
        list.push({ kind: 'on', time: at(h.start), note: { id, key: n.key, vel: n.vel, pan: n.pan, fine: n.fine, rel: n.rel, modX: n.modX, modY: n.modY, porta: n.porta, slide: n.slide, color: n.color, length: at(h.end) - at(h.start) } })
        list.push({ kind: 'off', time: at(h.end), id, key: n.key, rel: n.rel })
        byCh.set(h.channelId, list)
      }
      for (const [ch, evs] of byCh) engine.schedule(ch, evs)
    }
    if (audible && mode === 'song') {
      for (const clip of p.playlist.clips) {
        if (clip.muted || p.playlist.tracks[clip.track]?.muted) continue
        if (clip.kind === 'audio') {
          const raw = getBuffer(clip.ref)
          if (!raw) continue
          const pb = clipPlayback(p, clip, raw)
          const src = ctx.createBufferSource()
          const strip = clip.channelId ? engine.channels.get(clip.channelId) : null
          const dest = strip ? strip.input : engine.mixer[0]!.input
          // Audio clips aren't stretched by tempo automation: they play at the tempo where they start.
          const bpm = map.bpmAt(clip.start)
          if (hasFades(clip)) {
            const g = ctx.createGain()
            scheduleClipFades(g.gain, clip, at(clip.start), 0, (bpm * PPQ) / 60)
            src.connect(g).connect(dest)
          } else src.connect(dest)
          startClip(src, pb, clip, bpm, at(clip.start))
        } else if (clip.kind === 'automation') {
          // Same sampling as the live scheduler (transport.ts scheduleAutomation): every 1/16 beat.
          const a = p.automations.find((x) => x.id === clip.ref)
          if (!a?.target) continue
          const step = PPQ / 16
          const end = Math.min(lenTicks, clip.start + clip.length)
          for (let tk = Math.ceil(clip.start / step) * step; tk < end; tk += step) {
            applyAutomation(p, a, a.target, automationValue(a, tk - clip.start + clip.offset), at(tk), engine)
          }
        }
      }
    }

    // Port messages are async: make sure every plugin has its events before the (fast) offline render runs.
    const nodes = [...engine.channels.values()].map((c) => c.instrument).concat(engine.mixer.flatMap((m) => m?.slots.map((s) => s?.plugin ?? null) ?? []))
    await Promise.all(nodes.map((n) => n?.flush?.()))
    throwIfAborted(signal)

    // OfflineAudioContext has no progress events: suspend at checkpoints, report, resume (or stay suspended on cancel).
    for (const t of suspendTimes(totalSec, sr, req.progressStep ?? 0.5)) {
      void ctx.suspend(t).then(() => {
        if (signal?.aborted) return
        req.onProgress?.(t / totalSec)
        void ctx.resume()
      })
    }
    const out = await raceAbort(ctx.startRendering(), signal)
    req.onProgress?.(1)
    const lead = Math.min(out.length, Math.round(LEAD * sr))
    const channels = [0, 1].map((c) => out.getChannelData(Math.min(c, out.numberOfChannels - 1)).slice(lead))
    return { channels, sampleRate: sr, songFrames: Math.min(channels[0].length, Math.round(songSec * sr)) }
  } finally {
    engine.dispose()
  }
}

/** Back-compat helper: render the project (current transport mode) to an AudioBuffer-like result. */
export async function renderProject(opts: { sampleRate?: number; tail?: TailMode; mode?: RenderMode } = {}): Promise<RawRender> {
  const p = getProject()
  const mode = opts.mode ?? (useTransport.getState().mode === 'song' && p.playlist.clips.length ? 'song' : 'pattern')
  const raw = await renderRaw({ project: p, mode, patternId: useUI.getState().currentPattern, sampleRate: opts.sampleRate ?? 48000, tail: opts.tail ?? 'leave' })
  return { ...raw, channels: applyTail(raw.channels, raw.sampleRate, raw.songFrames, opts.tail ?? 'leave') }
}

// ── export pipeline ──────────────────────────────────────────────────────────

export interface ExportProgress {
  fileIndex: number // 0-based
  fileCount: number
  fileName: string
  phase: 'render' | 'encode' | 'done'
  /** Overall 0..1 */
  fraction: number
  /** This file 0..1 */
  fileFraction: number
}

export interface ExportJob {
  settings: ExportSettings
  project: Project
  patternId?: string | null
  /** Destination file (Electron). null → browser download (WAV only). */
  filePath: string | null
  ffmpeg: FfmpegInfo | null
  onProgress?: (p: ExportProgress) => void
  signal?: AbortSignal
}

export interface ExportResult {
  files: string[]
  skippedSilent: string[]
  folder: string | null
}

interface PlannedFile {
  name: string
  path: string
  project: Project
  target: RenderTarget
}

/** Decide which files a job produces (paths follow `<dir>/<base>/<base>_<track>.<ext>` when splitting). */
export function planExport(job: Pick<ExportJob, 'settings' | 'project' | 'filePath'>): { folder: string | null; files: PlannedFile[] } {
  const s = job.settings
  const p = job.project
  const ext = fileExtension(s.format)
  const base = job.filePath ?? `${p.name || 'Untitled'}.${ext}`
  if (s.split === 'none' || (s.split === 'playlist' && s.mode !== 'song')) {
    return { folder: null, files: [{ name: 'Master', path: base, project: p, target: { kind: 'master' } }] }
  }
  const stems = s.split === 'playlist' ? playlistStems(p) : mixerStems(p, usedMixerTracks(p))
  const { folder, files } = splitOutputPaths(base, stems.map((x) => x.name), ext)
  return {
    folder,
    files: stems.map((st, i) => ({
      name: st.name,
      path: files[i],
      project: s.split === 'playlist' ? soloPlaylistTrack(p, st.index) : p,
      target: s.split === 'mixer' && st.index > 0 ? { kind: 'mixer', track: st.index, masterFx: s.masterFx } : { kind: 'master' }
    }))
  }
}

const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)

function download(bytes: ArrayBuffer, name: string, type: string): void {
  const a = document.createElement('a')
  const url = URL.createObjectURL(new Blob([bytes], { type }))
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Run the whole export. Throws CancelledError on cancel (partially written files of the current step are removed). */
export async function exportProject(job: ExportJob): Promise<ExportResult> {
  const s = job.settings
  const { signal } = job
  const plan = planExport(job)
  const n = plan.files.length
  const result: ExportResult = { files: [], skippedSilent: [], folder: plan.folder }
  if (!n) throw new Error(s.split === 'playlist' ? 'No playlist tracks with clips to render.' : 'Nothing to render.')
  if (s.format !== 'wav' && (!host || !job.ffmpeg)) throw new Error('Install ffmpeg to export MP3/OGG/FLAC.')
  const cp = s.format !== 'wav' ? rendererChildProcess() : null
  if (s.format !== 'wav' && !cp) throw new Error('Node child_process is unavailable.')
  if (host && plan.folder) await host.fsp.mkdir(plan.folder, { recursive: true })

  const report = (i: number, f: PlannedFile, phase: ExportProgress['phase'], render: number, encode: number) =>
    job.onProgress?.({ fileIndex: i, fileCount: n, fileName: baseName(f.path), phase, fraction: overallProgress(i, n, render, encode), fileFraction: Math.min(1, render * 0.9 + encode * 0.1) })

  for (let i = 0; i < n; i++) {
    const f = plan.files[i]
    report(i, f, 'render', 0, 0)
    const raw = await renderRaw({
      project: f.project,
      mode: s.mode,
      patternId: job.patternId,
      sampleRate: s.sampleRate,
      tail: s.tail,
      target: f.target,
      signal,
      onProgress: (x) => report(i, f, 'render', x, 0)
    })
    throwIfAborted(signal)
    report(i, f, 'encode', 1, 0)
    let ch = applyTail(raw.channels, raw.sampleRate, raw.songFrames, s.tail)
    if (plan.folder && isSilent(ch)) {
      result.skippedSilent.push(f.name)
      continue
    }
    if (s.trimSilence && !plan.folder) ch = trimSilence(ch)
    if (!ch[0]?.length) ch = ch.map(() => new Float32Array(1))
    ch = finishSamples(ch, s)
    // Let the UI paint the "encoding" state before the synchronous WAV packing.
    await new Promise((r) => setTimeout(r, 0))
    if (s.format === 'wav') {
      const wav = encodeWavPcm(ch, raw.sampleRate, s.wavBits)
      if (host && job.filePath) await host.fsp.writeFile(f.path, new Uint8Array(wav))
      else download(wav, baseName(f.path), 'audio/wav')
    } else {
      const wav = new Uint8Array(encodeWavPcm(ch, raw.sampleRate, 32))
      try {
        await ffmpegEncode(cp!, job.ffmpeg!.path, buildFfmpegArgs(s, f.path), wav, signal)
      } catch (e) {
        if (e instanceof CancelledError) await host!.fsp.rm(f.path, { force: true }).catch(() => {})
        throw e
      }
    }
    result.files.push(f.path)
    report(i, f, i === n - 1 ? 'done' : 'encode', 1, 1)
  }
  return result
}

/** Quick export with default settings (kept for callers that bypass the wizard). */
export async function exportAudio(format: 'wav'): Promise<void> {
  const ui = useUI.getState()
  const p = getProject()
  let filePath: string | null = null
  if (host) {
    const r = await host.dialog.save({ title: 'Export WAV', defaultPath: `${p.name}.${format}`, filters: [{ name: 'WAV', extensions: ['wav'] }] })
    if (r.canceled || !r.filePath) return
    filePath = r.filePath
  }
  ui.setHint('Rendering…')
  const mode = useTransport.getState().mode === 'song' && p.playlist.clips.length ? 'song' : 'pattern'
  await exportProject({ settings: { ...DEFAULT_SETTINGS, mode }, project: p, patternId: ui.currentPattern, filePath, ffmpeg: null })
  ui.setHint(filePath ? `Exported ${filePath}` : 'Exported WAV')
}
