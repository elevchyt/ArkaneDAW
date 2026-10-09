// Access to the native side (Electron renderer with nodeIntegration): child_process for sidecars and the
// N-API bridge addon. Everything degrades to "unavailable" in the browser build (npm run dev:web).
import { host } from '../../platform'

export interface BridgeAddon {
  open(view: Int32Array): { id: number; shm: string }
  unlink(id: number): void
  close(id: number): void
  stats(): { instances: number; passes: number; forwarded: number; returned: number }
  setPollMicros(us: number): void
  totalBytes: number
  protocolVersion: number
}

export interface ChildProcessLike {
  pid?: number
  stdin: { write(s: string): boolean; end(): void } | null
  stdout: { on(ev: 'data', cb: (b: Buffer | string) => void): void; setEncoding?(e: string): void } | null
  stderr: { on(ev: 'data', cb: (b: Buffer | string) => void): void; setEncoding?(e: string): void } | null
  on(ev: 'exit', cb: (code: number | null, signal: string | null) => void): void
  on(ev: 'error', cb: (err: Error) => void): void
  kill(signal?: string): boolean
}

interface ChildProcessModule {
  spawn(cmd: string, args: string[], opts?: Record<string, unknown>): ChildProcessLike
}

type NodeRequire = (id: string) => unknown

function nodeRequire(): NodeRequire | null {
  const r = (globalThis as unknown as { require?: NodeRequire }).require
  return typeof r === 'function' ? r : null
}

let resourcesDir: Promise<string | null> | null = null

/** `<resources>/native` (dev: <repo>/resources/native, packaged: process.resourcesPath/native). */
export function nativeDir(): Promise<string | null> {
  if (!resourcesDir) {
    resourcesDir = host
      ? host.paths().then((p) => host!.path.join(p.resources, 'native'))
      : Promise.resolve(null)
  }
  return resourcesDir
}

export async function sidecarPath(): Promise<string | null> {
  const dir = await nativeDir()
  if (!dir || !host) return null
  const p = host.path.join(dir, 'arkane-vsthost')
  return host.fs.existsSync(p) ? p : null
}

let addon: BridgeAddon | null | undefined
export async function loadAddon(): Promise<BridgeAddon | null> {
  if (addon !== undefined) return addon
  const req = nodeRequire()
  const dir = await nativeDir()
  if (!req || !dir || !host) return (addon = null)
  const p = host.path.join(dir, 'arkane_bridge.node')
  if (!host.fs.existsSync(p)) return (addon = null)
  try {
    addon = req(p) as BridgeAddon
  } catch (e) {
    console.error('[vst] cannot load bridge addon', e)
    addon = null
  }
  return addon
}

/** Forget a failed addon load so the next nativeStatus() looks again (dependency "Re-check"). */
export function resetNativeProbe(): void {
  if (addon === null) addon = undefined
}

export function childProcess(): ChildProcessModule | null {
  const req = nodeRequire()
  if (!req) return null
  try {
    return req('child_process') as ChildProcessModule
  } catch {
    return null
  }
}

export interface NativeStatus {
  available: boolean
  reason?: string
  sidecar?: string
  crossOriginIsolated: boolean
}

/** Why VST hosting is (un)available — shown in the plugin manager. */
export async function nativeStatus(): Promise<NativeStatus> {
  const coi = (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
  if (!host) return { available: false, reason: 'Plugin hosting needs the desktop app.', crossOriginIsolated: coi }
  if (typeof SharedArrayBuffer === 'undefined') return { available: false, reason: 'SharedArrayBuffer unavailable (page not cross-origin isolated).', crossOriginIsolated: coi }
  const side = await sidecarPath()
  if (!side) return { available: false, reason: 'arkane-vsthost not built. Run "npm run build:native".', crossOriginIsolated: coi }
  if (!childProcess()) return { available: false, reason: 'Node integration is disabled in the renderer.', crossOriginIsolated: coi }
  const a = await loadAddon()
  if (!a) return { available: false, reason: 'arkane_bridge.node not built or failed to load. Run "npm run build:native".', sidecar: side, crossOriginIsolated: coi }
  return { available: true, sidecar: side, crossOriginIsolated: coi }
}
