// Playlist window (FL Studio "Playlist - Arrangement").
import { useMemo, useRef } from 'react'
import { ChevronRight, Eraser, Magnet, MoveHorizontal, PanelLeft, Paintbrush, Pencil, Scissors, SquareDashedMousePointer, Volume2, VolumeX, ZoomIn } from 'lucide-react'
import { MdiWindow } from '@/shell/MdiWindow'
import { useWindowKeys } from '@/shell/keys'
import { useProject } from '@/store/project'
import { useUI, SNAP_LABELS, type Snap, type Tool } from '@/store/ui'
import { useTransport } from '@/store/transport'
import { songLength, barTicks } from '@/audio/sequence'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { WindowProps } from '../types'
import { Grid } from './Grid'
import { Ruler } from './Ruler'
import { TrackHeaders, HEADER_W } from './TrackHeaders'
import { Picker } from './Picker'
import { PopupMenuHost } from './PopupMenu'
import { PromptHost } from './Prompt'
import { trackOffsets } from './geometry'
import { getPl, usePlaylist } from './state'
import { currentSource, sourceColor, sourceName } from './actions'
import { playlistKey } from './keys'
import { RULER_H } from './render'

const TOOLS: { tool: Tool; key: string; name: string; icon: React.ReactNode }[] = [
  { tool: 'draw', key: 'P', name: 'Draw', icon: <Pencil size={12} /> },
  { tool: 'paint', key: 'B', name: 'Paint', icon: <Paintbrush size={12} /> },
  { tool: 'delete', key: 'D', name: 'Delete', icon: <Eraser size={12} /> },
  { tool: 'mute', key: 'T', name: 'Mute', icon: <VolumeX size={12} /> },
  { tool: 'slip', key: 'S', name: 'Slip', icon: <MoveHorizontal size={12} /> },
  { tool: 'slice', key: 'C', name: 'Slice', icon: <Scissors size={12} /> },
  { tool: 'select', key: 'E', name: 'Select', icon: <SquareDashedMousePointer size={12} /> },
  { tool: 'zoom', key: 'Z', name: 'Zoom', icon: <ZoomIn size={12} /> },
  { tool: 'play', key: 'Y', name: 'Playback', icon: <Volume2 size={12} /> }
]

const SB = 11 // scrollbar thickness

export default function Playlist({ win, bounds }: WindowProps) {
  const tracks = useProject((s) => s.project.playlist.tracks)
  const vZoom = usePlaylist((s) => s.vZoom)
  const picker = usePlaylist((s) => s.picker)
  const heights = useMemo(() => tracks.map((t) => t.height), [tracks])
  const offsets = useMemo(() => trackOffsets(heights, vZoom), [heights, vZoom])
  useWindowKeys('playlist', playlistKey)

  return (
    <MdiWindow win={win} bounds={bounds} titleExtra={<TitleExtra />} minW={420}>
      <div className="flex h-full bg-[#2f383d]">
        {picker && <Picker />}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 bg-[#262e32]" style={{ height: SB }}>
            <div style={{ width: HEADER_W }} className="shrink-0 border-r border-[#1d2326]" />
            <HScroll />
            <div style={{ width: SB }} className="shrink-0" />
          </div>
          <div className="flex shrink-0" style={{ height: RULER_H }}>
            <Corner />
            <div className="relative min-w-0 flex-1">
              <Ruler />
            </div>
            <div style={{ width: SB }} className="shrink-0 bg-[#262e32]" />
          </div>
          <div className="flex min-h-0 flex-1">
            <TrackHeaders offsets={offsets} />
            <div className="relative min-w-0 flex-1">
              <Grid offsets={offsets} />
            </div>
            <VScroll total={offsets[offsets.length - 1]} />
          </div>
        </div>
      </div>
      <PopupMenuHost />
      <PromptHost />
    </MdiWindow>
  )
}

function Corner() {
  const mode = useTransport((s) => s.mode)
  return (
    <div
      className="flex shrink-0 items-end border-r border-b border-[#1d2326] bg-[#2b3438] px-1.5 pb-[3px] text-[10px] text-fl-dim"
      style={{ width: HEADER_W }}
      onPointerEnter={() => useUI.getState().setHint('Playlist — the timeline plays in SONG mode (press L to switch)')}
    >
      <span className={cn('rounded-[2px] px-1', mode === 'song' ? 'bg-fl-orange/80 text-[#1b1f22]' : 'bg-white/5')}>{mode === 'song' ? 'SONG' : 'PAT'}</span>
    </div>
  )
}

function TitleExtra() {
  const tool = useUI((s) => s.playlistTool)
  const picker = usePlaylist((s) => s.picker)
  usePlaylist((s) => s.source)
  useUI((s) => s.currentPattern)
  const project = useProject((s) => s.project)
  const src = currentSource()
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 pl-1">
      <ChevronRight size={11} className="shrink-0 opacity-60" />
      <span
        className="max-w-[160px] truncate rounded-[2px] px-1.5 text-[11px] text-[#eef2f4]"
        style={{ background: src ? sourceColor(project, src) : undefined }}
        title="Current clip source (used by Draw / Paint)"
      >
        {src ? sourceName(project, src) : '—'}
      </span>
      <div className="flex-1" />
      <button
        className={cn('grid h-[18px] w-[20px] place-items-center rounded-[2px]', picker ? 'bg-fl-orange text-[#1b1f22]' : 'hover:bg-white/10')}
        title="Picker panel (Alt+P)"
        onClick={() => getPl().set({ picker: !picker })}
        onPointerEnter={() => useUI.getState().setHint('Show/hide the picker panel (Alt+P)')}
      >
        <PanelLeft size={12} />
      </button>
      <SnapSelector />
      <div className="ml-1 flex items-center gap-[1px] rounded-[3px] bg-black/20 p-[1px]">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={cn('grid h-[18px] w-[20px] place-items-center rounded-[2px]', tool === t.tool ? 'bg-fl-orange text-[#1b1f22]' : 'text-[#dfe5e8] hover:bg-white/10')}
            title={`${t.name} (${t.key})`}
            onClick={() => useUI.getState().set({ playlistTool: t.tool })}
            onPointerEnter={() => useUI.getState().setHint(`${t.name} tool (${t.key})`)}
          >
            {t.icon}
          </button>
        ))}
      </div>
    </div>
  )
}

function SnapSelector() {
  const snap = usePlaylist((s) => s.snap)
  const global = useUI((s) => s.globalSnap)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-[18px] items-center gap-1 rounded-[2px] bg-black/20 px-1.5 text-[10px] text-[#dfe5e8] hover:bg-white/10"
        title="Playlist snap (Backspace toggles none/line)"
        onPointerEnter={() => useUI.getState().setHint(`Playlist snap: ${snap === 'main' ? `main (${SNAP_LABELS[global]})` : SNAP_LABELS[snap]}`)}
      >
        <Magnet size={11} />
        {snap === 'main' ? `Main` : SNAP_LABELS[snap]}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[70vh] overflow-auto">
        {(Object.keys(SNAP_LABELS) as Snap[]).map((s) => (
          <div key={s}>
            <DropdownMenuItem onSelect={() => getPl().set({ snap: s })} className={cn(s === snap && 'text-fl-orange')}>
              {s === 'main' ? `(main) — ${SNAP_LABELS[global]}` : SNAP_LABELS[s]}
            </DropdownMenuItem>
            {(s === 'main' || s === 'none') && <DropdownMenuSeparator />}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** FL puts the horizontal scrollbar above the ruler. */
function HScroll() {
  const scrollTick = usePlaylist((s) => s.scrollTick)
  const ppt = usePlaylist((s) => s.ppt)
  const project = useProject((s) => s.project)
  const ref = useRef<HTMLDivElement>(null)
  const w = ref.current?.clientWidth ?? 600
  const visible = w / ppt
  const bar = barTicks(project)
  const total = Math.max(songLength(project) + bar * 16, scrollTick + visible)
  const thumbW = Math.max(24, (visible / total) * w)
  const thumbX = (scrollTick / Math.max(1, total - visible)) * (w - thumbW)
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    const sx = e.clientX
    const st = scrollTick
    const onClickTrack = !(e.target as HTMLElement).dataset.thumb
    if (onClickTrack) {
      const r = ref.current!.getBoundingClientRect()
      const frac = (e.clientX - r.left - thumbW / 2) / Math.max(1, w - thumbW)
      getPl().set({ scrollTick: Math.max(0, frac * (total - visible)) })
      return
    }
    const move = (ev: PointerEvent) => getPl().set({ scrollTick: Math.max(0, st + ((ev.clientX - sx) / Math.max(1, w - thumbW)) * (total - visible)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div ref={ref} className="relative min-w-0 flex-1" onPointerDown={drag}>
      <div data-thumb="1" className="absolute top-[2px] h-[7px] rounded-[3px] bg-[#55636a] hover:bg-[#66757c]" style={{ left: thumbX, width: thumbW }} />
    </div>
  )
}

function VScroll({ total }: { total: number }) {
  const scrollY = usePlaylist((s) => s.scrollY)
  const ref = useRef<HTMLDivElement>(null)
  const h = ref.current?.clientHeight ?? 400
  const max = Math.max(1, total - h + 20)
  const thumbH = Math.max(24, (h / Math.max(h, total)) * h)
  const thumbY = (Math.min(scrollY, max) / max) * (h - thumbH)
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    if (!(e.target as HTMLElement).dataset.thumb) {
      const r = ref.current!.getBoundingClientRect()
      getPl().set({ scrollY: Math.max(0, Math.min(max, ((e.clientY - r.top - thumbH / 2) / Math.max(1, h - thumbH)) * max)) })
      return
    }
    const sy = e.clientY
    const s0 = scrollY
    const move = (ev: PointerEvent) => getPl().set({ scrollY: Math.max(0, Math.min(max, s0 + ((ev.clientY - sy) / Math.max(1, h - thumbH)) * max)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div ref={ref} className="relative shrink-0 bg-[#262e32]" style={{ width: SB }} onPointerDown={drag}>
      <div data-thumb="1" className="absolute left-[2px] w-[7px] rounded-[3px] bg-[#55636a] hover:bg-[#66757c]" style={{ top: thumbY, height: thumbH }} />
    </div>
  )
}

