import { useState } from 'react'
import { MdiWindow } from './MdiWindow'
import { groupPlugins, useAllPlugins } from '@/plugins/catalog'
import { useUI } from '@/store/ui'
import { addInstrumentChannel } from '@/store/actions'
import { guardPack } from '@/packs/guard'
import { PackBadge } from '@/packs/PackBadge'
import type { WindowProps } from '@/windows/types'
import { cn } from '@/lib/utils'

export function togglePluginPicker(): void {
  useUI.getState().toggleWindow('pluginPicker', { kind: 'pluginPicker', title: 'Plugin picker', w: 720, h: 420, x: 200, y: 80 })
}

/** F8: all plugins as tiles; drag instruments to the channel rack, effects onto mixer slots. */
export default function PluginPicker({ win, bounds }: WindowProps) {
  const [tab, setTab] = useState<'instrument' | 'effect'>('instrument')
  const groups = groupPlugins(useAllPlugins(tab))
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
          {groups.map(([c, list]) => (
            <div key={c} className="mb-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-fl-dim underline underline-offset-2">{c}</div>
              <div className="flex flex-wrap gap-2">
                {list.map((m) => (
                  <div
                    key={m.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/x-arkane-plugin', m.id)}
                    onDoubleClick={() => tab === 'instrument' && guardPack(m.id, () => addInstrumentChannel(m.id))}
                    onMouseEnter={() => setHint(`${m.name} – ${m.description ?? ''}`)}
                    className="flex h-[64px] w-[104px] cursor-grab flex-col justify-end rounded-[4px] border border-[#1d2326] p-1.5 fl-bevel"
                    style={{ background: `linear-gradient(160deg, ${m.color ?? (m.external ? '#8a7a5c' : '#5c676d')}55, #2f383c 70%)` }}
                  >
                    {m.external && <span className="mb-auto self-end text-[8px] font-bold text-fl-orange">{m.category.split(' ')[0]}</span>}
                    {m.pack && <PackBadge packId={m.pack.id} className="mb-auto ml-0 self-end pl-0" />}
                    <span className="text-[11px] font-semibold leading-tight text-white">{m.name}</span>
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
