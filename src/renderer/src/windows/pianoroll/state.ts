// Piano-roll-local UI state (not saved in the project, not undoable).
import { create } from 'zustand'
import type { Snap } from '@/store/ui'
import type { Note } from '@/store/types'

export type LaneTarget = 'vel' | 'rel' | 'pan' | 'modX' | 'modY' | 'fine'

export interface LaneDef {
  label: string
  get: (n: Note) => number // normalized 0..1
  set: (n: Note, v: number) => Note
  def: number // normalized default
  bipolar: boolean
  fmt: (n: Note) => string
}

const pct = (v: number) => `${Math.round(v * 100)}%`

export const LANES: Record<LaneTarget, LaneDef> = {
  vel: {
    label: 'Velocity',
    get: (n) => n.vel,
    set: (n, v) => ({ ...n, vel: v }),
    def: 100 / 128,
    bipolar: false,
    fmt: (n) => `${Math.round(n.vel * 128)} (${pct(n.vel)})`
  },
  rel: {
    label: 'Release',
    get: (n) => n.rel,
    set: (n, v) => ({ ...n, rel: v }),
    def: 0.5,
    bipolar: false,
    fmt: (n) => pct(n.rel)
  },
  pan: {
    label: 'Panning',
    get: (n) => (n.pan + 1) / 2,
    set: (n, v) => ({ ...n, pan: Math.abs(v - 0.5) < 0.01 ? 0 : v * 2 - 1 }),
    def: 0.5,
    bipolar: true,
    fmt: (n) => (Math.abs(n.pan) < 0.005 ? 'Centered' : `${Math.round(Math.abs(n.pan) * 100)}% ${n.pan < 0 ? 'left' : 'right'}`)
  },
  modX: {
    label: 'Mod X',
    get: (n) => n.modX,
    set: (n, v) => ({ ...n, modX: v }),
    def: 0.5,
    bipolar: true,
    fmt: (n) => pct(n.modX)
  },
  modY: {
    label: 'Mod Y',
    get: (n) => n.modY,
    set: (n, v) => ({ ...n, modY: v }),
    def: 0.5,
    bipolar: true,
    fmt: (n) => pct(n.modY)
  },
  fine: {
    label: 'Fine pitch',
    get: (n) => (n.fine + 120) / 240,
    set: (n, v) => ({ ...n, fine: Math.round(v * 240 - 120) }),
    def: 0.5,
    bipolar: true,
    fmt: (n) => `${n.fine > 0 ? '+' : ''}${n.fine} cents`
  }
}

export const LANE_ORDER: LaneTarget[] = ['vel', 'rel', 'pan', 'modX', 'modY', 'fine']

interface PRState {
  snap: Snap
  ghosts: boolean
  colorGroup: number
  slide: boolean
  porta: boolean
  scaleRoot: number
  scale: string
  stamp: string | null
  lane: LaneTarget
  laneH: number
  /** Note whose properties dialog is open. */
  propsNote: string | null
  /** Per-channel keyboard view override (true = drum view). Default: drum view when the plugin names keys. */
  drumView: Record<string, boolean>
  /** Current keyboard column width (published by the controller for DOM overlays). */
  keysW: number
  set: (patch: Partial<Omit<PRState, 'set'>>) => void
}

export const usePR = create<PRState>((set) => ({
  snap: 'main',
  ghosts: true,
  colorGroup: 0,
  slide: false,
  porta: false,
  scaleRoot: 0,
  scale: 'none',
  stamp: null,
  lane: 'vel',
  laneH: 96,
  propsNote: null,
  drumView: {},
  keysW: 74,
  set: (patch) => set(patch)
}))
