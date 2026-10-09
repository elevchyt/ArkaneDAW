// Hidden-window Electron host for the app-level scenario. Usage: electron main.cjs <built dir> <repo root> <clap>
const { app, BrowserWindow, protocol, ipcMain } = require('electron')
const { join, extname } = require('node:path')
const { readFile } = require('node:fs/promises')
const os = require('node:os')

const [dir, root, clap, userData] = process.argv.slice(-4)
app.setPath('userData', userData)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
ipcMain.handle('app:paths', () => ({ home: os.homedir(), userData, music: userData, documents: userData, appPath: root, resources: join(root, 'resources') }))
ipcMain.handle('win:nativeHandle', () => undefined)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' }
app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const file = join(dir, decodeURIComponent(new URL(req.url).pathname))
    try {
      return new Response(await readFile(file), {
        headers: { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
      })
    } catch {
      return new Response('nf', { status: 404 })
    }
  })
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: join(dir, 'preload.cjs'), nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false }
  })
  const timer = setTimeout(() => (console.log('E2E timeout'), app.exit(2)), 60000)
  win.webContents.on('console-message', (e) => {
    if (/Security Warning|DevTools/.test(e.message)) return
    console.log(e.message)
    if (e.message.startsWith('E2E_DONE')) {
      clearTimeout(timer)
      app.exit(e.message.includes('"failures":0') ? 0 : 1)
    }
  })
  win.loadURL(`app://e2e/index.html#${encodeURIComponent(JSON.stringify({ clap }))}`)
})
