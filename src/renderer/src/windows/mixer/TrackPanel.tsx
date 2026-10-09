// Right-hand "track inspector" of the FL mixer: input selector, the 10 FX slots, 3-band EQ,
// output selector and the extra track properties (phase, swap L/R, latency).
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Knob, Led } from '@/components/controls'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import type { FxSlot, MixerTrack } from '@/store/types'
import { getPlugin, listPlugins } from '@/plugins/registry'
import type { PluginModule } from '@/plugins/sdk/module'
import { openFxPlugin } from '@/windows/plugin/open'
import { EQ_FREQ, EQ_GAIN_MAX, eqResponse, freqToNorm, normToFreq } from './eq'
import { deleteSlot, fmtDb, fmtHz, insertEffect, moveSlot, routeOnly, setEq, setSlot, setTrack, trackLabel } from './ops'

const hint = (s: string) => useUI.getState().setHint(s)
const SLOT_MIME = 'application/x-arkane-fxslot'
const PLUGIN_MIME = 'application/x-arkane-plugin'

function effectsByCategory(): [string, PluginModule[]][] {
  const groups = new Map<string, PluginModule[]>()
  for (const m of listPlugins('effect')) {
    const c = m.manifest.category || 'Other'
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c)!.push(m)
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

export function TrackPanel({ index }: { index: number }) {
  const t = useProject((s) => s.project.mixer[index])
  if (!t) return null
  const label = trackLabel(t)
  return (
    <div className="flex h-full w-[236px] shrink-0 flex-col border-l border-[#1a1f22] bg-[#323b40]" onMouseEnter={() => hint(`${label} — track properties`)}>
      <div className="flex h-[22px] shrink-0 items-center gap-1.5 border-b border-[#1d2326] bg-[#2b3337] px-1.5">
        <span className="h-3 w-3 shrink-0 rounded-[2px] border border-black/40" style={{ background: t.color }} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#e3e9ec]">{label}</span>
        <Led
          on={t.fxEnabled}
          size={10}
          onClick={() => setTrack(index, { fxEnabled: !t.fxEnabled }, t.fxEnabled ? 'Disable track effects' : 'Enable track effects')}
          title=""
          className="mr-0.5"
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden p-1.5">
        <InputSelector t={t} />
        <div className="flex flex-col gap-[2px]">
          {t.slots.map((s, i) => (
            <SlotRow key={i} track={index} slot={i} s={s} fxOn={t.fxEnabled} trackLabel={label} />
          ))}
        </div>
        <EqSection t={t} />
        <OutputSelector t={t} />
        <Extras t={t} />
      </div>
    </div>
  )
}

// ── input ──────────────────────────────────────────────────────────────────────
function useAudioInputs(): MediaDeviceInfo[] {
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    let alive = true
    const load = () =>
      md
        .enumerateDevices()
        .then((list) => alive && setDevs(list.filter((d) => d.kind === 'audioinput')))
        .catch(() => undefined)
    void load()
    md.addEventListener?.('devicechange', load)
    return () => {
      alive = false
      md.removeEventListener?.('devicechange', load)
    }
  }, [])
  return devs
}

const selectCls = 'h-[20px] min-w-0 flex-1 appearance-none rounded-[2px] border border-[#1a1f22] bg-fl-well px-1 text-[11px] text-fl-text outline-none fl-inset'

function InputSelector({ t }: { t: MixerTrack }) {
  const devs = useAudioInputs()
  const known = t.inputDevice === null || devs.some((d) => d.deviceId === t.inputDevice)
  return (
    <div className="flex items-center gap-1" onMouseEnter={(e) => (e.stopPropagation(), hint(`${trackLabel(t)} audio input (for recording)`))}>
      <span className="w-9 shrink-0 text-[10px] uppercase tracking-wide text-fl-dim">In</span>
      <select
        className={selectCls}
        value={t.inputDevice ?? ''}
        onChange={(e) => setTrack(t.index, { inputDevice: e.target.value || null }, 'Change mixer input')}
      >
        <option value="">(none)</option>
        {devs.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || (d.deviceId === 'default' ? 'Default input' : `Input ${i + 1}`)}
          </option>
        ))}
        {!known && <option value={t.inputDevice!}>(missing device)</option>}
      </select>
      <select
        className={cn(selectCls, 'w-[52px] flex-none')}
        value={t.inputChannel}
        onChange={(e) => setTrack(t.index, { inputChannel: e.target.value as MixerTrack['inputChannel'] }, 'Change mixer input channel')}
      >
        <option value="stereo">Stereo</option>
        <option value="left">Left</option>
        <option value="right">Right</option>
      </select>
    </div>
  )
}

// ── FX slots ───────────────────────────────────────────────────────────────────
function EffectMenuItems({ onPick, Item, Label, Sep }: { onPick: (id: string) => void; Item: typeof DropdownMenuItem | typeof ContextMenuItem; Label: typeof DropdownMenuLabel | typeof ContextMenuLabel; Sep: typeof DropdownMenuSeparator | typeof ContextMenuSeparator }) {
  const groups = effectsByCategory()
  if (!groups.length) return <Item disabled>(no effects installed)</Item>
  return (
    <>
      {groups.map(([cat, mods], gi) => (
        <div key={cat}>
          {gi > 0 && <Sep />}
          <Label className="text-[10px] uppercase tracking-wide text-fl-dim">{cat}</Label>
          {mods.map((m) => (
            <Item key={m.manifest.id} onSelect={() => onPick(m.manifest.id)}>
              {m.manifest.name}
            </Item>
          ))}
        </div>
      ))}
    </>
  )
}

function SlotRow({ track, slot, s, fxOn, trackLabel: tl }: { track: number; slot: number; s: FxSlot | null; fxOn: boolean; trackLabel: string }) {
  const [over, setOver] = useState(false)
  const name = s ? getPlugin(s.plugin.pluginId)?.manifest.name ?? s.plugin.pluginId : ''
  const editorOpen = useUI((st) => !!st.windows[`fx:${track}:${slot}`]?.open)

  const dnd = {
    onDragOver: (e: React.DragEvent) => {
      const ty = e.dataTransfer.types
      if (ty.includes(SLOT_MIME) || ty.includes(PLUGIN_MIME)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = ty.includes(SLOT_MIME) ? 'move' : 'copy'
        setOver(true)
      }
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      setOver(false)
      const moved = e.dataTransfer.getData(SLOT_MIME)
      const plugin = e.dataTransfer.getData(PLUGIN_MIME)
      if (moved) {
        e.preventDefault()
        const [tr, from] = moved.split(':').map(Number)
        if (tr === track) moveSlot(track, from, slot)
      } else if (plugin) {
        e.preventDefault()
        insertEffect(track, slot, plugin)
      }
    }
  }

  const rowCls = cn(
    'group flex h-[21px] items-center gap-1 rounded-[2px] border pl-0.5 pr-1',
    over ? 'border-fl-orange' : 'border-[#1d2326]',
    s ? 'bg-[#3c474d]' : 'bg-[#2a3236]'
  )

  if (!s) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div {...dnd} onMouseEnter={(e) => (e.stopPropagation(), hint(`${tl} slot ${slot + 1}: empty — click to add an effect`))}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={cn(rowCls, 'w-full text-left hover:bg-[#323b40]')}>
                  <span className="w-[14px] shrink-0 text-center text-[9px] text-[#5d696f]">{slot + 1}</span>
                  <span className="flex-1 truncate text-[11px] text-[#66737a]">Slot {slot + 1}</span>
                  <ChevronDown size={11} className="text-[#66737a] opacity-0 group-hover:opacity-100" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[60vh] min-w-[180px] overflow-auto">
                <EffectMenuItems onPick={(id) => insertEffect(track, slot, id)} Item={DropdownMenuItem} Label={DropdownMenuLabel} Sep={DropdownMenuSeparator} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Select</ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-[60vh] overflow-auto">
              <EffectMenuItems onPick={(id) => insertEffect(track, slot, id)} Item={ContextMenuItem} Label={ContextMenuLabel} Sep={ContextMenuSeparator} />
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const on = s.enabled && fxOn
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={rowCls}
          {...dnd}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(SLOT_MIME, `${track}:${slot}`)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onMouseEnter={(e) => (e.stopPropagation(), hint(`${tl} slot ${slot + 1}: ${name}${s.plugin.presetName ? ` (${s.plugin.presetName})` : ''} — click to open, drag to move`))}
        >
          <GripVertical size={10} className="shrink-0 cursor-grab text-[#5d696f]" />
          <button
            className={cn('min-w-0 flex-1 truncate text-left text-[11px]', on ? 'text-[#e6ecef]' : 'text-[#7f8c92] line-through decoration-[#7f8c92]/50', editorOpen && 'text-fl-orange')}
            onClick={() => openFxPlugin(track, slot)}
          >
            {name}
          </button>
          <div
            onMouseEnter={(e) => (e.stopPropagation(), hint(`${name} mix: ${Math.round(s.mix * 100)}%`))}
            className="shrink-0"
          >
            <Knob
              size={16}
              value={s.mix}
              labelPosition="none"
              color="var(--fl-green)"
              onChange={(v) => {
                setSlot(track, slot, { mix: v }, 'Change effect mix', `mx:${track}:slot:${slot}:mix`)
                hint(`${name} mix: ${Math.round(v * 100)}%`)
              }}
              onReset={() => setSlot(track, slot, { mix: 1 }, 'Change effect mix')}
            />
          </div>
          <Led
            on={s.enabled}
            size={9}
            title=""
            onClick={() => setSlot(track, slot, { enabled: !s.enabled }, s.enabled ? 'Disable effect' : 'Enable effect')}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">
        <ContextMenuLabel className="text-fl-orange">{name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => openFxPlugin(track, slot)}>Open editor</ContextMenuItem>
        <ContextMenuItem onSelect={() => setSlot(track, slot, { enabled: !s.enabled }, s.enabled ? 'Disable effect' : 'Enable effect')}>
          {s.enabled ? 'Bypass' : 'Enable'}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Replace</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[60vh] overflow-auto">
            <EffectMenuItems
              onPick={(id) => {
                useUI.getState().closeWindow(`fx:${track}:${slot}`)
                insertEffect(track, slot, id)
              }}
              Item={ContextMenuItem}
              Label={ContextMenuLabel}
              Sep={ContextMenuSeparator}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={slot === 0} onSelect={() => moveSlot(track, slot, slot - 1)}>
          Move up
        </ContextMenuItem>
        <ContextMenuItem disabled={slot === 9} onSelect={() => moveSlot(track, slot, slot + 1)}>
          Move down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-[#ff8a80]" onSelect={() => deleteSlot(track, slot)}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── EQ ─────────────────────────────────────────────────────────────────────────
const BANDS = [
  { key: 'low', gain: 'lowGain', freq: 'lowFreq', name: 'Low', color: '#e6a040' },
  { key: 'mid', gain: 'midGain', freq: 'midFreq', name: 'Mid', color: '#8fe34a' },
  { key: 'high', gain: 'highGain', freq: 'highFreq', name: 'High', color: '#5fb3e6' }
] as const

const GW = 220
const GH = 62
const F_LO = 20
const F_HI = 20000
const fx = (f: number) => (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * GW
const xf = (x: number) => F_LO * Math.pow(F_HI / F_LO, Math.min(1, Math.max(0, x / GW)))
const gy = (db: number) => GH / 2 - (db / (EQ_GAIN_MAX + 2)) * (GH / 2)

function EqSection({ t }: { t: MixerTrack }) {
  const eq = t.eq
  const label = trackLabel(t)
  const path = useMemo(() => {
    const n = 90
    const freqs = Array.from({ length: n }, (_, i) => F_LO * Math.pow(F_HI / F_LO, i / (n - 1)))
    const r = eqResponse(eq, freqs)
    return freqs.map((f, i) => `${i ? 'L' : 'M'}${fx(f).toFixed(1)},${Math.min(GH, Math.max(0, gy(r[i]))).toFixed(1)}`).join(' ')
  }, [eq])
  const svgRef = useRef<SVGSVGElement>(null)

  const dragBand = (b: (typeof BANDS)[number]) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const range = EQ_FREQ[b.key]
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - rect.left
      const y = ev.clientY - rect.top
      const f = Math.min(range[1], Math.max(range[0], xf(x)))
      const g = Math.round(Math.min(EQ_GAIN_MAX, Math.max(-EQ_GAIN_MAX, ((GH / 2 - y) / (GH / 2)) * (EQ_GAIN_MAX + 2))) * 10) / 10
      setEq(t.index, { [b.freq]: Math.round(f), [b.gain]: g }, b.key)
      hint(`${label} EQ ${b.name}: ${fmtDb(g)} @ ${fmtHz(f)}`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="rounded-[2px] border border-[#1d2326] bg-[#2b3337] p-1" onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} EQ — drag the points: left/right = frequency, up/down = gain`))}>
      <svg ref={svgRef} width={GW} height={GH} className="block rounded-[2px] bg-fl-well fl-inset">
        {[100, 1000, 10000].map((f) => (
          <line key={f} x1={fx(f)} x2={fx(f)} y1={0} y2={GH} stroke="#263034" />
        ))}
        <line x1={0} x2={GW} y1={GH / 2} y2={GH / 2} stroke="#33414a" />
        <path d={`${path} L${GW},${GH / 2} L0,${GH / 2} Z`} fill="rgba(143,227,74,.12)" />
        <path d={path} stroke="#9fe86a" strokeWidth={1.4} fill="none" />
        {BANDS.map((b) => (
          <circle
            key={b.key}
            cx={fx(eq[b.freq])}
            cy={gy(eq[b.gain])}
            r={4.5}
            fill={b.color}
            stroke="#11161a"
            className="cursor-move"
            onPointerDown={dragBand(b)}
            onDoubleClick={() => setEq(t.index, { [b.gain]: 0 }, b.key)}
            onMouseEnter={() => hint(`${label} EQ ${b.name}: ${fmtDb(eq[b.gain])} @ ${fmtHz(eq[b.freq])}`)}
          />
        ))}
      </svg>
      <div className="mt-1 grid grid-cols-3 gap-x-1">
        {BANDS.map((b) => {
          const range = EQ_FREQ[b.key]
          const defaults = { low: 90, mid: 1400, high: 9000 }
          return (
            <div key={b.key} className="flex flex-col items-center gap-0.5">
              <span className="text-[9px] uppercase tracking-wide" style={{ color: b.color }}>
                {b.name}
              </span>
              <div className="flex items-end gap-1">
                <div onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} EQ ${b.name} gain: ${fmtDb(eq[b.gain])}`))}>
                  <Knob
                    size={24}
                    bipolar
                    value={(eq[b.gain] + EQ_GAIN_MAX) / (2 * EQ_GAIN_MAX)}
                    color={b.color}
                    labelPosition="none"
                    onChange={(v) => {
                      const g = Math.round((v * 2 - 1) * EQ_GAIN_MAX * 10) / 10
                      setEq(t.index, { [b.gain]: g }, `${b.key}g`)
                      hint(`${label} EQ ${b.name} gain: ${fmtDb(g)}`)
                    }}
                    onReset={() => setEq(t.index, { [b.gain]: 0 }, `${b.key}g`)}
                  />
                </div>
                <div onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} EQ ${b.name} frequency: ${fmtHz(eq[b.freq])}`))}>
                  <Knob
                    size={18}
                    value={freqToNorm(eq[b.freq], range)}
                    color="#9aa6ac"
                    labelPosition="none"
                    onChange={(v) => {
                      const f = Math.round(normToFreq(v, range))
                      setEq(t.index, { [b.freq]: f }, `${b.key}f`)
                      hint(`${label} EQ ${b.name} frequency: ${fmtHz(f)}`)
                    }}
                    onReset={() => setEq(t.index, { [b.freq]: defaults[b.key] }, `${b.key}f`)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── output ─────────────────────────────────────────────────────────────────────
function OutputSelector({ t }: { t: MixerTrack }) {
  const mixer = useProject((s) => s.project.mixer)
  const label = trackLabel(t)
  if (t.index === 0) {
    return (
      <div className="flex items-center gap-1" onMouseEnter={(e) => (e.stopPropagation(), hint('Master output: default audio device'))}>
        <span className="w-9 shrink-0 text-[10px] uppercase tracking-wide text-fl-dim">Out</span>
        <select className={selectCls} value="default" disabled>
          <option value="default">Default output</option>
        </select>
      </div>
    )
  }
  const value = t.sends.length === 1 ? String(t.sends[0].target) : t.sends.length === 0 ? 'none' : 'multi'
  return (
    <div className="flex items-center gap-1" onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} output (route to this track only)`))}>
      <span className="w-9 shrink-0 text-[10px] uppercase tracking-wide text-fl-dim">Out</span>
      <select
        className={selectCls}
        value={value}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'none') setTrack(t.index, { sends: [] }, 'Unroute mixer track')
          else if (v !== 'multi') routeOnly(t.index, Number(v))
        }}
      >
        <option value="none">(none)</option>
        {value === 'multi' && <option value="multi">(multiple: {t.sends.map((s) => (s.target === 0 ? 'M' : s.target)).join(', ')})</option>}
        {mixer
          .filter((m) => m.index !== t.index)
          .map((m) => (
            <option key={m.index} value={m.index}>
              {m.index === 0 ? 'Master' : trackLabel(m)}
            </option>
          ))}
      </select>
    </div>
  )
}

// ── extras ─────────────────────────────────────────────────────────────────────
function Toggle({ on, onClick, children, hintText }: { on: boolean; onClick: () => void; children: React.ReactNode; hintText: string }) {
  return (
    <button
      className={cn('h-[18px] rounded-[2px] border border-[#1d2326] px-1.5 text-[10px] fl-bevel', on ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#46525a] text-fl-text hover:bg-[#515e66]')}
      onClick={onClick}
      onMouseEnter={(e) => (e.stopPropagation(), hint(hintText))}
    >
      {children}
    </button>
  )
}

function Extras({ t }: { t: MixerTrack }) {
  const label = trackLabel(t)
  const lat = useRef(t.latencyComp)
  lat.current = t.latencyComp
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Toggle on={t.phaseInvert} onClick={() => setTrack(t.index, { phaseInvert: !t.phaseInvert }, 'Invert phase')} hintText={`${label}: invert polarity`}>
        Ø Phase
      </Toggle>
      <Toggle on={t.swapLR} onClick={() => setTrack(t.index, { swapLR: !t.swapLR }, 'Swap left/right')} hintText={`${label}: swap left and right channels`}>
        L⇄R
      </Toggle>
      <div
        className="ml-auto flex h-[18px] cursor-ns-resize items-center gap-1 rounded-[2px] px-1 fl-lcd text-[10px]"
        onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} latency compensation: ${t.latencyComp} ms (drag / wheel, double-click to reset)`))}
        onWheel={(e) => {
          const v = Math.max(0, Math.min(500, t.latencyComp - Math.sign(e.deltaY)))
          setTrack(t.index, { latencyComp: v }, 'Track latency', `mx:${t.index}:lat`)
          hint(`${label} latency compensation: ${v} ms`)
        }}
        onDoubleClick={() => setTrack(t.index, { latencyComp: 0 }, 'Track latency')}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.preventDefault()
          const sy = e.clientY
          const start = lat.current
          const move = (ev: PointerEvent) => {
            const v = Math.max(0, Math.min(500, Math.round(start + (sy - ev.clientY) / 2)))
            setTrack(t.index, { latencyComp: v }, 'Track latency', `mx:${t.index}:lat`)
            hint(`${label} latency compensation: ${v} ms`)
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        <span className="text-fl-dim">PDC</span>
        <span>{t.latencyComp} ms</span>
      </div>
    </div>
  )
}
