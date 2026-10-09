// Fallback editor shown inside the FL-style plugin wrapper window for bridged plugins: status, "Show editor"
// (opens the plugin's own GUI in a separate X11 window), reload after a crash, and generic parameter sliders.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { AppWindow, RotateCcw, Search } from 'lucide-react'
import type { PluginHostNode } from '../plugin-node'
import { initAudio } from '../transport'
import { VstHostNode, type VstSnapshot } from './host-node'
import type { VstParamInfo } from './sidecar'
import { parsePluginId } from './ids'
import { getExternalPluginInfo } from './catalog'

export interface ExternalEditorProps {
  pluginId: string
  /** project param values (normalized 0..1) */
  params: Record<string, number>
  /** the live host node (null until audio is initialised) */
  getNode: () => PluginHostNode | null
  /** write a param into the project (undoable, automatable) */
  setParam: (id: string, value: number) => void
  hint?: (text: string) => void
}

const EMPTY: VstSnapshot = { status: 'loading', info: null, values: {}, editorOpen: false, latencyMs: 0, xruns: 0 }
const MAX_ROWS = 300

function useVstNode(getNode: () => PluginHostNode | null): VstHostNode | null {
  const [node, setNode] = useState<VstHostNode | null>(null)
  useEffect(() => {
    let cancelled = false
    const pick = (): void => {
      const n = getNode()
      if (!cancelled) setNode(n instanceof VstHostNode ? n : null)
    }
    void initAudio().then(pick)
    // the engine may rebuild the node (plugin replaced, project loaded): re-check periodically
    const t = setInterval(pick, 1000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [getNode])
  return node
}

function useSnapshot(node: VstHostNode | null): VstSnapshot {
  const subscribe = useMemo(() => (cb: () => void) => (node ? node.subscribe(cb) : () => {}), [node])
  return useSyncExternalStore(subscribe, () => (node ? node.cachedSnapshot() : EMPTY))
}

export function VstEditorPanel({ pluginId, params, getNode, setParam, hint }: ExternalEditorProps) {
  const node = useVstNode(getNode)
  const snap = useSnapshot(node)
  const [filter, setFilter] = useState('')
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [plist, setPlist] = useState<VstParamInfo[] | null>(null)
  const ref = parsePluginId(pluginId)
  const cat = getExternalPluginInfo(pluginId)
  const info = snap.info
  const name = info?.name ?? cat?.name ?? ref?.path.split('/').pop() ?? pluginId

  // full param list with display texts once running
  useEffect(() => {
    if (!node || snap.status !== 'running') return
    let cancelled = false
    void node.params().then(
      (ps) => {
        if (cancelled) return
        setPlist(ps)
        setTexts(Object.fromEntries(ps.map((p) => [String(p.id), p.text ?? ''])))
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [node, snap.status, info?.params.length])

  // refresh display texts for values changed from the plugin GUI
  const values = snap.values
  useEffect(() => {
    if (!node || snap.status !== 'running') return
    const t = setTimeout(() => {
      void Promise.all(
        Object.entries(values).slice(0, 64).map(async ([id, v]) => [id, await node.paramText(Number(id), v).catch(() => '')] as const)
      ).then((pairs) => setTexts((old) => ({ ...old, ...Object.fromEntries(pairs) })))
    }, 120)
    return () => clearTimeout(t)
  }, [node, values, snap.status])

  const visible = (plist ?? info?.params ?? []).filter((p) => !p.hidden && (!filter || p.name.toLowerCase().includes(filter.toLowerCase())))
  const status = snap.status
  const led = status === 'running' ? '#7ed957' : status === 'loading' ? '#f2b84b' : '#e5534b'

  return (
    <div className="flex h-full flex-col bg-[#2b3337] text-[11px] text-fl-text">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1d2326] px-2 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: led }} title={status} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-white">{name}</div>
          <div className="truncate text-[10px] text-fl-dim">
            {[info?.vendor ?? cat?.vendor, (info?.format ?? ref?.format)?.toUpperCase(), info?.kind ?? cat?.kind].filter(Boolean).join(' · ')}
            {status === 'running' && ` · latency ${snap.latencyMs.toFixed(1)} ms${snap.xruns ? ` · ${snap.xruns} dropouts` : ''}`}
          </div>
        </div>
        {(status === 'crashed' || status === 'error') && (
          <button
            className="flex items-center gap-1 rounded-sm bg-[#3a454b] px-2 py-1 hover:bg-[#46535a]"
            onClick={() => node?.post({ type: 'restart' })}
            onMouseEnter={() => hint?.('Restart the plugin process (restores the last saved state)')}
          >
            <RotateCcw size={12} /> Reload
          </button>
        )}
        <button
          disabled={status !== 'running' || info?.hasEditor === false}
          className="flex items-center gap-1 rounded-sm bg-fl-orange px-2 py-1 font-semibold text-[#1b1f22] disabled:opacity-40"
          onClick={() => node?.post({ type: snap.editorOpen ? 'hideEditor' : 'showEditor' })}
          onMouseEnter={() => hint?.('Open the plugin’s own editor in a separate window')}
        >
          <AppWindow size={12} /> {snap.editorOpen ? 'Hide editor' : 'Show editor'}
        </button>
      </div>

      {status !== 'running' && (
        <div className={status === 'loading' ? 'px-3 py-2 text-fl-dim' : 'px-3 py-2 text-[#ff8a80]'}>
          {status === 'loading' && 'Starting plugin…'}
          {status === 'crashed' && `Plugin crashed: ${snap.message ?? 'process exited'}. Audio from this plugin is muted.`}
          {status === 'error' && `Could not load plugin: ${snap.message ?? ''}`}
          {status === 'unavailable' && (snap.message ?? 'Plugin hosting unavailable')}
          {!node && status === 'loading' && ''}
        </div>
      )}
      {status === 'running' && snap.message && <div className="px-3 py-1 text-[#ffb27a]">{snap.message}</div>}

      <div className="flex shrink-0 items-center gap-1 px-2 py-1">
        <Search size={11} className="text-fl-dim" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`${visible.length} parameters`}
          className="h-5 min-w-0 flex-1 rounded-sm bg-fl-well px-1.5 text-[11px] outline-none fl-inset"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
        {visible.slice(0, MAX_ROWS).map((p) => {
          const id = String(p.id)
          const v = snap.values[id] ?? params[id] ?? p.default
          return (
            <div key={id} className="flex items-center gap-2 py-[2px]" onMouseEnter={() => hint?.(`${p.name}: ${texts[id] ?? v.toFixed(3)}`)}>
              <span className="w-[38%] truncate text-fl-dim" title={p.name}>
                {p.name}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={p.steps ? 1 / p.steps : 0.001}
                value={v}
                disabled={p.readonly}
                className="h-1 min-w-0 flex-1 accent-[var(--fl-orange)]"
                onChange={(e) => {
                  const nv = Number(e.target.value)
                  setParam(id, nv)
                  hint?.(`${p.name}: ${texts[id] ?? nv.toFixed(3)}`)
                }}
                onDoubleClick={() => setParam(id, p.default)}
              />
              <span className="w-[22%] truncate text-right tabular-nums text-[#cfe9b8]">{texts[id] ?? v.toFixed(2)}</span>
            </div>
          )
        })}
        {visible.length > MAX_ROWS && <div className="py-1 text-fl-dim">… {visible.length - MAX_ROWS} more — type to filter</div>}
      </div>
    </div>
  )
}
