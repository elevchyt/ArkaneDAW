// contextIsolation is off: this runs in the page's world and exposes a small host API.
import { ipcRenderer, webUtils } from 'electron'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

const host = {
  isElectron: true as const,
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
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
  os
}

;(globalThis as unknown as { arkaneHost: typeof host }).arkaneHost = host
export type ArkaneHost = typeof host
