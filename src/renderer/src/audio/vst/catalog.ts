// External plugin catalogue: search paths, sandboxed scanning (one short-lived sidecar per file, with a
// timeout, so a bad plugin can never take the app down), persistence in <userData>/plugins/catalog.json,
// favourites / blacklist, and the query API used by pickers (listExternalPlugins / useExternalPlugins).
//
// Windows plugins wrapped by yabridge (`yabridgectl sync`) show up as ordinary Linux .so / .vst3 / .clap files in
// ~/.vst, ~/.vst3 and ~/.clap (under "yabridge/" subfolders), so they are found and hosted like native ones.
import { create } from 'zustand'
import { host } from '../../platform'
import { formatFromPath, formatPluginId, type PluginFormat } from './ids'
import { childProcess, sidecarPath } from './native'
import { scanFile } from './sidecar'

export type CatalogStatus = 'ok' | 'failed' | 'blacklisted' | 'unsupported'

export interface CatalogEntry {
  /** plugin id usable as PluginInstanceState.pluginId ("vst:<format>:<path>[:<uid>]") */
  id: string
  format: PluginFormat | 'lv2'
  path: string
  uid: string
  name: string
  vendor: string
  version: string
  category: string
  kind: 'instrument' | 'effect'
  status: CatalogStatus
  error?: string
  favorite?: boolean
  hasEditor?: boolean
  /** file mtime when scanned (ms) — unchanged files are skipped on incremental scans */
  mtime: number
  scannedAt: number
}

/** What pickers get. */
export interface ExternalPluginInfo {
  id: string
  name: string
  vendor: string
  kind: 'instrument' | 'effect'
  format: PluginFormat
  category: string
  favorite: boolean
}

interface CatalogFile {
  version: 1
  /** user-added folders */
  searchPaths: string[]
  /** default folders the user switched off */
  disabledDefaults: string[]
  plugins: CatalogEntry[]
}

export interface ScanProgress {
  done: number
  total: number
  current: string
  found: number
  failed: number
}

interface CatalogState {
  loaded: boolean
  entries: CatalogEntry[]
  searchPaths: string[]
  disabledDefaults: string[]
  scanning: ScanProgress | null
  lastScan: number | null
  load: () => Promise<void>
  scan: (opts?: { full?: boolean }) => Promise<void>
  cancelScan: () => void
  addSearchPath: (p: string) => void
  removeSearchPath: (p: string) => void
  toggleDefault: (p: string) => void
  toggleFavorite: (id: string) => void
  /** Display name shown in pickers and the browser. */
  rename: (id: string, name: string) => void
  setBlacklisted: (path: string, blacklisted: boolean) => void
  forget: (path: string) => void
}

const SCAN_CONCURRENCY = 4
const MAX_DEPTH = 6

export function defaultSearchPaths(home: string, env: Record<string, string | undefined> = {}): string[] {
  const out = [
    `${home}/.vst`,
    `${home}/.lxvst`,
    `${home}/.vst3`,
    `${home}/.clap`,
    `${home}/.lv2`,
    '/usr/lib/vst',
    '/usr/lib/lxvst',
    '/usr/lib/vst3',
    '/usr/lib/clap',
    '/usr/lib/lv2',
    '/usr/local/lib/vst',
    '/usr/local/lib/lxvst',
    '/usr/local/lib/vst3',
    '/usr/local/lib/clap',
    '/usr/local/lib/lv2',
    '/usr/lib/x86_64-linux-gnu/vst',
    '/usr/lib/x86_64-linux-gnu/vst3',
    '/usr/lib/x86_64-linux-gnu/clap',
    '/usr/lib/x86_64-linux-gnu/lv2'
  ]
  for (const v of ['VST_PATH', 'LXVST_PATH', 'VST3_PATH', 'CLAP_PATH', 'LV2_PATH']) {
    for (const p of (env[v] ?? '').split(':')) if (p && !out.includes(p)) out.push(p)
  }
  return out
}

/** Which formats a candidate file/bundle can be. */
export function candidateFormat(path: string, isDir: boolean): PluginFormat | 'lv2' | null {
  if (/\.lv2\/?$/i.test(path)) return isDir ? 'lv2' : null
  if (/\.vst3\/?$/i.test(path)) return 'vst3'
  if (isDir) return null
  const f = formatFromPath(path)
  return f
}

let cancelRequested = false

function catalogPath(): Promise<string | null> {
  if (!host) return Promise.resolve(null)
  return host.paths().then((p) => host!.path.join(p.userData, 'plugins', 'catalog.json'))
}

async function save(s: Pick<CatalogState, 'entries' | 'searchPaths' | 'disabledDefaults'>): Promise<void> {
  const file = await catalogPath()
  if (!file || !host) return
  const data: CatalogFile = { version: 1, searchPaths: s.searchPaths, disabledDefaults: s.disabledDefaults, plugins: s.entries }
  await host.fsp.mkdir(host.path.dirname(file), { recursive: true })
  await host.fsp.writeFile(file + '.tmp', JSON.stringify(data, null, 1))
  await host.fsp.rename(file + '.tmp', file)
}

/** All candidate plugin files below the enabled search paths. */
export async function discover(roots: string[]): Promise<{ path: string; format: PluginFormat | 'lv2'; mtime: number }[]> {
  if (!host) return []
  const h = host
  const out: { path: string; format: PluginFormat | 'lv2'; mtime: number }[] = []
  const seen = new Set<string>()
  const walk = async (dir: string, depth: number): Promise<void> => {
    let real: string
    try {
      real = await h.fsp.realpath(dir)
    } catch {
      return
    }
    if (seen.has(real) || depth > MAX_DEPTH) return
    seen.add(real)
    let names: string[]
    try {
      names = await h.fsp.readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const p = h.path.join(dir, name)
      let st
      try {
        st = await h.fsp.stat(p) // follows symlinks (yabridge uses them)
      } catch {
        continue
      }
      const fmt = candidateFormat(p, st.isDirectory())
      if (fmt) {
        out.push({ path: p, format: fmt, mtime: st.mtimeMs })
        continue // never descend into bundles
      }
      if (st.isDirectory()) await walk(p, depth + 1)
    }
  }
  for (const r of roots) await walk(r, 0)
  return out
}

function baseName(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop()!.replace(/\.(clap|vst3|so|lv2)$/i, '')
}

export const useVstCatalog = create<CatalogState>((set, get) => ({
  loaded: false,
  entries: [],
  searchPaths: [],
  disabledDefaults: [],
  scanning: null,
  lastScan: null,

  async load() {
    const file = await catalogPath()
    if (!file || !host) return set({ loaded: true })
    try {
      const raw = JSON.parse(await host.fsp.readFile(file, 'utf8')) as CatalogFile
      const lastScan = raw.plugins.reduce((m, e) => Math.max(m, e.scannedAt ?? 0), 0) || null
      set({ loaded: true, entries: raw.plugins ?? [], searchPaths: raw.searchPaths ?? [], disabledDefaults: raw.disabledDefaults ?? [], lastScan })
    } catch {
      set({ loaded: true })
    }
  },

  async scan(opts = {}) {
    if (get().scanning || !host) return
    const exe = await sidecarPath()
    const cp = childProcess()
    if (!exe || !cp) {
      set({ scanning: null })
      throw new Error('arkane-vsthost is not built (npm run build:native)')
    }
    cancelRequested = false
    const h = host
    const home = h.os.homedir()
    const roots = [...defaultSearchPaths(home, ((globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {})).filter((p) => !get().disabledDefaults.includes(p)), ...get().searchPaths]
    set({ scanning: { done: 0, total: 0, current: 'Looking for plugins…', found: 0, failed: 0 } })
    const files = await discover(roots)
    const prev = get().entries
    const byPath = new Map<string, CatalogEntry[]>()
    for (const e of prev) byPath.set(e.path, [...(byPath.get(e.path) ?? []), e])
    const result: CatalogEntry[] = []
    const todo: typeof files = []
    for (const f of files) {
      const old = byPath.get(f.path)
      if (old && old.some((e) => e.status === 'blacklisted')) {
        result.push(...old)
        continue
      }
      if (f.format === 'lv2') {
        result.push({
          id: `lv2:${f.path}`, format: 'lv2', path: f.path, uid: '', name: baseName(f.path), vendor: '', version: '', category: '',
          kind: 'effect', status: 'unsupported', error: 'LV2 hosting is not supported yet', mtime: f.mtime, scannedAt: Date.now()
        })
        continue
      }
      if (!opts.full && old && old.every((e) => e.mtime === f.mtime)) {
        result.push(...old)
        continue
      }
      todo.push(f)
    }
    const spawn = (cmd: string, args: string[]) => cp.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let done = 0
    let found = 0
    let failed = 0
    set({ scanning: { done, total: todo.length, current: '', found, failed } })
    const queue = [...todo]
    const worker = async (): Promise<void> => {
      while (queue.length && !cancelRequested) {
        const f = queue.shift()!
        set({ scanning: { done, total: todo.length, current: f.path, found, failed } })
        const timeout = /yabridge/i.test(f.path) ? 60000 : 20000 // Wine start-up is slow
        const r = await scanFile(spawn, exe, f.path, timeout)
        const favs = new Set((byPath.get(f.path) ?? []).filter((e) => e.favorite).map((e) => e.id))
        if (r.plugins.length) {
          for (const p of r.plugins) {
            const format = (p.format as PluginFormat) ?? (f.format as PluginFormat)
            const uid = String(p.uid ?? '')
            const id = formatPluginId({ format, path: f.path, uid })
            result.push({
              id,
              format,
              path: f.path,
              uid,
              name: String(p.name || baseName(f.path)),
              vendor: String(p.vendor ?? ''),
              version: String(p.version ?? ''),
              category: String(p.category ?? ''),
              kind: p.kind === 'instrument' ? 'instrument' : 'effect',
              status: 'ok',
              hasEditor: typeof p.hasEditor === 'boolean' ? p.hasEditor : undefined,
              favorite: favs.has(id) || undefined,
              mtime: f.mtime,
              scannedAt: Date.now()
            })
            found++
          }
        } else {
          failed++
          result.push({
            id: formatPluginId({ format: f.format as PluginFormat, path: f.path, uid: '' }),
            format: f.format,
            path: f.path,
            uid: '',
            name: baseName(f.path),
            vendor: '',
            version: '',
            category: '',
            kind: 'effect',
            status: 'failed',
            error: r.error ?? 'no plugins found in file',
            mtime: f.mtime,
            scannedAt: Date.now()
          })
        }
        done++
        set({ scanning: { done, total: todo.length, current: f.path, found, failed } })
      }
    }
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker))
    if (cancelRequested) {
      // keep previous results for files we did not get to
      for (const f of queue) result.push(...(byPath.get(f.path) ?? []))
    }
    result.sort((a, b) => a.name.localeCompare(b.name))
    set({ entries: result, scanning: null, lastScan: Date.now() })
    await save(get())
  },

  cancelScan() {
    cancelRequested = true
  },

  addSearchPath(p) {
    if (get().searchPaths.includes(p)) return
    set({ searchPaths: [...get().searchPaths, p] })
    void save(get())
  },
  removeSearchPath(p) {
    set({ searchPaths: get().searchPaths.filter((x) => x !== p) })
    void save(get())
  },
  toggleDefault(p) {
    const d = get().disabledDefaults
    set({ disabledDefaults: d.includes(p) ? d.filter((x) => x !== p) : [...d, p] })
    void save(get())
  },
  toggleFavorite(id) {
    set({ entries: get().entries.map((e) => (e.id === id ? { ...e, favorite: !e.favorite || undefined } : e)) })
    void save(get())
  },
  rename(id, name) {
    set({ entries: get().entries.map((e) => (e.id === id ? { ...e, name } : e)) })
    void save(get())
  },
  setBlacklisted(path, blacklisted) {
    set({
      entries: get().entries.map((e) =>
        e.path !== path ? e : { ...e, status: blacklisted ? 'blacklisted' : e.error ? 'failed' : 'ok', mtime: blacklisted ? e.mtime : 0 }
      )
    })
    void save(get())
  },
  forget(path) {
    set({ entries: get().entries.filter((e) => e.path !== path) })
    void save(get())
  }
}))

function toInfo(e: CatalogEntry): ExternalPluginInfo {
  return { id: e.id, name: e.name, vendor: e.vendor, kind: e.kind, format: e.format as PluginFormat, category: e.category, favorite: !!e.favorite }
}

/**
 * Usable external plugins (status ok), sorted by name. For pickers:
 *   listExternalPlugins('instrument') → channel rack "+" menu / "Replace"
 *   listExternalPlugins('effect')     → mixer slot menu
 * Pass `entry.id` as the pluginId (addInstrumentChannel(id, { name }) / setFxSlot(track, slot, id)).
 */
export function listExternalPlugins(kind?: 'instrument' | 'effect'): ExternalPluginInfo[] {
  return useVstCatalog
    .getState()
    .entries.filter((e) => e.status === 'ok' && (!kind || e.kind === kind))
    .map(toInfo)
}

/** React hook variant of listExternalPlugins (re-renders after scans / favourite changes). */
export function useExternalPlugins(kind?: 'instrument' | 'effect'): ExternalPluginInfo[] {
  const entries = useVstCatalog((s) => s.entries)
  return entries.filter((e) => e.status === 'ok' && (!kind || e.kind === kind)).map(toInfo)
}

/** Catalogue info for a plugin id (name for window titles etc.), or undefined. */
export function getExternalPluginInfo(id: string): ExternalPluginInfo | undefined {
  const e = useVstCatalog.getState().entries.find((x) => x.id === id)
  return e ? toInfo(e) : undefined
}
