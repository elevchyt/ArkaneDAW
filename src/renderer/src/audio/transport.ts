// Live playback: look-ahead scheduler (25 ms tick, ~120 ms horizon) driving the AudioEngine.
import { useProject, getProject } from '../store/project'
import { useTransport, playhead } from '../store/transport'
import { useUI } from '../store/ui'
import { PPQ, type Automation, type AutomationTarget, type Project } from '../store/types'
import { AudioEngine, faderToGain } from './engine'
import { ensureAudio } from './context'
import { automationValue, barTicks, patternHits, patternLength, songHits, songLength, type NoteHit } from './sequence'
import { getBuffer, loadSample } from './samples'
import { getPlugin } from '../plugins/registry'
import { denormalize } from '../plugins/sdk/params'
import { getAudioSettings } from '../windows/settings/settings-store'

const LOOKAHEAD_MS = 25
const HORIZON = 0.12 // seconds
/** Delay between pressing play and the first scheduled sample (audio recording aligns to this). */
export const START_DELAY = 0.06

let engine: AudioEngine | null = null
let initPromise: Promise<AudioEngine> | null = null

export function getEngine(): AudioEngine | null {
  return engine
}

/** Boot audio once (idempotent). Subscribes the engine to project changes. */
export function initAudio(): Promise<AudioEngine> {
  if (!initPromise) {
    initPromise = ensureAudio().then((ctx) => {
      engine = new AudioEngine(ctx)
      engine.sync(getProject())
      useProject.subscribe((s) => engine!.sync(s.project))
      startFrameLoop()
      return engine
    })
  }
  return initPromise
}

interface Wrap {
  time: number // ctx time where this segment starts
  tick: number // song tick at that time
}

class Scheduler {
  private timer: number | null = null
  private cursorTime = 0 // ctx time scheduled up to
  private cursorTick = 0 // song tick at cursorTime
  private wraps: Wrap[] = []
  private tempo = 130
  private sources = new Set<AudioBufferSourceNode>()
  private clickBuf: AudioBuffer | null = null
  private regionStart = 0

  start(fromTick: number): void {
    const e = engine
    if (!e) return
    const ctx = e.ctx as AudioContext
    this.tempo = getProject().tempo
    this.cursorTime = ctx.currentTime + START_DELAY
    this.cursorTick = fromTick
    this.wraps = [{ time: this.cursorTime, tick: fromTick }]
    this.startAudioClipsAt(fromTick, this.cursorTime)
    this.tick()
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        /* not started */
      }
    }
    this.sources.clear()
    engine?.stopScheduled()
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Song tick currently audible. */
  audibleTick(): number {
    const e = engine
    if (!e || !this.wraps.length) return playhead.tick
    const ctx = e.ctx as AudioContext
    const now = ctx.currentTime - (ctx.outputLatency || 0)
    let w = this.wraps[0]
    for (const x of this.wraps) if (x.time <= now) w = x
    // drop old wraps
    while (this.wraps.length > 2 && this.wraps[1].time <= now) this.wraps.shift()
    return w.tick + Math.max(0, now - w.time) * this.tps()
  }

  private tps(): number {
    return (this.tempo * PPQ) / 60
  }

  private region(p: Project): { start: number; end: number } {
    const t = useTransport.getState()
    if (t.mode === 'pattern') {
      const pat = p.patterns.find((x) => x.id === useUI.getState().currentPattern) ?? p.patterns[0]
      return { start: 0, end: pat ? patternLength(pat, p) : barTicks(p) }
    }
    if (t.loop) return t.loop
    return { start: 0, end: songLength(p) }
  }

  private tick(): void {
    const e = engine
    if (!e) return
    const ctx = e.ctx as AudioContext
    const p = getProject()
    if (p.tempo !== this.tempo) {
      // Re-anchor at the cursor so tempo changes apply from the next scheduled event.
      this.tempo = p.tempo
    }
    const horizon = ctx.currentTime + HORIZON
    let guard = 0
    while (this.cursorTime < horizon && guard++ < 16) {
      const { start, end } = this.region(p)
      this.regionStart = start
      if (this.cursorTick >= end || this.cursorTick < start) {
        this.cursorTick = start
        this.wraps.push({ time: this.cursorTime, tick: start })
        this.startAudioClipsAt(start, this.cursorTime)
      }
      const tps = this.tps()
      const spanTicks = Math.min(end - this.cursorTick, (horizon - this.cursorTime) * tps)
      if (spanTicks <= 0) break
      const from = this.cursorTick
      const to = from + spanTicks
      this.scheduleRange(p, from, to, this.cursorTime)
      this.cursorTime += spanTicks / tps
      this.cursorTick = to
      if (to >= end - 1e-6) {
        this.cursorTick = start
        this.wraps.push({ time: this.cursorTime, tick: start })
        this.startAudioClipsAt(start, this.cursorTime)
      }
    }
  }

  private scheduleRange(p: Project, from: number, to: number, t0: number): void {
    const e = engine!
    const tps = this.tps()
    const at = (tick: number) => t0 + (tick - from) / tps
    const t = useTransport.getState()
    let hits: NoteHit[]
    if (t.mode === 'pattern') {
      const pat = p.patterns.find((x) => x.id === useUI.getState().currentPattern) ?? p.patterns[0]
      const muted = new Set(p.channels.filter((c) => c.muted).map((c) => c.id))
      hits = pat ? patternHits(p, pat, 0, from, to, undefined, muted) : []
    } else {
      hits = songHits(p, from, to)
      this.scheduleAudioClips(p, from, to, at)
      this.scheduleAutomation(p, from, to, at)
    }
    const byChannel = new Map<string, import('../plugins/sdk/types').ScheduledEvent[]>()
    for (const h of hits) {
      const id = e.nextNoteId()
      const on = at(h.start)
      const off = at(h.end)
      const n = h.note
      let list = byChannel.get(h.channelId)
      if (!list) byChannel.set(h.channelId, (list = []))
      list.push({
        kind: 'on',
        time: on,
        note: { id, key: n.key, vel: n.vel, pan: n.pan, fine: n.fine, rel: n.rel, modX: n.modX, modY: n.modY, porta: n.porta, slide: n.slide, color: n.color, length: off - on }
      })
      list.push({ kind: 'off', time: off, id, key: n.key, rel: n.rel })
    }
    for (const [ch, evs] of byChannel) e.schedule(ch, evs)
    if (t.metronome) this.scheduleClicks(p, from, to, at)
  }

  /** Audio clips that are already sounding when playback starts or wraps. */
  private startAudioClipsAt(tick: number, time: number): void {
    const p = getProject()
    if (useTransport.getState().mode !== 'song') return
    for (const clip of p.playlist.clips) {
      if (clip.kind !== 'audio' || clip.muted || p.playlist.tracks[clip.track]?.muted) continue
      if (clip.start < tick && clip.start + clip.length > tick) this.playClip(p, clip, time, tick - clip.start)
    }
  }

  private scheduleAudioClips(p: Project, from: number, to: number, at: (t: number) => number): void {
    for (const clip of p.playlist.clips) {
      if (clip.kind !== 'audio' || clip.muted || p.playlist.tracks[clip.track]?.muted) continue
      if (clip.start >= from && clip.start < to) this.playClip(p, clip, at(clip.start), 0)
    }
  }

  private playClip(p: Project, clip: import('../store/types').Clip, when: number, intoTicks: number): void {
    const e = engine!
    const buf = getBuffer(clip.ref)
    if (!buf) {
      const s = p.samples.find((x) => x.id === clip.ref)
      if (s) void loadSample(s)
      return
    }
    const ctx = e.ctx
    const src = ctx.createBufferSource()
    src.buffer = buf
    const strip = clip.channelId ? e.channels.get(clip.channelId) : null
    src.connect(strip ? strip.input : e.mixer[0].input)
    const tps = this.tps()
    const offsetSec = (clip.offset + intoTicks) / tps
    const durSec = (clip.length - intoTicks) / tps
    if (offsetSec >= buf.duration) return
    src.start(Math.max(when, ctx.currentTime), offsetSec, durSec)
    this.sources.add(src)
    src.onended = () => this.sources.delete(src)
  }

  private scheduleAutomation(p: Project, from: number, to: number, at: (t: number) => number): void {
    const step = PPQ / 16
    for (const clip of p.playlist.clips) {
      if (clip.kind !== 'automation' || clip.muted || p.playlist.tracks[clip.track]?.muted) continue
      if (clip.start >= to || clip.start + clip.length <= from) continue
      const a = p.automations.find((x) => x.id === clip.ref)
      if (!a?.target) continue
      const s = Math.max(from, clip.start)
      const e = Math.min(to, clip.start + clip.length)
      for (let tk = Math.ceil(s / step) * step; tk < e; tk += step) {
        applyAutomation(p, a, a.target, automationValue(a, tk - clip.start + clip.offset), at(tk))
      }
    }
  }

  private scheduleClicks(p: Project, from: number, to: number, at: (t: number) => number): void {
    const e = engine!
    const ctx = e.ctx
    if (!this.clickBuf) this.clickBuf = makeClick(ctx)
    const beat = (PPQ * 4) / p.timeSig[1]
    const bar = barTicks(p)
    for (let b = Math.ceil(from / beat) * beat; b < to; b += beat) {
      const src = ctx.createBufferSource()
      src.buffer = this.clickBuf
      src.playbackRate.value = b % bar === 0 ? 1.5 : 1
      const g = ctx.createGain()
      g.gain.value = 0.35 * metronomeVolume()
      src.connect(g).connect(e.masterOut)
      src.start(at(b))
    }
  }
}

function metronomeVolume(): number {
  try {
    const v = getAudioSettings().metronomeVolume
    return typeof v === 'number' ? v : 1
  } catch {
    return 1
  }
}

function makeClick(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.03)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.sin((2 * Math.PI * 1600 * i) / ctx.sampleRate) * Math.exp(-i / (len / 6))
  return buf
}

/** Apply a normalized automation value to its target at a given context time. */
export function applyAutomation(p: Project, _a: Automation, target: AutomationTarget, v: number, time: number, eng: AudioEngine | null = engine): void {
  if (!eng) return
  switch (target.kind) {
    case 'channel': {
      const strip = eng.channels.get(target.channelId)
      if (!strip) return
      if (target.param === 'volume') strip.vol.gain.setValueAtTime(faderToGain(v * 1.25, 0.78), time)
      else if (target.param === 'pan') strip.pan.pan.setValueAtTime(v * 2 - 1, time)
      else strip.instrument?.schedule([{ kind: 'bend', time, semitones: (v * 2 - 1) * 12 }])
      return
    }
    case 'channelPlugin': {
      const ch = p.channels.find((c) => c.id === target.channelId)
      const def = ch?.plugin ? getPlugin(ch.plugin.pluginId)?.manifest.params.find((x) => x.id === target.paramId) : undefined
      const value = def ? denormalize(def, v) : v
      eng.channels.get(target.channelId)?.instrument?.schedule([{ kind: 'param', time, id: target.paramId, value }])
      return
    }
    case 'mixer': {
      const m = eng.mixer[target.track]
      if (!m) return
      if (target.param === 'volume') m.fader.gain.setValueAtTime(faderToGain(v * 1.25), time)
      else if (target.param === 'pan') m.pan.pan.setValueAtTime(v * 2 - 1, time)
      return
    }
    case 'mixerFx': {
      const slot = p.mixer[target.track]?.slots[target.slot]
      const def = slot ? getPlugin(slot.plugin.pluginId)?.manifest.params.find((x) => x.id === target.paramId) : undefined
      eng.fxPlugin(target.track, target.slot)?.schedule([{ kind: 'param', time, id: target.paramId, value: def ? denormalize(def, v) : v }])
      return
    }
    case 'masterVolume':
      eng.masterOut.gain.setValueAtTime(faderToGain(v * 1.25), time)
      return
    default:
      return
  }
}

const scheduler = new Scheduler()

let frameLoop = false
function startFrameLoop(): void {
  if (frameLoop) return
  frameLoop = true
  const loop = () => {
    if (scheduler.running) playhead.set(scheduler.audibleTick())
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

export const transport = {
  async play(): Promise<void> {
    await initAudio()
    const t = useTransport.getState()
    if (t.playing) return
    const from = t.paused ? playhead.tick : t.startTick
    useTransport.getState().set({ playing: true, paused: false })
    scheduler.start(from)
  },
  stop(): void {
    const t = useTransport.getState()
    scheduler.stop()
    useTransport.getState().set({ playing: false, paused: false })
    playhead.set(t.startTick)
  },
  pause(): void {
    if (!useTransport.getState().playing) return
    const tick = scheduler.audibleTick()
    scheduler.stop()
    useTransport.getState().set({ playing: false, paused: true })
    playhead.set(tick)
  },
  /** Space: start/stop.  */
  toggle(): void {
    if (useTransport.getState().playing) transport.stop()
    else void transport.play()
  },
  /** Ctrl+Space: start/pause. */
  togglePause(): void {
    if (useTransport.getState().playing) transport.pause()
    else void transport.play()
  },
  setMode(mode: 'pattern' | 'song'): void {
    const wasPlaying = useTransport.getState().playing
    if (wasPlaying) scheduler.stop()
    useTransport.getState().set({ mode, startTick: 0, paused: false })
    playhead.set(0)
    if (wasPlaying) {
      useTransport.getState().set({ playing: false })
      void transport.play()
    }
  },
  /** Move the start marker (click on a timeline). Restarts from there if playing. */
  seek(tick: number): void {
    const t = useTransport.getState()
    useTransport.getState().set({ startTick: Math.max(0, tick), paused: false })
    playhead.set(Math.max(0, tick))
    if (t.playing) {
      scheduler.stop()
      scheduler.start(Math.max(0, tick))
    }
  },
  panic(): void {
    engine?.panic(true)
  },
  /** Current audible song tick. */
  tick(): number {
    return scheduler.running ? scheduler.audibleTick() : playhead.tick
  }
}
