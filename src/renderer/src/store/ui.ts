import { create } from 'zustand'
import type { ID } from './types'

export type WindowKind =
  | 'playlist'
  | 'channelRack'
  | 'pianoRoll'
  | 'mixer'
  | 'plugin' // instrument or effect editor
  | 'pluginPicker'
  | 'projectInfo'
  | 'audioSettings'
  | 'pluginManager'

export interface WindowState {
  id: string // unique: 'playlist', 'pianoRoll', 'plugin:<channelId>', 'fx:<track>:<slot>'
  kind: WindowKind
  title: string
  x: number
  y: number
  w: number
  h: number
  z: number
  open: boolean
  maximized: boolean
  minimized: boolean
  /** plugin windows */
  channelId?: ID
  mixerTrack?: number
  slot?: number
}

export type Tool = 'draw' | 'paint' | 'paintDrum' | 'delete' | 'mute' | 'slice' | 'select' | 'zoom' | 'play' | 'slip'

/** Snap values in ticks; 'line' = adapt to zoom, 'none' = free. */
export type Snap =
  | 'main'
  | 'line'
  | 'cell'
  | 'none'
  | '1/6step'
  | '1/4step'
  | '1/3step'
  | '1/2step'
  | 'step'
  | '1/6beat'
  | '1/4beat'
  | '1/3beat'
  | '1/2beat'
  | 'beat'
  | 'bar'

export const SNAP_LABELS: Record<Snap, string> = {
  main: '(main)',
  line: 'Line',
  cell: 'Cell',
  none: '(none)',
  '1/6step': '1/6 step',
  '1/4step': '1/4 step',
  '1/3step': '1/3 step',
  '1/2step': '1/2 step',
  step: 'Step',
  '1/6beat': '1/6 beat',
  '1/4beat': '1/4 beat',
  '1/3beat': '1/3 beat',
  '1/2beat': '1/2 beat',
  beat: 'Beat',
  bar: 'Bar'
}

interface UIState {
  windows: Record<string, WindowState>
  topZ: number
  focused: string | null
  browserVisible: boolean
  browserWidth: number
  hint: string
  currentPattern: ID | null
  selectedChannels: ID[]
  pianoRollChannel: ID | null
  selectedMixerTrack: number
  playlistTool: Tool
  pianoRollTool: Tool
  globalSnap: Snap
  typingKeyboard: boolean
  typingOctave: number
  stepEditMode: boolean
  channelFilter: string
  /** Last-tweaked parameter (for "Link to controller" / automation creation) */
  lastTweaked: { label: string; target: unknown } | null

  openWindow: (id: string, init?: Partial<WindowState> & { kind: WindowKind; title: string }) => void
  closeWindow: (id: string) => void
  toggleWindow: (id: string, init?: Partial<WindowState> & { kind: WindowKind; title: string }) => void
  focusWindow: (id: string) => void
  updateWindow: (id: string, patch: Partial<WindowState>) => void
  setHint: (hint: string) => void
  set: (patch: Partial<UIState>) => void
}

// Default layout roughly matching FL Studio's "Arrange windows" (Ctrl+Shift+H).
const DEFAULT_WINDOWS: Record<string, WindowState> = {
  playlist: { id: 'playlist', kind: 'playlist', title: 'Playlist - Arrangement', x: 0, y: 0, w: 1100, h: 560, z: 1, open: true, maximized: true, minimized: false },
  channelRack: { id: 'channelRack', kind: 'channelRack', title: 'Channel rack', x: 60, y: 40, w: 640, h: 380, z: 3, open: true, maximized: false, minimized: false },
  pianoRoll: { id: 'pianoRoll', kind: 'pianoRoll', title: 'Piano roll', x: 140, y: 80, w: 980, h: 560, z: 2, open: false, maximized: false, minimized: false },
  mixer: { id: 'mixer', kind: 'mixer', title: 'Mixer', x: 80, y: 220, w: 1180, h: 470, z: 2, open: false, maximized: false, minimized: false }
}

export const useUI = create<UIState>((set, get) => ({
  windows: DEFAULT_WINDOWS,
  topZ: 10,
  focused: 'channelRack',
  browserVisible: true,
  browserWidth: 220,
  hint: 'ArkaneDAW',
  currentPattern: null,
  selectedChannels: [],
  pianoRollChannel: null,
  selectedMixerTrack: 0,
  playlistTool: 'draw',
  pianoRollTool: 'draw',
  globalSnap: 'line',
  typingKeyboard: false,
  typingOctave: 5,
  stepEditMode: false,
  channelFilter: 'All',
  lastTweaked: null,

  openWindow(id, init) {
    const { windows, topZ } = get()
    const existing = windows[id]
    const z = topZ + 1
    if (existing) {
      set({ windows: { ...windows, [id]: { ...existing, ...(init ?? {}), open: true, minimized: false, z } }, topZ: z, focused: id })
    } else if (init) {
      const n = Object.keys(windows).length
      const w: WindowState = {
        id,
        x: 120 + (n % 8) * 24,
        y: 60 + (n % 8) * 24,
        w: 520,
        h: 380,
        open: true,
        maximized: false,
        minimized: false,
        ...init,
        z
      } as WindowState
      set({ windows: { ...windows, [id]: w }, topZ: z, focused: id })
    }
  },
  closeWindow(id) {
    const { windows } = get()
    if (!windows[id]) return
    set({ windows: { ...windows, [id]: { ...windows[id], open: false } } })
  },
  toggleWindow(id, init) {
    const w = get().windows[id]
    if (w && w.open && !w.minimized && get().focused === id) get().closeWindow(id)
    else get().openWindow(id, init)
  },
  focusWindow(id) {
    const { windows, topZ, focused } = get()
    if (!windows[id] || (focused === id && windows[id].z === topZ)) return
    const z = topZ + 1
    set({ windows: { ...windows, [id]: { ...windows[id], z } }, topZ: z, focused: id })
  },
  updateWindow(id, patch) {
    const { windows } = get()
    if (!windows[id]) return
    set({ windows: { ...windows, [id]: { ...windows[id], ...patch } } })
  },
  setHint(hint) {
    if (get().hint !== hint) set({ hint })
  },
  set(patch) {
    set(patch)
  }
}))
