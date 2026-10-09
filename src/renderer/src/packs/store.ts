// Content-pack status store: one PackStatus per pack, install / cancel / remove through the main process.
// After an install or removal every channel using one of the pack's plugins re-resolves its data, so open
// Concerto / Studio Drums channels start (or stop) sounding without reloading the project.
import { create } from 'zustand'
import { host } from '../platform'
import { invalidatePackRoot, packEnv, packsSupported } from './paths'
import { getPack, PACKS, type PackDef } from './registry'
import { isBusy, isUsable, nextStatus, type PackEvent, type PackStatus } from './status'

interface PacksState {
  status: Record<string, PackStatus>
  dispatch: (id: string, ev: PackEvent) => void
}

export const usePacks = create<PacksState>((set) => ({
  status: Object.fromEntries(PACKS.map((p) => [p.id, { state: 'unknown' } as PackStatus])),
  dispatch: (id, ev) => set((s) => ({ status: { ...s.status, [id]: nextStatus(s.status[id] ?? { state: 'unknown' }, ev) } }))
}))

export const packStatus = (id: string): PackStatus => usePacks.getState().status[id] ?? { state: 'unknown' }
export const usePackStatus = (id: string): PackStatus => usePacks((s) => s.status[id] ?? { state: 'unknown' })
export const isPackInstalled = (id: string): boolean => isUsable(packStatus(id))

const installedListeners = new Set<(id: string) => void>()
/** Called after a pack finished installing (the dialog uses it to run its pending "Add to channel rack"). */
export function onPackInstalled(cb: (id: string) => void): () => void {
  installedListeners.add(cb)
  return () => installedListeners.delete(cb)
}

async function devCopyExists(def: PackDef): Promise<boolean> {
  try {
    const env = await packEnv()
    if (env.isPackaged || !env.resources) return false
    await host!.fsp.access(host!.path.join(env.resources, def.devDir, 'index.json'))
    return true
  } catch {
    return false
  }
}

/** Re-read install state from disk (all packs when no id). */
export async function refreshPacks(id?: string): Promise<void> {
  if (!host) return
  const defs = id ? [getPack(id)].filter((d): d is PackDef => !!d) : PACKS
  await Promise.all(
    defs.map(async (def) => {
      const installed = host!.packs ? await host!.packs.installed(def.id).catch(() => null) : null
      const dev = await devCopyExists(def)
      usePacks.getState().dispatch(def.id, { type: 'checked', installed, dev, latest: def.version })
    })
  )
}

async function reresolveChannels(def: PackDef): Promise<void> {
  try {
    const [{ getEngine }, { useProject }] = await Promise.all([import('../audio/transport'), import('../store/project')])
    const engine = getEngine()
    if (!engine) return
    for (const ch of useProject.getState().project.channels) {
      if (ch.plugin && def.pluginIds.includes(ch.plugin.pluginId)) engine.channelPlugin(ch.id)?.setData(ch.plugin.data)
    }
  } catch (e) {
    console.warn('[packs] could not refresh channels', e)
  }
}

export async function installPack(id: string): Promise<boolean> {
  const def = getPack(id)
  if (!def) return false
  const { dispatch } = usePacks.getState()
  if (isBusy(packStatus(id))) return false
  if (!host?.packs) {
    dispatch(id, { type: 'failed', code: 'unsupported', message: 'Sound libraries can only be downloaded in the desktop app.' })
    return false
  }
  dispatch(id, { type: 'start' })
  let res
  try {
    res = await host.packs.install({ id: def.id, version: def.version, sha256: def.sha256 || undefined })
  } catch (e) {
    res = { ok: false as const, code: 'network' as const, message: String(e) }
  }
  if (res.ok) {
    invalidatePackRoot(id)
    dispatch(id, { type: 'done', installed: res.installed, latest: def.version })
    void reresolveChannels(def)
    for (const l of installedListeners) l(id)
    return true
  }
  if (res.code === 'cancelled') {
    // leave the busy state, then restore whatever is on disk (an older version may still be installed);
    // the partial download is kept and resumed by the next install
    usePacks.setState((s) => ({ status: { ...s.status, [id]: { state: 'not-installed' } } }))
    await refreshPacks(id)
  } else dispatch(id, { type: 'failed', code: res.code, message: res.message })
  return false
}

export function cancelInstall(id: string): void {
  void host?.packs?.cancel(id)
}

export async function removePack(id: string): Promise<void> {
  const def = getPack(id)
  if (!def || !host?.packs) return
  await host.packs.remove(id)
  invalidatePackRoot(id)
  usePacks.setState((s) => ({ status: { ...s.status, [id]: { state: 'unknown' } } }))
  await refreshPacks(id)
  void reresolveChannels(def)
}

let subscribed = false
let checked = false
/** Subscribe to main-process progress and check every pack once (idempotent). */
export function initPacks(): void {
  if (!host) return
  if (!subscribed && host.packs) {
    subscribed = true
    host.packs.onProgress((p) => usePacks.getState().dispatch(p.id, { type: 'progress', p, now: performance.now() }))
  }
  if (!checked) {
    checked = true
    void refreshPacks()
  }
}

export { packsSupported }
