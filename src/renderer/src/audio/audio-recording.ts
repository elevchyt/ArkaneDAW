// Audio recording from armed mixer tracks (FL: arm the insert's record button, pick its input,
// press record + play).
//
//   getUserMedia(input, no EC/NS/AGC) ─▶ MediaStreamSource ─▶ 'arkane-recorder' worklet
//        (channel select, pre-roll ring, 100 ms chunks) ─▶ monitor gain ─▶ mixer insert input
//
// Streams open as soon as a track is armed (so recording can start sample-accurately and you can
// monitor through the insert's FX). When the transport starts with record armed, every armed track
// records; on stop the take is latency-compensated, embedded in the project pool and dropped into
// the playlist as an audio clip (+ an 'audio' channel routed to the armed insert).
import { create } from 'zustand'
import { useProject, getProject, editProject } from '../store/project'
import { useTransport, playhead } from '../store/transport'
import { useUI } from '../store/ui'
import { makeChannel, uid, CHANNEL_COLORS } from '../store/factory'
import { PLAYLIST_TRACKS, PPQ, type Clip, type MixerTrack } from '../store/types'
import { getEngine, initAudio, START_DELAY } from './transport'
import { registerBuffer } from './samples'
import { assembleTake, compensationSec, detectOnset, firstFreeTrack, median, type Chunk } from './recording-core'
import { getAudioSettings, useAudioSettings } from '../windows/settings/settings-store'
import recorderUrl from './worklet/recorder.ts?worker&url'

interface Input {
  track: number
  sig: string // config signature; reopen when it changes
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  monitor: GainNode
  channels: 1 | 2
  chunks: Chunk[]
  recording: boolean
  startFrame: number
  stopped: ((frame: number) => void) | null
  inputLatency: number
}

/** Live input state for UI (levels, errors). */
export const useAudioInputs = create<{ levels: Record<number, number>; error: string | null; recordingTracks: number[] }>(() => ({
  levels: {},
  error: null,
  recordingTracks: []
}))

/**
 * A take being recorded, drawn live in the playlist (song mode): grows with the playhead and shows the
 * waveform as chunks arrive. Plain module state (read every animation frame), not React state.
 */
export interface LiveTake {
  /** playlist track it will land on */
  playlistTrack: number
  startTick: number
  /** song ticks per second at the take's tempo */
  tps: number
  sampleRate: number
  startFrame: number
  /** frames per peak bucket */
  bucket: number
  /** max |sample| per bucket */
  peaks: number[]
  name: string
  color: string
  /** set when recording stops (the playhead jumps back, the take must not shrink) */
  endTick: number | null
}
const live = new Map<number, LiveTake>()
const liveListeners = new Set<() => void>()
export const liveTakes = (): ReadonlyMap<number, LiveTake> => live
/** Called when takes appear / stop / disappear (peaks grow without notifications: redraw per frame). */
export function onLiveTakesChange(cb: () => void): () => void {
  liveListeners.add(cb)
  return () => liveListeners.delete(cb)
}
const liveChanged = () => liveListeners.forEach((l) => l())

function addPeaks(take: LiveTake, frame: number, data: Float32Array[]): void {
  const n = data[0]?.length ?? 0
  for (let i = 0; i < n; i++) {
    const rel = frame + i - take.startFrame
    if (rel < 0) continue
    const b = Math.floor(rel / take.bucket)
    let v = 0
    for (const c of data) {
      const a = Math.abs(c[i])
      if (a > v) v = a
    }
    while (take.peaks.length <= b) take.peaks.push(0)
    if (v > take.peaks[b]) take.peaks[b] = v
  }
}

const inputs = new Map<number, Input>()
const opening = new Map<number, Promise<Input | null>>()
const moduleLoaded = new WeakSet<BaseAudioContext>()
let takeCounter = 0

async function ensureRecorderModule(ctx: BaseAudioContext): Promise<void> {
  if (moduleLoaded.has(ctx)) return
  await ctx.audioWorklet.addModule(recorderUrl)
  moduleLoaded.add(ctx)
}

function constraints(deviceId: string | null): MediaStreamConstraints {
  const s = getAudioSettings()
  const id = deviceId || s.inputDeviceId || ''
  return {
    audio: {
      ...(id ? { deviceId: { exact: id } } : {}),
      echoCancellation: s.inputProcessing,
      noiseSuppression: s.inputProcessing,
      autoGainControl: s.inputProcessing,
      channelCount: { ideal: s.inputChannels }
    },
    video: false
  }
}

const signature = (t: MixerTrack): string => {
  const s = getAudioSettings()
  return [t.inputDevice ?? '', s.inputDeviceId, t.inputChannel, s.inputProcessing, s.inputChannels].join('|')
}

export function isTrackMonitoring(track: number): boolean {
  return !getAudioSettings().monitorOff[track]
}

/** Per-track input monitoring toggle (default on while armed). */
export function setTrackMonitoring(track: number, on: boolean): void {
  const off = { ...getAudioSettings().monitorOff }
  if (on) delete off[track]
  else off[track] = true
  useAudioSettings.getState().update({ monitorOff: off })
}

function describeError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was denied — allow audio input to record'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Audio input device not found — pick another input in Options > Audio settings'
  if (name === 'NotReadableError') return 'Audio input is busy or unavailable'
  return `Audio input error: ${String((e as Error)?.message ?? e)}`
}

async function openInput(t: MixerTrack): Promise<Input | null> {
  const engine = await initAudio()
  const ctx = engine.ctx as AudioContext
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('getUserMedia unavailable'), { name: 'NotSupportedError' })
  await ensureRecorderModule(ctx)
  const stream = await navigator.mediaDevices.getUserMedia(constraints(t.inputDevice))
  const s = getAudioSettings()
  const channels: 1 | 2 = t.inputChannel !== 'stereo' || s.inputChannels === 1 ? 1 : 2
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'arkane-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    processorOptions: { channels, select: t.inputChannel }
  })
  const monitor = ctx.createGain()
  monitor.gain.value = isTrackMonitoring(t.index) ? 1 : 0
  source.connect(node)
  node.connect(monitor)
  const strip = engine.mixer[t.index]
  monitor.connect(strip ? strip.input : engine.masterOut)
  const settings = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }
  const inp: Input = {
    track: t.index,
    sig: signature(t),
    stream,
    source,
    node,
    monitor,
    channels,
    chunks: [],
    recording: false,
    startFrame: 0,
    stopped: null,
    inputLatency: typeof settings?.latency === 'number' ? settings.latency : 0
  }
  node.port.onmessage = (e: MessageEvent<{ type: string; frame?: number; data?: Float32Array[]; peak?: number }>) => {
    const m = e.data
    if (m.type === 'chunk' && m.data && inp.recording) {
      inp.chunks.push({ frame: m.frame ?? 0, data: m.data })
      const take = live.get(inp.track)
      if (take) addPeaks(take, m.frame ?? 0, m.data)
    }
    else if (m.type === 'stopped') {
      inp.stopped?.(m.frame ?? 0)
      inp.stopped = null
    } else if (m.type === 'level') {
      const levels = useAudioInputs.getState().levels
      if (Math.abs((levels[inp.track] ?? 0) - (m.peak ?? 0)) > 0.005) useAudioInputs.setState({ levels: { ...levels, [inp.track]: m.peak ?? 0 } })
    }
  }
  return inp
}

function closeInput(inp: Input): void {
  try {
    inp.node.port.postMessage({ type: 'dispose' })
    inp.source.disconnect()
    inp.node.disconnect()
    inp.monitor.disconnect()
  } catch {
    /* already disconnected */
  }
  for (const tr of inp.stream.getTracks()) tr.stop()
  const levels = { ...useAudioInputs.getState().levels }
  delete levels[inp.track]
  useAudioInputs.setState({ levels })
}

/** Open / close input streams to match armed mixer tracks. */
async function syncInputs(): Promise<void> {
  const p = getProject()
  const armed = p.mixer.filter((t) => t.armed && t.index > 0)
  const want = new Map(armed.map((t) => [t.index, t]))
  for (const [i, inp] of inputs) {
    const t = want.get(i)
    if (!t || inp.sig !== signature(t)) {
      if (inp.recording) continue // never yank an input mid-take; resynced after stop
      closeInput(inp)
      inputs.delete(i)
    }
  }
  for (const t of armed) {
    if (inputs.has(t.index) || opening.has(t.index)) continue
    const pr = openInput(t)
      .then((inp) => {
        opening.delete(t.index)
        if (!inp) return null
        // Track was disarmed while the device was opening.
        if (!getProject().mixer[t.index]?.armed) {
          closeInput(inp)
          return null
        }
        inputs.set(t.index, inp)
        useAudioInputs.setState({ error: null })
        if (pendingStart) beginOn(inp)
        return inp
      })
      .catch((e) => {
        opening.delete(t.index)
        const msg = describeError(e)
        console.warn('audio input', e)
        useAudioInputs.setState({ error: msg })
        useUI.getState().setHint(msg)
        return null
      })
    opening.set(t.index, pr)
  }
  for (const inp of inputs.values()) inp.monitor.gain.value = isTrackMonitoring(inp.track) ? 1 : 0
}

// ── takes ─────────────────────────────────────────────────────────────────────

interface TakeStart {
  frame: number // context frame aligned to `tick`
  tick: number
  mode: 'pattern' | 'song'
  tempo: number
  sampleRate: number
}
let pendingStart: TakeStart | null = null

/** Start a take on one input at the pending start frame (+ that device's reported input latency). */
function beginOn(inp: Input): void {
  if (!pendingStart) return
  const s = getAudioSettings()
  const extra = s.autoLatencyComp && s.calibratedLatencyMs == null ? Math.round(inp.inputLatency * pendingStart.sampleRate) : 0
  inp.startFrame = pendingStart.frame + extra
  inp.chunks = []
  inp.recording = true
  inp.node.port.postMessage({ type: 'start', fromFrame: inp.startFrame })
  const again = live.get(inp.track)
  if (again) again.startFrame = inp.startFrame
  else if (pendingStart.mode === 'song') {
    // reserve a playlist track that is free from the start position on (other live takes included)
    const p = getProject()
    const taken = [...live.values()].map((l) => ({ track: l.playlistTrack, start: l.startTick, length: Number.MAX_SAFE_INTEGER }))
    const at = pendingStart.tick
    const track = firstFreeTrack([...p.playlist.clips, ...taken], at, at + PPQ * 1e6, PLAYLIST_TRACKS, (i) => !!p.playlist.tracks[i]?.locked)
    if (track >= 0) {
      const mt = p.mixer[inp.track]
      live.set(inp.track, {
        playlistTrack: track,
        startTick: at,
        tps: (pendingStart.tempo * PPQ) / 60,
        sampleRate: pendingStart.sampleRate,
        startFrame: inp.startFrame,
        bucket: Math.max(1, Math.round(pendingStart.sampleRate * 0.01)),
        peaks: [],
        name: mt?.name ?? `Insert ${inp.track}`,
        color: mt?.color && mt.color !== '#5c676d' ? mt.color : '#ff4b3e',
        endTick: null
      })
      liveChanged()
    }
  }
}

/**
 * Start recording every armed track. `startTime` is the context time at which `fromTick` is
 * rendered by the scheduler. Called automatically when the transport starts with record armed.
 */
export async function startAudioRecording(fromTick: number, startTime?: number): Promise<void> {
  const armed = getProject().mixer.filter((t) => t.armed && t.index > 0)
  if (!armed.length) return
  const engine = getEngine() ?? (await initAudio())
  const ctx = engine.ctx as AudioContext
  const t0 = startTime ?? ctx.currentTime + START_DELAY
  const s = getAudioSettings()
  const comp = compensationSec({
    auto: s.autoLatencyComp,
    outputLatency: ctx.outputLatency || 0,
    baseLatency: ctx.baseLatency || 0,
    inputLatency: 0, // per input, added below
    calibratedMs: s.calibratedLatencyMs,
    offsetMs: s.latencyOffsetMs
  })
  const frame = Math.round((t0 + comp) * ctx.sampleRate)
  pendingStart = { frame, tick: fromTick, mode: useTransport.getState().mode, tempo: getProject().tempo, sampleRate: ctx.sampleRate }
  await syncInputs()
  for (const inp of inputs.values()) beginOn(inp)
  const n = armed.length
  useAudioInputs.setState({ recordingTracks: armed.map((t) => t.index) })
  useUI.getState().setHint(`Recording ${n} audio track${n === 1 ? '' : 's'}…`)
}

/** Stop all takes and turn them into clips. */
export async function stopAudioRecording(): Promise<void> {
  const start = pendingStart
  pendingStart = null
  const active = [...inputs.values()].filter((i) => i.recording)
  useAudioInputs.setState({ recordingTracks: [] })
  if (!start || !active.length) {
    live.clear()
    liveChanged()
    return
  }
  const engine = getEngine()
  const ctx = engine?.ctx as AudioContext | undefined
  if (!ctx) {
    live.clear()
    liveChanged()
    return
  }
  const endFrame = Math.round(ctx.currentTime * ctx.sampleRate)
  for (const take of live.values()) take.endTick = take.startTick + (Math.max(0, endFrame - take.startFrame) / take.sampleRate) * take.tps
  liveChanged()
  await Promise.all(
    active.map(
      (inp) =>
        new Promise<void>((res) => {
          const to = setTimeout(res, 600)
          inp.stopped = () => {
            clearTimeout(to)
            res()
          }
          inp.node.port.postMessage({ type: 'stop' })
        })
    )
  )
  const s = getAudioSettings()
  const placed: Clip[] = []
  const p0 = getProject()
  const tps = (start.tempo * PPQ) / 60
  for (const inp of active) {
    inp.recording = false
    const chunks = inp.chunks
    inp.chunks = []
    const first = chunks[0]?.frame
    if (first === undefined) continue
    const data = assembleTake(chunks, inp.startFrame, inp.channels, endFrame + (inp.startFrame - start.frame))
    if (data[0].length < ctx.sampleRate * 0.05) continue
    const buf = ctx.createBuffer(inp.channels, data[0].length, ctx.sampleRate)
    data.forEach((d, c) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, c))
    const mt = p0.mixer[inp.track]
    const name = `${mt?.name ?? `Insert ${inp.track}`} take ${++takeCounter}`
    const sample = registerBuffer(name, buf)
    const length = Math.max(1, Math.round(buf.duration * tps))
    const ch = makeChannel(name, null, {
      kind: 'audio',
      color: mt?.color && mt.color !== '#5c676d' ? mt.color : CHANNEL_COLORS[(p0.channels.length + placed.length) % CHANNEL_COLORS.length],
      mixerTrack: 0, // like any new channel; the take was already recorded through its insert
      sampler: { sampleId: sample.id, rootKey: 60, reverse: false, loop: false, attack: 0, decay: 0, sustain: 1, release: 0, startOffset: 0, oneShot: true, pitchToKey: false }
    })
    const toPlaylist = start.mode === 'song' || s.patternAudioToPlaylist
    const at = start.mode === 'song' ? start.tick : 0
    const proj = getProject()
    const all = [...proj.playlist.clips, ...placed]
    // the track it was drawn on while recording, unless something landed there meanwhile
    const reserved = live.get(inp.track)?.playlistTrack
    const free = (i: number) => !proj.playlist.tracks[i]?.locked && !all.some((c) => c.track === i && c.start < at + length && c.start + c.length > at)
    const track = !toPlaylist ? -1 : reserved !== undefined && free(reserved) ? reserved : firstFreeTrack(all, at, at + length, PLAYLIST_TRACKS, (i) => !!proj.playlist.tracks[i]?.locked)
    const clip: Clip | null = toPlaylist && track >= 0 ? { id: uid(), kind: 'audio', ref: sample.id, track, start: at, length, offset: 0, muted: false, channelId: ch.id } : null
    if (clip) placed.push(clip)
    editProject(`Record audio (${name})`, (d) => {
      d.channels.push(ch)
      if (clip) d.playlist.clips.push(clip)
    })
  }
  live.clear()
  liveChanged()
  if (placed.length || active.length) useUI.getState().setHint(placed.length ? `Recorded ${placed.length} audio clip${placed.length === 1 ? '' : 's'}` : 'Recording stopped')
  void syncInputs()
}

// ── loopback latency calibration ─────────────────────────────────────────────

/**
 * Measure the round-trip latency (output → input) by playing short clicks and finding them in the
 * recorded input. Needs a loopback cable or the mic close to the speakers. Returns ms or null.
 */
export async function calibrateLatency(onProgress?: (msg: string) => void): Promise<number | null> {
  const engine = await initAudio()
  const ctx = engine.ctx as AudioContext
  await ensureRecorderModule(ctx)
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints(null))
  } catch (e) {
    onProgress?.(describeError(e))
    return null
  }
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'arkane-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { channels: 1, select: 'stereo' } })
  const sink = ctx.createGain()
  sink.gain.value = 0
  source.connect(node).connect(sink).connect(ctx.destination)
  const chunks: Chunk[] = []
  node.port.onmessage = (e: MessageEvent<{ type: string; frame?: number; data?: Float32Array[] }>) => {
    if (e.data.type === 'chunk' && e.data.data) chunks.push({ frame: e.data.frame ?? 0, data: e.data.data })
  }
  const sr = ctx.sampleRate
  const startFrame = Math.round((ctx.currentTime + 0.1) * sr)
  node.port.postMessage({ type: 'start', fromFrame: startFrame })
  // 4 clicks, 0.5 s apart, starting 0.4 s after capture begins.
  const clickTimes: number[] = []
  const burst = ctx.createBuffer(1, Math.round(sr * 0.004), sr)
  const bd = burst.getChannelData(0)
  for (let i = 0; i < bd.length; i++) bd[i] = (i % 8 < 4 ? 0.6 : -0.6) * (1 - i / bd.length)
  for (let k = 0; k < 4; k++) {
    const src = ctx.createBufferSource()
    src.buffer = burst
    src.connect(ctx.destination)
    const t = startFrame / sr + 0.4 + k * 0.5
    src.start(t)
    clickTimes.push(t)
  }
  onProgress?.('Measuring…')
  await new Promise((r) => setTimeout(r, 2700))
  node.port.postMessage({ type: 'stop' })
  await new Promise((r) => setTimeout(r, 150))
  node.port.postMessage({ type: 'dispose' })
  source.disconnect()
  node.disconnect()
  sink.disconnect()
  for (const tr of stream.getTracks()) tr.stop()
  const [x] = assembleTake(chunks, startFrame, 1)
  const found: number[] = []
  for (const t of clickTimes) {
    const at = Math.round(t * sr) - startFrame
    const win = x.subarray(Math.max(0, at - Math.round(sr * 0.05)), Math.min(x.length, at + Math.round(sr * 0.45)))
    const onset = detectOnset(win, Math.round(sr * 0.05))
    if (onset >= 0) found.push(onset - Math.round(sr * 0.05))
  }
  if (found.length < 2) {
    onProgress?.('No clicks detected — connect output to input (loopback) or raise the input level')
    return null
  }
  const ms = Math.round((median(found) / sr) * 10000) / 10
  onProgress?.(`Measured round-trip latency: ${ms} ms`)
  return ms
}

// ── wiring ──────────────────────────────────────────────────────────────────

let booted = false
/** Subscribe to the project (armed tracks) and transport (record start/stop). Idempotent. */
export function initAudioRecording(): void {
  if (booted) return
  booted = true
  useProject.subscribe((s, prev) => {
    if (s.project.mixer === prev.project.mixer) return
    const changed = s.project.mixer.some((t, i) => {
      const o = prev.project.mixer[i]
      return !o || o.armed !== t.armed || o.inputDevice !== t.inputDevice || o.inputChannel !== t.inputChannel
    })
    if (changed) void syncInputs()
  })
  useAudioSettings.subscribe((s, prev) => {
    if (s.inputDeviceId !== prev.inputDeviceId || s.inputProcessing !== prev.inputProcessing || s.inputChannels !== prev.inputChannels || s.monitorOff !== prev.monitorOff) {
      if (inputs.size || s.monitorOff !== prev.monitorOff) void syncInputs()
    }
  })
  useTransport.subscribe((s, prev) => {
    const startRec = s.playing && s.recording && (!prev.playing || !prev.recording)
    const stopRec = (prev.playing && prev.recording && (!s.playing || !s.recording)) || false
    if (startRec) {
      // The scheduler renders the start tick 60 ms after play() (see audio/transport.ts).
      const ctx = getEngine()?.ctx as AudioContext | undefined
      const from = !prev.playing ? (prev.paused ? playhead.tick : s.startTick) : Math.round(playhead.tick)
      void startAudioRecording(from, ctx ? ctx.currentTime + (!prev.playing ? START_DELAY : -(ctx.outputLatency || 0)) : undefined).catch((e) => console.warn(e))
    } else if (stopRec) {
      void stopAudioRecording().catch((e) => console.warn(e))
    }
  })
  if (getProject().mixer.some((t) => t.armed && t.index > 0)) void syncInputs()
}
