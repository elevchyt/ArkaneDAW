// FL Studio's "Plugin manager": search folders, scan (each file in a sandboxed sidecar with a timeout),
// results table with favourites / blacklist. Double-click a plugin to add it (instrument → new channel,
// effect → first free slot of the selected mixer track). Rows can be dragged onto the channel rack.
import { useEffect, useMemo, useState } from 'react'
import { FolderPlus, Play, RefreshCw, Square, Star, X } from 'lucide-react'
import { MdiWindow } from '@/shell/MdiWindow'
import { useUI } from '@/store/ui'
import { getProject } from '@/store/project'
import { addInstrumentChannel, setFxSlot } from '@/store/actions'
import { host } from '@/platform'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { defaultSearchPaths, useVstCatalog, type CatalogEntry } from '@/audio/vst/catalog'
import { nativeStatus, type NativeStatus } from '@/audio/vst/native'
import type { WindowProps } from '../types'

type Filter = 'all' | 'instrument' | 'effect' | 'favorites' | 'problems'

const STATUS_COLOR: Record<CatalogEntry['status'], string> = {
  ok: 'text-fl-green',
  failed: 'text-[#ff8a80]',
  blacklisted: 'text-fl-dim',
  unsupported: 'text-fl-dim'
}

/** Add a catalogue plugin to the project. */
export function addExternalPlugin(e: CatalogEntry): void {
  if (e.status !== 'ok') return
  if (e.kind === 'instrument') {
    addInstrumentChannel(e.id, { name: e.name })
    return
  }
  const track = useUI.getState().selectedMixerTrack ?? 0
  const slots = getProject().mixer[track]?.slots ?? []
  const free = slots.findIndex((s) => !s)
  if (free >= 0) setFxSlot(track, free, e.id)
}

export default function PluginManager({ win, bounds }: WindowProps) {
  const cat = useVstCatalog()
  const setHint = useUI((s) => s.setHint)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [native, setNative] = useState<NativeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const home = host?.os.homedir() ?? '~'
  const defaults = useMemo(() => defaultSearchPaths(home), [home])

  useEffect(() => {
    void nativeStatus().then(setNative)
  }, [])

  const rows = cat.entries.filter((e) => {
    if (filter === 'instrument' && (e.kind !== 'instrument' || e.status !== 'ok')) return false
    if (filter === 'effect' && (e.kind !== 'effect' || e.status !== 'ok')) return false
    if (filter === 'favorites' && !e.favorite) return false
    if (filter === 'problems' && e.status === 'ok') return false
    if (query) {
      const q = query.toLowerCase()
      return [e.name, e.vendor, e.category, e.path, e.format].some((s) => s.toLowerCase().includes(q))
    }
    return true
  })
  const okCount = cat.entries.filter((e) => e.status === 'ok').length
  const problemCount = cat.entries.length - okCount

  const scan = (full: boolean) => {
    setError(null)
    cat.scan({ full }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const addFolder = async () => {
    if (!host) return
    const r = await host.dialog.open({ title: 'Add plugin folder', properties: ['openDirectory', 'multiSelections'] })
    if (!r.canceled) for (const p of r.filePaths) cat.addSearchPath(p)
  }

  const exists = (p: string) => !!host && host.fs.existsSync(p)

  return (
    <MdiWindow win={win} bounds={bounds} minW={560} minH={300}>
      <div className="flex h-full flex-col bg-[#2b3337] text-[11px] text-fl-text">
        {/* toolbar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-[#1d2326] p-1">
          {cat.scanning ? (
            <button className="flex items-center gap-1 rounded-sm bg-[#3a454b] px-2 py-0.5 hover:bg-[#46535a]" onClick={() => cat.cancelScan()}>
              <Square size={11} /> Stop
            </button>
          ) : (
            <>
              <button
                disabled={native?.available === false}
                className="flex items-center gap-1 rounded-sm bg-fl-orange px-2 py-0.5 font-semibold text-[#1b1f22] disabled:opacity-40"
                onClick={() => scan(false)}
                onMouseEnter={() => setHint('Start scan: scan new and changed plugins')}
              >
                <Play size={11} /> Start scan
              </button>
              <button
                disabled={native?.available === false}
                className="flex items-center gap-1 rounded-sm bg-[#3a454b] px-2 py-0.5 hover:bg-[#46535a] disabled:opacity-40"
                onClick={() => scan(true)}
                onMouseEnter={() => setHint('Rescan all plugins (including unchanged and failed ones)')}
              >
                <RefreshCw size={11} /> Rescan all
              </button>
            </>
          )}
          <div className="min-w-0 flex-1 truncate px-2 text-fl-dim">
            {cat.scanning
              ? `Scanning ${cat.scanning.done}/${cat.scanning.total} · found ${cat.scanning.found} · ${cat.scanning.current.split('/').pop()}`
              : error ?? (native && !native.available ? native.reason : `${okCount} plugins${problemCount ? ` · ${problemCount} not loadable` : ''}${cat.lastScan ? ` · last scan ${new Date(cat.lastScan).toLocaleString()}` : ''}`)}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-5 w-40 rounded-sm bg-fl-well px-1.5 outline-none fl-inset"
          />
        </div>
        {cat.scanning && (
          <div className="h-[3px] shrink-0 bg-fl-well">
            <div className="h-full bg-fl-orange transition-all" style={{ width: `${cat.scanning.total ? (cat.scanning.done / cat.scanning.total) * 100 : 0}%` }} />
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* search paths */}
          <div className="flex w-[230px] shrink-0 flex-col border-r border-[#1d2326]">
            <div className="flex items-center justify-between px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-widest text-fl-dim">
              Plugin search paths
              <button className="grid h-5 w-5 place-items-center rounded-sm hover:bg-white/10" title="Add folder…" onClick={() => void addFolder()}>
                <FolderPlus size={12} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-1 pb-1">
              {cat.searchPaths.map((p) => (
                <div key={p} className="group flex items-center gap-1 rounded-sm px-1 py-[1px] hover:bg-white/5" title={p}>
                  <span className="min-w-0 flex-1 truncate text-white">{p.replace(home, '~')}</span>
                  <button className="hidden h-4 w-4 place-items-center group-hover:grid" title="Remove" onClick={() => cat.removeSearchPath(p)}>
                    <X size={11} />
                  </button>
                </div>
              ))}
              {defaults.map((p) => {
                const on = !cat.disabledDefaults.includes(p)
                return (
                  <label key={p} className={cn('flex cursor-pointer items-center gap-1 rounded-sm px-1 py-[1px] hover:bg-white/5', !exists(p) && 'opacity-50')} title={p}>
                    <input type="checkbox" checked={on} onChange={() => cat.toggleDefault(p)} className="accent-[var(--fl-orange)]" />
                    <span className="min-w-0 flex-1 truncate">{p.replace(home, '~')}</span>
                  </label>
                )
              })}
            </div>
            <div className="border-t border-[#1d2326] p-2 text-[10px] leading-snug text-fl-dim">
              Windows plugins: install them with <span className="text-fl-text">yabridge</span> (<code>yabridgectl add … &amp;&amp; yabridgectl sync</code>); they then appear in ~/.vst, ~/.vst3 and ~/.clap and are scanned like native plugins. Every plugin runs in its own process, so a crash never takes ArkaneDAW down.
            </div>
          </div>

          {/* results */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 gap-1 p-1">
              {(
                [
                  ['all', `All (${cat.entries.length})`],
                  ['instrument', 'Generators'],
                  ['effect', 'Effects'],
                  ['favorites', 'Favorites'],
                  ['problems', `Problems (${problemCount})`]
                ] as [Filter, string][]
              ).map(([f, label]) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn('rounded-sm px-2 py-0.5', filter === f ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 bg-[#323c41] text-[10px] uppercase tracking-wider text-fl-dim">
                  <tr>
                    <th className="w-6 px-1 py-1" />
                    <th className="px-1 py-1">Name</th>
                    <th className="px-1 py-1">Vendor</th>
                    <th className="px-1 py-1">Format</th>
                    <th className="px-1 py-1">Type</th>
                    <th className="px-1 py-1">Category</th>
                    <th className="px-1 py-1">Status</th>
                    <th className="px-1 py-1">Path</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <ContextMenu key={e.id}>
                      <ContextMenuTrigger asChild>
                        <tr
                          draggable={e.status === 'ok' && e.kind === 'instrument'}
                          onDragStart={(ev) => ev.dataTransfer.setData('application/x-arkane-plugin', e.id)}
                          onDoubleClick={() => addExternalPlugin(e)}
                          onMouseEnter={() =>
                            setHint(e.status === 'ok' ? `${e.name} – double-click to add ${e.kind === 'instrument' ? 'to the channel rack' : 'to the selected mixer track'}` : `${e.name}: ${e.error ?? e.status}`)
                          }
                          className="border-b border-[#283034] hover:bg-white/5"
                        >
                          <td className="px-1">
                            {e.status === 'ok' && (
                              <button className="grid h-4 w-4 place-items-center" onClick={() => cat.toggleFavorite(e.id)} title="Favorite">
                                <Star size={11} className={e.favorite ? 'fill-fl-orange text-fl-orange' : 'text-fl-dim'} />
                              </button>
                            )}
                          </td>
                          <td className="max-w-[180px] truncate px-1 py-[3px] text-white">{e.name}</td>
                          <td className="max-w-[120px] truncate px-1">{e.vendor}</td>
                          <td className="px-1 uppercase">{e.format}</td>
                          <td className="px-1">{e.status === 'ok' ? (e.kind === 'instrument' ? 'Generator' : 'Effect') : ''}</td>
                          <td className="max-w-[100px] truncate px-1">{e.category}</td>
                          <td className={cn('max-w-[160px] truncate px-1', STATUS_COLOR[e.status])} title={e.error}>
                            {e.status === 'ok' ? 'OK' : e.status === 'failed' ? `Failed: ${e.error ?? ''}` : e.status === 'blacklisted' ? 'Blacklisted' : e.error ?? 'Unsupported'}
                          </td>
                          <td className="max-w-[260px] truncate px-1 text-fl-dim" title={e.path}>
                            {e.path.replace(home, '~')}
                          </td>
                        </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        {e.status === 'ok' && <ContextMenuItem onSelect={() => addExternalPlugin(e)}>{e.kind === 'instrument' ? 'Add to channel rack' : 'Add to selected mixer track'}</ContextMenuItem>}
                        {e.status === 'ok' && <ContextMenuItem onSelect={() => cat.toggleFavorite(e.id)}>{e.favorite ? 'Remove from favorites' : 'Add to favorites'}</ContextMenuItem>}
                        <ContextMenuSeparator />
                        {e.status === 'blacklisted' ? (
                          <ContextMenuItem onSelect={() => cat.setBlacklisted(e.path, false)}>Remove from blacklist (rescan)</ContextMenuItem>
                        ) : (
                          e.status !== 'unsupported' && <ContextMenuItem onSelect={() => cat.setBlacklisted(e.path, true)}>Blacklist (never scan / list)</ContextMenuItem>
                        )}
                        <ContextMenuItem onSelect={() => void navigator.clipboard?.writeText(e.path)}>Copy path</ContextMenuItem>
                        <ContextMenuItem onSelect={() => cat.forget(e.path)}>Forget</ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <div className="p-4 text-center text-fl-dim">
                  {cat.entries.length === 0 ? 'No plugins catalogued yet — press “Start scan”.' : 'No plugins match.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MdiWindow>
  )
}
