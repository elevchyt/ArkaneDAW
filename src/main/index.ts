import { app, BrowserWindow, ipcMain, dialog, protocol, session, shell } from 'electron'
import { join, extname, normalize } from 'node:path'
import { readFile } from 'node:fs/promises'
import { startUpdater } from './updater'
import { readRepoSlug, registerPackIpc } from './packs'

// Audio apps need these: no autoplay gesture, and SharedArrayBuffer for the plugin bridge.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
// Dev only: Chrome DevTools Protocol on localhost for debugging the renderer.
if (process.env.ELECTRON_RENDERER_URL) app.commandLine.appendSwitch('remote-debugging-port', '9339')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.wav': 'audio/wav', '.ttf': 'font/ttf'
}

function registerAppProtocol(): void {
  const root = join(__dirname, '../renderer')
  protocol.handle('app', async (req) => {
    const url = new URL(req.url)
    let p = decodeURIComponent(url.pathname)
    if (p === '/' || p === '') p = '/index.html'
    const file = normalize(join(root, p))
    if (!file.startsWith(root)) return new Response('forbidden', { status: 403 })
    try {
      const data = await readFile(file)
      return new Response(data, {
        headers: {
          'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

let win: BrowserWindow | null = null
/** Set once the renderer agreed to close (no unsaved changes, or the user chose Save / Don't save). */
let allowClose = false

function createWindow(): void {
  allowClose = false
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1000,
    minHeight: 640,
    frame: false,
    backgroundColor: '#262d31',
    title: 'ArkaneDAW',
    icon: app.isPackaged ? join(process.resourcesPath, 'icons/icon.png') : join(app.getAppPath(), 'resources/icons/icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      // A DAW loads only local content and needs native audio bridges + filesystem in the renderer.
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  })
  win.once('ready-to-show', () => {
    win?.maximize()
    win?.show()
  })
  // Closing asks the renderer first so it can prompt about unsaved changes; it answers with win:forceClose.
  win.on('close', (e) => {
    if (allowClose || !win || win.webContents.isCrashed() || win.webContents.isLoading()) return
    e.preventDefault()
    win.webContents.send('win:closeRequest')
  })
  win.webContents.on('render-process-gone', () => {
    allowClose = true
  })
  win.on('maximize', () => win?.webContents.send('win:state', { maximized: true }))
  win.on('unmaximize', () => win?.webContents.send('win:state', { maximized: false }))
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadURL('app://arkane/index.html')
}

ipcMain.handle('win:minimize', () => win?.minimize())
ipcMain.handle('win:toggleMaximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
ipcMain.handle('win:close', () => win?.close())
ipcMain.handle('win:forceClose', () => {
  allowClose = true
  win?.close()
})
ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false)
ipcMain.handle('win:setTitle', (_e, title: string) => win?.setTitle(title))
// X11 window id of the main window: bridged plugin editors (audio/vst) are made transient for it.
ipcMain.handle('win:nativeHandle', () => {
  const b = win?.getNativeWindowHandle()
  return b && b.length >= 4 ? (b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0)) : undefined
})
ipcMain.handle('dialog:open', (_e, opts: Electron.OpenDialogOptions) => dialog.showOpenDialog(win!, opts))
ipcMain.handle('dialog:save', (_e, opts: Electron.SaveDialogOptions) => dialog.showSaveDialog(win!, opts))
ipcMain.handle('app:paths', () => ({
  home: app.getPath('home'),
  userData: app.getPath('userData'),
  music: app.getPath('music'),
  documents: app.getPath('documents'),
  appPath: app.getAppPath(),
  resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
}))
// Downloadable content packs (Concerto / Studio Drums samples) → <userData>/packs/<id>/
registerPackIpc(ipcMain, () => win?.webContents, {
  packsDir: join(app.getPath('userData'), 'packs'),
  isPackaged: app.isPackaged,
  resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
  repo: readRepoSlug(app.getAppPath())
})

app.whenReady().then(() => {
  registerAppProtocol()
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['media', 'midi', 'midiSysex', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ['media', 'midi', 'midiSysex', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission)
  )
  createWindow()
  startUpdater(() => win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
