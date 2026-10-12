// Project files (.arkane = JSON). Embedded audio (recordings, renders) is written as WAV next to
// the project in "<name> audio/" and referenced by path, so projects stay small and diffable.
import { host } from '../platform'
import { useProject, getProject } from './project'
import { useUI } from './ui'
import { useTransport } from './transport'
import { makeEmptyProject } from './factory'
import { normalizeProject } from './normalize'
import type { Project } from './types'
import { encodeWav, getBuffer } from '../audio/samples'
import { flushVstStates } from '../audio/vst'
import { noteSynced } from './filewatch'

export const PROJECT_EXT = 'arkane'

/** Loaded JSON → a valid project (fills defaults, drops broken references, see normalize.ts) + format upgrades. */
export function migrate(raw: unknown): Project {
  const p = normalizeProject(raw)
  // "Chiptune Drums" was folded into Chiptune (its Drums mode).
  p.channels = p.channels.map((c) =>
    c.plugin?.pluginId === 'chiptunedrums' ? { ...c, plugin: { ...c.plugin, pluginId: 'chiptune', params: { ...c.plugin.params, mode: 1 } } } : c
  )
  return p
}

export async function saveProjectTo(path: string): Promise<void> {
  if (!host) throw new Error('Saving requires the desktop app')
  // Pull the latest state chunks from running VST/CLAP instances into the project first.
  await flushVstStates()
  const project = getProject()
  const dir = host.path.dirname(path)
  const base = host.path.basename(path).replace(/\.[^.]+$/, '')
  const audioDir = host.path.join(dir, `${base} audio`)
  const samples = []
  for (const s of project.samples) {
    if (s.embedded || !s.path) {
      const buf = getBuffer(s.id)
      if (!buf) {
        samples.push(s)
        continue
      }
      await host.fsp.mkdir(audioDir, { recursive: true })
      const file = host.path.join(audioDir, `${s.name.replace(/[^\w\- ]+/g, '_')}-${s.id}.wav`)
      await host.fsp.writeFile(file, Buffer.from(encodeWav(buf, 24)))
      samples.push({ ...s, path: file, embedded: false })
    } else samples.push(s)
  }
  const out: Project = { ...project, samples, name: project.name === 'Untitled' ? base : project.name }
  // indented so the file can be diffed and edited by hand / by other tools (see docs/PROJECT_FORMAT.md)
  const text = `${JSON.stringify(out, null, 1)}\n`
  await host.fsp.writeFile(path, text)
  noteSynced(path, text)
  useProject.setState({ project: { ...getProject(), samples, name: out.name } })
  useProject.getState().markSaved(path)
  addRecent(path)
}

export async function saveProject(saveAs = false): Promise<void> {
  if (!host) return
  let path = useProject.getState().filePath
  if (!path || saveAs) {
    const r = await host.dialog.save({ title: 'Save project', defaultPath: `${getProject().name}.${PROJECT_EXT}`, filters: [{ name: 'ArkaneDAW project', extensions: [PROJECT_EXT] }] })
    if (r.canceled || !r.filePath) return
    path = r.filePath.endsWith(`.${PROJECT_EXT}`) ? r.filePath : `${r.filePath}.${PROJECT_EXT}`
  }
  await saveProjectTo(path)
}

/** Ctrl+N: save as "<name>_2", "<name>_3"... */
export async function saveNewVersion(): Promise<void> {
  if (!host) return
  const cur = useProject.getState().filePath
  if (!cur) return saveProject(true)
  const m = cur.match(/^(.*?)(?:_(\d+))?\.arkane$/)
  let n = m?.[2] ? Number(m[2]) + 1 : 2
  let next = `${m?.[1]}_${n}.${PROJECT_EXT}`
  while (host.fs.existsSync(next)) next = `${m?.[1]}_${++n}.${PROJECT_EXT}`
  await saveProjectTo(next)
}

export async function openProjectFrom(path: string): Promise<void> {
  if (!host) return
  const text = await host.fsp.readFile(path, 'utf8')
  const project = migrate(JSON.parse(text))
  noteSynced(path, text)
  useTransport.getState().set({ playing: false, paused: false, startTick: 0 })
  useProject.getState().load(project, path)
  useUI.getState().set({ currentPattern: project.patterns[0]?.id ?? null, selectedChannels: [], pianoRollChannel: project.channels[0]?.id ?? null })
  addRecent(path)
}

export async function openProject(): Promise<void> {
  if (!host) return
  const r = await host.dialog.open({ title: 'Open project', filters: [{ name: 'ArkaneDAW project', extensions: [PROJECT_EXT] }], properties: ['openFile'] })
  if (r.canceled || !r.filePaths[0]) return
  await openProjectFrom(r.filePaths[0])
}

export function newProject(template?: () => Project): void {
  const p = template ? template() : makeEmptyProject()
  useProject.getState().load(p, null)
  useUI.getState().set({ currentPattern: p.patterns[0].id, selectedChannels: [], pianoRollChannel: p.channels[0]?.id ?? null })
  showOnlyChannelRack()
}

/** A fresh project starts with just the Channel rack (pattern editor) on screen. */
export function showOnlyChannelRack(): void {
  const ui = useUI.getState()
  for (const [id, w] of Object.entries(ui.windows)) if (w.open && id !== 'channelRack') ui.closeWindow(id)
  ui.openWindow('channelRack', { kind: 'channelRack', title: 'Channel rack' })
}

const RECENT_KEY = 'arkane.recent'
export function recentFiles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function addRecent(path: string): void {
  const list = [path, ...recentFiles().filter((p) => p !== path)].slice(0, 10)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}
