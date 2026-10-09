// One mixer track strip (FL Studio 20 layout): mute LED, pan, stereo separation, fader + stereo
// peak meter with the name written vertically, track number, record arm and the route switch.
import { memo, useState } from 'react'
import { ArrowDown, Disc } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Fader, Knob, Led } from '@/components/controls'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { MIXER_INSERTS } from '@/store/types'
import { StereoMeter } from './Meter'
import { DEFAULT_TRACK_COLOR, TRACK_COLORS, useMixerView } from './state'
import {
  addEffectToTrack,
  fmtPan,
  fmtSep,
  linkChannels,
  resetTrack,
  routeOnly,
  routeOnlyMany,
  selectTrack,
  selectedTracks,
  sendDb,
  setSendLevel,
  setTrack,
  soloTrack,
  soloWithSources,
  swapTracks,
  toggleMute,
  toggleSend,
  trackLabel,
  unmuteAll,
  volDb
} from './ops'

const hint = (s: string) => useUI.getState().setHint(s)

export interface StripProps {
  index: number
  width: number
  faderH: number
  /** muted because another track is soloed */
  soloMuted: boolean
}

export const Strip = memo(function Strip({ index, width, faderH, soloMuted }: StripProps) {
  const t = useProject((s) => s.project.mixer[index])
  const sel = useUI((s) => s.selectedMixerTrack)
  const selected = sel === index
  const inMulti = useMixerView((s) => s.multi.length > 1 && s.multi.includes(index))
  const renaming = useMixerView((s) => s.renaming === index)
  const layout = useMixerView((s) => s.layout)
  // send from the selected track into this one (route switch state)
  const selSend = useProject((s) => (sel !== index ? s.project.mixer[sel]?.sends.find((x) => x.target === index) : undefined))
  const feedsSelected = useProject((s) => sel !== index && !!s.project.mixer[index]?.sends.some((x) => x.target === sel))
  const linked = useProject((s) => s.project.channels.filter((c) => c.mixerTrack === index).map((c) => c.name).join(', '))
  const linkedColor = useProject((s) => s.project.channels.find((c) => c.mixerTrack === index)?.color ?? '')
  const [dropHover, setDropHover] = useState(false)
  if (!t) return null

  const isMaster = index === 0
  const label = trackLabel(t)
  const color = t.color !== DEFAULT_TRACK_COLOR ? t.color : linkedColor || DEFAULT_TRACK_COLOR
  const colored = color !== DEFAULT_TRACK_COLOR
  const effMuted = t.muted || soloMuted
  const wide = layout === 'wide'
  const knobS = wide ? 26 : 24

  const hoverHint = () =>
    hint(`${label}${linked ? ` — linked: ${linked}` : ''}${t.slots.some(Boolean) ? ` — FX: ${t.slots.filter(Boolean).length}` : ''}`)

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const ctl = (e.target as HTMLElement).closest('[data-ctl],svg,canvas,button,input')
    if (!ctl && (e.ctrlKey || e.metaKey)) selectTrack(index, 'toggle')
    else if (!ctl && e.shiftKey) selectTrack(index, 'range')
    else if (sel !== index || useMixerView.getState().multi.length > 1) {
      if (!ctl || !useMixerView.getState().multi.includes(index)) selectTrack(index)
    }
  }

  const setVol = (v: number) => {
    setTrack(index, { volume: v }, 'Mixer track volume', `mx:${index}:vol`)
    hint(`${label} volume: ${volDb(v)}`)
  }
  const setPan = (v: number) => {
    const pan = Math.abs(v * 2 - 1) < 0.01 ? 0 : v * 2 - 1
    setTrack(index, { pan }, 'Mixer track panning', `mx:${index}:pan`)
    hint(`${label} panning: ${fmtPan(pan)}`)
  }
  const setSep = (v: number) => {
    const stereoSep = Math.abs(v * 2 - 1) < 0.01 ? 0 : v * 2 - 1
    setTrack(index, { stereoSep }, 'Mixer track stereo separation', `mx:${index}:sep`)
    hint(`${label} stereo separation: ${fmtSep(stereoSep)}`)
  }

  const commitName = (name: string) => {
    useMixerView.getState().set({ renaming: null })
    const n = name.trim()
    if (n && n !== t.name) setTrack(index, { name: n }, 'Rename mixer track')
  }

  const body = (
    <div
      className={cn(
        'relative flex h-full flex-col items-stretch border-r border-[#1e2427]',
        selected ? 'bg-[#56636a]' : inMulti ? 'bg-[#4c585e]' : isMaster ? 'bg-[#3f4a50]' : 'bg-[#39444a]',
        dropHover && 'outline outline-1 -outline-offset-1 outline-fl-orange'
      )}
      style={{ width }}
      onPointerDownCapture={onPointerDownCapture}
      onMouseEnter={hoverHint}
      onWheel={(e) => {
        if (!e.shiftKey || isMaster) return
        const j = index + (e.deltaY > 0 ? 1 : -1)
        if (j < 1 || j > MIXER_INSERTS) return
        swapTracks(index, j)
        selectTrack(j)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-arkane-plugin')) {
          e.preventDefault()
          setDropHover(true)
        }
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => {
        setDropHover(false)
        const id = e.dataTransfer.getData('application/x-arkane-plugin')
        if (!id) return
        e.preventDefault()
        selectTrack(index)
        if (addEffectToTrack(index, id) < 0) hint(`${label}: no free effect slot`)
      }}
    >
      {/* color bar */}
      <div className="h-[3px] shrink-0" style={{ background: colored ? color : selected ? '#7b878d' : '#4a555b' }} />

      {/* mute / solo LED */}
      <div
        className="flex h-[18px] shrink-0 items-center justify-center gap-1"
        data-ctl
        onMouseEnter={(e) => {
          e.stopPropagation()
          hint(`${label}: ${t.solo ? 'solo' : effMuted ? 'muted' : 'on'} — click: mute, right-click / Ctrl+click: solo, Alt+click: solo with sources, Ctrl+right-click: unmute all`)
        }}
      >
        <Led
          on={!effMuted}
          size={11}
          color={t.solo ? '#b6ff5a' : 'var(--fl-green)'}
          title=""
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey) soloTrack(index, e.shiftKey)
            else if (e.altKey) soloWithSources(index)
            else toggleMute(index)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.ctrlKey || e.metaKey) unmuteAll()
            else soloTrack(index)
          }}
        />
        {t.solo && <span className="text-[8px] font-bold leading-none text-[#b6ff5a]">S</span>}
      </div>

      {/* pan */}
      <div
        className="flex h-[30px] shrink-0 items-center justify-center"
        data-ctl
        onMouseEnter={(e) => {
          e.stopPropagation()
          hint(`${label} panning: ${fmtPan(t.pan)}`)
        }}
      >
        <Knob size={knobS} value={(t.pan + 1) / 2} bipolar color="#d7a050" labelPosition="none" onChange={setPan} onReset={() => setPan(0.5)} />
      </div>

      {/* stereo separation */}
      <div
        className="flex h-[26px] shrink-0 items-center justify-center"
        data-ctl
        onMouseEnter={(e) => {
          e.stopPropagation()
          hint(`${label} stereo separation: ${fmtSep(t.stereoSep)}`)
        }}
      >
        <Knob size={18} value={(t.stereoSep + 1) / 2} bipolar color="#7fb6d8" labelPosition="none" onChange={setSep} onReset={() => setSep(0.5)} />
      </div>

      {/* fader zone: vertical name | fader | meter */}
      <div className="flex shrink-0 items-stretch justify-center gap-[3px] px-[2px] py-1" style={{ height: faderH + 8 }}>
        <div
          className="relative w-[12px] shrink-0 overflow-hidden rounded-[2px]"
          style={{ background: colored ? `${color}55` : 'rgba(0,0,0,.12)' }}
          onDoubleClick={() => useMixerView.getState().set({ renaming: index })}
        >
          <span
            className={cn('absolute bottom-1 left-1/2 origin-bottom-left whitespace-nowrap text-[10px] leading-[12px]', selected ? 'text-white' : 'text-[#cfd7db]')}
            style={{ transform: 'rotate(-90deg) translateY(50%)', maxWidth: faderH - 4, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {t.name}
          </span>
        </div>
        <div
          data-ctl
          onMouseEnter={(e) => {
            e.stopPropagation()
            hint(`${label} volume: ${volDb(t.volume)}`)
          }}
        >
          <Fader value={Math.min(1, t.volume)} unity={0.8} height={faderH} width={wide ? 22 : 18} onChange={setVol} onReset={() => setVol(0.8)} />
        </div>
        <StereoMeter index={index} height={faderH} width={isMaster ? 12 : wide ? 11 : 9} label={label} />
      </div>

      {/* track number */}
      <div
        className={cn('mx-[3px] flex h-[15px] shrink-0 items-center justify-center rounded-[2px] text-[10px] font-semibold leading-none', selected ? 'text-[#1b1f22]' : 'text-[#c5cdd1]')}
        style={{ background: selected ? '#d9e2e6' : colored ? `${color}aa` : '#2c3438' }}
        onDoubleClick={() => useMixerView.getState().set({ renaming: index })}
      >
        {isMaster ? 'M' : index}
      </div>

      {/* record arm */}
      <div className="flex h-[18px] shrink-0 items-center justify-center" data-ctl>
        <button
          className={cn('grid h-[14px] w-[14px] place-items-center rounded-full', t.armed ? 'text-[#ff4b3e]' : 'text-[#6b777d] hover:text-[#9aa6ac]')}
          onClick={() => setTrack(index, { armed: !t.armed }, t.armed ? 'Disarm mixer track' : 'Arm mixer track')}
          onMouseEnter={(e) => {
            e.stopPropagation()
            hint(`${label}: ${t.armed ? 'armed for recording' : 'arm disk recording'}${t.inputDevice ? '' : ' (no input selected)'}`)
          }}
        >
          <Disc size={12} fill={t.armed ? '#ff4b3e' : 'transparent'} strokeWidth={2} />
        </button>
      </div>

      {/* route switch / send knob */}
      <RouteArea index={index} sel={sel} selSend={selSend} feedsSelected={feedsSelected} label={label} />

      {renaming && (
        <input
          autoFocus
          defaultValue={t.name}
          className="absolute bottom-[70px] left-0 z-20 h-[20px] w-[130px] rounded-sm border border-fl-orange bg-fl-well px-1 text-[11px] text-white outline-none"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => commitName(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commitName(e.currentTarget.value)
            if (e.key === 'Escape') useMixerView.getState().set({ renaming: null })
          }}
        />
      )}
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{body}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[220px]">
        <ContextMenuItem disabled className="opacity-100 font-semibold text-fl-orange">
          {label}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => useMixerView.getState().set({ renaming: index })}>
          Rename<ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Color</ContextMenuSubTrigger>
          <ContextMenuSubContent className="grid w-[136px] grid-cols-4 gap-1 p-1.5">
            {TRACK_COLORS.map((c) => (
              <ContextMenuItem key={c} className="h-6 w-7 rounded-sm p-0" style={{ background: c }} onSelect={() => setTrack(index, { color: c }, 'Color mixer track')} />
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        {!isMaster && (
          <>
            <ContextMenuItem onSelect={() => linkChannels(index, false)}>
              Link selected channels to this track<ContextMenuShortcut>Ctrl+L</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => linkChannels(index, true)}>
              ...starting from this track<ContextMenuShortcut>Ctrl+Shift+L</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        {sel !== index && sel !== 0 && (
          <ContextMenuItem onSelect={() => routeOnlyMany(selectedTracks().filter((x) => x !== index), index)}>Route selected tracks to this track only</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setTrack(index, { fxEnabled: !t.fxEnabled }, t.fxEnabled ? 'Disable track effects' : 'Enable track effects')}>
          {t.fxEnabled ? 'Disable effects' : 'Enable effects'}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => setTrack(index, { armed: !t.armed }, 'Arm mixer track')}>{t.armed ? 'Disarm recording' : 'Arm for recording'}</ContextMenuItem>
        {!isMaster && (
          <>
            <ContextMenuItem disabled={index <= 1} onSelect={() => (swapTracks(index, index - 1), selectTrack(index - 1))}>
              Move left<ContextMenuShortcut>Alt+←</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem disabled={index >= MIXER_INSERTS} onSelect={() => (swapTracks(index, index + 1), selectTrack(index + 1))}>
              Move right<ContextMenuShortcut>Alt+→</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => resetTrack(index)}>Reset track (keep FX & routing)</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

function RouteArea({ index, sel, selSend, feedsSelected, label }: { index: number; sel: number; selSend: { target: number; level: number } | undefined; feedsSelected: boolean; label: string }) {
  const selName = useProject((s) => (s.project.mixer[sel] ? trackLabel(s.project.mixer[sel]) : ''))
  if (index === sel) {
    return (
      <div className="flex h-[34px] shrink-0 items-center justify-center" onMouseEnter={(e) => (e.stopPropagation(), hint(`${label}: selected track (output)`))}>
        <ArrowDown size={16} strokeWidth={3} className="text-fl-green drop-shadow-[0_0_3px_rgba(143,227,74,.7)]" />
      </div>
    )
  }
  if (index === 0 && sel === 0) return <div className="h-[34px] shrink-0" />
  if (sel === 0) {
    return <div className="h-[34px] shrink-0" />
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative flex h-[34px] shrink-0 flex-col items-center justify-start"
          data-ctl
          onMouseEnter={(e) => {
            e.stopPropagation()
            hint(
              selSend
                ? `Send from ${selName} to ${label}: ${sendDb(selSend.level)} (click arrow to remove)`
                : `Route ${selName} to ${label} (right-click: route to this track only)`
            )
          }}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <button
            className="mt-[1px] h-[9px] w-[16px]"
            onClick={() => toggleSend(sel, index)}
            title=""
          >
            <svg width="16" height="9" viewBox="0 0 16 9">
              <path d="M8 0 L15 8 L1 8 Z" fill={selSend ? '#8fe34a' : feedsSelected ? '#f79a2e' : '#22292c'} stroke={selSend ? '#4d7a2a' : '#151a1c'} strokeWidth="1" />
            </svg>
          </button>
          {selSend && (
            <Knob
              size={20}
              value={Math.min(1, selSend.level / 1.25)}
              color="var(--fl-green)"
              labelPosition="none"
              onChange={(v) => {
                setSendLevel(sel, index, v * 1.25)
                hint(`Send from ${selName} to ${label}: ${sendDb(v * 1.25)}`)
              }}
              onReset={() => setSendLevel(sel, index, 1)}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => routeOnly(sel, index)}>Route to this track only</ContextMenuItem>
        <ContextMenuItem onSelect={() => toggleSend(sel, index)}>{selSend ? 'Remove route' : 'Route to this track'}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
