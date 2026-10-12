// Watches the open .arkane file for changes made by other programs (a text editor, a script, an AI agent editing
// the project). A clean project reloads right away; with unsaved changes the user is asked first. Either way the
// reload is one undoable step ("Reload from disk"), so Ctrl+Z goes back to what was on screen.
import { host } from '../platform'
import { useProject } from './project'
import { useUI } from './ui'
import { migrate } from './io'
import { confirmAction } from '../system/ConfirmDialog'
import type { Project } from './types'

const POLL_MS = 700
/** Writers often save in several steps (truncate + write, temp + rename): wait until the file settles. */
const SETTLE_MS = 250

let watched: string | null = null
/** File contents the project is known to match (what we last read or wrote). */
let synced: string | null = null
/** The last project file io.ts read or wrote (it becomes `watched` right after). */
let last: { path: string; text: string } | null = null
let settleTimer = 0
let asking = false

/** io.ts reports every read / write of a project file, so our own saves don't look like outside changes. */
export function noteSynced(path: string, text: string): void {
  last = { path, text }
  if (path === watched) synced = text
}

function readText(path: string): string | null {
  try {
    return host!.fs.readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Replace the project with the file's contents as one undoable edit. */
function reloadFrom(path: string, project: Project): void {
  const name = host!.path.basename(path)
  useProject.getState().edit(`Reload ${name} from disk`, () => project)
  useProject.setState({ dirty: false })
  // keep the UI pointing at things that still exist
  const ui = useUI.getState()
  const pats = new Set(project.patterns.map((p) => p.id))
  const chans = new Set(project.channels.map((c) => c.id))
  ui.set({
    currentPattern: ui.currentPattern && pats.has(ui.currentPattern) ? ui.currentPattern : (project.patterns[0]?.id ?? null),
    selectedChannels: ui.selectedChannels.filter((id) => chans.has(id)),
    pianoRollChannel: ui.pianoRollChannel && chans.has(ui.pianoRollChannel) ? ui.pianoRollChannel : (project.channels[0]?.id ?? null),
    hint: `${name} changed on disk and was reloaded (Ctrl+Z to undo)`
  })
}

async function onChange(path: string): Promise<void> {
  if (path !== watched || asking) return
  const text = readText(path)
  if (text === null || text === synced) return
  let project: Project
  try {
    project = migrate(JSON.parse(text))
  } catch {
    return // half-written or not JSON (yet): wait for the next change
  }
  synced = text
  if (useProject.getState().dirty) {
    asking = true
    const ok = await confirmAction({
      title: 'File changed on disk',
      message: `${host!.path.basename(path)} was changed by another program. Reload it?`,
      detail: 'Reload replaces your unsaved changes (Ctrl+Z brings them back). Cancel keeps them, and the next save overwrites the file.',
      confirmLabel: 'Reload'
    })
    asking = false
    if (!ok || path !== watched) return
    // it may have changed again while the dialog was open
    const latest = readText(path)
    if (latest !== null && latest !== text) {
      try {
        project = migrate(JSON.parse(latest))
        synced = latest
      } catch {
        /* keep the version the user agreed to */
      }
    }
  }
  reloadFrom(path, project)
}

function watch(path: string | null): void {
  if (watched === path) return
  if (watched) host!.fs.unwatchFile(watched)
  watched = path
  synced = null
  if (!path) return
  synced = last?.path === path ? last.text : readText(path)
  host!.fs.watchFile(path, { interval: POLL_MS }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.size === prev.size) return
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => void onChange(path), SETTLE_MS)
  })
}

/** Started once from App. */
export function startFileWatch(): () => void {
  if (!host) return () => {}
  watch(useProject.getState().filePath)
  const unsub = useProject.subscribe((s, prev) => {
    if (s.filePath !== prev.filePath) watch(s.filePath)
  })
  return () => {
    unsub()
    clearTimeout(settleTimer)
    watch(null)
  }
}
