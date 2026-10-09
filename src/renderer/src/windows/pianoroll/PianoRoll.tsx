import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brush, Check, ChevronDown, Drum, Eraser, Ghost, Magnet, Music, Pencil, Scissors, SquareDashed, Stamp, Volume2, VolumeX, ZoomIn } from 'lucide-react'
import { MdiWindow } from '@/shell/MdiWindow'
import { useWindowKeys } from '@/shell/keys'
import { useProject } from '@/store/project'
import { useUI, SNAP_LABELS, type Snap, type Tool } from '@/store/ui'
import { cn } from '@/lib/utils'
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
import type { WindowProps } from '../types'
import { PianoRollController, SB } from './controller'
import { CHORDS, NOTE_COLORS, NOTE_NAMES, SCALES } from './music'
import { LANES, LANE_ORDER, usePR } from './state'
import { NoteProps } from './NoteProps'
import { getPlugin } from '@/plugins/registry'

const TOOLS: { id: Tool; icon: React.ComponentType<{ size?: number }>; name: string; key: string }[] = [
  { id: 'draw', icon: Pencil, name: 'Draw', key: 'P' },
  { id: 'paint', icon: Brush, name: 'Paint', key: 'B' },
  { id: 'delete', icon: Eraser, name: 'Delete', key: 'D' },
  { id: 'mute', icon: VolumeX, name: 'Mute', key: 'T' },
  { id: 'slice', icon: Scissors, name: 'Slice', key: 'C' },
  { id: 'select', icon: SquareDashed, name: 'Select', key: 'E' },
  { id: 'zoom', icon: ZoomIn, name: 'Zoom', key: 'Z' },
  { id: 'play', icon: Volume2, name: 'Playback', key: 'Y' }
]

const SNAPS: Snap[] = ['main', 'line', 'none', '1/6step', '1/4step', '1/3step', '1/2step', 'step', '1/6beat', '1/4beat', '1/3beat', '1/2beat', 'beat', 'bar']

const btn = 'grid h-[18px] min-w-[18px] place-items-center rounded-[2px] px-0.5 text-[10px] hover:bg-white/10'
const trig = 'flex h-[18px] items-center gap-1 rounded-[2px] bg-fl-well px-1.5 text-[10px] text-fl-text fl-inset outline-none'

function key(code: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { code, ctrlKey: !!mods.ctrl, shiftKey: !!mods.shift, altKey: !!mods.alt })
}

export default function PianoRoll({ win, bounds }: WindowProps) {
  const ctl = useMemo(() => new PianoRollController(), [])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const laneH = usePR((s) => s.laneH)
  const lane = usePR((s) => s.lane)
  const keysW = usePR((s) => s.keysW)
  const [boxH, setBoxH] = useState(0)
  const visible = win.open && !win.minimized

  useEffect(() => {
    const c = canvasRef.current
    const box = boxRef.current
    if (!c || !box) return
    ctl.attach(c)
    const ro = new ResizeObserver(() => {
      ctl.resize(box.clientWidth, box.clientHeight)
      setBoxH(box.clientHeight)
    })
    ro.observe(box)
    ctl.resize(box.clientWidth, box.clientHeight)
    setBoxH(box.clientHeight)
    return () => {
      ro.disconnect()
      ctl.detach()
    }
  }, [ctl, visible])

  // FL shows the target channel in the title: "Piano roll - <channel>"
  const chName = useProject((s) => {
    const id = useUI.getState().pianoRollChannel
    return (s.project.channels.find((c) => c.id === id) ?? s.project.channels[0])?.name
  })
  const prChannel = useUI((s) => s.pianoRollChannel)
  useEffect(() => {
    const title = chName ? `Piano roll - ${chName}` : 'Piano roll'
    if (win.title !== title) useUI.getState().updateWindow(win.id, { title })
  }, [chName, prChannel, win.title, win.id])

  const onKey = useCallback((e: KeyboardEvent) => ctl.handleKey(e), [ctl])
  useWindowKeys('pianoRoll', onKey)

  const effLane = Math.max(0, Math.min(laneH, boxH - 26 - SB - 5 - 40))

  return (
    <MdiWindow win={win} bounds={bounds} titleExtra={<TitleBar ctl={ctl} />} menu={<WindowMenu ctl={ctl} />} minW={480} minH={240}>
      <div ref={boxRef} className="absolute inset-0 overflow-hidden bg-[#262e32]">
        {visible && (
          <canvas
            ref={canvasRef}
            className="block touch-none"
            onPointerDown={(e) => ctl.onPointerDown(e.nativeEvent)}
            onPointerMove={(e) => ctl.onPointerMove(e.nativeEvent)}
            onPointerUp={(e) => ctl.onPointerUp(e.nativeEvent)}
            onPointerCancel={(e) => ctl.onPointerUp(e.nativeEvent)}
            onPointerLeave={() => ctl.onPointerLeave()}
            onContextMenu={(e) => e.preventDefault()}
          />
        )}
        {effLane >= 22 && (
          <div className="absolute" style={{ left: 3, width: keysW - 7, bottom: SB + effLane - 21 }}>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(trig, 'w-full justify-between')}
                title="Event editor target (F / Shift+F)"
                onWheel={(e) => {
                  const i = LANE_ORDER.indexOf(lane)
                  usePR.getState().set({ lane: LANE_ORDER[(i + (e.deltaY > 0 ? 1 : LANE_ORDER.length - 1)) % LANE_ORDER.length] })
                }}
              >
                <span className="truncate">{LANES[lane].label}</span>
                <ChevronDown size={9} />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                <DropdownMenuLabel>Control</DropdownMenuLabel>
                {LANE_ORDER.map((l) => (
                  <DropdownMenuItem key={l} onSelect={() => usePR.getState().set({ lane: l })}>
                    <span className="w-3">{l === lane && <Check size={10} />}</span>
                    Note {LANES[l].label.toLowerCase()}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <NoteProps ctl={ctl} />
    </MdiWindow>
  )
}

function WindowMenu({ ctl }: { ctl: PianoRollController }) {
  const k = (code: string, mods?: { ctrl?: boolean; shift?: boolean; alt?: boolean }) => () => {
    ctl.handleKey(key(code, mods))
  }
  const item = (label: string, sc: string, fn: () => void) => (
    <DropdownMenuItem onSelect={fn}>
      {label}
      <span className="ml-auto pl-6 text-fl-dim">{sc}</span>
    </DropdownMenuItem>
  )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid h-4 w-4 place-items-center rounded-sm opacity-80 outline-none hover:bg-white/10" title="Piano roll options">
        <ChevronDown size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Edit</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {item('Select all', 'Ctrl+A', k('KeyA', { ctrl: true }))}
            {item('Deselect', 'Ctrl+D', k('KeyD', { ctrl: true }))}
            {item('Invert selection', 'Shift+I', k('KeyI', { shift: true }))}
            {item('Select by color', 'Shift+C', k('KeyC', { shift: true }))}
            <DropdownMenuSeparator />
            {item('Copy', 'Ctrl+C', k('KeyC', { ctrl: true }))}
            {item('Cut', 'Ctrl+X', k('KeyX', { ctrl: true }))}
            {item('Paste', 'Ctrl+V', k('KeyV', { ctrl: true }))}
            {item('Delete', 'Del', k('Delete'))}
            {item('Duplicate', 'Ctrl+B', k('KeyB', { ctrl: true }))}
            <DropdownMenuSeparator />
            {item('Transpose octave up', 'Ctrl+Up', k('ArrowUp', { ctrl: true }))}
            {item('Transpose octave down', 'Ctrl+Down', k('ArrowDown', { ctrl: true }))}
            {item('Mute selection', 'Alt+M', k('KeyM', { alt: true }))}
            {item('Unmute selection', 'Alt+Shift+M', k('KeyM', { alt: true, shift: true }))}
            {item('Set color of selection', 'Alt+C', k('KeyC', { alt: true }))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Tools</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {item('Quick quantize start times', 'Ctrl+Q', k('KeyQ', { ctrl: true }))}
            {item('Quick legato', 'Ctrl+L', k('KeyL', { ctrl: true }))}
            {item('Glue', 'Ctrl+G', k('KeyG', { ctrl: true }))}
            {item('Quick chop', 'Ctrl+U', k('KeyU', { ctrl: true }))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {item('Ghost notes', 'Alt+V', k('KeyV', { alt: true }))}
            {item('Zoom in', 'PgUp', k('PageUp'))}
            {item('Zoom out', 'PgDn', k('PageDown'))}
            {item('Zoom level 1', 'Shift+1', k('Digit1', { shift: true }))}
            {item('Zoom level 2', 'Shift+2', k('Digit2', { shift: true }))}
            {item('Zoom level 3', 'Shift+3', k('Digit3', { shift: true }))}
            {item('Show all', 'Shift+4', k('Digit4', { shift: true }))}
            {item('Zoom to selection', 'Shift+5', k('Digit5', { shift: true }))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TitleBar({ ctl }: { ctl: PianoRollController }) {
  const tool = useUI((s) => s.pianoRollTool)
  const channels = useProject((s) => s.project.channels)
  const channelId = useUI((s) => s.pianoRollChannel)
  const ch = channels.find((c) => c.id === channelId) ?? channels[0]
  const hasNames = useMemo(() => {
    const pl = ch?.plugin
    if (!pl) return false
    try {
      const n = getPlugin(pl.pluginId)?.keyNames?.({ params: pl.params, data: pl.data, presetName: pl.presetName })
      return !!n && Object.keys(n).length > 0
    } catch {
      return false
    }
  }, [ch?.plugin])
  const globalSnap = useUI((s) => s.globalSnap)
  const pr = usePR()
  const setHint = useUI((s) => s.setHint)
  const hint = (t: string) => ({ onMouseEnter: () => setHint(t) })

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 pl-2">
      {/* snap */}
      <DropdownMenu>
        <DropdownMenuTrigger className={trig} {...hint('Snap to grid (Backspace toggles)')}>
          <Magnet size={10} className="text-fl-orange" />
          {pr.snap === 'main' ? `Main (${SNAP_LABELS[globalSnap]})` : SNAP_LABELS[pr.snap]}
          <ChevronDown size={9} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[70vh] overflow-auto">
          {SNAPS.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => pr.set({ snap: s })}>
              <span className="w-3">{s === pr.snap && <Check size={10} />}</span>
              {s === 'main' ? 'Main snap (global)' : SNAP_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* tools */}
      <div className="flex items-center gap-px rounded-[2px] bg-black/15 p-px">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={cn(btn, tool === t.id ? 'bg-fl-orange text-[#1b1f22] hover:bg-fl-orange' : 'text-fl-text')}
            title={`${t.name} (${t.key})`}
            onClick={() => useUI.getState().set({ pianoRollTool: t.id })}
            {...hint(`${t.name} tool (${t.key})`)}
          >
            <t.icon size={11} />
          </button>
        ))}
      </div>

      {/* slide / porta / ghosts */}
      <button className={cn(btn, 'font-bold', pr.slide ? 'bg-fl-orange text-[#1b1f22]' : 'text-fl-text')} onClick={() => pr.set({ slide: !pr.slide })} title="Slide (S)" {...hint('Slide: new notes are slide notes (S)')}>
        <svg width="11" height="11" viewBox="0 0 11 11">
          <path d="M2 1 L9 5.5 L2 10 Z" fill="currentColor" />
        </svg>
      </button>
      <button className={cn(btn, pr.porta ? 'bg-fl-orange text-[#1b1f22]' : 'text-fl-text')} onClick={() => pr.set({ porta: !pr.porta })} title="Portamento (O)" {...hint('Portamento: new notes are portamento notes (O)')}>
        <svg width="12" height="11" viewBox="0 0 12 11">
          <path d="M1 9 C 4 9, 5 2, 11 2" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>
      {hasNames && ch && (
        <button
          className={cn(btn, (pr.drumView[ch.id] ?? true) ? 'bg-fl-orange text-[#1b1f22]' : 'text-fl-text')}
          onClick={() => ctl.toggleDrumView()}
          title="Keyboard view: drum names / piano (M)"
          {...hint('Keyboard view: drum names / piano (M)')}
        >
          <Drum size={11} />
        </button>
      )}
      <button className={cn(btn, pr.ghosts ? 'text-fl-green' : 'text-fl-dim')} onClick={() => pr.set({ ghosts: !pr.ghosts })} title="Ghost notes (Alt+V)" {...hint(`Ghost notes ${pr.ghosts ? 'on' : 'off'} (Alt+V)`)}>
        <Ghost size={11} />
      </button>

      {/* color group */}
      <DropdownMenu>
        <DropdownMenuTrigger className={trig} title="Note color group" {...hint(`New note color: group ${pr.colorGroup + 1} (Alt+C applies to selection, Shift+C selects)`)}>
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: NOTE_COLORS[pr.colorGroup] }} />
          {pr.colorGroup + 1}
          <ChevronDown size={9} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[148px] p-1.5">
          <div className="grid grid-cols-8 gap-1">
            {NOTE_COLORS.map((c, i) => (
              <button
                key={c}
                className={cn('h-3.5 w-3.5 rounded-[2px] border', pr.colorGroup === i ? 'border-white' : 'border-[#1b2124]')}
                style={{ background: c }}
                title={`Color ${i + 1}`}
                onClick={() => pr.set({ colorGroup: i })}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* scale highlighting */}
      <DropdownMenu>
        <DropdownMenuTrigger className={trig} title="Scale highlighting" {...hint('Scale highlighting: shade notes outside the scale')}>
          <Music size={10} />
          {pr.scale === 'none' ? 'Scale' : `${NOTE_NAMES[pr.scaleRoot]} ${SCALES[pr.scale].name}`}
          <ChevronDown size={9} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[70vh] overflow-auto">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Root: {NOTE_NAMES[pr.scaleRoot]}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {NOTE_NAMES.map((n, i) => (
                <DropdownMenuItem key={n} onSelect={() => pr.set({ scaleRoot: i })}>
                  <span className="w-3">{i === pr.scaleRoot && <Check size={10} />}</span>
                  {n}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {Object.entries(SCALES).map(([id, s]) => (
            <DropdownMenuItem key={id} onSelect={() => pr.set({ scale: id })}>
              <span className="w-3">{id === pr.scale && <Check size={10} />}</span>
              {s.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* chord stamp */}
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(trig, pr.stamp && 'text-fl-orange')} title="Stamp (chords)" {...hint('Stamp: draw whole chords')}>
          <Stamp size={10} />
          {pr.stamp ? CHORDS[pr.stamp].name : 'Stamp'}
          <ChevronDown size={9} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[70vh] overflow-auto">
          <DropdownMenuItem onSelect={() => pr.set({ stamp: null })}>
            <span className="w-3">{!pr.stamp && <Check size={10} />}</span>
            (none)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {Object.entries(CHORDS).map(([id, c]) => (
            <DropdownMenuItem key={id} onSelect={() => pr.set({ stamp: id })}>
              <span className="w-3">{id === pr.stamp && <Check size={10} />}</span>
              {c.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex-1" />
      <ChannelSelector />
    </div>
  )
}

function ChannelSelector() {
  const channels = useProject((s) => s.project.channels)
  const patterns = useProject((s) => s.project.patterns)
  const currentPattern = useUI((s) => s.currentPattern)
  const channelId = useUI((s) => s.pianoRollChannel)
  const pat = patterns.find((p) => p.id === currentPattern) ?? patterns[0]
  const cur = channels.find((c) => c.id === channelId) ?? channels[0]
  const hasNotes = (id: string) => (pat?.notes[id]?.length ?? 0) > 0
  const select = (id: string) => useUI.getState().set({ pianoRollChannel: id, selectedChannels: [id] })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(trig, 'max-w-[160px]')}
        title="Target channel (wheel: channels with notes, Ctrl+wheel: all)"
        onWheel={(e) => {
          const list = e.ctrlKey ? channels : channels.filter((c) => hasNotes(c.id) || c.id === cur?.id)
          const i = list.findIndex((c) => c.id === cur?.id)
          const n = list[(i + (e.deltaY > 0 ? 1 : list.length - 1)) % list.length]
          if (n) select(n.id)
        }}
      >
        {cur && <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: cur.color }} />}
        <span className="truncate">{cur?.name ?? '(none)'}</span>
        <ChevronDown size={9} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] overflow-auto">
        <DropdownMenuLabel>Target channel</DropdownMenuLabel>
        {channels.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => select(c.id)}>
            <span className="w-3">{hasNotes(c.id) && <Check size={10} className="text-fl-green" />}</span>
            <span className="h-2 w-2 rounded-[1px]" style={{ background: c.color }} />
            <span className={cn(c.id === cur?.id && 'text-fl-orange')}>{c.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
