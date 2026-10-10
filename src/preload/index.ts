// contextIsolation is off: this runs in the page's world and exposes a small host API.
import { ipcRenderer, webUtils } from 'electron'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { AppInfo, CheckResult, InstallResult, UpdateInfo, UpdateProgress } from '../main/updater'
import type { InstalledPack, PackInfo, PackProgress, PackResult, PackSpec } from '../main/packs'

const host = {
  isElectron: true as const,
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
    /** Close without asking again (after the unsaved-changes prompt). */
    forceClose: () => ipcRenderer.invoke('win:forceClose'),
    /** The user asked to close the window (title bar, Alt+F4, quit): answer with forceClose() or ignore. */
    onCloseRequest: (cb: () => void) => {
      const h = () => cb()
      ipcRenderer.on('win:closeRequest', h)
      return () => {
        ipcRenderer.off('win:closeRequest', h)
      }
    },
    isMaximized: () => ipcRenderer.invoke('win:isMaximized') as Promise<boolean>,
    setTitle: (t: string) => ipcRenderer.invoke('win:setTitle', t),
    nativeHandle: () => ipcRenderer.invoke('win:nativeHandle') as Promise<number | undefined>,
    onState: (cb: (s: { maximized: boolean }) => void) => {
      const h = (_: unknown, s: { maximized: boolean }) => cb(s)
      ipcRenderer.on('win:state', h)
      return () => {
        ipcRenderer.off('win:state', h)
      }
    }
  },
  dialog: {
    open: (opts: Electron.OpenDialogOptions) => ipcRenderer.invoke('dialog:open', opts) as Promise<Electron.OpenDialogReturnValue>,
    save: (opts: Electron.SaveDialogOptions) => ipcRenderer.invoke('dialog:save', opts) as Promise<Electron.SaveDialogReturnValue>
  },
  /** Absolute path of a File dropped from the OS (File.path was removed from Electron). */
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  paths: () => ipcRenderer.invoke('app:paths') as Promise<Record<string, string>>,
  fs,
  fsp,
  path,
  os,
  /** System facts for the dependency checks (system/deps.ts). */
  system: {
    env: (name: string): string | undefined => process.env[name],
    info: () => ipcRenderer.invoke('app:info') as Promise<AppInfo>
  },
  /** GitHub-releases updater (main/updater.ts). */
  updater: {
    check: () => ipcRenderer.invoke('update:check') as Promise<CheckResult>,
    last: () => ipcRenderer.invoke('update:last') as Promise<CheckResult | null>,
    install: () => ipcRenderer.invoke('update:install') as Promise<InstallResult>,
    restart: () => ipcRenderer.invoke('update:restart') as Promise<void>,
    openRelease: (url: string) => ipcRenderer.invoke('update:openRelease', url) as Promise<void>,
    onAvailable: (cb: (info: UpdateInfo) => void) => {
      const h = (_: unknown, info: UpdateInfo) => cb(info)
      ipcRenderer.on('update:available', h)
      return () => {
        ipcRenderer.off('update:available', h)
      }
    },
    onProgress: (cb: (p: UpdateProgress) => void) => {
      const h = (_: unknown, p: UpdateProgress) => cb(p)
      ipcRenderer.on('update:progress', h)
      return () => {
        ipcRenderer.off('update:progress', h)
      }
    }
  },
  /** Downloadable content packs (main/packs.ts). */
  packs: {
    info: () => ipcRenderer.invoke('packs:info') as Promise<PackInfo>,
    installed: (id: string) => ipcRenderer.invoke('packs:installed', id) as Promise<InstalledPack | null>,
    install: (spec: PackSpec) => ipcRenderer.invoke('packs:install', spec) as Promise<PackResult>,
    cancel: (id: string) => ipcRenderer.invoke('packs:cancel', id) as Promise<boolean>,
    remove: (id: string) => ipcRenderer.invoke('packs:remove', id) as Promise<boolean>,
    onProgress: (cb: (p: PackProgress) => void) => {
      const h = (_: unknown, p: PackProgress) => cb(p)
      ipcRenderer.on('packs:progress', h)
      return () => {
        ipcRenderer.off('packs:progress', h)
      }
    }
  }
}

;(globalThis as unknown as { arkaneHost: typeof host }).arkaneHost = host
export type ArkaneHost = typeof host
