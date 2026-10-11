// Playlist window (FL Studio "Playlist - Arrangement").
import { useEffect, useMemo, useRef } from 'react'
import { ChevronRight, Eraser, Magnet, MoveHorizontal, PanelLeft, Paintbrush, Pencil, Scissors, SquareDashedMousePointer, Volume2, VolumeX, ZoomIn } from 'lucide-react'
import { MdiWindow, forceCursor } from '@/shell/MdiWindow'
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
import { clampPpt, trackOffsets } from './geometry'
import { getPl, setTrackZoom, toggleStretch, toggleZeroCross, usePlaylist, MAX_VZOOM, MIN_VZOOM } from './state'
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
            <TrackHeight />
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
    </MdiWindow>
  )
}

function Corner() {
  const mode = useTransport((s) => s.mode)
  return (
    <div
      className="flex shrink-0 flex-col justify-between border-r border-b border-[#1d2326] bg-[#2b3438] px-1.5 py-[3px] text-[10px] text-fl-dim"
      style={{ width: HEADER_W }}
      onPointerEnter={() => useUI.getState().setHint('Playlist — the timeline plays in SONG mode (press L to switch)')}
    >
      <span className={cn('self-start rounded-[2px] px-1 leading-[12px]', mode === 'song' ? 'bg-fl-orange/80 text-[#1b1f22]' : 'bg-white/5')}>{mode === 'song' ? 'SONG' : 'PAT'}</span>
      <AudioFocus />
    </div>
  )
}

/** FL's audio clip focus options: Z-CROSS and STRETCH, each with its LED. */
function AudioFocus() {
  const zeroCross = usePlaylist((s) => s.zeroCross)
  const stretch = usePlaylist((s) => s.stretch)
  const opt = (label: string, on: boolean, hint: string, toggle: () => void) => (
    <button
      className={cn('flex items-center gap-1 text-[9px] font-semibold tracking-wide', on ? 'text-[#e9eef1]' : 'text-fl-dim hover:text-fl-text')}
      onClick={toggle}
      onPointerEnter={(e) => {
        e.stopPropagation()
        useUI.getState().setHint(hint)
      }}
    >
      {label}
      <span className="h-[6px] w-[6px] rounded-full border border-[#141819]" style={{ background: on ? 'var(--fl-orange)' : 'var(--fl-led-off)', boxShadow: on ? '0 0 4px var(--fl-orange)' : undefined }} />
    </button>
  )
  return (
    <div className="flex items-center justify-end gap-2.5">
      {opt('Z-CROSS', zeroCross, `Zero-cross ${zeroCross ? 'on' : 'off'}: slices and trims of audio clips land on the nearest zero crossing (Alt = exact)`, toggleZeroCross)}
      {opt('STRETCH', stretch, `Stretch ${stretch ? 'on' : 'off'} (Shift+M): drag an audio clip's edge to time-stretch it. Pitch follows the channel's Sampler stretch mode`, toggleStretch)}
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

/** Pixels from a scrollbar thumb's end that grab the end (resize) instead of the thumb (scroll). */
const EDGE = 4

/** Window-level drag helper: calls `move` with the pointer delta until release, with `cursor` forced. */
function dragFrom(e: React.PointerEvent, cursor: string | null, move: (dx: number, dy: number) => void): void {
  e.preventDefault()
  const sx = e.clientX
  const sy = e.clientY
  const end = cursor ? forceCursor(cursor) : null
  const onMove = (ev: PointerEvent) => move(ev.clientX - sx, ev.clientY - sy)
  const up = () => {
    end?.()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', up)
}

/** Which end of a thumb (if any) the pointer is on. */
function thumbEdge(e: React.PointerEvent, vertical: boolean): 'start' | 'end' | null {
  const t = e.target as HTMLElement
  if (!t.dataset.thumb) return null
  const r = t.getBoundingClientRect()
  const pos = vertical ? e.clientY - r.top : e.clientX - r.left
  const len = vertical ? r.height : r.width
  return pos <= EDGE ? 'start' : pos >= len - EDGE ? 'end' : null
}

/**
 * FL puts the horizontal scrollbar above the ruler. Dragging the thumb scrolls; dragging either end of it
 * zooms (a wider thumb shows more of the song).
 */
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
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const edge = thumbEdge(e, false)
    if (edge) {
      // resize the thumb = zoom; the opposite end of the view stays put
      const end0 = scrollTick + visible
      return dragFrom(e, 'ew-resize', (dx) => {
        const tw = Math.max(16, Math.min(w, thumbW + (edge === 'end' ? dx : -dx)))
        const nppt = clampPpt(w / ((tw / w) * total))
        const nVisible = w / nppt
        getPl().set(edge === 'end' ? { ppt: nppt } : { ppt: nppt, scrollTick: Math.max(0, end0 - nVisible) })
        useUI.getState().setHint(`Zoom: ${(nVisible / bar).toFixed(1)} bars visible`)
      })
    }
    if (!(e.target as HTMLElement).dataset.thumb) {
      e.preventDefault()
      const r = ref.current!.getBoundingClientRect()
      const frac = (e.clientX - r.left - thumbW / 2) / Math.max(1, w - thumbW)
      getPl().set({ scrollTick: Math.max(0, frac * (total - visible)) })
      return
    }
    const st = scrollTick
    dragFrom(e, null, (dx) => getPl().set({ scrollTick: Math.max(0, st + (dx / Math.max(1, w - thumbW)) * (total - visible)) }))
  }
  return (
    <div
      ref={ref}
      className="relative min-w-0 flex-1"
      onPointerDown={down}
      onPointerMove={(e) => {
        const edge = thumbEdge(e, false)
        ;(e.target as HTMLElement).style.cursor = edge ? 'ew-resize' : ''
        if (edge) useUI.getState().setHint('Drag the end of the scrollbar to zoom the playlist horizontally')
      }}
    >
      <div data-thumb="1" className="absolute top-[2px] h-[7px] rounded-[3px] bg-[#55636a] hover:bg-[#66757c]" style={{ left: thumbX, width: thumbW }} />
    </div>
  )
}

/** Dragging the thumb scrolls the tracks; dragging either end of it changes the track height. */
function VScroll({ total }: { total: number }) {
  const scrollY = usePlaylist((s) => s.scrollY)
  const vZoom = usePlaylist((s) => s.vZoom)
  const ref = useRef<HTMLDivElement>(null)
  const h = ref.current?.clientHeight ?? 400
  const max = Math.max(1, total - h + 20)
  const thumbH = Math.max(24, (h / Math.max(h, total)) * h)
  const thumbY = (Math.min(scrollY, max) / max) * (h - thumbH)
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const edge = thumbEdge(e, true)
    if (edge) {
      // a taller thumb shows more tracks = smaller tracks; the opposite end stays anchored
      const z0 = vZoom
      return dragFrom(e, 'ns-resize', (_dx, dy) => {
        const th = Math.max(12, thumbH + (edge === 'end' ? dy : -dy))
        setTrackZoom(z0 * (thumbH / th), edge === 'end' ? 0 : h)
      })
    }
    if (!(e.target as HTMLElement).dataset.thumb) {
      e.preventDefault()
      const r = ref.current!.getBoundingClientRect()
      getPl().set({ scrollY: Math.max(0, Math.min(max, ((e.clientY - r.top - thumbH / 2) / Math.max(1, h - thumbH)) * max)) })
      return
    }
    const s0 = scrollY
    dragFrom(e, null, (_dx, dy) => getPl().set({ scrollY: Math.max(0, Math.min(max, s0 + (dy / Math.max(1, h - thumbH)) * max)) }))
  }
  return (
    <div
      ref={ref}
      className="relative shrink-0 bg-[#262e32]"
      style={{ width: SB }}
      onPointerDown={down}
      onPointerMove={(e) => {
        const edge = thumbEdge(e, true)
        ;(e.target as HTMLElement).style.cursor = edge ? 'ns-resize' : ''
        if (edge) useUI.getState().setHint('Drag the end of the scrollbar to change the track height')
      }}
    >
      <div data-thumb="1" className="absolute left-[2px] w-[7px] rounded-[3px] bg-[#55636a] hover:bg-[#66757c]" style={{ top: thumbY, height: thumbH }} />
    </div>
  )
}

/** FL's "Track height" control (right of the horizontal scrollbar): drag up / down or use the mouse wheel. */
function TrackHeight() {
  const vZoom = usePlaylist((s) => s.vZoom)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // native listener: React's wheel handler is passive, and the page must not scroll
    const el = ref.current!
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      setTrackZoom(getPl().vZoom * ((e.deltaY || e.deltaX) < 0 ? 1.1 : 1 / 1.1))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])
  const fill = (vZoom - MIN_VZOOM) / (MAX_VZOOM - MIN_VZOOM)
  return (
    <div
      ref={ref}
      className="relative shrink-0 cursor-ns-resize border-l border-[#1d2326] bg-[#2b3438] hover:bg-[#34404a]"
      style={{ width: SB, height: SB }}
      title="Track height – drag up / down or use the mouse wheel"
      onPointerEnter={() => useUI.getState().setHint(`Track height: ${Math.round(vZoom * 100)}% – drag up / down or use the mouse wheel`)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const z0 = vZoom
        dragFrom(e, 'ns-resize', (_dx, dy) => setTrackZoom(z0 * Math.pow(1.01, -dy)))
      }}
      onDoubleClick={() => setTrackZoom(1)}
    >
      {/* level bar + grip lines */}
      <span className="absolute bottom-[1px] left-[1px] w-[2px] rounded-[1px] bg-fl-orange" style={{ height: Math.max(1, Math.round(fill * (SB - 2))) }} />
      <span className="absolute left-[4px] right-[2px] top-[3px] h-px bg-[#9fb0b8]" />
      <span className="absolute left-[4px] right-[2px] top-[5px] h-px bg-[#9fb0b8]" />
      <span className="absolute left-[4px] right-[2px] top-[7px] h-px bg-[#9fb0b8]" />
    </div>
  )
}
