// Where a pack's files are on disk: <userData>/packs/<id>/ when installed (pack.json present), else — only when
// running unpackaged from a dev checkout — <resources>/<devDir>/, else nowhere (not installed).
// Unpackaged, an outdated installed pack loses to the dev checkout (which always matches the code).
// No React / store imports: plugin loaders use this.
import { host } from '../platform'
import { getPack } from './registry'

export interface PackEnv {
  /** null when the main process has no pack IPC (older main): only the dev fallback applies */
  packsDir: string | null
  isPackaged: boolean
  resources: string
  repo: string
  baseUrl: string
}

export interface PackRoot {
  dir: string
  source: 'pack' | 'dev'
  /** installed pack version (source 'pack', when its pack.json is readable) */
  version?: string
}

type Exists = (p: string) => Promise<boolean>
type Join = (...p: string[]) => string
/** version from <dir>/pack.json, null when unreadable */
type ReadVersion = (dir: string) => Promise<string | null>

/** Pure resolution (tested): installed pack first, dev checkout fallback only when unpackaged (or the pack is outdated). */
export async function resolvePackRoot(
  id: string,
  devDir: string,
  env: PackEnv,
  exists: Exists,
  join: Join,
  opts: { latest?: string; readVersion?: ReadVersion } = {}
): Promise<PackRoot | null> {
  const devRoot = async (): Promise<PackRoot | null> => {
    if (env.isPackaged || !env.resources) return null
    const dir = join(env.resources, devDir)
    return (await exists(join(dir, 'index.json'))) ? { dir, source: 'dev' } : null
  }
  if (env.packsDir) {
    const dir = join(env.packsDir, id)
    if (await exists(join(dir, 'pack.json'))) {
      const version = (await opts.readVersion?.(dir)) ?? undefined
      if (opts.latest && version && version !== opts.latest) {
        const dev = await devRoot()
        if (dev) return dev
      }
      return version ? { dir, source: 'pack', version } : { dir, source: 'pack' }
    }
  }
  return devRoot()
}

let envPromise: Promise<PackEnv> | null = null
/** Pack environment from the main process (cached). Rejects without the Electron host. */
export function packEnv(): Promise<PackEnv> {
  if (!host) return Promise.reject(new Error('no host'))
  if (!envPromise) {
    const h = host
    envPromise = (h.packs ? h.packs.info() : Promise.reject(new Error('no pack ipc')))
      .then((i): PackEnv => ({ ...i }))
      .catch(async (): Promise<PackEnv> => {
        // main without pack IPC (not restarted yet / tests): dev fallback only
        const p = await h.paths()
        return { packsDir: null, isPackaged: false, resources: p.resources, repo: 'elevchyt/ArkaneDAW', baseUrl: '' }
      })
    envPromise.catch(() => (envPromise = null))
  }
  return envPromise
}

/** True when this host can download packs (desktop app with the pack IPC). */
export function packsSupported(): boolean {
  return !!host?.packs
}

const exists: Exists = async (p) => {
  try {
    await host!.fsp.access(p)
    return true
  } catch {
    return false
  }
}

const readVersion: ReadVersion = async (dir) => {
  try {
    const j = JSON.parse(await host!.fsp.readFile(host!.path.join(dir, 'pack.json'), 'utf8')) as { version?: unknown }
    return typeof j.version === 'string' ? j.version : null
  } catch {
    return null
  }
}

const roots = new Map<string, PackRoot>()
const listeners = new Set<(id: string) => void>()

/** Root dir of an installed pack (or dev copy); null = not installed. Only positive results are cached. */
export async function packRoot(id: string): Promise<PackRoot | null> {
  const hit = roots.get(id)
  if (hit) return hit
  const def = getPack(id)
  if (!def || !host) return null
  const env = await packEnv()
  const r = await resolvePackRoot(id, def.devDir, env, exists, (...p) => host!.path.join(...p), { latest: def.version, readVersion })
  if (r) roots.set(id, r)
  return r
}

/** Forget the cached root after an install / removal (loaders drop their JSON caches via onPackRootChange). */
export function invalidatePackRoot(id: string): void {
  roots.delete(id)
  for (const l of listeners) l(id)
}

export function onPackRootChange(cb: (id: string) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
