import { create } from 'zustand'
import { enablePatches, produceWithPatches, applyPatches, type Patch } from 'immer'
import type { Project } from './types'
import { makeEmptyProject } from './factory'

enablePatches()

interface HistoryEntry {
  label: string
  patches: Patch[]
  inverse: Patch[]
  coalesceKey?: string
  time: number
}

interface ProjectState {
  project: Project
  filePath: string | null
  dirty: boolean
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Undoable edit. Edits sharing a coalesceKey within 1.5 s merge into one history step (knob drags). */
  edit: (label: string, recipe: (draft: Project) => void, opts?: { coalesceKey?: string; undoable?: boolean }) => void
  undo: () => void
  redo: () => void
  /** Jump to a history position (FL's "History" menu). */
  undoTo: (index: number) => void
  load: (project: Project, filePath?: string | null) => void
  reset: () => void
  markSaved: (filePath: string) => void
}

const MAX_HISTORY = 200

export const useProject = create<ProjectState>((set, get) => ({
  project: makeEmptyProject(),
  filePath: null,
  dirty: false,
  past: [],
  future: [],

  edit(label, recipe, opts) {
    const { project, past } = get()
    const [next, patches, inverse] = produceWithPatches(project, recipe)
    if (patches.length === 0) return
    if (opts?.undoable === false) {
      set({ project: next, dirty: true })
      return
    }
    const now = performance.now()
    const last = past[past.length - 1]
    if (opts?.coalesceKey && last && last.coalesceKey === opts.coalesceKey && now - last.time < 1500) {
      const merged: HistoryEntry = {
        ...last,
        patches: [...last.patches, ...patches],
        inverse: [...inverse, ...last.inverse],
        time: now
      }
      set({ project: next, past: [...past.slice(0, -1), merged], future: [], dirty: true })
      return
    }
    const entry: HistoryEntry = { label, patches, inverse, coalesceKey: opts?.coalesceKey, time: now }
    const nextPast = past.length >= MAX_HISTORY ? [...past.slice(1), entry] : [...past, entry]
    set({ project: next, past: nextPast, future: [], dirty: true })
  },

  undo() {
    const { past, future, project } = get()
    const entry = past[past.length - 1]
    if (!entry) return
    set({ project: applyPatches(project, entry.inverse), past: past.slice(0, -1), future: [entry, ...future], dirty: true })
  },

  redo() {
    const { past, future, project } = get()
    const entry = future[0]
    if (!entry) return
    set({ project: applyPatches(project, entry.patches), past: [...past, entry], future: future.slice(1), dirty: true })
  },

  undoTo(index) {
    // index = number of entries that should remain in `past`
    let s = get()
    while (s.past.length > index) {
      s.undo()
      s = get()
    }
    while (s.past.length < index && s.future.length) {
      s.redo()
      s = get()
    }
  },

  load(project, filePath = null) {
    set({ project, filePath, dirty: false, past: [], future: [] })
  },

  reset() {
    set({ project: makeEmptyProject(), filePath: null, dirty: false, past: [], future: [] })
  },

  markSaved(filePath) {
    set({ filePath, dirty: false })
  }
}))

/** Shorthand for non-React code. */
export const getProject = (): Project => useProject.getState().project
export const editProject = (
  label: string,
  recipe: (draft: Project) => void,
  opts?: { coalesceKey?: string; undoable?: boolean }
): void => useProject.getState().edit(label, recipe, opts)
