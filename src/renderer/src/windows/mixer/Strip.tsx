// One mixer track strip, FL Studio 20/21 compact layout (~32 px): track number, vertical name with
// the peak meter beside it, mute LED, pan, fader, phase/swap, stereo separation, FX-off/latency,
// record arm and the send switch (+ send level knob when the selected track routes here).
import { memo, useState } from 'react'
import { ArrowLeftRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Led } from '@/components/controls'
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
import { IconToggle, SlimFader, TinyKnob } from './widgets'
import { DEFAULT_TRACK_COLOR, TRACK_COLORS, useMixerView } from './state'
import {
  addEffectAndOpen,
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
  /** height of the top name + peak meter area */
  nameH: number
  faderH: number
  /** muted because another track is soloed */
  soloMuted: boolean
}

export const Strip = memo(function Strip({ index, width, nameH, faderH, soloMuted }: StripProps) {
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
  const usedFx = t.slots.filter(Boolean).length

  const hoverHint = () => hint(`${label}${linked ? ` — linked: ${linked}` : ''}${usedFx ? ` — FX: ${usedFx}` : ''}`)
  const ctlHint = (s: string) => (e: React.MouseEvent) => {
    e.stopPropagation()
    hint(s)
  }

  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    // the send switch / send knob act on the *selected* track: never change the selection there
    if ((e.target as HTMLElement).closest('[data-route]')) return
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
  const setLatency = (ms: number) => {
    const v = Math.max(0, Math.min(500, ms))
    setTrack(index, { latencyComp: v }, 'Track latency', `mx:${index}:lat`)
    hint(`${label} latency compensation: ${v ? `${v} ms` : 'none'}`)
  }

  const commitName = (name: string) => {
    useMixerView.getState().set({ renaming: null })
    const n = name.trim()
    if (n && n !== t.name) setTrack(index, { name: n }, 'Rename mixer track')
  }

  const bg = selected ? '#51636d' : inMulti ? '#48565d' : isMaster ? '#3f4b51' : index % 2 ? '#3b464c' : '#363f45'
  const meterW = isMaster ? (wide ? 12 : 9) : wide ? 9 : 7
  const knob = wide ? 20 : 18

  const body = (
    <div
      className={cn('relative flex h-full flex-col items-stretch border-r border-[#232b2f] pb-[2px]', dropHover && 'outline outline-1 -outline-offset-1 outline-fl-orange')}
      style={{ width, background: bg }}
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
        if (addEffectAndOpen(index, id) < 0) hint(`${label}: no free effect slot`)
      }}
    >
      {/* track number */}
      <div
        className={cn('flex h-[14px] shrink-0 items-center justify-center text-[9px] font-semibold leading-none', selected ? 'bg-[#6f8792] text-white' : 'bg-[#2b3337] text-[#9aa7ad]')}
        onDoubleClick={() => useMixerView.getState().set({ renaming: index })}
      >
        {isMaster ? 'M' : index}
      </div>
      {/* color / icon bar */}
      <div className="h-[2px] shrink-0" style={{ background: colored ? color : selected ? '#8aa3ae' : 'transparent' }} />

      {/* vertical name + peak meter */}
      <div className="flex shrink-0 items-stretch justify-center gap-[2px] px-[2px] pt-[2px]" style={{ height: nameH }}>
        <div
          className="flex min-w-0 flex-1 items-end justify-center overflow-hidden pb-[1px]"
          onDoubleClick={() => useMixerView.getState().set({ renaming: index })}
          onMouseEnter={ctlHint(`${label}${linked ? ` — linked: ${linked}` : ''} (double-click / F2 to rename)`)}
        >
          <span
            className={cn('overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-[11px]', selected ? 'text-white' : colored ? 'text-[#e2e8eb]' : 'text-[#c3ccd0]', effMuted && 'opacity-50')}
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: nameH - 4 }}
          >
            {t.name}
          </span>
        </div>
        <div className={cn('shrink-0', effMuted && 'opacity-50')}>
          <StereoMeter index={index} height={nameH - 2} width={meterW} label={label} />
        </div>
      </div>

      {/* mute / solo LED */}
      <div
        className="flex h-[14px] shrink-0 items-center justify-center gap-[2px]"
        data-ctl
        onMouseEnter={ctlHint(`${label}: ${t.solo ? 'solo' : effMuted ? 'muted' : 'on'} — click: mute, right-click / Ctrl+click: solo, Alt+click: solo with sources, Ctrl+right-click: unmute all`)}
      >
        <Led
          on={!effMuted}
          size={9}
          color={t.solo ? '#c6ff6a' : 'var(--fl-green)'}
          title=""
          className={t.solo ? 'ring-1 ring-[#c6ff6a]/70' : undefined}
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
      </div>

      {/* pan */}
      <div className="flex h-[22px] shrink-0 items-center justify-center" data-ctl onMouseEnter={ctlHint(`${label} panning: ${fmtPan(t.pan)}`)}>
        <TinyKnob size={knob} value={(t.pan + 1) / 2} bipolar color="#e3b06a" onChange={setPan} onReset={() => setPan(0.5)} />
      </div>

      {/* level fader */}
      <div className="flex shrink-0 justify-center px-[4px] py-[2px]" data-ctl style={{ height: faderH }} onMouseEnter={ctlHint(`${label} volume: ${volDb(t.volume)}`)}>
        <SlimFader value={Math.min(1, t.volume)} height={faderH - 4} width={Math.min(width - 8, wide ? 26 : 22)} accent={selected} onChange={setVol} onReset={() => setVol(0.8)} />
      </div>

      {/* invert phase / swap stereo */}
      <div className="flex h-[13px] shrink-0 items-center justify-center gap-[1px]">
        <IconToggle
          on={t.phaseInvert}
          onClick={() => setTrack(index, { phaseInvert: !t.phaseInvert }, 'Invert phase')}
          onHover={() => hint(`${label}: invert polarity ${t.phaseInvert ? '(on)' : '(off)'}`)}
        >
          <span className="text-[9px] font-normal">Ø</span>
        </IconToggle>
        <IconToggle
          on={t.swapLR}
          onClick={() => setTrack(index, { swapLR: !t.swapLR }, 'Swap left/right')}
          onHover={() => hint(`${label}: swap left and right ${t.swapLR ? '(on)' : '(off)'}`)}
        >
          <ArrowLeftRight size={8} strokeWidth={2.5} />
        </IconToggle>
      </div>

      {/* stereo separation */}
      <div className="flex h-[18px] shrink-0 items-center justify-center" data-ctl onMouseEnter={ctlHint(`${label} stereo separation: ${fmtSep(t.stereoSep)}`)}>
        <TinyKnob size={14} value={(t.stereoSep + 1) / 2} bipolar color="#8cc4e6" onChange={setSep} onReset={() => setSep(0.5)} />
      </div>

      {/* disable FX / latency */}
      <div className="flex h-[13px] shrink-0 items-center justify-center gap-[1px]">
        <IconToggle
          on={!t.fxEnabled}
          activeColor="#ff6a5c"
          onClick={() => setTrack(index, { fxEnabled: !t.fxEnabled }, t.fxEnabled ? 'Disable track effects' : 'Enable track effects')}
          onHover={() => hint(`${label}: ${t.fxEnabled ? 'effects enabled — click to disable all FX' : 'all effects DISABLED — click to enable'}`)}
          className={!t.fxEnabled ? 'line-through' : undefined}
        >
          fx
        </IconToggle>
        <IconToggle
          on={t.latencyComp > 0}
          activeColor="#8fe34a"
          onHover={() => hint(`${label} latency compensation: ${t.latencyComp ? `${t.latencyComp} ms` : 'none'} (wheel to change, double-click to reset)`)}
          onWheel={(e) => setLatency(t.latencyComp - Math.sign(e.deltaY))}
          onDoubleClick={() => setLatency(0)}
        >
          <Clock size={8} strokeWidth={2.5} />
        </IconToggle>
      </div>

      {/* record arm */}
      <div className="flex h-[12px] shrink-0 items-center justify-center" data-ctl>
        <button
          className="grid h-[11px] w-[11px] place-items-center"
          onClick={() => setTrack(index, { armed: !t.armed }, t.armed ? 'Disarm mixer track' : 'Arm mixer track')}
          onMouseEnter={ctlHint(`${label}: ${t.armed ? 'armed for recording' : 'arm disk recording'}${t.inputDevice ? '' : ' (no input selected)'}`)}
        >
          <span
            className="block h-[7px] w-[7px] rounded-full border"
            style={t.armed ? { background: '#ff4b3e', borderColor: '#7a1d17', boxShadow: '0 0 4px #ff4b3e' } : { background: '#2a3236', borderColor: '#171c1e' }}
          />
        </button>
      </div>

      {/* send switch / send level */}
      <RouteArea index={index} sel={sel} selSend={selSend} feedsSelected={feedsSelected} label={label} />

      {renaming && (
        <input
          autoFocus
          defaultValue={t.name}
          className="absolute left-0 top-[18px] z-20 h-[18px] w-[130px] rounded-sm border border-fl-orange bg-fl-well px-1 text-[11px] text-white outline-none"
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
  const box = 'flex h-[30px] shrink-0 flex-col items-center justify-start'
  if (index === sel) {
    return (
      <div className={box} onMouseEnter={(e) => (e.stopPropagation(), hint(`${label}: selected track — click another track's send switch to route to it`))}>
        <svg width="12" height="8" viewBox="0 0 12 8" className="mt-[2px]">
          <path d="M6 0.5 L11.5 7.5 L0.5 7.5 Z" fill="none" stroke="#9fe86a" strokeWidth="1.2" />
        </svg>
      </div>
    )
  }
  if (sel === 0) return <div className={box} />
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={box}
          data-ctl
          data-route
          onMouseEnter={(e) => {
            e.stopPropagation()
            hint(selSend ? `Send from ${selName} to ${label}: ${sendDb(selSend.level)} (click switch to remove)` : `Route ${selName} to ${label} (right-click: route to this track only)`)
          }}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <button className="mt-[2px] grid h-[8px] w-[14px] place-items-center" onClick={() => toggleSend(sel, index)} title="">
            <svg width="12" height="8" viewBox="0 0 12 8">
              <path
                d="M6 0.5 L11.5 7.5 L0.5 7.5 Z"
                fill={selSend ? '#8fe34a' : feedsSelected ? '#f79a2e' : '#262e32'}
                stroke={selSend ? '#4d7a2a' : feedsSelected ? '#8a5418' : '#161b1d'}
                strokeWidth="1"
              />
            </svg>
          </button>
          {selSend && (
            <div className="mt-[2px]">
              <TinyKnob
                size={16}
                value={Math.min(1, selSend.level / 1.25)}
                color="var(--fl-green)"
                onChange={(v) => {
                  setSendLevel(sel, index, v * 1.25)
                  hint(`Send from ${selName} to ${label}: ${sendDb(v * 1.25)}`)
                }}
                onReset={() => setSendLevel(sel, index, 1)}
              />
            </div>
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
