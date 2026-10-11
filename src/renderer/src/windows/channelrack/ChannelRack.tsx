import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Ruler } from 'lucide-react'
import { MdiWindow } from '@/shell/MdiWindow'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { DEFAULT_NOTE_KEY, TICKS_PER_STEP, type Channel, type Note, type Pattern } from '@/store/types'
import {
  addInstrumentChannel,
  cloneChannels,
  currentPatternId,
  deleteChannels,
  replaceChannelPlugin,
  routeToFreeInserts,
  toggleStep,
  updateChannel
} from '@/store/actions'
import { barTicks, patternLength } from '@/audio/sequence'
import { useTransport, playhead } from '@/store/transport'
import { Led, MiniKnob, Knob } from '@/components/controls'
import { groupPlugins, useAllPlugins } from '@/plugins/catalog'
import { guardPack } from '@/packs/guard'
import { PackBadge } from '@/packs/PackBadge'
import { toggleChannelPlugin } from '../plugin/open'
import { openPianoRoll } from '../pianoroll/open'
import { cn } from '@/lib/utils'
import { editProject } from '@/store/project'
import { defaultNote } from '@/store/factory'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { handleChannelRackDrop } from './drop'
import { PatternSelector } from '@/shell/PatternSelector'
import type { WindowProps } from '../types'

const ROW_H = 26
const STEP_W = 17
/** Step sequencer limit (FL: longer patterns go in the piano roll). */
const MAX_STEPS = 512

/** True when a channel's notes are plain steps (so the rack shows buttons, not a piano-roll preview). */
function isStepOnly(notes: Note[], root: number): boolean {
  return notes.every((n) => n.key === root && n.len <= TICKS_PER_STEP && n.pos % TICKS_PER_STEP === 0 && !n.slide)
}

export default function ChannelRack({ win, bounds }: WindowProps) {
  const project = useProject((s) => s.project)
  const currentPattern = useUI((s) => s.currentPattern)
  const selected = useUI((s) => s.selectedChannels)
  const filter = useUI((s) => s.channelFilter)
  const patternId = currentPattern ?? project.patterns[0]?.id
  const pattern = project.patterns.find((p) => p.id === patternId)
  const channels = project.channels.filter((c) => filter === 'All' || c.filterGroup === filter)
  const paint = useRef<{ on: boolean; channelId: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const rackRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fitSteps = useFitSteps(scrollRef)
  const barSteps = Math.max(1, Math.round(barTicks(project) / TICKS_PER_STEP))
  const stepsPerBeat = Math.max(1, 16 / project.timeSig[1])
  // Explicit length: exactly that many steps. Auto: the content (whole bars), or as many bars as fit the window.
  const steps = !pattern
    ? barSteps
    : pattern.length > 0
      ? Math.min(MAX_STEPS, Math.max(1, Math.round(pattern.length / TICKS_PER_STEP)))
      : Math.min(MAX_STEPS, Math.max(Math.ceil(patternLength(pattern, project) / TICKS_PER_STEP), Math.floor(fitSteps / barSteps) * barSteps, barSteps))
  useStepIndicator(rackRef, pattern)

  const select = (id: string, e: React.MouseEvent) => {
    const ui = useUI.getState()
    if (e.ctrlKey || e.shiftKey) {
      const has = ui.selectedChannels.includes(id)
      ui.set({ selectedChannels: has ? ui.selectedChannels.filter((x) => x !== id) : [...ui.selectedChannels, id] })
    } else ui.set({ selectedChannels: [id] })
    ui.set({ pianoRollChannel: id })
  }

  const titleExtra = (
    <div className="flex items-center gap-2 pl-2">
      <PatternSelector />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-4 items-center gap-1 rounded-sm bg-fl-well px-1.5 text-[10px] text-fl-text fl-inset">
          {filter}
          <ChevronDown size={10} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {['All', ...project.filterGroups].map((g) => (
            <DropdownMenuItem key={g} onSelect={() => useUI.getState().set({ channelFilter: g })}>
              {g}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center gap-1 text-[10px] text-fl-dim" title="Swing" data-nodrag>
        <Knob
          size={16}
          value={project.swing}
          labelPosition="none"
          onChange={(v) => editProject('Swing', (d) => void (d.swing = v), { coalesceKey: 'swing' })}
          onReset={() => editProject('Swing', (d) => void (d.swing = 0))}
          hint={`Swing: ${Math.round(project.swing * 100)}%`}
        />
        SWING
      </div>
      <div className="flex-1" />
      {pattern && <PatternLength pattern={pattern} />}
    </div>
  )

  return (
    <MdiWindow win={win} bounds={bounds} titleExtra={titleExtra} minW={420}>
      <div
        ref={rackRef}
        className={cn('flex h-full flex-col bg-[#2f383d]', dragOver && 'outline outline-2 -outline-offset-2 outline-fl-orange')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false)
          void handleChannelRackDrop(e)
        }}
      >
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto py-1" onPointerUp={() => (paint.current = null)}>
          {channels.map((ch) => (
            <ChannelRow
              key={ch.id}
              ch={ch}
              notes={pattern?.notes[ch.id] ?? []}
              steps={steps}
              stepsPerBeat={stepsPerBeat}
              selected={selected.includes(ch.id)}
              onSelect={select}
              patternId={patternId}
              paint={paint}
            />
          ))}
          {channels.length === 0 && <div className="px-4 py-6 text-center text-fl-dim">Click + to add an instrument, or drop audio files here.</div>}
        </div>
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-[#1d2326] bg-[#2a3236] px-2">
          <AddChannelButton />
          <span className="text-[10px] text-fl-dim">{pattern?.name}</span>
        </div>
      </div>
    </MdiWindow>
  )
}

function AddChannelButton() {
  const groups = groupPlugins(useAllPlugins('instrument'))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-5 w-16 items-center justify-center rounded-sm border border-[#1d2326] bg-[#46525a] fl-bevel hover:bg-[#515e66]" title="Add channel">
        <Plus size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="max-h-[70vh] overflow-auto">
        {groups.map(([c, list]) => (
          <DropdownMenuSub key={c}>
            <DropdownMenuSubTrigger>{c}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-[60vh] overflow-auto">
              {list.map((m) => (
                <DropdownMenuItem key={m.id} onSelect={() => guardPack(m.id, () => addInstrumentChannel(m.id))}>
                  {m.name}
                  {m.pack && <PackBadge packId={m.pack.id} />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface RowProps {
  ch: Channel
  notes: Note[]
  steps: number
  stepsPerBeat: number
  selected: boolean
  patternId: string
  onSelect: (id: string, e: React.MouseEvent) => void
  paint: React.MutableRefObject<{ on: boolean; channelId: string } | null>
}

function ChannelRow({ ch, notes, steps, stepsPerBeat, selected, patternId, onSelect, paint }: RowProps) {
  const root = ch.rootNote ?? DEFAULT_NOTE_KEY
  const stepMode = isStepOnly(notes, root)
  const active = useMemo(() => new Set(notes.map((n) => n.pos / TICKS_PER_STEP)), [notes])
  const setHint = useUI((s) => s.setHint)
  const instruments = useAllPlugins('instrument')
  const editing = useRef(false)
  const [renaming, setRenaming] = useState(false)
  const selectedIds = () => {
    const s = useUI.getState().selectedChannels
    return s.includes(ch.id) ? s : [ch.id]
  }

  return (
    <div className="flex w-max items-center gap-1 px-1.5 [&>*]:shrink-0" style={{ height: ROW_H }}>
      <Led
        on={!ch.muted}
        onClick={() => updateChannel(ch.id, { muted: !ch.muted }, 'Mute channel')}
        onContextMenu={(e) => {
          e.preventDefault()
          // right-click LED = solo
          const p = useProject.getState().project
          const others = p.channels.filter((c) => c.id !== ch.id)
          const soloed = !ch.muted && others.every((c) => c.muted)
          editProject('Solo channel', (d) => {
            for (const c of d.channels) c.muted = soloed ? false : c.id !== ch.id
          })
        }}
        title="Mute (right-click: solo)"
      />
      <MiniKnob
        value={(ch.pan + 1) / 2}
        bipolar
        onChange={(v) => updateChannel(ch.id, { pan: v * 2 - 1 }, 'Channel panning', `pan:${ch.id}`)}
        onReset={() => updateChannel(ch.id, { pan: 0 }, 'Channel panning')}
        hint={`${ch.name} panning: ${ch.pan === 0 ? 'Centered' : `${Math.round(Math.abs(ch.pan) * 100)}% ${ch.pan < 0 ? 'left' : 'right'}`}`}
      />
      <MiniKnob
        value={ch.volume / 1.25}
        onChange={(v) => updateChannel(ch.id, { volume: v * 1.25 }, 'Channel volume', `vol:${ch.id}`)}
        onReset={() => updateChannel(ch.id, { volume: 0.78 }, 'Channel volume')}
        hint={`${ch.name} volume: ${Math.round((ch.volume / 0.78) * 100)}%`}
      />
      <MixerTrackBox ch={ch} />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {renaming ? (
            <input
              autoFocus
              defaultValue={ch.name}
              className="h-[20px] w-[110px] rounded-sm bg-fl-well px-1 text-[11px] text-white outline-none"
              onBlur={(e) => {
                updateChannel(ch.id, { name: e.target.value || ch.name }, 'Rename channel')
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(false)
                e.stopPropagation()
              }}
            />
          ) : (
            <button
              className={cn('h-[20px] w-[110px] truncate rounded-[3px] border border-[#1d2326] px-1.5 text-left text-[11px] fl-bevel', selected ? 'text-white' : 'text-[#d7dee1]')}
              style={{ background: `linear-gradient(${ch.color}, ${ch.color}cc)` }}
              onClick={(e) => {
                if (e.ctrlKey || e.shiftKey) onSelect(ch.id, e)
                else {
                  onSelect(ch.id, e)
                  toggleChannelPlugin(ch.id)
                }
              }}
              onMouseEnter={() => setHint(`${ch.name} – click to show plugin, right-click for options`)}
              onWheel={(e) => {
                if (e.shiftKey) {
                  // Shift+wheel: move channel
                  editProject('Move channel', (d) => {
                    const i = d.channels.findIndex((c) => c.id === ch.id)
                    const j = i + (e.deltaY > 0 ? 1 : -1)
                    if (j < 0 || j >= d.channels.length) return
                    ;[d.channels[i], d.channels[j]] = [d.channels[j], d.channels[i]]
                  })
                }
              }}
            >
              {ch.name}
            </button>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => openPianoRoll(ch.id)}>Piano roll</ContextMenuItem>
          <ContextMenuItem onSelect={() => setRenaming(true)}>Rename, color and icon...</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger>Replace</ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-[60vh] overflow-auto">
              {groupPlugins(instruments).map(([cat, list]) => (
                <ContextMenuSub key={cat}>
                  <ContextMenuSubTrigger>{cat}</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="max-h-[60vh] overflow-auto">
                    {list.map((m) => (
                      <ContextMenuItem key={m.id} onSelect={() => guardPack(m.id, () => replaceChannelPlugin(ch.id, m.id), `Replace ${ch.name}`)}>
                        {m.name}
                        {m.pack && <PackBadge packId={m.pack.id} />}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Insert</ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-[60vh] overflow-auto">
              {groupPlugins(instruments).map(([cat, list]) => (
                <ContextMenuSub key={cat}>
                  <ContextMenuSubTrigger>{cat}</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="max-h-[60vh] overflow-auto">
                    {list.map((m) => (
                      <ContextMenuItem key={m.id} onSelect={() => guardPack(m.id, () => addInstrumentChannel(m.id))}>
                        {m.name}
                        {m.pack && <PackBadge packId={m.pack.id} />}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => cloneChannels(selectedIds())}>Clone<span className="ml-auto pl-4 text-fl-dim">Alt+C</span></ContextMenuItem>
          <ContextMenuItem onSelect={() => deleteChannels(selectedIds())}>Delete...<span className="ml-auto pl-4 text-fl-dim">Alt+Del</span></ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => routeToFreeInserts(selectedIds())}>Route to free mixer track<span className="ml-auto pl-4 text-fl-dim">Ctrl+L</span></ContextMenuItem>
          <ContextMenuItem
            onSelect={() =>
              editProject('Clear steps', (d) => {
                const pat = d.patterns.find((x) => x.id === patternId)
                if (pat) delete pat.notes[ch.id]
              })
            }
          >
            Clear notes in pattern
          </ContextMenuItem>
          {[2, 4, 8].map((every) => (
            <ContextMenuItem
              key={every}
              onSelect={() =>
                editProject(`Fill each ${every} steps`, (d) => {
                  const pat = d.patterns.find((x) => x.id === patternId)
                  if (!pat) return
                  const list: Note[] = []
                  for (let s = 0; s < steps; s += every) list.push(defaultNote({ key: root, pos: s * TICKS_PER_STEP, len: TICKS_PER_STEP }))
                  pat.notes[ch.id] = list
                })
              }
            >
              Fill each {every} steps
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      <button
        className={cn('h-[18px] w-[6px] rounded-[1px] border border-[#1d2326]', selected ? 'bg-fl-green shadow-[0_0_4px_var(--fl-green)]' : 'bg-[#4a565c]')}
        onClick={(e) => onSelect(ch.id, e)}
        title="Select"
      />
      {stepMode ? (
        <div className="flex gap-[2px] pl-1" data-steps onPointerLeave={() => (editing.current = false)}>
          {Array.from({ length: steps }, (_, i) => {
            const on = active.has(i)
            const group = Math.floor(i / stepsPerBeat) % 2
            return (
              <div
                key={i}
                data-step={i}
                className="h-[20px] rounded-[2px] border border-[#1b2124]"
                style={{
                  width: STEP_W - 2,
                  background: on
                    ? 'linear-gradient(#f2f5f7, #c9d1d5)'
                    : group === 0
                      ? 'linear-gradient(#66737a, #56636a)'
                      : 'linear-gradient(#7a6466, #6a5557)',
                  boxShadow: on ? '0 0 4px rgba(255,255,255,.25)' : 'inset 0 1px 0 rgba(255,255,255,.08)'
                }}
                onPointerDown={(e) => {
                  e.preventDefault()
                  const turnOn = e.button === 0
                  paint.current = { on: turnOn, channelId: ch.id }
                  toggleStep(patternId, ch.id, i, turnOn)
                }}
                onPointerEnter={() => {
                  const p = paint.current
                  if (p && p.channelId === ch.id) toggleStep(patternId, ch.id, i, p.on)
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
            )
          })}
        </div>
      ) : (
        <PianoPreview notes={notes} steps={steps} onOpen={() => openPianoRoll(ch.id)} />
      )}
    </div>
  )
}

/** Mini piano-roll preview drawn in place of the steps (FL shows this once notes aren't plain steps). */
function PianoPreview({ notes, steps, onOpen }: { notes: Note[]; steps: number; onOpen: () => void }) {
  const width = steps * STEP_W - 2
  const keys = notes.map((n) => n.key)
  const lo = Math.min(...keys)
  const hi = Math.max(...keys)
  const span = Math.max(12, hi - lo + 1)
  const total = steps * TICKS_PER_STEP
  return (
    <div className="relative ml-1 h-[20px] cursor-pointer rounded-[2px] border border-[#1b2124] bg-[#252c30]" style={{ width }} onClick={onOpen} title="Open in piano roll">
      {notes.map((n) => (
        <div
          key={n.id}
          className="absolute h-[2px] rounded-[1px] bg-fl-green"
          style={{ left: `${(n.pos / total) * 100}%`, width: `${Math.max(0.6, (n.len / total) * 100)}%`, bottom: `${((n.key - lo) / span) * 85 + 5}%` }}
        />
      ))}
    </div>
  )
}

function MixerTrackBox({ ch }: { ch: Channel }) {
  const start = useRef<{ y: number; v: number } | null>(null)
  const setHint = useUI((s) => s.setHint)
  return (
    <div
      className="grid h-[18px] w-[26px] cursor-ns-resize place-items-center rounded-sm bg-fl-well text-[10px] text-[#9fe870] fl-inset"
      onMouseEnter={() => setHint(`Target mixer track: ${ch.mixerTrack <= 0 ? 'Master' : `Insert ${ch.mixerTrack}`}`)}
      onPointerDown={(e) => {
        start.current = { y: e.clientY, v: ch.mixerTrack }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const v = Math.max(0, Math.min(125, start.current.v + Math.round((start.current.y - e.clientY) / 6)))
        if (v !== ch.mixerTrack) updateChannel(ch.id, { mixerTrack: v }, 'Route channel', `route:${ch.id}`)
      }}
      onPointerUp={() => (start.current = null)}
      onWheel={(e) => updateChannel(ch.id, { mixerTrack: Math.max(0, Math.min(125, ch.mixerTrack - Math.sign(e.deltaY))) }, 'Route channel', `route:${ch.id}`)}
    >
      {ch.mixerTrack <= 0 ? 'M' : ch.mixerTrack}
    </div>
  )
}

/** How many steps fit in the rack's step area at its current width (Auto pattern length shows at least that). */
function useFitSteps(scrollRef: React.RefObject<HTMLDivElement | null>): number {
  const [fit, setFit] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      // where the step buttons start inside a row (fallback: the usual header width)
      const first = el.querySelector<HTMLElement>('[data-steps]')
      const left = first ? first.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft : 230
      setFit(Math.max(0, Math.floor((el.clientWidth - left - 6) / STEP_W)))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [scrollRef])
  return fit
}

/** Step in `pattern` the playhead is on, or -1 (not playing, or the pattern isn't under the song position). */
function playingStep(pattern: Pattern): number {
  const t = useTransport.getState()
  if (!t.playing) return -1
  const tick = playhead.tick
  if (t.mode === 'pattern') return Math.floor(tick / TICKS_PER_STEP)
  const p = useProject.getState().project
  const clip = p.playlist.clips.find((c) => c.kind === 'pattern' && c.ref === pattern.id && !c.muted && tick >= c.start && tick < c.start + c.length)
  if (!clip) return -1
  const len = patternLength(pattern, p)
  return Math.floor((((tick - clip.start + clip.offset) % len) + len) % len / TICKS_PER_STEP)
}

/**
 * FL's step indicator: the column of step buttons under the playhead lights up. Done with a scoped style rule
 * rewritten once per step, so the rows don't re-render every frame.
 */
function useStepIndicator(rackRef: React.RefObject<HTMLDivElement | null>, pattern: Pattern | undefined): void {
  useEffect(() => {
    const rack = rackRef.current
    if (!rack || !pattern) return
    const scope = `rack-${Math.random().toString(36).slice(2, 8)}`
    rack.dataset.rack = scope
    const style = document.createElement('style')
    document.head.appendChild(style)
    let last = -2
    const update = () => {
      const step = playingStep(pattern)
      if (step === last) return
      last = step
      style.textContent =
        step < 0
          ? ''
          : `[data-rack="${scope}"] [data-step="${step}"] { filter: brightness(1.55) saturate(1.2); border-color: #c8d3d8 !important; box-shadow: 0 0 5px rgba(255,255,255,.35) !important; }`
    }
    update()
    const offPlayhead = playhead.subscribe(update)
    const offTransport = useTransport.subscribe(update)
    return () => {
      offPlayhead()
      offTransport()
      style.remove()
    }
  }, [rackRef, pattern])
}

/** Title-bar Pattern length control: Auto, or 1..512 steps. Drag up/down or use the mouse wheel; double-click = Auto. */
function PatternLength({ pattern }: { pattern: Pattern }) {
  const timeSig = useProject((s) => s.project.timeSig)
  const setHint = useUI((s) => s.setHint)
  const drag = useRef<{ y: number; v: number } | null>(null)
  const steps = Math.round(pattern.length / TICKS_PER_STEP)
  const barSteps = (16 * timeSig[0]) / timeSig[1]
  const describe = (n: number) => {
    if (n <= 0) {
      const auto = Math.ceil(patternLength({ ...pattern, length: 0 }, { timeSig }) / TICKS_PER_STEP)
      return `Auto (${auto} steps)`
    }
    const bars = n / barSteps
    return `${n} step${n === 1 ? '' : 's'} (${Number.isInteger(bars) ? bars : bars.toFixed(2)} bar${bars === 1 ? '' : 's'})`
  }
  // read the stored value, not the render's: wheel events can outrun re-renders
  const current = () => Math.round((useProject.getState().project.patterns.find((x) => x.id === pattern.id)?.length ?? 0) / TICKS_PER_STEP)
  const set = (n: number) => {
    const v = Math.max(0, Math.min(MAX_STEPS, Math.round(n)))
    if (v !== current()) editProject('Pattern length', (d) => void (d.patterns.find((x) => x.id === pattern.id)!.length = v * TICKS_PER_STEP), { coalesceKey: `patlen:${pattern.id}` })
    setHint(`Pattern length: ${describe(v)} – drag or wheel, double-click for Auto`)
  }
  return (
    <div
      data-nodrag
      className="flex h-4 shrink-0 cursor-ns-resize select-none items-center gap-1 rounded-sm bg-fl-well px-1.5 text-[10px] text-fl-text fl-inset"
      title="Pattern length"
      onMouseEnter={() => setHint(`Pattern length: ${describe(steps)} – drag or wheel, double-click for Auto`)}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        drag.current = { y: e.clientY, v: steps }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) set(d.v + Math.round((d.y - e.clientY) / 4))
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onWheel={(e) => set(current() - Math.sign(e.deltaY))}
      onDoubleClick={() => set(0)}
    >
      <Ruler size={10} className="text-fl-dim" />
      <span className={cn('min-w-[26px] text-right font-mono', steps > 0 ? 'text-[#9fe870]' : 'text-fl-dim')}>{steps > 0 ? steps : 'Auto'}</span>
    </div>
  )
}

export { currentPatternId }
