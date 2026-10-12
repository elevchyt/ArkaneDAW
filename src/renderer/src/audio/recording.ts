// Live note recording (typing keyboard / MIDI controller) into the current pattern, plus the
// record-start behaviours FL has on the transport: count-in (precount) and "wait for input".
// Audio recording lives in audio/audio-recording.ts.
//
//  • Only with the "MIDI into channel" record mode on (useTransport.recordMidi), and only into the live channel
//    (the first selected channel of the rack — liveChannelId()). "Mixer input into playlist" (recordAudio,
//    audio-recording.ts) records armed mixer tracks at the same time.
//
//  • Pattern mode: notes go into the current pattern. Playback doesn't loop while recording MIDI (see
//    Scheduler.region): it runs on past the pattern end and the pattern grows to fit what you play.
//  • Song mode: notes go into the current pattern. If no clip of that pattern covers the position
//    where recording started, a pattern clip is added there on the first free playlist track (FL);
//    the clip grows to fit what you record.
//  • Loop record ON = overdub (notes accumulate every pass); OFF = replace: notes of the recorded
//    channel inside the range swept since the first input of the take are removed.
//  • Start (and optionally end) times are quantized to the global snap when it is a musical value.
import { useTransport, playhead } from '../store/transport'
import { useUI } from '../store/ui'
import { editProject, getProject } from '../store/project'
import { defaultNote, uid } from '../store/factory'
import { currentPatternId, findPattern, liveChannelId } from '../store/actions'
import { PLAYLIST_TRACKS, PPQ, type Project } from '../store/types'
import { barTicks } from './sequence'
import { getEngine, initAudio, transport } from './transport'
import { countInPlan, firstFreeTrack, grownPatternLength, inRanges, quantizeRecordedNote, recordQuantizeGrid, sweptRanges } from './recording-core'
import { getAudioSettings } from '../windows/settings/settings-store'

interface Pending {
  channelId: string
  key: number
  vel: number
  tick: number // transport tick at note on (pattern-local in PAT mode, song tick in SONG mode)
  time: number // seconds clock at note on
}

interface Take {
  id: string
  mode: 'pattern' | 'song'
  patternId: string
  /** Song tick where the take started (playback start) — clip placement in song mode. */
  startTick: number
  /** Song mode: song tick of pattern tick 0 and the clip being recorded into. */
  origin: number | null
  clipId: string | null
  /** Notes recorded in this take (replace mode keeps them). */
  noteIds: Set<string>
  /** First input of the take (replace sweep). */
  sweepPos: number | null
  sweepTime: number
}

const pending = new Map<number, Pending>()
let take: Take | null = null

const tps = (p: Pick<Project, 'tempo'>): number => (p.tempo * PPQ) / 60

/** A monotonic clock in seconds — the audio clock when audio is running. */
function clock(): number {
  const e = getEngine()
  return e ? e.ctx.currentTime : performance.now() / 1000
}

function newTake(startTick: number): Take {
  const t = useTransport.getState()
  return {
    id: uid(),
    mode: t.mode,
    patternId: currentPatternId(),
    startTick,
    origin: null,
    clipId: null,
    noteIds: new Set(),
    sweepPos: null,
    sweepTime: 0
  }
}

/** Pattern position for a transport tick within the current take. */
function patternPos(tk: Take, tick: number, p: Project): number {
  if (tk.mode === 'pattern') return tick
  if (tk.origin === null) resolveSongTarget(tk, p)
  return tick - (tk.origin ?? tk.startTick)
}

/** Song mode: find a clip of the recorded pattern covering the take start (or plan a new one). */
function resolveSongTarget(tk: Take, p: Project): void {
  const clip = p.playlist.clips.find((c) => c.kind === 'pattern' && c.ref === tk.patternId && c.start <= tk.startTick && c.start + c.length > tk.startTick)
  if (clip) {
    tk.clipId = clip.id
    tk.origin = clip.start - clip.offset
  } else {
    const bar = barTicks(p)
    tk.origin = Math.floor(tk.startTick / bar) * bar
    tk.clipId = null // created on first commit
  }
}

function commit(pn: Pending, endTime: number): void {
  const project = getProject()
  if (!take) take = newTake(pn.tick)
  const tk = take
  const pattern = findPattern(project, tk.patternId)
  if (!pattern) return
  const s = getAudioSettings()
  const grid = recordQuantizeGrid(useUI.getState().globalSnap, project.timeSig)
  const rate = tps(project)
  const played = Math.max(1, (endTime - pn.time) * rate)
  let { pos, len } = quantizeRecordedNote(patternPos(tk, pn.tick, project), played, grid, { start: s.quantizeStart, end: s.quantizeEnd })
  // neither mode loops while recording MIDI: positions run on (the pattern / its clip grow to fit)
  const loopLen = Infinity
  pos = Math.max(0, pos)

  const replace = !useTransport.getState().loopRecord
  const sweep = replace && tk.sweepPos !== null ? sweptRanges(tk.sweepPos, (clock() - tk.sweepTime) * rate, loopLen) : []
  const note = defaultNote({ key: pn.key, vel: pn.vel, pos, len })
  tk.noteIds.add(note.id)
  const bar = barTicks(project)
  const needClip = tk.mode === 'song' && !tk.clipId
  const clipId = needClip ? uid() : tk.clipId
  const track = needClip
    ? Math.max(0, firstFreeTrack(project.playlist.clips, tk.origin ?? 0, (tk.origin ?? 0) + bar, PLAYLIST_TRACKS, (i) => !!project.playlist.tracks[i]?.locked))
    : -1
  if (needClip) tk.clipId = clipId

  editProject(
    'Record notes',
    (d) => {
      const pat = findPattern(d, tk.patternId)
      if (!pat) return
      const list = (pat.notes[pn.channelId] ??= [])
      if (sweep.length) {
        for (let i = list.length - 1; i >= 0; i--) if (!tk.noteIds.has(list[i].id) && inRanges(list[i].pos, sweep)) list.splice(i, 1)
      }
      list.push(note)
      list.sort((a, b) => a.pos - b.pos)
      if (tk.mode !== 'song') {
        pat.length = grownPatternLength(pat.length, pos + len, bar)
        return
      }
      const origin = tk.origin ?? 0
      if (needClip) {
        // FL: a pattern clip is placed where recording started (bar-aligned) on the first free track.
        d.playlist.clips.push({ id: clipId!, kind: 'pattern', ref: tk.patternId, track, start: origin, length: bar, offset: 0, muted: false })
      }
      const clip = d.playlist.clips.find((c) => c.id === clipId)
      if (clip) {
        const needEnd = origin + pos + len
        const len2 = Math.ceil((needEnd - clip.start) / bar) * bar
        if (len2 > clip.length) clip.length = len2
      }
    },
    { coalesceKey: `record:${tk.id}` }
  )
}

/** Notes of `channelId` are recorded: MIDI into channel is on, and it is the live (first selected) channel. */
function recordsNotes(channelId: string): boolean {
  return useTransport.getState().recordMidi && channelId === liveChannelId()
}

const audioArmed = (): boolean => getProject().mixer.some((m) => m.armed && m.index > 0)

/**
 * Called for every live note on/off (typing keyboard, MIDI). Adds notes to the current pattern while
 * recording + playing in MIDI record mode; with "wait for input" armed the first note starts playback.
 */
export function recordLiveNote(channelId: string, key: number, vel: number, on: boolean, id: number): void {
  const t = useTransport.getState()
  if (on) {
    if (waiting && t.recording) {
      // Wait for input: this note starts the song and lands on the start position.
      const from = startFrom()
      startNow()
      if (!recordsNotes(channelId)) return
      pending.set(id, { channelId, key, vel, tick: from, time: clock() + 0.06 })
      take = newTake(from)
      markSweep(from)
      return
    }
    if (!t.recording || !t.playing || !recordsNotes(channelId)) return
    const tick = transport.tick()
    if (!take) take = newTake(useTransport.getState().mode === 'song' ? takeStartTick ?? tick : tick)
    pending.set(id, { channelId, key, vel, tick, time: clock() })
    markSweep(tick)
    return
  }
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  commit(p, Math.max(clock(), p.time))
}

function markSweep(tick: number): void {
  if (!take || take.sweepPos !== null) return
  take.sweepPos = patternPos(take, tick, getProject())
  take.sweepTime = clock()
}

/** Finish held notes (transport stopped or record disarmed) and close the take. */
export function flushRecording(): void {
  const now = clock()
  for (const p of pending.values()) commit(p, Math.max(now, p.time))
  pending.clear()
  take = null
}

// ── count-in & wait for input ────────────────────────────────────────────────

let waiting = false
let counting = false
let countTimers: number[] = []
let countSources: AudioScheduledSourceNode[] = []
let clickBuf: AudioBuffer | null = null
let takeStartTick: number | null = null

type Play = () => Promise<void>
let origPlay: Play | null = null
let origStop: (() => void) | null = null
let origPause: (() => void) | null = null

function startFrom(): number {
  const t = useTransport.getState()
  return t.paused ? playhead.tick : t.startTick
}

function startNow(): void {
  waiting = false
  counting = false
  void origPlay?.()
}

/** Abort a pending count-in / wait. */
export function cancelRecordStart(): void {
  for (const id of countTimers) clearTimeout(id)
  countTimers = []
  for (const s of countSources) {
    try {
      s.stop()
    } catch {
      /* already stopped */
    }
  }
  countSources = []
  if (waiting || counting) useUI.getState().setHint('Recording start cancelled')
  waiting = false
  counting = false
}

export const recordStartState = (): { waiting: boolean; counting: boolean } => ({ waiting, counting })

function makeClick(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.03)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * 1600 * i) / ctx.sampleRate) * Math.exp(-i / (len / 6))
  return buf
}

/** FL "Countdown before recording": metronome clicks for N bars, then the transport starts on the downbeat. */
async function countIn(): Promise<void> {
  const engine = await initAudio()
  const ctx = engine.ctx
  const p = getProject()
  const s = getAudioSettings()
  const { beatsPerBar, beatSec, total } = countInPlan(p.tempo, p.timeSig, s.precountBars)
  counting = true
  clickBuf ??= makeClick(ctx)
  const t0 = ctx.currentTime + 0.08
  const vol = ctx.createGain()
  vol.gain.value = 0.5 * s.metronomeVolume
  vol.connect(engine.masterOut)
  for (let i = 0; i < total; i++) {
    const src = ctx.createBufferSource()
    src.buffer = clickBuf
    src.playbackRate.value = i % beatsPerBar === 0 ? 1.5 : 1
    src.connect(vol)
    src.start(t0 + i * beatSec)
    countSources.push(src)
    const beat = (i % beatsPerBar) + 1
    countTimers.push(window.setTimeout(() => counting && useUI.getState().setHint(`Count-in… ${beatsPerBar - beat + 1}`), Math.max(0, (t0 + i * beatSec - ctx.currentTime) * 1000)))
  }
  // The scheduler places the start tick 60 ms after play() — start so that lands on the next downbeat.
  const startAt = t0 + total * beatSec - 0.06
  countTimers.push(
    window.setTimeout(() => {
      countTimers = []
      countSources = []
      setTimeout(() => vol.disconnect(), 200)
      if (counting) startNow()
    }, Math.max(0, (startAt - ctx.currentTime) * 1000))
  )
}

/**
 * Wrap the transport's play/stop/pause so record-start options work without changing the
 * scheduler: play() with record armed goes through count-in / wait-for-input first.
 */
function installTransportHooks(): void {
  if (origPlay) return
  origPlay = transport.play
  origStop = transport.stop
  origPause = transport.pause
  transport.play = async () => {
    let t = useTransport.getState()
    if (t.playing) return origPlay!()
    if (t.recording && !waiting && !counting && t.recordAudio && audioArmed()) {
      // Audio takes are recorded into the playlist: switch to song mode and show it.
      if (t.mode === 'pattern') transport.setMode('song')
      const ui = useUI.getState()
      if (!ui.windows.playlist?.open || ui.windows.playlist.minimized) ui.openWindow('playlist', { kind: 'playlist', title: 'Playlist - Arrangement' })
      t = useTransport.getState()
    }
    if (waiting || counting) {
      // play / Space again during the count-in (or while waiting for input) stops: nothing starts
      cancelRecordStart()
      return
    }
    if (t.recording && t.waitForInput) {
      waiting = true
      useUI.getState().setHint('Waiting for input… play a note to start recording')
      return
    }
    if (t.recording && t.precount) {
      try {
        await countIn()
      } catch (e) {
        console.warn('count-in failed', e)
        startNow()
      }
      return
    }
    return origPlay!()
  }
  transport.stop = () => {
    cancelRecordStart()
    origStop!()
  }
  transport.pause = () => {
    cancelRecordStart()
    origPause!()
  }
}

function recordingHint(): string {
  const t = useTransport.getState()
  const parts: string[] = []
  if (t.recordAudio && audioArmed()) parts.push('mixer input into the playlist')
  if (t.recordMidi) parts.push(`MIDI into ${getProject().channels.find((c) => c.id === liveChannelId())?.name ?? 'the selected channel'}`)
  if (!parts.length) return t.recordAudio ? 'Recording — arm a mixer track to record its input' : 'Recording — right-click Record to choose what it records'
  return `Recording ${parts.join(' and ')}${t.recordMidi ? ' — play the typing keyboard or a MIDI controller' : '…'}`
}

let installed = false
/** Boot note recording (idempotent). */
export function initNoteRecording(): void {
  if (installed) return
  installed = true
  installTransportHooks()
  useTransport.subscribe((s, prev) => {
    if (s.playing && !prev.playing) {
      takeStartTick = prev.paused ? playhead.tick : s.startTick
      if (s.recording) useUI.getState().setHint(recordingHint())
    }
    if ((!s.playing && prev.playing) || (!s.recording && prev.recording) || (!s.recordMidi && prev.recordMidi)) flushRecording()
    if (!s.playing && prev.playing) takeStartTick = null
    if (!s.recording && prev.recording && (waiting || counting)) cancelRecordStart()
    if (s.mode !== prev.mode) take = null
  })
  useUI.subscribe((s, prev) => {
    if (s.currentPattern !== prev.currentPattern && take) {
      flushRecording()
    }
  })
}
