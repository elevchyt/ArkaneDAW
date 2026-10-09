// Renderer side of the GitHub-releases updater (main/updater.ts): state for the "Update available" dialog
// and the toolbar indicator, the "Skip this version" memory and the HELP › Check for updates… flow.
import { create } from 'zustand'
import { host } from '@/platform'
import type { InstallResult, UpdateInfo, UpdateProgress } from '../../../main/updater'

export type { UpdateInfo } from '../../../main/updater'

const SKIP_KEY = 'arkane.update.skipVersion'

function readSkip(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY)
  } catch {
    return null
  }
}
function writeSkip(v: string | null): void {
  try {
    if (v) localStorage.setItem(SKIP_KEY, v)
    else localStorage.removeItem(SKIP_KEY)
  } catch {
    /* storage unavailable */
  }
}

export type UpdateView = 'update' | 'checking' | 'uptodate' | 'checkError'
export type UpdatePhase = 'idle' | 'downloading' | 'done' | 'error'

export interface UpdateState {
  current: string
  info: UpdateInfo | null
  skipped: string | null
  open: boolean
  view: UpdateView
  phase: UpdatePhase
  progress: UpdateProgress | null
  result: InstallResult | null
  message: string | null
  /** an automatically found update waits to be shown (after the dependency dialog, if any) */
  autoPending: boolean
  /** version already shown automatically this session */
  autoShown: string | null
}

export const useUpdate = create<UpdateState>(() => ({
  current: '',
  info: null,
  skipped: readSkip(),
  open: false,
  view: 'update',
  phase: 'idle',
  progress: null,
  result: null,
  message: null,
  autoPending: false,
  autoShown: null
}))

type Updater = NonNullable<typeof host>['updater']
/** The preload API (absent in the browser build, or with a preload older than this renderer). */
const api = (): Updater | null => (host as { updater?: Updater } | null)?.updater ?? null

/** Whether the toolbar should show the "Update available" pill. */
export const hasVisibleUpdate = (s: UpdateState): boolean => !!s.info && s.skipped !== s.info.version

function gotUpdate(info: UpdateInfo, auto: boolean): void {
  const s = useUpdate.getState()
  const sameVersion = s.info?.version === info.version
  useUpdate.setState({
    info,
    autoPending: auto && s.skipped !== info.version && s.autoShown !== info.version ? true : s.autoPending
  })
  if (!sameVersion && s.open && s.view === 'update' && s.phase === 'idle') useUpdate.setState({ result: null, message: null })
}

let initialised = false
/** Subscribe to main-process update events (once). */
export function initUpdates(): () => void {
  const u = api()
  if (!u || initialised) return () => {}
  initialised = true
  void host?.system?.info().then((i) => useUpdate.setState({ current: i.version }), () => {})
  const offA = u.onAvailable((info) => gotUpdate(info, true))
  const offP = u.onProgress((p) => useUpdate.setState({ progress: p }))
  void u.last().then(
    (r) => {
      if (r?.current) useUpdate.setState({ current: r.current })
      if (r?.status === 'available') gotUpdate(r.info, true)
    },
    () => {}
  )
  return () => {
    offA()
    offP()
    initialised = false
  }
}

/** Show the pending automatic update dialog (called when no other startup dialog is open). */
export function showAutoUpdate(): void {
  const s = useUpdate.getState()
  if (!s.autoPending || !s.info) return
  useUpdate.setState({ autoPending: false, autoShown: s.info.version, open: true, view: 'update', phase: s.phase === 'downloading' ? s.phase : 'idle', result: null, message: null })
}

/** Toolbar pill / manual re-open. */
export function openUpdateDialog(): void {
  if (!useUpdate.getState().info) return
  useUpdate.setState((s) => ({ open: true, view: 'update', ...(s.phase === 'downloading' || s.phase === 'done' ? {} : { phase: 'idle', result: null, message: null }) }))
}

/** HELP › Check for updates… */
export async function checkForUpdatesNow(): Promise<void> {
  const u = api()
  if (!u) {
    useUpdate.setState({ open: true, view: 'checkError', message: host ? 'Restart ArkaneDAW to enable the updater.' : 'Updates are only available in the desktop app.' })
    return
  }
  if (useUpdate.getState().phase === 'downloading') return openUpdateDialog()
  useUpdate.setState({ open: true, view: 'checking', message: null })
  try {
    const r = await u.check()
    if (r.current) useUpdate.setState({ current: r.current })
    if (!useUpdate.getState().open) return
    if (r.status === 'available') {
      gotUpdate(r.info, false)
      useUpdate.setState({ view: 'update', phase: 'idle', result: null, message: null, autoPending: false })
    } else if (r.status === 'none') useUpdate.setState({ view: 'uptodate' })
    else useUpdate.setState({ view: 'checkError', message: r.message })
  } catch (e) {
    useUpdate.setState({ view: 'checkError', message: e instanceof Error ? e.message : String(e) })
  }
}

export async function installUpdate(): Promise<void> {
  const u = api()
  const s = useUpdate.getState()
  if (!u || !s.info || s.phase === 'downloading') return
  if (s.skipped === s.info.version) {
    writeSkip(null)
    useUpdate.setState({ skipped: null })
  }
  useUpdate.setState({ phase: 'downloading', progress: null, result: null, message: null })
  try {
    const r = await u.install()
    useUpdate.setState({ phase: r.action === 'error' ? 'error' : 'done', result: r, message: r.action === 'error' ? r.message : null })
  } catch (e) {
    useUpdate.setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

export function closeUpdateDialog(): void {
  useUpdate.setState({ open: false })
}

/** "Later": close; a manual "Later" also forgets an earlier skip of this version. */
export function remindLater(): void {
  const s = useUpdate.getState()
  if (s.info && s.skipped === s.info.version) writeSkip(null)
  useUpdate.setState({ open: false, skipped: s.info && s.skipped === s.info.version ? null : s.skipped })
}

export function skipThisVersion(): void {
  const v = useUpdate.getState().info?.version
  if (!v) return
  writeSkip(v)
  useUpdate.setState({ skipped: v, open: false })
}

export function restartToUpdate(): void {
  void api()?.restart()
}

export function openReleasePage(url?: string): void {
  const target = url ?? useUpdate.getState().info?.htmlUrl
  if (!target) return
  const u = api()
  if (u) void u.openRelease(target)
  else window.open(target, '_blank', 'noopener')
}
