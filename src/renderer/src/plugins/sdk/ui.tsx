// Shared building blocks for plugin editors so every built-in plugin looks like part of one family
// (the way FL's "Fruity" plugins do): dark rounded panel, small caps labels, colored knob arcs.
import { cn } from '@/lib/utils'
import { ParamKnob } from '@/components/controls'
import type { ParamDef, PluginManifest } from './types'
import type { PluginEditorProps } from './module'
import { formatParam } from './params'

export function PluginPanel({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn('h-full w-full bg-gradient-to-b from-[#3b464c] to-[#2c3438] p-2 text-fl-text', className)} style={style}>
      {children}
    </div>
  )
}

export function Section({ title, children, className, accent }: { title?: string; children: React.ReactNode; className?: string; accent?: string }) {
  return (
    <div className={cn('rounded-[4px] border border-[#1d2326] bg-[#2a3236]/80 p-2 fl-bevel', className)}>
      {title && (
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fl-dim">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: accent ?? 'var(--fl-orange)' }} />
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

/** Knob bound to one manifest param by id. */
export function PK({ p, id, size = 36, color, label }: { p: PluginEditorProps; id: string; size?: number; color?: string; label?: string }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def) return <div className="text-fl-red text-[10px]">?{id}</div>
  return <ParamKnob def={def} value={p.instance.params[id] ?? def.default} onChange={(v) => p.setParam(id, v)} size={size} color={color} label={label} />
}

/** Segmented selector for enumerated params (waveforms, modes). */
export function PSelect({ p, id, className, vertical }: { p: PluginEditorProps; id: string; className?: string; vertical?: boolean }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def?.options) return null
  const v = Math.round(p.instance.params[id] ?? def.default)
  return (
    <div className={cn('flex flex-col gap-0.5', className)} onMouseEnter={() => p.hint(`${def.name}: ${def.options![v]}`)}>
      <span className="text-[10px] uppercase tracking-wide text-fl-dim">{def.name}</span>
      <div className={cn('flex gap-px rounded-[3px] bg-[#1a1f22] p-px', vertical && 'flex-col')}>
        {def.options.map((o, i) => (
          <button
            key={o}
            onClick={() => p.setParam(id, i)}
            className={cn('px-1.5 py-0.5 text-[10px] rounded-[2px] whitespace-nowrap', i === v ? 'bg-fl-orange text-[#1b1f22] font-semibold' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

/** On/off toggle for 0/1 params. */
export function PToggle({ p, id, label }: { p: PluginEditorProps; id: string; label?: string }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def) return null
  const on = (p.instance.params[id] ?? def.default) >= 0.5
  return (
    <button
      onClick={() => p.setParam(id, on ? 0 : 1)}
      onMouseEnter={() => p.hint(`${def.name}: ${on ? 'On' : 'Off'}`)}
      className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fl-dim"
    >
      <span className="h-2.5 w-2.5 rounded-full border border-[#141819]" style={{ background: on ? 'var(--fl-green)' : 'var(--fl-led-off)', boxShadow: on ? '0 0 5px var(--fl-green)' : undefined }} />
      {label ?? def.name}
    </button>
  )
}

/** Small LCD-style readout. */
export function Readout({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('fl-lcd px-1.5 py-0.5 text-[11px] text-[#9fe870]', className)}>{children}</div>
}

/** Fallback editor: one knob (or selector) per visible param, grouped by id prefix "group.name". */
export function GenericEditor(p: PluginEditorProps) {
  const groups = new Map<string, ParamDef[]>()
  for (const def of p.manifest.params) {
    if (def.hidden) continue
    const g = def.id.includes('.') ? def.id.split('.')[0] : ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(def)
  }
  return (
    <PluginPanel className="flex flex-wrap content-start gap-2 overflow-auto">
      {[...groups].map(([g, defs]) => (
        <Section key={g || '_'} title={g || p.manifest.name} accent={p.manifest.color}>
          <div className="flex flex-wrap gap-3">
            {defs.map((d) =>
              d.options ? (
                <PSelect key={d.id} p={p} id={d.id} />
              ) : (
                <PK key={d.id} p={p} id={d.id} color={p.manifest.color} />
              )
            )}
          </div>
        </Section>
      ))}
    </PluginPanel>
  )
}

export function paramText(manifest: PluginManifest, id: string, v: number): string {
  const def = manifest.params.find((x) => x.id === id)
  return def ? formatParam(def, v) : String(v)
}
