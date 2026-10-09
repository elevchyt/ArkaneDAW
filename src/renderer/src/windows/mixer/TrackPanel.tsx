// Right-hand track inspector of the FL 20/21 mixer: audio input, the 10 FX slots (arrow, name,
// wet mix knob, enable LED), 3-band EQ, PDC (latency) and the output selector.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Led } from '@/components/controls'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import type { FxSlot, MixerTrack } from '@/store/types'
import { allPlugins, groupPlugins, pluginName } from '@/plugins/catalog'
import { openFxPlugin } from '@/windows/plugin/open'
import { EQ_FREQ, EQ_GAIN_MAX, eqResponse, freqToNorm, normToFreq } from './eq'
import { deleteSlot, fmtDb, fmtHz, insertEffectAndOpen, moveSlot, routeOnly, setEq, setSlot, setTrack, trackLabel } from './ops'
import { PANEL_W } from './state'
import { TinyKnob } from './widgets'

const hint = (s: string) => useUI.getState().setHint(s)
const SLOT_MIME = 'application/x-arkane-fxslot'
const PLUGIN_MIME = 'application/x-arkane-plugin'

export function TrackPanel({ index }: { index: number }) {
  const t = useProject((s) => s.project.mixer[index])
  if (!t) return null
  const label = trackLabel(t)
  return (
    <div
      className="flex h-full shrink-0 flex-col border-l-[3px] border-[#1a2023] bg-[#343e43]"
      style={{ width: PANEL_W }}
      onMouseEnter={() => hint(`${label} — track properties`)}
    >
      <div className="flex h-[18px] shrink-0 items-center gap-1 border-b border-[#20272a] bg-[#2c3539] px-1">
        <span className="h-[9px] w-[9px] shrink-0 rounded-[1px] border border-black/40" style={{ background: t.color }} />
        <span className="min-w-0 flex-1 truncate text-[10px] text-[#dfe5e8]">Mixer - {label}</span>
        <span className="text-[9px] text-[#7f8c92]">FX</span>
        <Led
          on={t.fxEnabled}
          size={8}
          onClick={() => setTrack(index, { fxEnabled: !t.fxEnabled }, t.fxEnabled ? 'Disable track effects' : 'Enable track effects')}
          title=""
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto overflow-x-hidden px-[3px] py-[3px]">
        <InputSelector t={t} />
        <div className="flex flex-col gap-[1px]">
          {t.slots.map((s, i) => (
            <SlotRow key={i} track={index} slot={i} s={s} fxOn={t.fxEnabled} trackLabel={label} />
          ))}
        </div>
        <EqSection t={t} />
        <PdcRow t={t} />
        <OutputSelector t={t} />
      </div>
    </div>
  )
}

// ── I/O rows ───────────────────────────────────────────────────────────────────
/** FL-style selector field: arrow, current value, grey caption on the right. A transparent
 *  native <select> sits on top so keyboard + OS list behaviour stay intact. */
function IoField({
  value,
  display,
  caption,
  onChange,
  disabled,
  children,
  hintText,
  extra
}: {
  value: string
  display: string
  caption: string
  onChange?: (v: string) => void
  disabled?: boolean
  children: React.ReactNode
  hintText: string
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-[3px]" onMouseEnter={(e) => (e.stopPropagation(), hint(hintText))}>
      <div className="relative flex h-[18px] min-w-0 flex-1 items-center gap-1 rounded-[2px] border border-[#1b2124] bg-[#262e32] pl-[2px] pr-1.5 fl-inset">
        <ChevronRight size={10} className="shrink-0 text-[#8b989e]" />
        <span className="min-w-0 flex-1 truncate text-[10px] text-[#d3dadd]">{display}</span>
        <span className="shrink-0 text-[10px] text-[#7d8a90]">{caption}</span>
        <select
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {children}
        </select>
      </div>
      {extra}
    </div>
  )
}

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

const devLabel = (d: MediaDeviceInfo, i: number) => d.label || (d.deviceId === 'default' ? 'Default input' : `Input ${i + 1}`)
const CHANNEL_NEXT: Record<MixerTrack['inputChannel'], MixerTrack['inputChannel']> = { stereo: 'left', left: 'right', right: 'stereo' }
const CHANNEL_SHORT: Record<MixerTrack['inputChannel'], string> = { stereo: 'ST', left: 'L', right: 'R' }

function InputSelector({ t }: { t: MixerTrack }) {
  const devs = useAudioInputs()
  const di = devs.findIndex((d) => d.deviceId === t.inputDevice)
  const display = t.inputDevice === null ? '(none)' : di >= 0 ? devLabel(devs[di], di) : '(missing device)'
  return (
    <IoField
      value={t.inputDevice ?? ''}
      display={display}
      caption="Audio Input"
      onChange={(v) => setTrack(t.index, { inputDevice: v || null }, 'Change mixer input')}
      hintText={`${trackLabel(t)} audio input (for recording)`}
      extra={
        <button
          className="h-[18px] w-[22px] shrink-0 rounded-[2px] border border-[#1b2124] bg-[#3e494f] text-[9px] font-semibold text-[#cfd7db] hover:bg-[#4a565c]"
          onClick={() => setTrack(t.index, { inputChannel: CHANNEL_NEXT[t.inputChannel] }, 'Change mixer input channel')}
          onMouseEnter={(e) => (e.stopPropagation(), hint(`Input channel: ${t.inputChannel} (click to change)`))}
        >
          {CHANNEL_SHORT[t.inputChannel]}
        </button>
      }
    >
      <option value="">(none)</option>
      {devs.map((d, i) => (
        <option key={d.deviceId || i} value={d.deviceId}>
          {devLabel(d, i)}
        </option>
      ))}
      {t.inputDevice !== null && di < 0 && <option value={t.inputDevice}>(missing device)</option>}
    </IoField>
  )
}

function OutputSelector({ t }: { t: MixerTrack }) {
  const mixer = useProject((s) => s.project.mixer)
  const label = trackLabel(t)
  if (t.index === 0) {
    return (
      <IoField value="default" display="Default output" caption="Audio Output" disabled hintText="Master output: default audio device">
        <option value="default">Default output</option>
      </IoField>
    )
  }
  const value = t.sends.length === 1 ? String(t.sends[0].target) : t.sends.length === 0 ? 'none' : 'multi'
  const display =
    value === 'none'
      ? '(none)'
      : value === 'multi'
        ? `(multiple: ${t.sends.map((s) => (s.target === 0 ? 'M' : s.target)).join(', ')})`
        : t.sends[0].target === 0
          ? 'Master'
          : trackLabel(mixer[t.sends[0].target])
  return (
    <IoField
      value={value}
      display={display}
      caption="Output"
      hintText={`${label} output (route to this track only)`}
      onChange={(v) => {
        if (v === 'none') setTrack(t.index, { sends: [] }, 'Unroute mixer track')
        else if (v !== 'multi') routeOnly(t.index, Number(v))
      }}
    >
      <option value="none">(none)</option>
      {value === 'multi' && <option value="multi">{display}</option>}
      {mixer
        .filter((m) => m.index !== t.index)
        .map((m) => (
          <option key={m.index} value={m.index}>
            {m.index === 0 ? 'Master' : trackLabel(m)}
          </option>
        ))}
    </IoField>
  )
}

// ── effect menus ───────────────────────────────────────────────────────────────
type MenuKit = {
  Item: React.ElementType
  Label: React.ElementType
  Sep: React.ElementType
  Sub: React.ElementType
  SubTrigger: React.ElementType
  SubContent: React.ElementType
}
const DROPDOWN: MenuKit = {
  Item: DropdownMenuItem,
  Label: DropdownMenuLabel,
  Sep: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent
}
const CONTEXT: MenuKit = {
  Item: ContextMenuItem,
  Label: ContextMenuLabel,
  Sep: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent
}

/** Effects grouped by category; category labels are underlined, dim and uppercase. */
function EffectMenuItems({ onPick, kit }: { onPick: (id: string) => void; kit: MenuKit }) {
  const { Item, Label, Sep } = kit
  const groups = groupPlugins(allPlugins('effect'))
  if (!groups.length) return <Item disabled>(no effects installed)</Item>
  return (
    <>
      {groups.map(([cat, mods], gi) => (
        <div key={cat}>
          {gi > 0 && <Sep />}
          <Label className="px-2 pb-0.5 pt-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#7f8c92] underline decoration-[#7f8c92]/70 underline-offset-[3px]">
            {cat}
          </Label>
          {mods.map((m) => (
            <Item key={m.id} className="pl-4 text-[11px]" onSelect={() => onPick(m.id)}>
              {m.name}
            </Item>
          ))}
        </div>
      ))}
    </>
  )
}

/** Slot menu (arrow + right-click). Empty slots only get the effect list. */
function SlotMenuItems({ track, slot, s, kit }: { track: number; slot: number; s: FxSlot | null; kit: MenuKit }) {
  const { Item, Label, Sep, Sub, SubTrigger, SubContent } = kit
  const pick = (id: string) => {
    if (s) useUI.getState().closeWindow(`fx:${track}:${slot}`)
    insertEffectAndOpen(track, slot, id)
  }
  if (!s) {
    return (
      <>
        <Label className="text-fl-orange no-underline normal-case tracking-normal text-[11px]">Slot {slot + 1}</Label>
        <EffectMenuItems onPick={pick} kit={kit} />
      </>
    )
  }
  const name = pluginName(s.plugin.pluginId)
  return (
    <>
      <Label className="text-fl-orange no-underline normal-case tracking-normal text-[11px]">{name}</Label>
      <Item onSelect={() => openFxPlugin(track, slot)}>Open editor</Item>
      <Item onSelect={() => setSlot(track, slot, { enabled: !s.enabled }, s.enabled ? 'Disable effect' : 'Enable effect')}>{s.enabled ? 'Bypass' : 'Enable'}</Item>
      <Sub>
        <SubTrigger>Replace</SubTrigger>
        <SubContent className="max-h-[60vh] min-w-[180px] overflow-auto">
          <EffectMenuItems onPick={pick} kit={kit} />
        </SubContent>
      </Sub>
      <Sep />
      <Item disabled={slot === 0} onSelect={() => moveSlot(track, slot, slot - 1)}>
        Move up
      </Item>
      <Item disabled={slot === 9} onSelect={() => moveSlot(track, slot, slot + 1)}>
        Move down
      </Item>
      <Sep />
      <Item className="text-[#ff8a80]" onSelect={() => deleteSlot(track, slot)}>
        Delete
      </Item>
    </>
  )
}

// ── FX slots ───────────────────────────────────────────────────────────────────
function SlotRow({ track, slot, s, fxOn, trackLabel: tl }: { track: number; slot: number; s: FxSlot | null; fxOn: boolean; trackLabel: string }) {
  const [over, setOver] = useState(false)
  const name = s ? pluginName(s.plugin.pluginId) : ''
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
        if (s) useUI.getState().closeWindow(`fx:${track}:${slot}`)
        insertEffectAndOpen(track, slot, plugin)
      }
    }
  }

  const on = !!s && s.enabled && fxOn
  const rowCls = cn(
    'group flex h-[19px] items-center gap-[3px] rounded-[2px] border pr-[3px]',
    over ? 'border-fl-orange' : 'border-[#20272a]',
    s ? 'bg-[#3d494f]' : 'bg-[#2c3539]'
  )

  const arrow = (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid h-full w-[14px] shrink-0 place-items-center rounded-l-[2px] text-[#8b989e] hover:bg-white/5 hover:text-white"
        onMouseEnter={(e) => (e.stopPropagation(), hint(`${tl} slot ${slot + 1}: ${s ? `${name} — slot menu` : 'select an effect'}`))}
      >
        <ChevronRight size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] min-w-[180px] overflow-auto">
        <SlotMenuItems track={track} slot={slot} s={s} kit={DROPDOWN} />
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={rowCls}
          {...dnd}
          draggable={!!s}
          onDragStart={(e) => {
            e.dataTransfer.setData(SLOT_MIME, `${track}:${slot}`)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onMouseEnter={(e) => (
            e.stopPropagation(),
            hint(s ? `${tl} slot ${slot + 1}: ${name}${s.plugin.presetName ? ` (${s.plugin.presetName})` : ''} — click to open, drag to move` : `${tl} slot ${slot + 1}: empty — click to add an effect`)
          )}
        >
          {arrow}
          {s ? (
            <>
              <button
                className={cn(
                  'min-w-0 flex-1 truncate text-left text-[10px]',
                  on ? 'text-[#e6ecef]' : 'text-[#7f8c92] line-through decoration-[#7f8c92]/50',
                  editorOpen && 'text-fl-orange'
                )}
                onClick={() => openFxPlugin(track, slot)}
              >
                {name}
              </button>
              <div className="shrink-0" onMouseEnter={(e) => (e.stopPropagation(), hint(`${name} mix: ${Math.round(s.mix * 100)}%`))}>
                <TinyKnob
                  size={15}
                  value={s.mix}
                  color="var(--fl-green)"
                  dim={!on}
                  onChange={(v) => {
                    setSlot(track, slot, { mix: v }, 'Change effect mix', `mx:${track}:slot:${slot}:mix`)
                    hint(`${name} mix: ${Math.round(v * 100)}%`)
                  }}
                  onReset={() => setSlot(track, slot, { mix: 1 }, 'Change effect mix')}
                />
              </div>
              <Led on={s.enabled} size={8} title="" onClick={() => setSlot(track, slot, { enabled: !s.enabled }, s.enabled ? 'Disable effect' : 'Enable effect')} />
            </>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger className="min-w-0 flex-1 truncate text-left text-[10px] italic text-[#6f7c82] hover:text-[#a4b0b5]">Slot {slot + 1}</DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[60vh] min-w-[180px] overflow-auto">
                <SlotMenuItems track={track} slot={slot} s={null} kit={DROPDOWN} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-h-[70vh] min-w-[180px] overflow-auto">
        <SlotMenuItems track={track} slot={slot} s={s} kit={CONTEXT} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

// ── EQ ─────────────────────────────────────────────────────────────────────────
const BANDS = [
  { key: 'low', gain: 'lowGain', freq: 'lowFreq', name: 'Low', color: '#e6a040', def: 90 },
  { key: 'mid', gain: 'midGain', freq: 'midFreq', name: 'Med', color: '#8fe34a', def: 1400 },
  { key: 'high', gain: 'highGain', freq: 'highFreq', name: 'High', color: '#5fb3e6', def: 9000 }
] as const

const GW = PANEL_W - 17 // border + paddings
const GH = 44
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
    <div
      className="mt-[2px] rounded-[2px] border border-[#20272a] bg-[#2c3539] p-[2px]"
      onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} EQ — drag the points: left/right = frequency, up/down = gain`))}
    >
      <div className="flex h-[13px] items-center px-[2px] text-[9px] text-[#8b989e]">Equalizer</div>
      <svg ref={svgRef} width={GW} height={GH} className="block rounded-[1px] bg-[#1d2427] fl-inset">
        {[100, 1000, 10000].map((f) => (
          <line key={f} x1={fx(f)} x2={fx(f)} y1={0} y2={GH} stroke="#273136" />
        ))}
        <line x1={0} x2={GW} y1={GH / 2} y2={GH / 2} stroke="#34424a" />
        <path d={`${path} L${GW},${GH / 2} L0,${GH / 2} Z`} fill="rgba(143,227,74,.12)" />
        <path d={path} stroke="#9fe86a" strokeWidth={1.2} fill="none" />
        {BANDS.map((b) => (
          <circle
            key={b.key}
            cx={fx(eq[b.freq])}
            cy={gy(eq[b.gain])}
            r={3.5}
            fill={b.color}
            stroke="#11161a"
            className="cursor-move"
            onPointerDown={dragBand(b)}
            onDoubleClick={() => setEq(t.index, { [b.gain]: 0 }, b.key)}
            onMouseEnter={() => hint(`${label} EQ ${b.name}: ${fmtDb(eq[b.gain])} @ ${fmtHz(eq[b.freq])}`)}
          />
        ))}
      </svg>
      <div className="mt-[2px] grid grid-cols-3">
        {BANDS.map((b) => {
          const range = EQ_FREQ[b.key]
          return (
            <div key={b.key} className="flex items-center justify-center gap-[3px]">
              <span className="w-[22px] text-right text-[9px]" style={{ color: b.color }}>
                {b.name}
              </span>
              <div title="" onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} EQ ${b.name} gain: ${fmtDb(eq[b.gain])}`))}>
                <TinyKnob
                  size={18}
                  bipolar
                  value={(eq[b.gain] + EQ_GAIN_MAX) / (2 * EQ_GAIN_MAX)}
                  color={b.color}
                  onChange={(v) => {
                    const g = Math.round((v * 2 - 1) * EQ_GAIN_MAX * 10) / 10
                    setEq(t.index, { [b.gain]: g }, `${b.key}g`)
                    hint(`${label} EQ ${b.name} gain: ${fmtDb(g)}`)
                  }}
                  onReset={() => setEq(t.index, { [b.gain]: 0 }, `${b.key}g`)}
                />
              </div>
              <div onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} EQ ${b.name} frequency: ${fmtHz(eq[b.freq])}`))}>
                <TinyKnob
                  size={14}
                  value={freqToNorm(eq[b.freq], range)}
                  color="#aab6bb"
                  onChange={(v) => {
                    const f = Math.round(normToFreq(v, range))
                    setEq(t.index, { [b.freq]: f }, `${b.key}f`)
                    hint(`${label} EQ ${b.name} frequency: ${fmtHz(f)}`)
                  }}
                  onReset={() => setEq(t.index, { [b.freq]: b.def }, `${b.key}f`)}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── PDC (latency compensation) ─────────────────────────────────────────────────
function PdcRow({ t }: { t: MixerTrack }) {
  const label = trackLabel(t)
  const lat = useRef(t.latencyComp)
  lat.current = t.latencyComp
  const set = (v: number) => {
    const ms = Math.max(0, Math.min(500, Math.round(v)))
    setTrack(t.index, { latencyComp: ms }, 'Track latency', `mx:${t.index}:lat`)
    hint(`${label} latency compensation: ${ms ? `${ms} ms` : 'none'}`)
  }
  return (
    <div
      className="flex h-[18px] cursor-ns-resize items-center gap-1 rounded-[2px] border border-[#1b2124] bg-[#262e32] px-1 fl-inset"
      onMouseEnter={(e) => (e.stopPropagation(), hint(`${label} latency compensation: ${t.latencyComp} ms (drag / wheel, double-click to reset)`))}
      onWheel={(e) => set(t.latencyComp - Math.sign(e.deltaY))}
      onDoubleClick={() => set(0)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const sy = e.clientY
        const start = lat.current
        const move = (ev: PointerEvent) => set(start + (sy - ev.clientY) / 2)
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    >
      <Clock size={10} className={t.latencyComp ? 'text-fl-green' : 'text-[#8b989e]'} />
      <span className="flex-1 text-[10px] text-[#d3dadd]">{t.latencyComp ? `${t.latencyComp} ms` : '(none)'}</span>
      <span className="text-[10px] text-[#7d8a90]">PDC</span>
    </div>
  )
}
