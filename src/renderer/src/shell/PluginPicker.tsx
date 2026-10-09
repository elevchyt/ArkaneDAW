import { useState } from 'react'
import { MdiWindow } from './MdiWindow'
import { listPlugins } from '@/plugins/registry'
import { useUI } from '@/store/ui'
import { addInstrumentChannel } from '@/store/actions'
import type { WindowProps } from '@/windows/types'
import { cn } from '@/lib/utils'

export function togglePluginPicker(): void {
  useUI.getState().toggleWindow('pluginPicker', { kind: 'pluginPicker', title: 'Plugin picker', w: 720, h: 420, x: 200, y: 80 })
}

/** F8: all plugins as tiles; drag instruments to the channel rack, effects onto mixer slots. */
export default function PluginPicker({ win, bounds }: WindowProps) {
  const [tab, setTab] = useState<'instrument' | 'effect'>('instrument')
  const list = listPlugins(tab)
  const cats = [...new Set(list.map((m) => m.manifest.category))].sort()
  const setHint = useUI((s) => s.setHint)
  return (
    <MdiWindow win={win} bounds={bounds}>
      <div className="flex h-full flex-col bg-[#2b3337]">
        <div className="flex gap-1 border-b border-[#1d2326] p-1">
          {(['instrument', 'effect'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn('rounded-sm px-2 py-0.5 text-[11px]', tab === t ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text')}>
              {t === 'instrument' ? 'Generators' : 'Effects'}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {cats.map((c) => (
            <div key={c} className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-widest text-fl-dim">{c}</div>
              <div className="flex flex-wrap gap-2">
                {list
                  .filter((m) => m.manifest.category === c)
                  .map((m) => (
                    <div
                      key={m.manifest.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('application/x-arkane-plugin', m.manifest.id)}
                      onDoubleClick={() => tab === 'instrument' && addInstrumentChannel(m.manifest.id)}
                      onMouseEnter={() => setHint(`${m.manifest.name} – ${m.manifest.description ?? ''}`)}
                      className="flex h-[64px] w-[104px] cursor-grab flex-col justify-end rounded-[4px] border border-[#1d2326] p-1.5 fl-bevel"
                      style={{ background: `linear-gradient(160deg, ${m.manifest.color ?? '#5c676d'}55, #2f383c 70%)` }}
                    >
                      <span className="text-[11px] font-semibold leading-tight text-white">{m.manifest.name}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </MdiWindow>
  )
}
