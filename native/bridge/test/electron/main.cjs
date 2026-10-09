// Electron e2e for the VST bridge: hidden window, COOP/COEP (crossOriginIsolated), nodeIntegration like the app.
// Usage: electron main.cjs <dir-with-built-files> <resources/native> <test.clap>
const { app, BrowserWindow, protocol } = require('electron')
const { join, extname } = require('node:path')
const { readFile } = require('node:fs/promises')

const [dir, nativeDir, clap] = process.argv.slice(-3)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

app.whenReady().then(() => {
  protocol.handle('app', async (req) => {
    const file = join(dir, new URL(req.url).pathname)
    try {
      return new Response(await readFile(file), {
        headers: {
          'Content-Type': extname(file) === '.html' ? 'text/html' : 'text/javascript',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp'
        }
      })
    } catch {
      return new Response('nf', { status: 404 })
    }
  })
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false }
  })
  const timer = setTimeout(() => {
    console.log('E2E timeout')
    app.exit(2)
  }, 30000)
  win.webContents.on('console-message', (e) => {
    const msg = e.message
    console.log(msg)
    if (msg.startsWith('E2E_DONE')) {
      clearTimeout(timer)
      app.exit(msg.includes('"failures":0') ? 0 : 1)
    }
  })
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('renderer gone', d.reason)
    app.exit(3)
  })
  win.loadURL(`app://e2e/index.html#${encodeURIComponent(JSON.stringify({ nativeDir, clap }))}`)
})
