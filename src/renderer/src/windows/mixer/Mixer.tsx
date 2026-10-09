// FL Studio 20/21 style Mixer: Master docked left, 125 inserts in a horizontally scrolling
// (virtualized) row, routing cables under the strips and the track inspector on the right.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Columns2, Columns3, PanelRight, Cable } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MdiWindow } from '@/shell/MdiWindow'
import { useWindowKeys } from '@/shell/keys'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { MIXER_INSERTS, type MixerTrack } from '@/store/types'
import type { WindowProps } from '../types'
import { MASTER_W, STRIP_FIXED_H, STRIP_W, useMixerView } from './state'
import { Strip } from './Strip'
import { TrackPanel } from './TrackPanel'
import {
  linkChannels,
  resetTrack,
  selectTrack,
  selectedTracks,
  setTracks,
  soloAudible,
  soloTrack,
  soloWithSources,
  swapTracks,
  toggleMute,
  unmuteAll
} from './ops'

const CABLE_H = 22
const OVERSCAN = 2

export default function Mixer({ win, bounds }: WindowProps) {
  const layout = useMixerView((s) => s.layout)
  const inspector = useMixerView((s) => s.inspector)
  const cables = useMixerView((s) => s.cables)
  const sel = useUI((s) => s.selectedMixerTrack)
  const mixer = useProject((s) => s.project.mixer)
  const sw = STRIP_W[layout]
  const mw = MASTER_W[layout]

  const scrollRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 800, height: 400 })

  useLayoutEffect(() => {
    const el = scrollRef.current
    const area = areaRef.current
    if (!el || !area) return
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth, height: area.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    ro.observe(area)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [win.open, win.minimized])

  // keep the selected track visible
  useEffect(() => {
    const el = scrollRef.current
    if (!el || sel <= 0) return
    const x = (sel - 1) * sw
    if (x < el.scrollLeft) el.scrollLeft = x
    else if (x + sw > el.scrollLeft + el.clientWidth) el.scrollLeft = x + sw - el.clientWidth
  }, [sel, sw])

  // solo state → which strips look muted
  const audible = useMemo(() => soloAudible(mixer), [mixer])

  const stripH = Math.max(0, view.height - (cables ? CABLE_H : 0) - 10 /* scrollbar */)
  const faderH = Math.max(60, stripH - STRIP_FIXED_H)
  const first = Math.max(1, Math.floor(view.left / sw) + 1 - OVERSCAN)
  const last = Math.min(MIXER_INSERTS, Math.ceil((view.left + view.width) / sw) + OVERSCAN)
  const visible: number[] = []
  for (let i = first; i <= last; i++) visible.push(i)

  // ── keyboard ────────────────────────────────────────────────────────────────
  const onKey = useCallback((e: KeyboardEvent): boolean => {
    const ui = useUI.getState()
    const cur = ui.selectedMixerTrack
    const ctrl = e.ctrlKey || e.metaKey
    const plainLetter = !ctrl && !e.altKey && e.code.startsWith('Key')
    if (plainLetter && ui.typingKeyboard) return false
    switch (true) {
      case e.code === 'ArrowLeft' && e.altKey:
        if (cur > 1) {
          swapTracks(cur, cur - 1)
          selectTrack(cur - 1)
        }
        return true
      case e.code === 'ArrowRight' && e.altKey:
        if (cur >= 1 && cur < MIXER_INSERTS) {
          swapTracks(cur, cur + 1)
          selectTrack(cur + 1)
        }
        return true
      case e.code === 'ArrowLeft' && !ctrl:
        selectTrack(Math.max(0, cur - 1), e.shiftKey ? 'range' : 'set')
        return true
      case e.code === 'ArrowRight' && !ctrl:
        selectTrack(Math.min(MIXER_INSERTS, cur + 1), e.shiftKey ? 'range' : 'set')
        return true
      case e.code === 'Home':
        selectTrack(0)
        return true
      case e.code === 'F2':
        useMixerView.getState().set({ renaming: cur })
        return true
      case ctrl && e.shiftKey && e.code === 'KeyL':
        linkChannels(cur, true)
        return true
      case ctrl && e.code === 'KeyL':
        linkChannels(cur, false)
        return true
      case ctrl && e.code === 'KeyA':
        useMixerView.getState().set({ multi: Array.from({ length: MIXER_INSERTS + 1 }, (_, i) => i) })
        return true
      case e.altKey && e.code === 'KeyS':
        soloWithSources(cur)
        return true
      case !ctrl && !e.altKey && e.code === 'KeyS':
        soloTrack(cur)
        return true
      case !ctrl && !e.altKey && e.code === 'KeyM':
        toggleMute(cur)
        return true
      case e.code === 'Escape':
        useMixerView.getState().set({ multi: [], renaming: null })
        return true
      default:
        return false
    }
  }, [])
  useWindowKeys('mixer', onKey)

  // ── cables ──────────────────────────────────────────────────────────────────
  const xOf = (i: number) => (i === 0 ? mw / 2 : mw + (i - 1) * sw + sw / 2 - view.left)
  const totalW = mw + view.width
  const cablePaths = useMemo(() => {
    if (!cables) return []
    const out: { d: string; color: string; head: [number, number]; dim: boolean }[] = []
    const add = (from: number, to: number, color: string, dim: boolean) => {
      const x1 = xOf(from)
      const x2 = xOf(to)
      if ((x1 < mw && x2 < mw && from !== 0 && to !== 0) || (x1 > totalW && x2 > totalW)) return
      const depth = Math.min(CABLE_H - 4, 6 + Math.abs(x2 - x1) / 30)
      out.push({ d: `M${x1},1 C${x1},${depth + 2} ${x2},${depth + 2} ${x2},4`, color, head: [x2, 2], dim })
    }
    const t = mixer[sel]
    if (t && sel !== 0) for (const s of t.sends) add(sel, s.target, '#8fe34a', false)
    if (sel !== 0) for (const m of mixer) if (m.index !== sel && m.sends.some((s) => s.target === sel)) add(m.index, sel, '#f79a2e', true)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cables, mixer, sel, view.left, view.width, sw, mw])

  const multi = useMixerView((s) => s.multi)
  const selList = multi.length ? multi : [sel]

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid h-4 w-4 place-items-center rounded-sm hover:bg-white/10" data-nodrag>
        <ChevronDown size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[230px]">
        <DropdownMenuLabel>Mixer</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuCheckboxItem checked={layout === 'narrow'} onSelect={() => useMixerView.getState().set({ layout: 'narrow' })}>
              Narrow strips
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={layout === 'wide'} onSelect={() => useMixerView.getState().set({ layout: 'wide' })}>
              Wide strips
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={inspector} onSelect={() => useMixerView.getState().set({ inspector: !inspector })}>
              Track inspector
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={cables} onSelect={() => useMixerView.getState().set({ cables: !cables })}>
              Routing cables
            </DropdownMenuCheckboxItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useMixerView.getState().set({ multi: Array.from({ length: MIXER_INSERTS + 1 }, (_, i) => i) })}>
          Select all<DropdownMenuShortcut>Ctrl+A</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => useMixerView.getState().set({ multi: [] })}>Deselect</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => useMixerView.getState().set({ renaming: sel })}>
          Rename selected track<DropdownMenuShortcut>F2</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => linkChannels(sel, false)}>
          Link selected channels to track<DropdownMenuShortcut>Ctrl+L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => linkChannels(sel, true)}>
          ...starting from this track<DropdownMenuShortcut>Ctrl+Shift+L</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => soloTrack(sel)}>
          Solo selected<DropdownMenuShortcut>S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => unmuteAll()}>Unmute / unsolo all</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTracks(selectedTracks(), { armed: true }, 'Arm mixer tracks')}>Arm selected for recording</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTracks(selList, { armed: false }, 'Disarm mixer tracks')}>Disarm selected</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => selectedTracks().forEach((i) => resetTrack(i))}>Reset selected tracks</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            setTracks(
              selectedTracks().filter((i) => i > 0),
              { sends: [{ target: 0, level: 1 }] } as Partial<MixerTrack>,
              'Reset routing'
            )
          }
        >
          Reset routing of selected (to Master)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const titleExtra = (
    <div className="ml-2 flex items-center gap-[2px]">
      <LayoutBtn active={layout === 'narrow'} onClick={() => useMixerView.getState().set({ layout: 'narrow' })} hint="Mixer layout: narrow strips">
        <Columns3 size={11} />
      </LayoutBtn>
      <LayoutBtn active={layout === 'wide'} onClick={() => useMixerView.getState().set({ layout: 'wide' })} hint="Mixer layout: wide strips">
        <Columns2 size={11} />
      </LayoutBtn>
      <LayoutBtn active={cables} onClick={() => useMixerView.getState().set({ cables: !cables })} hint="Show routing cables">
        <Cable size={11} />
      </LayoutBtn>
      <LayoutBtn active={inspector} onClick={() => useMixerView.getState().set({ inspector: !inspector })} hint="Show track inspector (FX slots, EQ, I/O)">
        <PanelRight size={11} />
      </LayoutBtn>
      {selList.length > 1 && <span className="ml-1 text-[10px] text-fl-dim">{selList.length} selected</span>}
    </div>
  )

  return (
    <MdiWindow win={win} bounds={bounds} menu={menu} titleExtra={titleExtra} minW={420} minH={300}>
      <div className="flex h-full bg-[#2a3236]">
        <div ref={areaRef} className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {/* Master, docked left */}
            <div className="shrink-0 border-r-2 border-[#151a1c]" style={{ height: stripH }}>
              <Strip index={0} width={mw} faderH={faderH} soloMuted={false} />
            </div>
            {/* Inserts (virtualized) */}
            <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-scroll overflow-y-hidden">
              <div className="relative" style={{ width: MIXER_INSERTS * sw, height: stripH }}>
                {visible.map((i) => (
                  <div key={i} className="absolute top-0" style={{ left: (i - 1) * sw, height: stripH }}>
                    <Strip index={i} width={sw} faderH={faderH} soloMuted={!!audible && !audible.has(i)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {cables && (
            <svg className="pointer-events-none shrink-0" width={totalW} height={CABLE_H} style={{ background: '#20272a' }}>
              <defs>
                <clipPath id="mixer-cable-clip">
                  <rect x={0} y={0} width={totalW} height={CABLE_H} />
                </clipPath>
              </defs>
              <g clipPath="url(#mixer-cable-clip)">
                {cablePaths.map((c, k) => (
                  <g key={k} opacity={c.dim ? 0.75 : 1}>
                    <path d={c.d} stroke="#0e1213" strokeWidth={4} fill="none" strokeLinecap="round" />
                    <path d={c.d} stroke={c.color} strokeWidth={2} fill="none" strokeLinecap="round" />
                    <path d={`M${c.head[0] - 4},${c.head[1] + 5} L${c.head[0]},${c.head[1] - 1} L${c.head[0] + 4},${c.head[1] + 5} Z`} fill={c.color} />
                  </g>
                ))}
              </g>
            </svg>
          )}
        </div>
        {inspector && <TrackPanel index={sel} />}
      </div>
    </MdiWindow>
  )
}

function LayoutBtn({ active, onClick, hint, children }: { active: boolean; onClick: () => void; hint: string; children: React.ReactNode }) {
  return (
    <button
      className={cn('grid h-[16px] w-[18px] place-items-center rounded-[2px] border border-[#1e2427]', active ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#46525a] text-fl-text hover:bg-[#515e66]')}
      onClick={onClick}
      onMouseEnter={() => useUI.getState().setHint(hint)}
    >
      {children}
    </button>
  )
}
