// JSON-line control channel to one arkane-vsthost process (see native/vsthost/src/main.cpp).
// Pure apart from the injected spawn function, so it is shared by the renderer and the Node e2e test.
import type { ChildProcessLike } from './native'

export interface VstParamInfo {
  id: number
  name: string
  unit?: string
  group?: string
  default: number
  steps?: number
  automatable?: boolean
  hidden?: boolean
  readonly?: boolean
  value?: number
  text?: string
}

export interface VstPluginInfo {
  format: string
  path: string
  uid: string
  name: string
  vendor: string
  version: string
  category: string
  kind: 'instrument' | 'effect'
  hasEditor: boolean
  latency: number
  params: VstParamInfo[]
}

export type SidecarEvent =
  | { ev: 'ready'; info: VstPluginInfo }
  | { ev: 'error'; message: string }
  | { ev: 'params'; values: Record<string, number> }
  | { ev: 'dirty' }
  | { ev: 'latency'; samples: number }
  | { ev: 'paramsChanged'; params: VstParamInfo[] }
  | { ev: 'editor'; open: boolean }

export interface SidecarExit {
  code: number | null
  signal: string | null
  stderr: string
}

type Spawn = (cmd: string, args: string[]) => ChildProcessLike

export interface SidecarArgs {
  exe: string
  format: string
  path: string
  uid: string
  sampleRate: number
  shm: string
  title?: string
  transientFor?: number
  /** editor scale factor (window.devicePixelRatio) */
  scale?: number
}

export class SidecarProcess {
  private proc: ChildProcessLike
  private buf = ''
  private stderrTail: string[] = []
  private nextId = 1
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>()
  private listeners = new Set<(e: SidecarEvent) => void>()
  private exitListeners = new Set<(e: SidecarExit) => void>()
  exited: SidecarExit | null = null
  readonly ready: Promise<VstPluginInfo>

  constructor(spawn: Spawn, a: SidecarArgs) {
    const args = ['host', '--format', a.format, '--path', a.path, '--sr', String(Math.round(a.sampleRate)), '--shm', a.shm]
    if (a.uid) args.push('--uid', a.uid)
    if (a.title) args.push('--title', a.title)
    if (a.transientFor) args.push('--transient-for', String(a.transientFor))
    if (a.scale && a.scale !== 1) args.push('--scale', String(a.scale))
    this.proc = spawn(a.exe, args)
    this.ready = new Promise<VstPluginInfo>((resolve, reject) => {
      const off = this.on((e) => {
        if (e.ev === 'ready') {
          off()
          resolve(e.info)
        } else if (e.ev === 'error') {
          off()
          reject(new Error(e.message))
        }
      })
      this.onExit((x) => reject(new Error(describeExit(x))))
    })
    this.ready.catch(() => {})
    this.proc.stdout?.setEncoding?.('utf8')
    this.proc.stderr?.setEncoding?.('utf8')
    this.proc.stdout?.on('data', (d) => this.onData(String(d)))
    this.proc.stderr?.on('data', (d) => {
      const s = String(d)
      this.stderrTail.push(s)
      if (this.stderrTail.length > 50) this.stderrTail.shift()
    })
    this.proc.on('error', (err) => this.finish({ code: null, signal: null, stderr: String(err) }))
    this.proc.on('exit', (code, signal) => this.finish({ code, signal, stderr: this.stderrTail.join('') }))
  }

  get pid(): number | undefined {
    return this.proc.pid
  }

  on(cb: (e: SidecarEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onExit(cb: (e: SidecarExit) => void): () => void {
    if (this.exited) {
      cb(this.exited)
      return () => {}
    }
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }

  call<T = Record<string, unknown>>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 10000): Promise<T> {
    if (this.exited) return Promise.reject(new Error('plugin process is not running'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${cmd}: timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          if (v.ok === false) reject(new Error(String(v.error ?? `${cmd} failed`)))
          else resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.proc.stdin?.write(JSON.stringify({ id, cmd, ...args }) + '\n')
    })
  }

  /** Ask politely, then kill. */
  stop(graceMs = 1500): void {
    if (this.exited) return
    try {
      this.proc.stdin?.write(JSON.stringify({ id: 0, cmd: 'quit' }) + '\n')
      this.proc.stdin?.end()
    } catch {
      /* pipe closed */
    }
    setTimeout(() => {
      if (!this.exited) this.proc.kill('SIGKILL')
    }, graceMs)
  }

  private onData(s: string): void {
    this.buf += s
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl)
      this.buf = this.buf.slice(nl + 1)
      if (!line.trim()) continue
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof msg.id === 'number' && msg.id > 0 && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        p.resolve(msg)
      } else if (typeof msg.ev === 'string') {
        for (const l of [...this.listeners]) l(msg as unknown as SidecarEvent)
      }
    }
  }

  private finish(x: SidecarExit): void {
    if (this.exited) return
    this.exited = x
    for (const p of this.pending.values()) p.reject(new Error(describeExit(x)))
    this.pending.clear()
    for (const l of [...this.exitListeners]) l(x)
    this.exitListeners.clear()
  }
}

export function describeExit(x: SidecarExit): string {
  if (x.signal) return `plugin process crashed (${x.signal})`
  if (x.code === 3) {
    const m = /"message":"([^"]*)"/.exec(x.stderr)
    return m ? m[1] : 'plugin failed to load'
  }
  return `plugin process exited (code ${x.code})`
}

/** Run `arkane-vsthost scan <path>` with a timeout. */
export function scanFile(spawn: Spawn, exe: string, path: string, timeoutMs = 15000): Promise<{ plugins: Record<string, unknown>[]; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(exe, ['scan', path])
    let out = ''
    let err = ''
    let done = false
    const finish = (r: { plugins: Record<string, unknown>[]; error?: string }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      finish({ plugins: [], error: `timed out after ${timeoutMs / 1000}s` })
    }, timeoutMs)
    proc.stdout?.setEncoding?.('utf8')
    proc.stdout?.on('data', (d) => (out += String(d)))
    proc.stderr?.on('data', (d) => {
      if (err.length < 4000) err += String(d)
    })
    proc.on('error', (e) => finish({ plugins: [], error: String(e) }))
    proc.on('exit', (code, signal) => {
      const line = out.split('\n').find((l) => l.startsWith('{'))
      if (line) {
        try {
          const j = JSON.parse(line)
          return finish({ plugins: j.plugins ?? [], error: j.error })
        } catch {
          /* fallthrough */
        }
      }
      finish({ plugins: [], error: signal ? `crashed while scanning (${signal})` : `scanner exited with code ${code}` })
    })
  })
}
