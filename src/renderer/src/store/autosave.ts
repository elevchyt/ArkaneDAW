// Autosave: every 5 minutes a project with unsaved changes is snapshotted to <userData>/autosave/autosave.arkane
// (each snapshot overwrites the previous one). Recorded / rendered audio that only lives in memory is written next
// to it as WAV and stays flagged `embedded`, so after recovery the next real save copies it into the project's
// own audio folder. FILE › Recover last autosave loads the snapshot.
import { create } from 'zustand'
import { host } from '../platform'
import { getProject, useProject } from './project'
import { useUI } from './ui'
import { useTransport } from './transport'
import { encodeWav, getBuffer } from '../audio/samples'
import { flushVstStates } from '../audio/vst'
import { migrate } from './io'
import type { Project, Sample } from './types'

export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000

export interface AutosaveInfo {
  /** epoch ms of the snapshot */
  time: number
  /** project name at the time */
  name: string
  /** the project file it was made from (null = never saved) */
  source: string | null
}

export const useAutosave = create<{ last: AutosaveInfo | null }>(() => ({ last: null }))

let dirPromise: Promise<string> | null = null
function autosaveDir(): Promise<string> {
  dirPromise ??= host!.paths().then((p) => host!.path.join(p.userData, 'autosave'))
  return dirPromise
}
const files = (dir: string) => ({
  project: host!.path.join(dir, 'autosave.arkane'),
  meta: host!.path.join(dir, 'autosave.json'),
  audio: host!.path.join(dir, 'audio')
})

/** Read the last snapshot's info (startup, after writing one). */
export async function refreshAutosaveInfo(): Promise<void> {
  if (!host) return
  try {
    const f = files(await autosaveDir())
    if (!host.fs.existsSync(f.project)) return useAutosave.setState({ last: null })
    const info = JSON.parse(await host.fsp.readFile(f.meta, 'utf8')) as AutosaveInfo
    useAutosave.setState({ last: info })
  } catch {
    useAutosave.setState({ last: null })
  }
}

/** Write a snapshot of the current project now (overwrites the previous one). */
export async function writeAutosave(): Promise<void> {
  if (!host) return
  await flushVstStates()
  const project = getProject()
  const { filePath } = useProject.getState()
  const f = files(await autosaveDir())
  await host.fsp.mkdir(f.audio, { recursive: true })
  const keep = new Set<string>()
  const samples: Sample[] = []
  for (const s of project.samples) {
    if (!(s.embedded || !s.path)) {
      samples.push(s)
      continue
    }
    const buf = getBuffer(s.id)
    if (!buf) {
      // not decoded (yet): keep its file if it is one of ours (a recovered snapshot)
      if (s.path && host.path.dirname(s.path) === f.audio) keep.add(host.path.basename(s.path))
      samples.push(s)
      continue
    }
    const name = `${s.id}.wav`
    const file = host.path.join(f.audio, name)
    keep.add(name)
    // sample buffers never change under the same id: write each one once
    if (!host.fs.existsSync(file)) await host.fsp.writeFile(file, Buffer.from(encodeWav(buf, 24)))
    samples.push({ ...s, path: file, embedded: true })
  }
  for (const old of await host.fsp.readdir(f.audio)) if (!keep.has(old)) await host.fsp.rm(host.path.join(f.audio, old), { force: true })
  const out: Project = { ...project, samples }
  const info: AutosaveInfo = { time: Date.now(), name: project.name, source: filePath }
  // write-then-rename so a crash mid-write never leaves a broken snapshot
  await host.fsp.writeFile(`${f.project}.tmp`, JSON.stringify(out))
  await host.fsp.rename(`${f.project}.tmp`, f.project)
  await host.fsp.writeFile(f.meta, JSON.stringify(info))
  useAutosave.setState({ last: info })
}

/** Load the last snapshot. It opens as unsaved changes to its original file (Ctrl+S writes there). */
export async function recoverAutosave(): Promise<boolean> {
  if (!host) return false
  const f = files(await autosaveDir())
  if (!host.fs.existsSync(f.project)) return false
  const project = migrate(JSON.parse(await host.fsp.readFile(f.project, 'utf8')) as Project)
  const info = useAutosave.getState().last
  useTransport.getState().set({ playing: false, paused: false, startTick: 0 })
  useProject.getState().load(project, info?.source ?? null)
  useProject.setState({ dirty: true })
  useUI.getState().set({ currentPattern: project.patterns[0]?.id ?? null, selectedChannels: [], pianoRollChannel: project.channels[0]?.id ?? null })
  return true
}

/** Starts the 5-minute timer (once, from App). Only snapshots when something changed since the last one. */
export function startAutosave(): () => void {
  if (!host) return () => {}
  void refreshAutosaveInfo()
  let changed = false
  let busy = false
  const unsub = useProject.subscribe((s, prev) => {
    if (s.project !== prev.project) changed = true
  })
  const timer = window.setInterval(() => {
    if (busy || !changed || !useProject.getState().dirty) return
    busy = true
    changed = false
    writeAutosave()
      .catch((e) => {
        changed = true
        console.warn('[autosave] failed', e)
      })
      .finally(() => {
        busy = false
      })
  }, AUTOSAVE_INTERVAL_MS)
  return () => {
    unsub()
    clearInterval(timer)
  }
}
