// GitHub-releases updater (main process). Checks <repo>/releases/latest shortly after the window shows and
// every 6 hours, pushes `update:available` to the renderer, and installs on request:
//   AppImage  → download next to the running file, verify, atomic rename, then "Restart now"
//   .deb/.rpm → download to ~/Downloads, reveal it and hand back the install command
//   otherwise → open the release page (always in dev builds: never replace files there)
import { app, ipcMain, net, shell, type BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { access, constants, rm } from 'node:fs/promises'
import { detectDistro } from '../renderer/src/system/distro'
import {
  checkForUpdate,
  downloadFile,
  fetchChecksum,
  packageInstallCommand,
  parseRepoSlug,
  planInstall,
  replaceAppImage,
  type CheckResult,
  type FetchLike,
  type UpdateInfo
} from './updater-core'

export type { CheckResult, UpdateInfo } from './updater-core'

export interface AppInfo {
  version: string
  isPackaged: boolean
  appImage: boolean
  arch: string
  repo: string | null
}

export type InstallResult =
  | { action: 'replaced'; version: string }
  | { action: 'downloaded'; path: string; command: string; version: string }
  | { action: 'opened'; message: string; url: string }
  | { action: 'error'; message: string; url?: string }

export interface UpdateProgress {
  received: number
  total: number
  file: string
}

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 5000

let repo: string | null = null
let last: CheckResult | null = null
let checking: Promise<CheckResult> | null = null
let installing = false
let started = false

function readRepo(): string | null {
  if (process.env.ARKANE_UPDATE_REPO) return parseRepoSlug(process.env.ARKANE_UPDATE_REPO)
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { repository?: unknown }
    return parseRepoSlug(pkg.repository)
  } catch {
    return null
  }
}

const fetcher: FetchLike = (url, init) => net.fetch(url, init as RequestInit)

function readFamily() {
  for (const p of ['/etc/os-release', '/usr/lib/os-release']) {
    try {
      return detectDistro(readFileSync(p, 'utf8')).family
    } catch {
      /* next */
    }
  }
  return 'generic' as const
}

async function check(): Promise<CheckResult> {
  if (!repo) return { status: 'error', current: app.getVersion(), message: 'No GitHub repository configured in package.json.' }
  if (!checking) {
    checking = checkForUpdate({ repo, current: app.getVersion(), fetch: fetcher }).finally(() => {
      checking = null
    })
  }
  const r = await checking
  // Keep the last known update if a later periodic check fails (offline laptop etc.).
  if (r.status !== 'error' || !last || last.status !== 'available') last = r
  return r
}

async function writable(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function install(win: BrowserWindow | null): Promise<InstallResult> {
  if (last?.status !== 'available') return { action: 'error', message: 'No update available.' }
  if (installing) return { action: 'error', message: 'An update is already being downloaded.' }
  const info: UpdateInfo = last.info
  const family = readFamily()
  const plan = planInstall(info, { isPackaged: app.isPackaged, appImagePath: process.env.APPIMAGE, arch: process.arch, family })
  const openPage = async (message: string): Promise<InstallResult> => {
    await shell.openExternal(info.htmlUrl)
    return { action: 'opened', message, url: info.htmlUrl }
  }
  if (plan.kind === 'browser') return openPage(plan.reason)

  installing = true
  const progress = (received: number, total: number) => win?.webContents.send('update:progress', { received, total, file: plan.asset.name } satisfies UpdateProgress)
  try {
    const sha256 = await fetchChecksum(fetcher, plan.checksum, plan.asset.name)
    if (plan.kind === 'appimage') {
      const dir = dirname(plan.target)
      if (!(await writable(dir))) return openPage(`Cannot write to ${dir}. Download the new AppImage from the release page instead.`)
      const tmp = join(dir, `.${basename(plan.target)}.update`)
      await downloadFile({ url: plan.asset.url, dest: tmp, expectedSize: plan.asset.size, sha256, fetch: fetcher, onProgress: progress })
      try {
        await replaceAppImage(plan.target, tmp)
      } catch (e) {
        await rm(tmp, { force: true }).catch(() => {})
        throw e
      }
      return { action: 'replaced', version: info.version }
    }
    const dest = join(app.getPath('downloads'), plan.asset.name)
    await downloadFile({ url: plan.asset.url, dest, expectedSize: plan.asset.size, sha256, fetch: fetcher, onProgress: progress })
    shell.showItemInFolder(dest)
    return { action: 'downloaded', path: dest, command: packageInstallCommand(family, dest), version: info.version }
  } catch (e) {
    return { action: 'error', message: e instanceof Error ? e.message : String(e), url: info.htmlUrl }
  } finally {
    installing = false
  }
}

function relaunch(): void {
  // Inside an AppImage process.execPath points into the (soon unmounted) squashfs: relaunch the file itself.
  const appImage = process.env.APPIMAGE
  if (appImage) app.relaunch({ execPath: appImage, args: process.argv.slice(1) })
  else app.relaunch()
  app.exit(0)
}

/** Register IPC handlers and schedule the background checks. Call once after the main window is created. */
export function startUpdater(getWin: () => BrowserWindow | null): void {
  if (started) return
  started = true
  repo = readRepo()

  ipcMain.handle('app:info', (): AppInfo => ({ version: app.getVersion(), isPackaged: app.isPackaged, appImage: !!process.env.APPIMAGE, arch: process.arch, repo }))
  ipcMain.handle('update:check', () => check())
  ipcMain.handle('update:last', () => last)
  ipcMain.handle('update:install', () => install(getWin()))
  ipcMain.handle('update:restart', () => relaunch())
  ipcMain.handle('update:openRelease', (_e, url: string) => {
    if (typeof url === 'string' && /^https:\/\/github\.com\//.test(url)) return shell.openExternal(url)
  })

  if (process.env.ARKANE_NO_UPDATE_CHECK === '1' || !repo) return
  const auto = async () => {
    const r = await check()
    if (r.status === 'available') getWin()?.webContents.send('update:available', r.info)
  }
  const schedule = () => {
    setTimeout(() => void auto(), FIRST_CHECK_DELAY_MS)
    setInterval(() => void auto(), CHECK_EVERY_MS)
  }
  const w = getWin()
  if (w && !w.isVisible()) w.once('show', schedule)
  else schedule()
}
