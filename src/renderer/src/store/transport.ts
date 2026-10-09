import { create } from 'zustand'

export type PlayMode = 'pattern' | 'song'

interface TransportState {
  playing: boolean
  paused: boolean
  recording: boolean // record armed (R)
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
  mode: 'pattern',
  metronome: false,
  precount: false,
  waitForInput: false,
  loopRecord: true,
  startTick: 0,
  loop: null,
  set: (patch) => set(patch)
}))

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
