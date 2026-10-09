// System dependency registry + checker.
//
//   runStartupDependencyCheck()            every app start: opens the "Missing dependencies" dialog when a
//                                          required/recommended dependency is missing (optional ones are only listed)
//   requireDependency(id, feature?)        before an action that needs a dependency: resolves true when available
//                                          (or after a successful "Re-check"), false when the user pressed "Continue"
//   useDeps(selector)                      React hook on the dialog/check state (DepsDialog.tsx)
//
// The browser build (no `host`) skips system checks: requireDependency resolves false, no dialog is shown.
import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { host } from '@/platform'
import { detectFfmpeg, rendererChildProcess, runProcess, type ChildProcessApi, type FfmpegInfo } from '@/windows/export/ffmpeg'
import { FFMPEG_ENCODER } from '@/windows/export/core'
import { nativeStatus, resetNativeProbe } from '@/audio/vst/native'
import { detectDistro, installCommand, type DistroFamily } from './distro'

export type DepId = 'ffmpeg' | 'vsthost' | 'x11' | 'yabridge' | 'audioserver'
export type Severity = 'required' | 'recommended' | 'optional'

export interface DepStatus {
  ok: boolean
  /** human-readable result ("ffmpeg 6.1 (/usr/bin/ffmpeg)", "DISPLAY is not set", …) */
  detail?: string
  /** found but incomplete (ffmpeg without some encoders) */
  found?: boolean
  /** missing sub-components (ffmpeg encoder names) */
  missing?: string[]
  /** machine-readable cause used by install() */
  reason?: string
}

export interface InstallStep {
  cmd: string
  label?: string
}
export interface InstallHelp {
  steps: InstallStep[]
  note?: string
}
export interface InstallEnv {
  family: DistroFamily
  isPackaged: boolean
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Everything detectors may touch (injected so tests can fake it). */
export interface DepContext {
  env(name: string): string | undefined
  exists(path: string): boolean
  readText(path: string): Promise<string | null>
  /** Run a program; rejects when it cannot be spawned (ENOENT) or times out. */
  run(cmd: string, args: string[]): Promise<RunResult>
  cp: ChildProcessApi | null
  home: string
  family: DistroFamily
  distroName: string
  isPackaged: boolean
}

export interface Dependency {
  id: DepId
  name: string
  severity: Severity
  /** why ArkaneDAW needs it */
  why: string
  /** features affected when missing */
  affects: string
  homepage?: { label: string; url: string }
  detect(ctx: DepContext): Promise<DepStatus>
  install(env: InstallEnv, status?: DepStatus): InstallHelp
  /** `feature` narrows the check (ffmpeg: an encoder name). Default: status.ok */
  satisfies?(status: DepStatus, feature?: string): boolean
}

const pm = (family: DistroFamily, pkgs: Partial<Record<DistroFamily, string[]>>): InstallStep[] => {
  const p = pkgs[family]
  const cmd = p ? installCommand(family, p) : null
  return cmd ? [{ cmd }] : []
}

// ── ffmpeg (shared with the export wizard) ──────────────────────────────────

export const FFMPEG_ENCODERS = [FFMPEG_ENCODER.mp3, FFMPEG_ENCODER.vorbis, FFMPEG_ENCODER.opus, FFMPEG_ENCODER.flac]

let ffProbe: Promise<FfmpegInfo | null> | null = null
/** Cached ffmpeg detection (refreshed by every dependency check / "Re-check"). */
export function probeFfmpeg(): Promise<FfmpegInfo | null> {
  if (!host) return Promise.resolve(null)
  if (!ffProbe) ffProbe = detectFfmpeg(rendererChildProcess()).catch(() => null)
  return ffProbe
}

// ── the registry ─────────────────────────────────────────────────────────────

export const DEPENDENCIES: Dependency[] = [
  {
    id: 'ffmpeg',
    name: 'ffmpeg',
    severity: 'recommended',
    why: 'Encodes rendered audio to compressed formats.',
    affects: 'MP3, OGG (Vorbis/Opus) and FLAC export',
    homepage: { label: 'ffmpeg.org', url: 'https://ffmpeg.org/download.html' },
    async detect(ctx) {
      ffProbe = detectFfmpeg(ctx.cp).catch(() => null)
      const info = await ffProbe
      if (!info) return { ok: false, found: false, detail: 'ffmpeg was not found on your PATH.', missing: FFMPEG_ENCODERS }
      const missing = FFMPEG_ENCODERS.filter((e) => !info.encoders.has(e))
      return missing.length
        ? { ok: false, found: true, missing, detail: `ffmpeg ${info.version} was found, but it lacks the ${missing.join(', ')} encoder${missing.length > 1 ? 's' : ''}.` }
        : { ok: true, found: true, missing: [], detail: `ffmpeg ${info.version} (${info.path})` }
    },
    satisfies: (st, feature) => (feature ? !!st.found && !(st.missing ?? []).includes(feature) : st.ok),
    install({ family }, st) {
      const partial = st?.found ? 'Your ffmpeg build is missing encoders: install your distribution’s full ffmpeg package. ' : ''
      if (family === 'dnf')
        return {
          steps: [{ cmd: 'sudo dnf install ffmpeg-free' }],
          note: `${partial}For the full build, enable RPM Fusion and run "sudo dnf swap ffmpeg-free ffmpeg --allowerasing".`
        }
      if (family === 'zypper') return { steps: pm(family, { zypper: ['ffmpeg'] }), note: `${partial}The Packman repository provides a build with every codec.` }
      const steps = pm(family, { apt: ['ffmpeg'], pacman: ['ffmpeg'] })
      return { steps, note: (partial + (steps.length ? '' : 'Install ffmpeg with your distribution’s package manager.')).trim() || undefined }
    }
  },
  {
    id: 'vsthost',
    name: 'Native plugin host',
    severity: 'recommended',
    why: 'Runs third-party plugins in a separate, crash-isolated process (arkane-vsthost + arkane_bridge.node).',
    affects: 'Loading VST2, VST3 and CLAP plugins',
    async detect() {
      resetNativeProbe()
      const ns = await nativeStatus()
      return ns.available ? { ok: true, detail: ns.sidecar } : { ok: false, detail: ns.reason }
    },
    install({ family, isPackaged }) {
      if (isPackaged) return { steps: [], note: 'The plugin host ships with ArkaneDAW. Reinstall ArkaneDAW (latest release) to restore it.' }
      return {
        steps: [...pm(family, { apt: ['g++', 'make'], dnf: ['gcc-c++', 'make'], pacman: ['base-devel'], zypper: ['gcc-c++', 'make'] }).map((s) => ({ ...s, label: 'Toolchain (if missing)' })), { cmd: 'npm run build:native', label: 'In the ArkaneDAW source folder' }],
        note: 'Builds resources/native/arkane-vsthost and arkane_bridge.node (only g++ and make are needed).'
      }
    }
  },
  {
    id: 'x11',
    name: 'X11 / XWayland',
    severity: 'recommended',
    why: 'Plugin editor windows are X11 windows; on Wayland they need XWayland.',
    affects: 'Opening plugin editors (Show editor)',
    async detect(ctx) {
      const display = ctx.env('DISPLAY')
      const wayland = ctx.env('WAYLAND_DISPLAY')
      if (display) return { ok: true, detail: `DISPLAY=${display}${wayland ? ' (XWayland)' : ''}` }
      if (wayland) return { ok: false, reason: 'wayland', detail: 'Wayland session without XWayland: plugin editor windows cannot open.' }
      return { ok: false, reason: 'none', detail: 'No X11 display (DISPLAY is not set).' }
    },
    install({ family }, st) {
      if (st?.reason === 'none') return { steps: [], note: 'Start ArkaneDAW from a graphical X11 or Wayland desktop session.' }
      return {
        steps: pm(family, { apt: ['xwayland'], dnf: ['xorg-x11-server-Xwayland'], pacman: ['xorg-xwayland'], zypper: ['xwayland'] }),
        note: 'Install XWayland, then log out and back in.'
      }
    }
  },
  {
    id: 'yabridge',
    name: 'yabridge',
    severity: 'optional',
    why: 'Wraps Windows VST2/VST3/CLAP plugins so they load on Linux (needs Wine). Only needed for Windows plugins.',
    affects: 'Windows plugins',
    homepage: { label: 'yabridge on GitHub', url: 'https://github.com/robbert-vdh/yabridge#readme' },
    async detect(ctx) {
      try {
        const r = await ctx.run('yabridgectl', ['--version'])
        if (r.code === 0) return { ok: true, detail: r.stdout.trim() || 'yabridgectl' }
      } catch {
        /* not on PATH */
      }
      for (const p of [`${ctx.home}/.local/share/yabridge/yabridge-host.exe`, '/usr/bin/yabridge-host.exe', '/usr/lib/yabridge/yabridge-host.exe']) {
        if (ctx.exists(p)) return { ok: true, detail: p }
      }
      return { ok: false, detail: 'yabridge is not installed.' }
    },
    install({ family }) {
      if (family === 'pacman') return { steps: [{ cmd: 'sudo pacman -S yabridge yabridgectl' }], note: 'Then run "yabridgectl add <plugin folder>" and "yabridgectl sync".' }
      if (family === 'dnf') return { steps: [{ cmd: 'sudo dnf copr enable patrickl/yabridge' }, { cmd: 'sudo dnf install yabridge' }], note: 'Then run "yabridgectl add <plugin folder>" and "yabridgectl sync".' }
      return { steps: [], note: 'Download the latest release from GitHub and follow its installation guide (needs Wine Staging).' }
    }
  },
  {
    id: 'audioserver',
    name: 'PipeWire / PulseAudio',
    severity: 'optional',
    why: 'Chromium plays and records audio through the PulseAudio API (PipeWire provides it on modern desktops).',
    affects: 'Audio output device selection and recording',
    homepage: { label: 'pipewire.org', url: 'https://pipewire.org' },
    async detect(ctx) {
      const rt = ctx.env('XDG_RUNTIME_DIR')
      const socket = rt ? [`${rt}/pulse/native`, `${rt}/pipewire-0`].find((p) => ctx.exists(p)) : undefined
      try {
        const r = await ctx.run('pactl', ['info'])
        if (r.code === 0) return { ok: true, detail: /Server Name:\s*(.+)/.exec(r.stdout)?.[1]?.trim() ?? 'pactl info OK' }
        if (!socket) return { ok: false, detail: `"pactl info" failed: ${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}` }
      } catch {
        /* pactl not installed: fall back to the socket check */
      }
      return socket ? { ok: true, detail: socket } : { ok: false, detail: 'No PulseAudio/PipeWire server is reachable.' }
    },
    install({ family }) {
      return {
        steps: [
          ...pm(family, {
            apt: ['pipewire-pulse', 'wireplumber', 'pulseaudio-utils'],
            dnf: ['pipewire-pulseaudio', 'wireplumber', 'pulseaudio-utils'],
            pacman: ['pipewire-pulse', 'wireplumber', 'libpulse'],
            zypper: ['pipewire-pulseaudio', 'wireplumber', 'pulseaudio-utils']
          }),
          { cmd: 'systemctl --user enable --now pipewire pipewire-pulse wireplumber' }
        ]
      }
    }
  }
]

// ── checker / dialog state ───────────────────────────────────────────────────

export interface DepsState {
  /** a system context exists (false in the browser build until/unless one is created) */
  ready: boolean
  checking: boolean
  results: Partial<Record<DepId, DepStatus>>
  open: boolean
  mode: 'startup' | 'focus'
  focus: { id: DepId; feature?: string } | null
  family: DistroFamily
  distroName: string
  isPackaged: boolean
}

interface Waiter {
  id: DepId
  feature?: string
  resolve: (ok: boolean) => void
}

export interface DependencyManager {
  store: StoreApi<DepsState>
  registry: Dependency[]
  checkAll(): Promise<Partial<Record<DepId, DepStatus>>>
  runStartupCheck(): Promise<void>
  requireDependency(id: DepId, feature?: string): Promise<boolean>
  recheck(): Promise<void>
  dismiss(): void
  /** dependencies the dialog lists for a state */
  visible(s: DepsState): { dep: Dependency; status: DepStatus }[]
  isSatisfied(id: DepId, feature?: string): boolean
}

export function createDependencyManager(registry: Dependency[], getContext: () => Promise<DepContext | null>): DependencyManager {
  const store = createStore<DepsState>(() => ({
    ready: false,
    checking: false,
    results: {},
    open: false,
    mode: 'startup',
    focus: null,
    family: 'generic',
    distroName: '',
    isPackaged: false
  }))
  const waiters: Waiter[] = []
  let ctxP: Promise<DepContext | null> | null = null
  let checkP: Promise<Partial<Record<DepId, DepStatus>>> | null = null

  const ctx = () =>
    (ctxP ??= getContext()
      .catch(() => null)
      .then((c) => {
        if (c) store.setState({ ready: true, family: c.family, distroName: c.distroName, isPackaged: c.isPackaged })
        return c
      }))
  const byId = (id: DepId) => registry.find((d) => d.id === id)
  const satisfied = (d: Dependency | undefined, st: DepStatus | undefined, feature?: string) => !!d && !!st && (d.satisfies ? d.satisfies(st, feature) : st.ok)
  const detect = async (d: Dependency, c: DepContext): Promise<DepStatus> => {
    try {
      return await d.detect(c)
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }
  const blocking = (r: Partial<Record<DepId, DepStatus>>) => registry.filter((d) => d.severity !== 'optional' && r[d.id] && !r[d.id]!.ok)

  async function checkAll() {
    if (checkP) return checkP
    checkP = (async () => {
      const c = await ctx()
      if (!c) return {}
      store.setState({ checking: true })
      try {
        const entries = await Promise.all(registry.map(async (d) => [d.id, await detect(d, c)] as const))
        const results = Object.fromEntries(entries) as Partial<Record<DepId, DepStatus>>
        store.setState({ results })
        return results
      } finally {
        store.setState({ checking: false })
      }
    })().finally(() => {
      checkP = null
    })
    return checkP
  }

  async function checkOne(id: DepId, c: DepContext): Promise<DepStatus | undefined> {
    const d = byId(id)
    if (!d) return undefined
    const st = await detect(d, c)
    store.setState((s) => ({ results: { ...s.results, [id]: st } }))
    return st
  }

  async function runStartupCheck() {
    const r = await checkAll()
    if (blocking(r).length && !store.getState().open) store.setState({ open: true, mode: 'startup', focus: null })
  }

  async function requireDependency(id: DepId, feature?: string): Promise<boolean> {
    const d = byId(id)
    if (!d) return false
    const c = await ctx()
    if (!c) return false
    if (satisfied(d, store.getState().results[id], feature)) return true
    if (checkP) await checkP.catch(() => {})
    if (satisfied(d, store.getState().results[id], feature)) return true
    if (satisfied(d, await checkOne(id, c), feature)) return true
    return new Promise<boolean>((resolve) => {
      waiters.push({ id, feature, resolve })
      if (!store.getState().open) store.setState({ open: true, mode: 'focus', focus: { id, feature } })
    })
  }

  async function recheck() {
    const r = await checkAll()
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i]
      if (satisfied(byId(w.id), r[w.id], w.feature)) {
        waiters.splice(i, 1)
        w.resolve(true)
      }
    }
    const s = store.getState()
    if (!s.open) return
    if (waiters.length) {
      if (s.mode === 'focus' && !waiters.some((w) => w.id === s.focus?.id)) store.setState({ focus: { id: waiters[0].id, feature: waiters[0].feature } })
      return
    }
    if (s.mode === 'focus' || blocking(r).length === 0) store.setState({ open: false })
  }

  function dismiss() {
    store.setState({ open: false })
    for (const w of waiters.splice(0)) w.resolve(false)
  }

  function visible(s: DepsState) {
    const rows: { dep: Dependency; status: DepStatus }[] = []
    const add = (d: Dependency | undefined) => {
      const st = d && s.results[d.id]
      if (d && st && !rows.some((r) => r.dep.id === d.id)) rows.push({ dep: d, status: st })
    }
    if (s.mode === 'focus') {
      add(s.focus ? byId(s.focus.id) : undefined)
      for (const w of waiters) add(byId(w.id))
      return rows
    }
    for (const d of registry) if (d.severity !== 'optional' && s.results[d.id] && !satisfied(d, s.results[d.id])) add(d)
    for (const w of waiters) add(byId(w.id))
    for (const d of registry) if (d.severity === 'optional' && s.results[d.id] && !s.results[d.id]!.ok) add(d)
    return rows
  }

  const isSatisfied = (id: DepId, feature?: string) => satisfied(byId(id), store.getState().results[id], feature)

  return { store, registry, checkAll, runStartupCheck, requireDependency, recheck, dismiss, visible, isSatisfied }
}

// ── the app's instance ───────────────────────────────────────────────────────

async function rendererContext(): Promise<DepContext | null> {
  if (!host) return null
  const h = host
  const cp = rendererChildProcess()
  const sys = (h as { system?: typeof h.system }).system
  const info = await sys?.info().catch(() => null)
  const paths = await h.paths().catch(() => ({}) as Record<string, string>)
  let osRelease: string | null = null
  for (const p of ['/etc/os-release', '/usr/lib/os-release']) {
    osRelease = await h.fsp.readFile(p, 'utf8').catch(() => null)
    if (osRelease) break
  }
  const distro = detectDistro(osRelease)
  const env = sys?.env ?? ((k: string) => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[k])
  return {
    env,
    exists: (p) => {
      try {
        return h.fs.existsSync(p)
      } catch {
        return false
      }
    },
    readText: (p) => h.fsp.readFile(p, 'utf8').catch(() => null),
    run: (cmd, args) => {
      if (!cp) return Promise.reject(new Error('child_process unavailable'))
      return runProcess(cp, cmd, args, undefined, AbortSignal.timeout(5000))
    },
    cp,
    home: h.os.homedir(),
    family: distro.family,
    distroName: distro.name,
    isPackaged: info?.isPackaged ?? /app\.asar/.test(paths.appPath ?? '')
  }
}

export const deps = createDependencyManager(DEPENDENCIES, rendererContext)

export const requireDependency = (id: DepId, feature?: string): Promise<boolean> => deps.requireDependency(id, feature)
export const runStartupDependencyCheck = (): Promise<void> => deps.runStartupCheck()
export function useDeps<T>(selector: (s: DepsState) => T): T {
  return useStore(deps.store, selector)
}
