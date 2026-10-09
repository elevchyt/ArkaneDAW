import { describe, expect, it } from 'vitest'
import type { ChildProcessApi } from '@/windows/export/ffmpeg'
import { DEPENDENCIES, createDependencyManager, requireDependency, type DepContext, type DepStatus, type Dependency } from './deps'

function fakeCtx(over: Partial<DepContext> = {}): DepContext {
  return {
    env: () => undefined,
    exists: () => false,
    readText: async () => null,
    run: async () => {
      throw new Error('ENOENT')
    },
    cp: null,
    home: '/home/u',
    family: 'apt',
    distroName: 'Linux Mint 22.3',
    isPackaged: false,
    ...over
  }
}

/** A dependency whose availability the test flips. */
function fakeDep(id: Dependency['id'], severity: Dependency['severity'], state: { ok: boolean; missing?: string[] }): Dependency & { calls: number } {
  const d = {
    id,
    name: id,
    severity,
    why: 'w',
    affects: 'a',
    calls: 0,
    async detect(): Promise<DepStatus> {
      d.calls++
      return { ok: state.ok, found: true, missing: state.missing ?? [] }
    },
    satisfies: (st: DepStatus, feature?: string) => (feature ? !(st.missing ?? []).includes(feature) : st.ok),
    install: () => ({ steps: [{ cmd: `install ${id}` }] })
  }
  return d
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('dependency manager', () => {
  it('startup check opens only for required/recommended deps', async () => {
    const ff = { ok: true }
    const yb = { ok: false }
    const m = createDependencyManager([fakeDep('ffmpeg', 'recommended', ff), fakeDep('yabridge', 'optional', yb)], async () => fakeCtx())
    await m.runStartupCheck()
    expect(m.store.getState().open).toBe(false) // optional alone does not nag
    expect(m.store.getState()).toMatchObject({ ready: true, family: 'apt', distroName: 'Linux Mint 22.3' })

    ff.ok = false
    const m2 = createDependencyManager([fakeDep('ffmpeg', 'recommended', ff), fakeDep('yabridge', 'optional', yb)], async () => fakeCtx())
    await m2.runStartupCheck()
    const s = m2.store.getState()
    expect(s).toMatchObject({ open: true, mode: 'startup' })
    // optional deps are listed once the modal shows, after the blocking ones
    expect(m2.visible(s).map((r) => r.dep.id)).toEqual(['ffmpeg', 'yabridge'])
  })

  it('re-check closes the startup dialog once nothing blocking is missing', async () => {
    const ff = { ok: false }
    const m = createDependencyManager([fakeDep('ffmpeg', 'recommended', ff), fakeDep('yabridge', 'optional', { ok: false })], async () => fakeCtx())
    await m.runStartupCheck()
    await m.recheck()
    expect(m.store.getState().open).toBe(true)
    ff.ok = true
    await m.recheck()
    expect(m.store.getState().open).toBe(false)
  })

  it('requireDependency resolves true immediately when available', async () => {
    const d = fakeDep('ffmpeg', 'recommended', { ok: true })
    const m = createDependencyManager([d], async () => fakeCtx())
    expect(await m.requireDependency('ffmpeg')).toBe(true)
    expect(m.store.getState().open).toBe(false)
  })

  it('requireDependency opens a focused dialog; re-check success resolves true and closes', async () => {
    const st = { ok: false }
    const m = createDependencyManager([fakeDep('vsthost', 'recommended', st)], async () => fakeCtx())
    let result: boolean | undefined
    void m.requireDependency('vsthost').then((r) => (result = r))
    await tick()
    await tick()
    expect(m.store.getState()).toMatchObject({ open: true, mode: 'focus', focus: { id: 'vsthost' } })
    await m.recheck() // still missing: stays open
    expect(result).toBeUndefined()
    expect(m.store.getState().open).toBe(true)
    st.ok = true
    await m.recheck()
    await tick()
    expect(result).toBe(true)
    expect(m.store.getState().open).toBe(false)
  })

  it('Continue resolves every waiter false; concurrent requests share one dialog', async () => {
    const m = createDependencyManager([fakeDep('vsthost', 'recommended', { ok: false })], async () => fakeCtx())
    const a = m.requireDependency('vsthost')
    const b = m.requireDependency('vsthost')
    await tick()
    await tick()
    expect(m.store.getState().open).toBe(true)
    m.dismiss()
    expect(await a).toBe(false)
    expect(await b).toBe(false)
    expect(m.store.getState().open).toBe(false)
  })

  it('feature checks: ffmpeg with only some encoders', async () => {
    const st = { ok: false, missing: ['libopus'] }
    const m = createDependencyManager([fakeDep('ffmpeg', 'recommended', st)], async () => fakeCtx())
    expect(await m.requireDependency('ffmpeg', 'libmp3lame')).toBe(true)
    const p = m.requireDependency('ffmpeg', 'libopus')
    await tick()
    await tick()
    expect(m.store.getState().focus).toEqual({ id: 'ffmpeg', feature: 'libopus' })
    st.missing = []
    await m.recheck()
    expect(await p).toBe(true)
  })

  it('a request while the startup dialog is open joins it', async () => {
    const st = { ok: false }
    const m = createDependencyManager([fakeDep('ffmpeg', 'recommended', st), fakeDep('x11', 'recommended', { ok: false })], async () => fakeCtx())
    await m.runStartupCheck()
    const p = m.requireDependency('ffmpeg')
    await tick()
    await tick()
    expect(m.store.getState().mode).toBe('startup')
    st.ok = true
    await m.recheck()
    expect(await p).toBe(true)
    expect(m.store.getState().open).toBe(true) // x11 still missing
  })

  it('without a system context (browser build) checks are skipped', async () => {
    const d = fakeDep('ffmpeg', 'recommended', { ok: false })
    const m = createDependencyManager([d], async () => null)
    await m.runStartupCheck()
    expect(await m.requireDependency('ffmpeg')).toBe(false)
    expect(m.store.getState().open).toBe(false)
    expect(d.calls).toBe(0)
    // the app's default instance in node (no host) behaves the same
    expect(await requireDependency('ffmpeg')).toBe(false)
  })

  it('a throwing detector counts as missing', async () => {
    const bad: Dependency = { ...fakeDep('x11', 'recommended', { ok: true }), detect: async () => Promise.reject(new Error('boom')) }
    const m = createDependencyManager([bad], async () => fakeCtx())
    await m.runStartupCheck()
    expect(m.store.getState().results.x11).toEqual({ ok: false, detail: 'boom' })
  })
})

const dep = (id: string) => DEPENDENCIES.find((d) => d.id === id)!

describe('built-in detectors', () => {
  it('X11 / XWayland', async () => {
    const env = (e: Record<string, string>) => fakeCtx({ env: (k) => e[k] })
    expect(await dep('x11').detect(env({ DISPLAY: ':0' }))).toMatchObject({ ok: true, detail: 'DISPLAY=:0' })
    expect(await dep('x11').detect(env({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }))).toMatchObject({ ok: true, detail: 'DISPLAY=:0 (XWayland)' })
    const noX = await dep('x11').detect(env({ WAYLAND_DISPLAY: 'wayland-0' }))
    expect(noX).toMatchObject({ ok: false, reason: 'wayland' })
    expect(dep('x11').install({ family: 'pacman', isPackaged: true }, noX).steps[0].cmd).toBe('sudo pacman -S xorg-xwayland')
    const none = await dep('x11').detect(env({}))
    expect(none.ok).toBe(false)
    expect(dep('x11').install({ family: 'apt', isPackaged: true }, none).steps).toEqual([])
  })

  it('audio server via pactl, falling back to the runtime socket', async () => {
    const ok = await dep('audioserver').detect(fakeCtx({ run: async () => ({ code: 0, stdout: 'Server Name: PulseAudio (on PipeWire 1.0.5)\n', stderr: '' }) }))
    expect(ok).toEqual({ ok: true, detail: 'PulseAudio (on PipeWire 1.0.5)' })
    const fail = await dep('audioserver').detect(fakeCtx({ run: async () => ({ code: 1, stdout: '', stderr: 'Connection failure: Connection refused\n' }) }))
    expect(fail).toMatchObject({ ok: false, detail: '"pactl info" failed: Connection failure: Connection refused' })
    const sock = await dep('audioserver').detect(fakeCtx({ env: (k) => (k === 'XDG_RUNTIME_DIR' ? '/run/user/1000' : undefined), exists: (p) => p === '/run/user/1000/pipewire-0' }))
    expect(sock).toEqual({ ok: true, detail: '/run/user/1000/pipewire-0' })
    expect((await dep('audioserver').detect(fakeCtx())).ok).toBe(false)
    expect(dep('audioserver').severity).toBe('optional')
  })

  it('yabridge is optional and found via yabridgectl or its host binary', async () => {
    expect(dep('yabridge').severity).toBe('optional')
    expect(await dep('yabridge').detect(fakeCtx({ run: async () => ({ code: 0, stdout: 'yabridgectl 5.1.1\n', stderr: '' }) }))).toEqual({ ok: true, detail: 'yabridgectl 5.1.1' })
    expect((await dep('yabridge').detect(fakeCtx({ exists: (p) => p === '/home/u/.local/share/yabridge/yabridge-host.exe' }))).ok).toBe(true)
    expect((await dep('yabridge').detect(fakeCtx())).ok).toBe(false)
  })

  it('ffmpeg encoders and install commands per family', async () => {
    const enc = ' A..... libmp3lame           libmp3lame MP3\n A..... libvorbis   Vorbis\n A..... flac  FLAC\n'
    const cp = {
      spawn(cmd: string, args: string[]) {
        const out = args.includes('-version') ? 'ffmpeg version 6.1.1-3ubuntu5 Copyright' : enc
        const handlers: Record<string, (...a: unknown[]) => void> = {}
        const child = {
          stdin: { write: () => true, end: () => {}, on: () => child },
          stdout: { on: (_e: string, cb: (b: string) => void) => setTimeout(() => cb(out), 0) },
          stderr: { on: () => {} },
          on(ev: string, cb: (...a: unknown[]) => void) {
            handlers[ev] = cb
            if (ev === 'close') setTimeout(() => cb(cmd === 'ffmpeg' ? 0 : 1, null), 5)
            return child
          },
          kill: () => true
        }
        return child
      }
    }
    const st = await dep('ffmpeg').detect(fakeCtx({ cp: cp as unknown as ChildProcessApi }))
    expect(st).toMatchObject({ ok: false, found: true, missing: ['libopus'] })
    expect(dep('ffmpeg').satisfies!(st, 'libmp3lame')).toBe(true)
    expect(dep('ffmpeg').satisfies!(st, 'libopus')).toBe(false)
    expect((await dep('ffmpeg').detect(fakeCtx({ cp: null }))).found).toBe(false)

    const cmd = (family: 'apt' | 'dnf' | 'pacman' | 'zypper' | 'generic') => dep('ffmpeg').install({ family, isPackaged: true }).steps.map((s) => s.cmd)
    expect(cmd('apt')).toEqual(['sudo apt install ffmpeg'])
    expect(cmd('dnf')).toEqual(['sudo dnf install ffmpeg-free'])
    expect(cmd('pacman')).toEqual(['sudo pacman -S ffmpeg'])
    expect(cmd('zypper')).toEqual(['sudo zypper install ffmpeg'])
    expect(cmd('generic')).toEqual([])
    expect(dep('ffmpeg').install({ family: 'generic', isPackaged: true }).note).toMatch(/package manager/)
  })

  it('native plugin host instructions differ for dev and packaged builds', () => {
    const dev = dep('vsthost').install({ family: 'apt', isPackaged: false })
    expect(dev.steps.map((s) => s.cmd)).toEqual(['sudo apt install g++ make', 'npm run build:native'])
    const packaged = dep('vsthost').install({ family: 'apt', isPackaged: true })
    expect(packaged.steps).toEqual([])
    expect(packaged.note).toMatch(/Reinstall/)
  })

  it('severities: nothing optional blocks startup except ffmpeg/vsthost/x11', () => {
    expect(DEPENDENCIES.filter((d) => d.severity !== 'optional').map((d) => d.id)).toEqual(['ffmpeg', 'vsthost', 'x11'])
  })
})
