// Mosaic editor — Montage-inspired Performance view in the FL plugin style:
// browser (category tabs + search) · LCD + Super Knob + quick edits · 4 Part strips ·
// Part detail (engine / amp & filter / LFO & play / Super Knob assign) · FX row · mini keyboard.
import { useMemo, useRef, useState } from 'react'
import { Search, X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Knob, ParamKnob, useVerticalDrag } from '@/components/controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { PluginEditorProps } from '../sdk/module'
import type { ParamDef, Preset } from '../sdk/types'
import { PK, PSelect, PToggle, useHeldKeys } from '../sdk/ui'
import { formatParam } from '../sdk/params'
import {
  DRAWBARS,
  ENGINES,
  ENGINE_PARAMS,
  NUM_PARTS,
  PART_PARAMS,
  SUPER_DESTS,
  VOWELS,
  engineDefaultParams,
  midiName,
  normalizeData,
  resolvePart,
  type EngineId,
  type PartDef,
  type SuperAssign,
  type WSData
} from './model'
import { CATEGORIES } from './presets'

const GOLD = '#e8c872'
const CAT_SHORT: Record<string, string> = {
  Piano: 'Piano', Keyboard: 'Keys', Organ: 'Organ', 'Synth Lead': 'Lead', 'Synth Pad': 'Pad', 'Synth Comp': 'Comp', Strings: 'Strings',
  Brass: 'Brass', Woodwind: 'Wind', Choir: 'Choir', 'Guitar/Plucked': 'Guitar', Bass: 'Bass', 'Chromatic Perc': 'Chrom', Bells: 'Bells', 'Split/Layer': 'Split'
}
const engineInfo = (e: EngineId) => ENGINES.find((x) => x.id === e) ?? ENGINES[0]
const commonDef = (id: string) => PART_PARAMS.find((d) => d.id === id)!

type Tab = 'engine' | 'ampflt' | 'lfo' | 'super'

const SHORT: Record<string, string> = {
  'Hammer Noise': 'Knock', 'Damper Noise': 'Damper', Soundboard: 'Board', 'Strike Pos': 'Strike', 'Pluck Pos': 'Pos', 'Pitch Drop': 'Drop',
  'Bow Noise': 'Bow', 'Osc2 Mix': 'Osc2', 'Osc2 Semi': 'Semi', 'Osc2 Fine': 'Fine', 'Sub Osc': 'Sub', 'Pulse W': 'PW', Brightness: 'Bright',
  Ensemble: 'Ens', 'Motor Rate': 'M.Rate', 'Mod Rate': 'Rate', 'Mod Depth': 'Depth', 'Key Click': 'Click', Overdrive: 'Drive', 'Horn/Drum': 'Horn',
  Leakage: 'Leak', 'F.Attack': 'F.Atk', 'F.Decay': 'F.Dec', 'F.Sustain': 'F.Sus', 'F.Release': 'F.Rel', 'LFO Rate': 'Rate', 'LFO Delay': 'Delay',
  'LFO>Cut': 'LFO>F', Portamento: 'Porta', Transpose: 'Trans', 'Vel Sens': 'VelSens', 'Env Amt': 'Env', 'Key Trk': 'KeyTrk', 'Vel>Cut': 'Vel>F',
  Feedback: 'FB', 'Pre-Delay': 'Pre', Damping: 'Damp', 'Mid Freq': 'Freq', Resonance: 'Reso', Volume: 'Volume', 'Op6 Feedback': 'FB'
}
const short = (name: string) => SHORT[name] ?? name

/** Fixed-width slot so knob labels never collide. */
function Cell({ w, children }: { w: number; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 justify-center overflow-hidden" style={{ width: w }}>
      {children}
    </div>
  )
}

export function MosaicEditor(p: PluginEditorProps) {
  const data = useMemo(() => normalizeData(p.instance.data), [p.instance.data])
  const [sel, setSel] = useState(0)
  const [tab, setTab] = useState<Tab>('engine')
  const setDataWith = (fn: (d: WSData) => WSData) => p.setData(fn(data))
  const setPart = (i: number, patch: Partial<PartDef>) =>
    setDataWith((d) => ({ ...d, parts: d.parts.map((pt, k) => (k === i ? { ...pt, ...patch } : pt)) }))
  const setPartParam = (i: number, id: string, v: number) =>
    setDataWith((d) => ({ ...d, parts: d.parts.map((pt, k) => (k === i ? { ...pt, p: { ...pt.p, [id]: v } } : pt)) }))
  const setPartParams = (i: number, vals: Record<string, number>) =>
    setDataWith((d) => ({ ...d, parts: d.parts.map((pt, k) => (k === i ? { ...pt, p: { ...pt.p, ...vals } } : pt)) }))
  const changeEngine = (i: number, engine: EngineId) => {
    const pt = data.parts[i]
    const keep: Record<string, number> = {}
    for (const d of PART_PARAMS) if (d.id in pt.p) keep[d.id] = pt.p[d.id]
    setPart(i, { engine, on: true, p: { ...keep, ...engineDefaultParams(engine) } })
  }

  return (
    <div
      className="flex h-full w-full flex-col gap-1.5 p-1.5 text-fl-text"
      style={{ background: 'radial-gradient(120% 90% at 50% 0%, #3d484e 0%, #2b3337 55%, #232a2e 100%)' }}
    >
      <div className="flex min-h-0 flex-1 gap-1.5">
        <Browser p={p} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Header p={p} data={data} tab={tab} setTab={setTab} />
          <div className="grid h-[64px] shrink-0 grid-cols-4 gap-1.5">
            {data.parts.map((pt, i) => (
              <PartStrip
                key={i}
                p={p}
                index={i}
                part={pt}
                selected={sel === i}
                onSelect={() => {
                  setSel(i)
                  if (tab === 'super') setTab('engine')
                }}
                onToggle={() => setPart(i, { on: !pt.on })}
                onEngine={(e) => changeEngine(i, e)}
                onParam={(id, v) => setPartParam(i, id, v)}
              />
            ))}
          </div>
          <Detail
            p={p}
            data={data}
            sel={sel}
            tab={tab}
            setTab={setTab}
            onParam={(id, v) => setPartParam(sel, id, v)}
            onParams={(vals) => setPartParams(sel, vals)}
            onSuper={(sk) => setDataWith((d) => ({ ...d, superKnob: sk }))}
          />
          <FXRow p={p} />
        </div>
      </div>
      <MiniKeyboard p={p} data={data} sel={sel} />
    </div>
  )
}

// ─── Browser ─────────────────────────────────────────────────────────────────
function Browser({ p }: { p: PluginEditorProps }) {
  const presets = p.manifest.presets ?? []
  const [cat, setCat] = useState<string>(() => presets.find((x) => x.name === p.instance.presetName)?.category ?? 'All')
  const [q, setQ] = useState('')
  const list = presets.filter(
    (x) => (cat === 'All' || x.category === cat) && (!q || `${x.name} ${x.category}`.toLowerCase().includes(q.toLowerCase()))
  )
  return (
    <div className="flex w-[186px] shrink-0 flex-col gap-1 rounded-[4px] border border-[#1d2326] bg-[#262d31] p-1.5 fl-bevel">
      <div className="flex items-center gap-1 rounded-[3px] bg-fl-well px-1.5 py-0.5 fl-inset">
        <Search size={11} className="text-fl-dim" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Search performances"
          className="w-full bg-transparent text-[11px] text-fl-text outline-none placeholder:text-fl-dim"
        />
        {q && <X size={11} className="cursor-pointer text-fl-dim" onClick={() => setQ('')} />}
      </div>
      <div className="grid grid-cols-4 gap-px">
        {['All', ...CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            onMouseEnter={() => p.hint(`Category: ${c}`)}
            className={cn(
              'truncate rounded-[2px] px-0.5 py-[2px] text-[9.5px] font-semibold uppercase tracking-wide',
              cat === c ? 'text-[#1b1f22]' : 'bg-[#343d42] text-fl-dim hover:bg-[#3f4a50] hover:text-fl-text'
            )}
            style={cat === c ? { background: GOLD } : undefined}
          >
            {c === 'All' ? 'All' : CAT_SHORT[c]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[3px] bg-fl-well fl-inset">
        {list.map((x) => (
          <PresetRow key={x.name} p={p} preset={x} active={x.name === p.instance.presetName} showCat={cat === 'All' || !!q} />
        ))}
        {list.length === 0 && <div className="p-2 text-[10px] text-fl-dim">No matches</div>}
      </div>
      <div className="text-center text-[9.5px] text-fl-dim">{list.length} / {presets.length} performances</div>
    </div>
  )
}

function PresetRow({ p, preset, active, showCat }: { p: PluginEditorProps; preset: Preset; active: boolean; showCat: boolean }) {
  const d = preset.data as WSData | undefined
  const engines = (d?.parts ?? []).filter((x) => x.on).map((x) => x.engine)
  return (
    <button
      onClick={() => p.loadPreset(preset)}
      onMouseEnter={() => p.hint(`${preset.category}: ${preset.name}`)}
      className={cn('flex w-full items-center gap-1 px-1.5 py-[3px] text-left text-[11px]', active ? 'bg-[#4a3f22] text-[#ffe7a6]' : 'hover:bg-white/5')}
    >
      <span className="min-w-0 flex-1 truncate">{preset.name}</span>
      {showCat && <span className="shrink-0 text-[9px] text-fl-dim">{CAT_SHORT[preset.category ?? ''] ?? ''}</span>}
      <span className="flex shrink-0 gap-[2px]">
        {engines.map((e, i) => (
          <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: engineInfo(e).color }} />
        ))}
      </span>
    </button>
  )
}

// ─── Header: LCD + Super Knob + quick edits ──────────────────────────────────
function Header({ p, data, tab, setTab }: { p: PluginEditorProps; data: WSData; tab: Tab; setTab: (t: Tab) => void }) {
  const preset = (p.manifest.presets ?? []).find((x) => x.name === p.instance.presetName)
  const superDef = p.manifest.params.find((d) => d.id === 'super')!
  const sv = p.instance.params.super ?? 0
  return (
    <div className="flex h-[100px] shrink-0 items-stretch gap-1.5">
      <div className="flex w-[214px] shrink-0 flex-col justify-between rounded-[4px] border border-[#11161a] p-2" style={{ background: 'linear-gradient(180deg,#0e1418,#151d22)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.7)' }}>
        <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.18em] text-[#7fb6c9]">
          <span>{preset?.category ?? 'Performance'}</span>
          <span className="text-[#56717c]">MOSAIC</span>
        </div>
        <div className="truncate font-mono text-[17px] leading-tight text-[#e9f6ff]" style={{ textShadow: '0 0 8px rgba(140,210,255,.35)' }}>
          {p.instance.presetName ?? 'Init Performance'}
        </div>
        <div className="flex gap-1">
          {data.parts.map((pt, i) => (
            <span
              key={i}
              className="flex-1 truncate rounded-[2px] px-1 text-center font-mono text-[8.5px] leading-[13px]"
              style={{ background: pt.on ? engineInfo(pt.engine).color + '33' : '#ffffff08', color: pt.on ? engineInfo(pt.engine).color : '#4b5a61' }}
            >
              {i + 1} {pt.on ? engineInfo(pt.engine).short : '—'}
            </span>
          ))}
        </div>
      </div>
      <div className="relative flex w-[150px] shrink-0 items-center gap-2 rounded-[4px] border border-[#1d2326] bg-[#2a3236]/80 px-2 fl-bevel">
        <div className="relative grid place-items-center">
          <div
            className="pointer-events-none absolute rounded-full"
            style={{ width: 88, height: 88, background: `conic-gradient(from 225deg, ${GOLD} ${sv * 270}deg, transparent 0)`, opacity: 0.18, filter: 'blur(3px)' }}
          />
          <ParamKnob def={superDef} value={sv} onChange={(v) => p.setParam('super', v)} size={78} color={GOLD} label="" />
        </div>
        <div className="flex flex-col items-start gap-1">
          <span className="text-[9.5px] font-semibold uppercase leading-tight tracking-[0.14em] text-[#e8c872]">Super<br />Knob</span>
          <span className="font-mono text-[12px] text-fl-text">{Math.round(sv * 100)}%</span>
          <button
            onClick={() => setTab(tab === 'super' ? 'engine' : 'super')}
            onMouseEnter={() => p.hint(`Super Knob: ${data.superKnob.length} assignment(s) — click to edit`)}
            className={cn('rounded-[2px] px-1.5 py-[1px] text-[9px] font-semibold uppercase', tab === 'super' ? 'text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}
            style={tab === 'super' ? { background: GOLD } : undefined}
          >
            Assign
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-around rounded-[4px] border border-[#1d2326] bg-[#2a3236]/80 px-1 fl-bevel">
        {(['q.cutoff', 'q.reso', 'q.attack', 'q.release'] as const).map((id) => (
          <Cell key={id} w={46}>
            <PK p={p} id={id} size={32} color={GOLD} label={short(p.manifest.params.find((d) => d.id === id)!.name)} />
          </Cell>
        ))}
        <Cell w={46}>
          <PK p={p} id="master" size={32} color="#9fe870" />
        </Cell>
        <PSelect p={p} id="rotary" vertical />
      </div>
    </div>
  )
}

// ─── Part strips ─────────────────────────────────────────────────────────────
function PartStrip(props: {
  p: PluginEditorProps
  index: number
  part: PartDef
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onEngine: (e: EngineId) => void
  onParam: (id: string, v: number) => void
}) {
  const { p, index, part, selected } = props
  const eng = engineInfo(part.engine)
  const r = resolvePart(part)
  return (
    <div
      onMouseDown={props.onSelect}
      className={cn('flex cursor-pointer flex-col gap-1 rounded-[4px] border px-1.5 py-1 fl-bevel', selected ? 'bg-[#323c41]' : 'bg-[#283034] hover:bg-[#2d363a]', !part.on && 'opacity-60')}
      style={{ borderColor: selected ? eng.color : '#1d2326', boxShadow: selected ? `0 0 0 1px ${eng.color}55, inset 0 1px 0 rgba(255,255,255,.07)` : undefined }}
    >
      <div className="flex items-center gap-1">
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={props.onToggle}
          onMouseEnter={() => p.hint(`Part ${index + 1}: ${part.on ? 'On' : 'Off'}`)}
          className="h-2.5 w-2.5 shrink-0 rounded-full border border-[#141819]"
          style={{ background: part.on ? eng.color : 'var(--fl-led-off)', boxShadow: part.on ? `0 0 5px ${eng.color}` : undefined }}
        />
        <span className="text-[9.5px] font-bold text-fl-dim">P{index + 1}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            onMouseDown={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 truncate rounded-[2px] px-1 text-left text-[10px] font-semibold uppercase tracking-wide"
            style={{ background: eng.color + '26', color: eng.color }}
          >
            {eng.short}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Part {index + 1} engine</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ENGINES.map((e) => (
              <DropdownMenuItem key={e.id} onSelect={() => props.onEngine(e.id)}>
                <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: e.color }} />
                {e.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center justify-between gap-1">
        <ParamKnob def={commonDef('level')} value={r.level} onChange={(v) => props.onParam('level', v)} size={22} color={eng.color} label="" />
        <ParamKnob def={commonDef('pan')} value={r.pan} onChange={(v) => props.onParam('pan', v)} size={22} color={eng.color} label="" />
        <div className="flex flex-col items-center leading-none">
          <div className="flex items-center gap-0.5 font-mono text-[10px]">
            <DragNum p={p} value={r.keyLo} min={0} max={127} label="Key low" fmt={midiName} onChange={(v) => props.onParam('keyLo', Math.min(v, r.keyHi))} />
            <span className="text-fl-dim">–</span>
            <DragNum p={p} value={r.keyHi} min={0} max={127} label="Key high" fmt={midiName} onChange={(v) => props.onParam('keyHi', Math.max(v, r.keyLo))} />
          </div>
          <span className="text-[8.5px] uppercase tracking-wide text-fl-dim">
            {r.transpose ? `${r.transpose > 0 ? '+' : ''}${r.transpose} st` : 'key range'}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Vertical-drag number field. */
function DragNum({ p, value, min, max, onChange, fmt, label }: { p: PluginEditorProps; value: number; min: number; max: number; onChange: (v: number) => void; fmt?: (v: number) => string; label: string }) {
  const acc = useRef(value)
  const drag = useVerticalDrag(
    (d) => {
      acc.current = Math.min(max, Math.max(min, acc.current + d * (max - min) * 0.6))
      const v = Math.round(acc.current)
      if (v !== value) onChange(v)
      p.hint(`${label}: ${fmt ? fmt(v) : v}`)
    },
    200
  )
  return (
    <span
      {...drag}
      onMouseDownCapture={(e) => e.stopPropagation()}
      onPointerDownCapture={() => (acc.current = value)}
      onMouseEnter={() => p.hint(`${label}: ${fmt ? fmt(value) : value} (drag)`)}
      className="cursor-ns-resize rounded-[2px] bg-fl-well px-1 text-[#cfe9b8] fl-inset"
    >
      {fmt ? fmt(value) : value}
    </span>
  )
}

// ─── Detail panel ────────────────────────────────────────────────────────────
function Detail(props: {
  p: PluginEditorProps
  data: WSData
  sel: number
  tab: Tab
  setTab: (t: Tab) => void
  onParam: (id: string, v: number) => void
  onParams: (v: Record<string, number>) => void
  onSuper: (sk: SuperAssign[]) => void
}) {
  const { p, data, sel, tab } = props
  const part = data.parts[sel]
  const eng = engineInfo(part.engine)
  const r = resolvePart(part)
  const tabs: [Tab, string][] = [
    ['engine', eng.short],
    ['ampflt', part.engine === 'organ' ? 'Amp/Filter (n/a)' : 'Amp & Filter'],
    ['lfo', 'LFO & Play'],
    ['super', 'Super Knob']
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[4px] border border-[#1d2326] bg-[#2a3236]/80 fl-bevel">
      <div className="flex h-[20px] shrink-0 items-center gap-px border-b border-[#1d2326] px-1">
        <span className="mr-1 text-[9.5px] font-bold uppercase tracking-[0.12em]" style={{ color: eng.color }}>
          Part {sel + 1}
        </span>
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => props.setTab(t)}
            className={cn('rounded-t-[3px] px-2 py-[2px] text-[9.5px] font-semibold uppercase tracking-wide', tab === t ? 'bg-[#3a454b] text-fl-text' : 'text-fl-dim hover:text-fl-text')}
            style={tab === t ? { boxShadow: `inset 0 2px 0 ${t === 'super' ? GOLD : eng.color}` } : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-1.5">
        {tab === 'engine' && <EnginePanel p={p} part={part} r={r} onParam={props.onParam} onParams={props.onParams} />}
        {tab === 'ampflt' && <AmpFilterPanel p={p} part={part} r={r} onParam={props.onParam} />}
        {tab === 'lfo' && <LfoPlayPanel p={p} part={part} r={r} onParam={props.onParam} />}
        {tab === 'super' && <SuperPanel p={p} data={data} onSuper={props.onSuper} />}
      </div>
    </div>
  )
}

type PanelProps = { p: PluginEditorProps; part: PartDef; r: Record<string, number>; onParam: (id: string, v: number) => void }

function Kn({ def, r, onParam, color, size = 32, label }: { def: ParamDef; r: Record<string, number>; onParam: (id: string, v: number) => void; color: string; size?: number; label?: string }) {
  return (
    <Cell w={Math.max(size + 14, 46)}>
      <ParamKnob def={def} value={r[def.id] ?? def.default} onChange={(v) => onParam(def.id, v)} size={size} color={color} label={label ?? short(def.name)} />
    </Cell>
  )
}

function Seg({ p, def, value, onChange, color, vertical }: { p: PluginEditorProps; def: ParamDef; value: number; onChange: (v: number) => void; color: string; vertical?: boolean }) {
  const v = Math.round(value)
  return (
    <div className="flex flex-col gap-0.5" onMouseEnter={() => p.hint(`${def.name}: ${def.options?.[v]}`)}>
      <span className="text-[9.5px] uppercase tracking-wide text-fl-dim">{def.name}</span>
      <div className={cn('flex flex-wrap gap-px rounded-[3px] bg-[#1a1f22] p-px', vertical && 'flex-col')}>
        {def.options!.map((o, i) => (
          <button
            key={o}
            onClick={() => onChange(i)}
            className={cn('whitespace-nowrap rounded-[2px] px-1.5 py-[1px] text-[9.5px]', i === v ? 'font-semibold text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}
            style={i === v ? { background: color } : undefined}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

function EnginePanel({ p, part, r, onParam, onParams }: PanelProps & { onParams: (v: Record<string, number>) => void }) {
  const color = engineInfo(part.engine).color
  const defs = ENGINE_PARAMS[part.engine]
  if (part.engine === 'organ') return <OrganPanel p={p} r={r} onParam={onParam} onParams={onParams} color={color} />
  if (part.engine === 'fm') return <FMPanel p={p} r={r} onParam={onParam} color={color} />
  const sel = defs.filter((d) => d.options)
  const knobs = defs.filter((d) => !d.options)
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {sel.map((d) => (
          <Seg key={d.id} p={p} def={d} value={r[d.id]} onChange={(v) => onParam(d.id, v)} color={color} />
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-x-1.5 gap-y-2">
        {knobs.map((d) =>
          d.id === 'vowel' ? (
            <div key={d.id} className="flex flex-col items-center">
              <Kn def={d} r={r} onParam={onParam} color={color} size={38} />
              <span className="font-mono text-[9px] text-[#cfe9b8]">{VOWELS[Math.min(4, Math.round(r.vowel))]}</span>
            </div>
          ) : (
            <Kn key={d.id} def={d} r={r} onParam={onParam} color={color} size={38} />
          )
        )}
      </div>
      <div className="mt-auto text-[9.5px] italic text-fl-dim">{ENGINE_HELP[part.engine]}</div>
    </div>
  )
}

const ENGINE_HELP: Record<EngineId, string> = {
  piano: 'Modal string model: inharmonic partials, coupled-string beating, two-stage decay, hammer & damper noise, soundboard.',
  epiano: 'Tine = FM tine + asymmetric pickup bark · Reed = odd-harmonic reed bite · FM = DX-style 1:1 + 14:1 stacks.',
  organ: '',
  fm: '',
  pluck: 'Waveguide string with tuned loss filter, pluck shape & position, body resonances. Bowed = continuous stick-slip drive.',
  analog: 'Up to 7 detuned oscillators with stereo spread, second osc, sub, noise, PWM and drive → part filter.',
  choir: 'Ensemble of singers through 5 morphing vowel formants (A·E·I·O·U), male ↔ female formant sets.',
  mallet: 'Modal bars/tubes/bells with mallet hardness spectrum and contact click. Motor = vibraphone tremolo.'
}

const DB_COLORS = ['#7a4a2a', '#7a4a2a', '#e9e6dc', '#e9e6dc', '#1b1b1b', '#e9e6dc', '#1b1b1b', '#1b1b1b', '#e9e6dc']

function OrganPanel({ p, r, onParam, onParams, color }: { p: PluginEditorProps; r: Record<string, number>; onParam: (id: string, v: number) => void; onParams: (v: Record<string, number>) => void; color: string }) {
  const defs = ENGINE_PARAMS.organ
  const d = (id: string) => defs.find((x) => x.id === id)!
  const presetsReg: [string, string][] = [['888000000', 'Jazz'], ['888800000', 'Gospel'], ['888888888', 'Full'], ['008600000', 'Ballad'], ['868646048', 'Pleno']]
  return (
    <div className="flex h-full gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex gap-[3px] rounded-[3px] bg-[#15191b] p-1 fl-inset">
          {DRAWBARS.map((name, i) => (
            <Drawbar key={i} p={p} name={name} color={DB_COLORS[i]} value={r[`db${i + 1}`]} onChange={(v) => onParam(`db${i + 1}`, v)} />
          ))}
        </div>
        <div className="flex gap-px">
          {presetsReg.map(([reg, n]) => (
            <button
              key={reg}
              onClick={() => onParams(Object.fromEntries([...reg].map((c, i) => [`db${i + 1}`, Number(c)])))}
              onMouseEnter={() => p.hint(`Registration ${reg}`)}
              className="flex-1 rounded-[2px] bg-[#3a454b] px-1 text-[9px] text-fl-text hover:bg-[#46535a]"
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Seg p={p} def={d('variant')} value={r.variant} onChange={(v) => onParam('variant', v)} color={color} />
          <Seg p={p} def={d('rotary')} value={r.rotary} onChange={(v) => onParam('rotary', v)} color={color} />
          <PSelect p={p} id="rotary" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Seg p={p} def={d('perc')} value={r.perc} onChange={(v) => onParam('perc', v)} color={color} />
          <Seg p={p} def={d('percFast')} value={r.percFast} onChange={(v) => onParam('percFast', v)} color={color} />
          <Seg p={p} def={d('percSoft')} value={r.percSoft} onChange={(v) => onParam('percSoft', v)} color={color} />
        </div>
        <div className="flex items-end gap-3">
          <Seg p={p} def={d('vib')} value={r.vib} onChange={(v) => onParam('vib', v)} color={color} />
          {['click', 'leak', 'drive', 'hornMix'].map((id) => (
            <Kn key={id} def={d(id)} r={r} onParam={onParam} color={color} size={30} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Drawbar({ p, name, color, value, onChange }: { p: PluginEditorProps; name: string; color: string; value: number; onChange: (v: number) => void }) {
  const H = 112
  const acc = useRef(value)
  const drag = useVerticalDrag((dlt) => {
    acc.current = Math.min(8, Math.max(0, acc.current - dlt * 8 * 1.6))
    const v = Math.round(acc.current)
    if (v !== value) onChange(v)
    p.hint(`Drawbar ${name}: ${v}`)
  }, 200)
  const ext = (value / 8) * (H - 26)
  const dark = color === '#1b1b1b'
  return (
    <div className="flex w-[17px] flex-col items-center" onMouseEnter={() => p.hint(`Drawbar ${name}: ${value} (drag down to pull out)`)}>
      <div className="relative w-full overflow-hidden rounded-[2px] bg-[#0b0d0e]" style={{ height: H }} {...drag} onPointerDownCapture={() => (acc.current = value)}>
        <div className="absolute left-[5px] top-0 w-[7px] bg-[#3a3f42]" style={{ height: ext + 4 }} />
        <div
          className="absolute left-0 flex w-full cursor-ns-resize items-end justify-center rounded-[2px] pb-[2px] font-mono text-[9px] font-bold"
          style={{ top: ext, height: 24, background: `linear-gradient(180deg, ${color}, ${dark ? '#000' : color})`, color: dark || color === '#7a4a2a' ? '#eee' : '#222', boxShadow: '0 2px 3px rgba(0,0,0,.6)' }}
        >
          {value}
        </div>
      </div>
      <span className="mt-0.5 text-[8.5px] text-fl-dim">{name}</span>
    </div>
  )
}

const OP_COLS: [string, string][] = [['r', 'Ratio'], ['d', 'Det'], ['l', 'Level'], ['a', 'Atk'], ['dc', 'Dec'], ['s', 'Sus'], ['rl', 'Rel'], ['v', 'Vel'], ['k', 'KeyS']]

function FMPanel({ p, r, onParam, color }: { p: PluginEditorProps; r: Record<string, number>; onParam: (id: string, v: number) => void; color: string }) {
  const defs = ENGINE_PARAMS.fm
  const d = (id: string) => defs.find((x) => x.id === id)!
  return (
    <div className="flex h-full gap-2">
      <div className="flex w-[150px] shrink-0 flex-col gap-1.5">
        <Seg p={p} def={d('algo')} value={r.algo} onChange={(v) => onParam('algo', v)} color={color} vertical />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="grid grid-cols-[28px_repeat(9,1fr)] text-center text-[8.5px] uppercase tracking-wide text-fl-dim">
          <span />
          {OP_COLS.map(([, n]) => (
            <span key={n}>{n}</span>
          ))}
        </div>
        {[1, 2, 3, 4, 5, 6].map((o) => (
          <div key={o} className="grid grid-cols-[28px_repeat(9,1fr)] items-center justify-items-center">
            <span className="text-[9.5px] font-bold" style={{ color }}>
              OP{o}
            </span>
            {OP_COLS.map(([k]) => {
              const def = d(`o${o}.${k}`)
              return (
                <Knob
                  key={k}
                  size={19}
                  labelPosition="none"
                  color={color}
                  value={(() => {
                    const v = r[def.id] ?? def.default
                    return def.curve === 'exp' && def.min > 0 ? Math.log(v / def.min) / Math.log(def.max / def.min) : (v - def.min) / (def.max - def.min)
                  })()}
                  onChange={(x) => {
                    let v = def.curve === 'exp' && def.min > 0 ? def.min * Math.pow(def.max / def.min, x) : def.min + (def.max - def.min) * x
                    if (k === 'r') v = Math.round(v * 2) / 2 // ratios snap to ½ steps (musical FM ratios)
                    onParam(def.id, v)
                  }}
                  onReset={() => onParam(def.id, def.default)}
                  hint={`${def.name}: ${formatParam(def, r[def.id] ?? def.default)}`}
                />
              )
            })}
          </div>
        ))}
        <div className="mt-0.5 flex items-center gap-2">
          <Kn def={d('fb')} r={r} onParam={onParam} color={color} size={20} label="OP6 FB" />
          <span className="text-[9px] italic text-fl-dim">Ops evaluate 6→1 · modulator Level = index · ratios snap to ½</span>
        </div>
      </div>
    </div>
  )
}

function AmpFilterPanel({ p, part, r, onParam }: PanelProps) {
  const color = engineInfo(part.engine).color
  if (part.engine === 'organ')
    return <div className="p-2 text-[10.5px] text-fl-dim">The organ speaks through its own key contacts (instant gate, click, percussion) — amp envelope and filter don't apply. Use the Quick Edit cutoff/EQ, Drive and the rotary instead.</div>
  return (
    <div className="flex h-full gap-1.5">
      <div className="flex flex-col gap-1 rounded-[3px] bg-black/10 p-1">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-fl-dim">Amp Envelope</span>
        <EnvGraph a={r['amp.a']} d={r['amp.d']} s={r['amp.s']} rl={r['amp.r']} color={color} />
        <div className="flex gap-1.5">
          {['amp.a', 'amp.d', 'amp.s', 'amp.r', 'velSens'].map((id) => (
            <Kn key={id} def={commonDef(id)} r={r} onParam={onParam} color={color} size={28} />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-[3px] bg-black/10 p-1">
        <Seg p={p} def={commonDef('flt.type')} value={r['flt.type']} onChange={(v) => onParam('flt.type', v)} color={color} />
        <div className={cn('flex flex-wrap gap-x-2 gap-y-1', r['flt.type'] === 0 && 'opacity-40')}>
          {['flt.cut', 'flt.res', 'flt.env', 'flt.key', 'flt.vel', 'flt.a', 'flt.d', 'flt.s', 'flt.r'].map((id) => (
            <Kn key={id} def={commonDef(id)} r={r} onParam={onParam} color={color} size={28} />
          ))}
        </div>
      </div>
    </div>
  )
}

function EnvGraph({ a, d, s, rl, color }: { a: number; d: number; s: number; rl: number; color: string }) {
  const W = 150
  const H = 34
  const sc = (t: number) => Math.log10(1 + t * 10) / Math.log10(1 + 20 * 10)
  const xa = sc(a) * W * 0.3
  const xd = xa + sc(d) * W * 0.3
  const xs = xd + W * 0.15
  const xr = Math.min(W, xs + sc(rl) * W * 0.3)
  const y = (v: number) => H - 2 - v * (H - 4)
  const path = `M0 ${y(0)} L${xa} ${y(1)} Q${xa + (xd - xa) * 0.25} ${y(s)} ${xd} ${y(s)} L${xs} ${y(s)} Q${xs + (xr - xs) * 0.2} ${y(0)} ${xr} ${y(0)}`
  return (
    <svg width={W} height={H} className="rounded-[2px] bg-fl-well">
      <path d={`${path} L${xr} ${H} L0 ${H} Z`} fill={color} opacity={0.15} />
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" />
    </svg>
  )
}

function LfoPlayPanel({ p, part, r, onParam }: PanelProps) {
  const color = engineInfo(part.engine).color
  return (
    <div className="flex h-full gap-1.5">
      <div className="flex flex-col gap-1 rounded-[3px] bg-black/10 p-1">
        <Seg p={p} def={commonDef('lfo.shape')} value={r['lfo.shape']} onChange={(v) => onParam('lfo.shape', v)} color={color} />
        <div className="flex gap-1.5">
          {['lfo.rate', 'lfo.delay', 'lfo.pitch', 'lfo.amp', 'lfo.flt'].map((id) => (
            <Kn key={id} def={commonDef(id)} r={r} onParam={onParam} color={color} size={28} />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-[3px] bg-black/10 p-1">
        <div className="flex items-start gap-2">
          <Seg p={p} def={commonDef('mode')} value={r.mode} onChange={(v) => onParam('mode', v)} color={color} />
          <div className="flex flex-col gap-0.5 text-[9.5px] uppercase tracking-wide text-fl-dim">
            Velocity range
            <div className="flex items-center gap-0.5 font-mono text-[10px] normal-case">
              <DragNum p={p} value={r.velLo} min={1} max={127} label="Vel low" onChange={(v) => onParam('velLo', Math.min(v, r.velHi))} />
              <span>–</span>
              <DragNum p={p} value={r.velHi} min={1} max={127} label="Vel high" onChange={(v) => onParam('velHi', Math.max(v, r.velLo))} />
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          {['porta', 'transpose', 'fine', 'level', 'pan'].map((id) => (
            <Kn key={id} def={commonDef(id)} r={r} onParam={onParam} color={color} size={28} />
          ))}
        </div>
      </div>
    </div>
  )
}

function SuperPanel({ p, data, onSuper }: { p: PluginEditorProps; data: WSData; onSuper: (sk: SuperAssign[]) => void }) {
  const list = data.superKnob
  const upd = (i: number, patch: Partial<SuperAssign>) => onSuper(list.map((a, k) => (k === i ? { ...a, ...patch } : a)))
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex items-center gap-2 text-[9.5px] text-fl-dim">
        <span className="font-semibold uppercase tracking-[0.12em]" style={{ color: GOLD }}>
          Super Knob destinations
        </span>
        <span className="italic">amount = offset at 100%</span>
        <button
          onClick={() => onSuper([...list, { dest: 'cutoff', amt: 2, part: -1 }])}
          className="ml-auto flex items-center gap-1 rounded-[2px] bg-[#3a454b] px-1.5 py-[1px] text-fl-text hover:bg-[#46535a]"
          disabled={list.length >= 8}
        >
          <Plus size={10} /> Add
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-[3px] bg-fl-well p-1 fl-inset">
        {list.length === 0 && <div className="p-1 text-[10px] text-fl-dim">No assignments — click Add.</div>}
        {list.map((a, i) => {
          const dd = SUPER_DESTS.find((x) => x.id === a.dest) ?? SUPER_DESTS[0]
          return (
            <div key={i} className="flex items-center gap-1.5 py-[2px] text-[10.5px]">
              <select
                value={a.dest}
                onChange={(e) => {
                  const nd = SUPER_DESTS.find((x) => x.id === e.target.value)!
                  upd(i, { dest: nd.id, amt: Math.max(nd.min, Math.min(nd.max, a.amt)) })
                }}
                className="w-[118px] rounded-[2px] bg-[#343d42] px-1 text-fl-text outline-none"
              >
                {SUPER_DESTS.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <select
                value={dd.fx ? -1 : a.part}
                disabled={dd.fx}
                onChange={(e) => upd(i, { part: Number(e.target.value) })}
                className="w-[62px] rounded-[2px] bg-[#343d42] px-1 text-fl-text outline-none disabled:opacity-40"
              >
                <option value={-1}>{dd.fx ? 'FX' : 'All'}</option>
                {Array.from({ length: NUM_PARTS }, (_, k) => (
                  <option key={k} value={k}>
                    Part {k + 1}
                  </option>
                ))}
              </select>
              <input
                type="range"
                min={dd.min}
                max={dd.max}
                step={(dd.max - dd.min) / 200}
                value={a.amt}
                onChange={(e) => upd(i, { amt: Number(e.target.value) })}
                onMouseEnter={() => p.hint(`${dd.name}: ${a.amt.toFixed(2)} ${dd.unit}`)}
                className="h-1 min-w-0 flex-1 accent-[#e8c872]"
              />
              <span className="w-[66px] whitespace-nowrap text-right font-mono text-[10px] text-[#cfe9b8]">
                {a.amt > 0 ? '+' : ''}
                {a.amt.toFixed(dd.max >= 10 ? 0 : 2)} {dd.unit}
              </span>
              <X size={11} className="cursor-pointer text-fl-dim hover:text-fl-red" onClick={() => onSuper(list.filter((_, k) => k !== i))} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── FX row ──────────────────────────────────────────────────────────────────
function FXBox({ p, title, on, ids, color, extra }: { p: PluginEditorProps; title: string; on?: string; ids: string[]; color: string; extra?: React.ReactNode }) {
  const enabled = !on || (p.instance.params[on] ?? 0) >= 0.5
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[4px] border border-[#1d2326] bg-[#2a3236]/80 px-1 py-1 fl-bevel">
      <div className="flex items-center gap-1.5">
        {on ? <PToggle p={p} id={on} label={title} /> : <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fl-dim">{title}</span>}
        {extra}
      </div>
      <div className={cn('flex items-end gap-1', !enabled && 'opacity-40')}>
        {ids.map((id) => (
          <Cell key={id} w={28}>
            <PK p={p} id={id} size={22} color={color} label={short(p.manifest.params.find((d) => d.id === id)!.name)} />
          </Cell>
        ))}
      </div>
    </div>
  )
}

function FXRow({ p }: { p: PluginEditorProps }) {
  return (
    <div className="flex h-[70px] shrink-0 justify-between gap-1">
      <FXBox p={p} title="EQ" ids={['eq.low', 'eq.mid', 'eq.midf', 'eq.high']} color="#7fb8e0" />
      <FXBox p={p} title="Chorus" on="cho.on" ids={['cho.rate', 'cho.depth', 'cho.mix']} color="#8fd16a" />
      <FXBox p={p} title="Phaser" on="pha.on" ids={['pha.rate', 'pha.depth', 'pha.fb', 'pha.mix']} color="#b48cf0" />
      <FXBox
        p={p}
        title="Delay"
        on="dly.on"
        ids={['dly.time', 'dly.fb', 'dly.tone', 'dly.mix']}
        color="#f09a5b"
        extra={
          <button
            onClick={() => p.setParam('dly.pp', (p.instance.params['dly.pp'] ?? 1) >= 0.5 ? 0 : 1)}
            onMouseEnter={() => p.hint('Delay ping-pong')}
            className={cn('ml-auto rounded-[2px] px-1 text-[8.5px] font-semibold', (p.instance.params['dly.pp'] ?? 1) >= 0.5 ? 'bg-[#f09a5b] text-[#1b1f22]' : 'bg-[#3a454b] text-fl-dim')}
          >
            P-P
          </button>
        }
      />
      <FXBox p={p} title="Reverb" on="rev.on" ids={['rev.size', 'rev.decay', 'rev.damp', 'rev.pre', 'rev.mix']} color="#5fb8f0" />
    </div>
  )
}

// ─── Mini keyboard ───────────────────────────────────────────────────────────
const LO = 21
const HI = 108
const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(k % 12)

function MiniKeyboard({ p, data, sel }: { p: PluginEditorProps; data: WSData; sel: number }) {
  const [down, setDown] = useState<number | null>(null)
  const live = useHeldKeys(p)
  const lit = (k: number) => down === k || live.has(k)
  const ref = useRef<HTMLDivElement>(null)
  const whites: number[] = []
  for (let k = LO; k <= HI; k++) if (!isBlack(k)) whites.push(k)
  const W = 100 / whites.length
  const pos = (k: number) => whites.indexOf(k) * W
  const play = (k: number | null, vel = 0.8) => {
    if (down !== null && down !== k) p.previewNote?.(down, 0, false)
    if (k !== null && k !== down) p.previewNote?.(k, vel, true)
    setDown(k)
  }
  const velFromEvent = (e: React.MouseEvent, black: boolean) => {
    const el = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - el.top) / el.height
    return Math.max(0.15, Math.min(1, (black ? 0.35 : 0.25) + y * 0.8))
  }
  return (
    <div className="flex h-[46px] shrink-0 flex-col gap-[2px]" onMouseLeave={() => play(null)} onMouseUp={() => play(null)}>
      <div className="relative h-[7px] w-full">
        {data.parts.map((pt, i) => {
          if (!pt.on) return null
          const r = resolvePart(pt)
          const lo = Math.max(LO, r.keyLo)
          const hi = Math.min(HI, r.keyHi)
          if (hi < lo) return null
          const l = pos(isBlack(lo) ? lo - 1 : lo)
          const rr = pos(isBlack(hi) ? hi + 1 : hi) + W
          return (
            <div
              key={i}
              className="absolute rounded-full"
              style={{ left: `${l}%`, width: `${rr - l}%`, top: i * 1.75, height: 1.5, background: engineInfo(pt.engine).color, opacity: i === sel ? 1 : 0.55 }}
            />
          )
        })}
      </div>
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden rounded-[3px] border border-[#111] bg-[#111]">
        {whites.map((k) => (
          <div
            key={k}
            onMouseDown={(e) => play(k, velFromEvent(e, false))}
            onMouseEnter={(e) => {
              p.hint(midiName(k))
              if (e.buttons & 1) play(k, velFromEvent(e, false))
            }}
            className="absolute top-0 h-full border-r border-[#9aa] "
            style={{
              left: `${pos(k)}%`,
              width: `${W}%`,
              background: lit(k) ? GOLD : k === 60 ? 'linear-gradient(#f4f4ef,#dcdcd2)' : 'linear-gradient(#fbfbf7,#e2e2da)'
            }}
          >
            {k % 12 === 0 && <span className="absolute bottom-0 left-0 w-full text-center text-[7.5px] text-[#667]">{midiName(k)}</span>}
          </div>
        ))}
        {Array.from({ length: HI - LO + 1 }, (_, i) => LO + i)
          .filter(isBlack)
          .map((k) => (
            <div
              key={k}
              onMouseDown={(e) => {
                e.stopPropagation()
                play(k, velFromEvent(e, true))
              }}
              onMouseEnter={(e) => {
                p.hint(midiName(k))
                if (e.buttons & 1) play(k, velFromEvent(e, true))
              }}
              className="absolute top-0 z-10 rounded-b-[2px]"
              style={{ left: `${pos(k - 1) + W * 0.68}%`, width: `${W * 0.64}%`, height: '62%', background: lit(k) ? GOLD : 'linear-gradient(#3a3f42,#111)' }}
            />
          ))}
      </div>
    </div>
  )
}

export default MosaicEditor
