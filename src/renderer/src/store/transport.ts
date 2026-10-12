import { create } from 'zustand'

export type PlayMode = 'pattern' | 'song'

/**
 * What the Record button records (right-click it; both on by default, they don't conflict):
 *  recordAudio — "Mixer input into playlist": armed mixer tracks → audio clips in the playlist
 *  recordMidi  — "MIDI into channel": MIDI controller / typing keyboard → the first selected channel's notes in
 *                the current pattern
 */
const RECORD_MODES_KEY = 'arkane.recordModes.v1'
function savedRecordModes(): { recordAudio: boolean; recordMidi: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(RECORD_MODES_KEY) ?? '{}') as { audio?: unknown; midi?: unknown }
    return { recordAudio: v.audio !== false, recordMidi: v.midi !== false }
  } catch {
    return { recordAudio: true, recordMidi: true }
  }
}

interface TransportState {
  playing: boolean
  paused: boolean
  recording: boolean // record armed (R)
  recordAudio: boolean
  recordMidi: boolean
  mode: PlayMode
  metronome: boolean
  precount: boolean
  waitForInput: boolean
  loopRecord: boolean
  /** Start position (ticks) playback returns to on stop. */
  startTick: number
  /** Song-mode loop range (ticks) from playlist time selection, or null. */
  loop: { start: number; end: number } | null
  set: (patch: Partial<Omit<TransportState, 'set'>>) => void
}

export const useTransport = create<TransportState>((set) => ({
  playing: false,
  paused: false,
  recording: false,
  ...savedRecordModes(),
  mode: 'pattern',
  metronome: false,
  precount: true,
  waitForInput: false,
  loopRecord: true,
  startTick: 0,
  loop: null,
  set: (patch) => set(patch)
}))

useTransport.subscribe((s, prev) => {
  if (s.recordAudio === prev.recordAudio && s.recordMidi === prev.recordMidi) return
  try {
    localStorage.setItem(RECORD_MODES_KEY, JSON.stringify({ audio: s.recordAudio, midi: s.recordMidi }))
  } catch {
    /* storage unavailable: the choice lasts for this session */
  }
})

/**
 * The playhead position is updated every animation frame. It is NOT kept in React state:
 * canvases read it directly and subscribe to frame ticks to avoid re-rendering the tree.
 */
export const playhead = {
  tick: 0,
  /** Which pattern the playhead belongs to in pattern mode. */
  patternId: null as string | null,
  listeners: new Set<(tick: number) => void>(),
  set(tick: number) {
    this.tick = tick
    for (const l of this.listeners) l(tick)
  },
  subscribe(fn: (tick: number) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
