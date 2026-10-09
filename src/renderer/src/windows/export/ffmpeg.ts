// System ffmpeg via Node child_process (Electron renderer has nodeIntegration). Used for MP3 / OGG / FLAC.
// The child_process module is injected so the same code runs under vitest/node.
import { parseEncoders } from './core'

interface Stream {
  on(ev: 'data', cb: (b: Uint8Array | string) => void): unknown
}
interface Stdin {
  write(b: Uint8Array): boolean
  end(): void
  on(ev: 'error', cb: (e: Error) => void): unknown
}
interface Child {
  stdin: Stdin | null
  stdout: Stream | null
  stderr: Stream | null
  on(ev: 'close', cb: (code: number | null, signal: string | null) => void): unknown
  on(ev: 'error', cb: (err: Error) => void): unknown
  kill(signal?: string): boolean
}
export interface ChildProcessApi {
  spawn(cmd: string, args: string[], opts?: Record<string, unknown>): Child
}

/** child_process in the Electron renderer (null in the plain browser build). */
export function rendererChildProcess(): ChildProcessApi | null {
  const req = (globalThis as unknown as { require?: (id: string) => unknown }).require
  if (typeof req !== 'function') return null
  try {
    return req('node:child_process') as ChildProcessApi
  } catch {
    return null
  }
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

/** Run a process, optionally feeding `input` to stdin. Rejects on spawn errors (e.g. ENOENT) and on abort. */
export function runProcess(cp: ChildProcessApi, cmd: string, args: string[], input?: Uint8Array, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    let child: Child
    try {
      child = cp.spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      return reject(e)
    }
    let out = ''
    let err = ''
    const dec = (b: Uint8Array | string) => (typeof b === 'string' ? b : new TextDecoder().decode(b))
    child.stdout?.on('data', (b) => (out += dec(b)))
    child.stderr?.on('data', (b) => {
      if (err.length < 64 * 1024) err += dec(b)
    })
    const onAbort = () => {
      child.kill('SIGKILL')
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(e)
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return
      resolve({ code, stdout: out, stderr: err })
    })
    child.stdin?.on('error', () => {
      /* EPIPE when ffmpeg exits early: the exit code/stderr carry the real error */
    })
    if (input) child.stdin?.write(input)
    child.stdin?.end()
  })
}

export interface FfmpegInfo {
  path: string
  version: string
  encoders: Set<string>
}

const CANDIDATES = ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/opt/local/bin/ffmpeg', 'C:\\ffmpeg\\bin\\ffmpeg.exe']

/** Find a working ffmpeg (PATH first, then common install locations) and list its encoders. */
export async function detectFfmpeg(cp: ChildProcessApi | null): Promise<FfmpegInfo | null> {
  if (!cp) return null
  for (const path of CANDIDATES) {
    try {
      const v = await runProcess(cp, path, ['-hide_banner', '-version'])
      if (v.code !== 0) continue
      const version = /ffmpeg version (\S+)/.exec(v.stdout)?.[1] ?? 'unknown'
      const enc = await runProcess(cp, path, ['-hide_banner', '-encoders'])
      return { path, version, encoders: parseEncoders(enc.stdout) }
    } catch {
      /* not here */
    }
  }
  return null
}

/** Encode a WAV (bytes) with ffmpeg using prepared args (see buildFfmpegArgs; input must be pipe:0). */
export async function ffmpegEncode(cp: ChildProcessApi, ffmpegPath: string, args: string[], wav: Uint8Array, signal?: AbortSignal): Promise<void> {
  const r = await runProcess(cp, ffmpegPath, args, wav, signal)
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}): ${r.stderr.trim().split('\n').slice(-3).join(' ') || 'unknown error'}`)
}
