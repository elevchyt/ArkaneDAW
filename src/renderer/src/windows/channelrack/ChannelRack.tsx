import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { MdiWindow } from '@/shell/MdiWindow'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { DEFAULT_NOTE_KEY, TICKS_PER_STEP, type Channel, type Note } from '@/store/types'
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
import { patternLength } from '@/audio/sequence'
import { Led, MiniKnob, Knob } from '@/components/controls'
import { listPlugins } from '@/plugins/registry'
import { toggleChannelPlugin } from '../plugin/open'
import { openPianoRoll } from '../pianoroll/open'
import { cn } from '@/lib/utils'
import { editProject } from '@/store/project'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { handleChannelRackDrop } from './drop'
import type { WindowProps } from '../types'

const ROW_H = 26
const STEP_W = 17

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
  const steps = pattern ? Math.max(16, Math.ceil(patternLength(pattern, project) / TICKS_PER_STEP)) : 16
  const channels = project.channels.filter((c) => filter === 'All' || c.filterGroup === filter)
  const paint = useRef<{ on: boolean; channelId: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)

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
      <div className="flex items-center gap-1 text-[10px] text-fl-dim" title="Swing">
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
    </div>
  )

  return (
    <MdiWindow win={win} bounds={bounds} titleExtra={titleExtra} minW={420}>
      <div
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
        <div className="min-h-0 flex-1 overflow-auto py-1" onPointerUp={() => (paint.current = null)}>
          {channels.map((ch) => (
            <ChannelRow
              key={ch.id}
              ch={ch}
              notes={pattern?.notes[ch.id] ?? []}
              steps={steps}
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
  const instruments = listPlugins('instrument')
  const cats = [...new Set(instruments.map((m) => m.manifest.category))].sort()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-5 w-16 items-center justify-center rounded-sm border border-[#1d2326] bg-[#46525a] fl-bevel hover:bg-[#515e66]" title="Add channel">
        <Plus size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="max-h-[70vh] overflow-auto">
        {cats.map((c) => (
          <div key={c}>
            <DropdownMenuLabel>{c}</DropdownMenuLabel>
            {instruments
              .filter((m) => m.manifest.category === c)
              .map((m) => (
                <DropdownMenuItem key={m.manifest.id} onSelect={() => addInstrumentChannel(m.manifest.id)}>
                  {m.manifest.name}
                </DropdownMenuItem>
              ))}
            <DropdownMenuSeparator />
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface RowProps {
  ch: Channel
  notes: Note[]
  steps: number
  selected: boolean
  patternId: string
  onSelect: (id: string, e: React.MouseEvent) => void
  paint: React.MutableRefObject<{ on: boolean; channelId: string } | null>
}

function ChannelRow({ ch, notes, steps, selected, patternId, onSelect, paint }: RowProps) {
  const root = ch.rootNote ?? DEFAULT_NOTE_KEY
  const stepMode = isStepOnly(notes, root)
  const active = useMemo(() => new Set(notes.map((n) => n.pos / TICKS_PER_STEP)), [notes])
  const setHint = useUI((s) => s.setHint)
  const instruments = listPlugins('instrument')
  const editing = useRef(false)
  const [renaming, setRenaming] = useState(false)
  const selectedIds = () => {
    const s = useUI.getState().selectedChannels
    return s.includes(ch.id) ? s : [ch.id]
  }

  return (
    <div className="flex items-center gap-1 px-1.5" style={{ height: ROW_H }}>
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
              {instruments.map((m) => (
                <ContextMenuItem key={m.manifest.id} onSelect={() => replaceChannelPlugin(ch.id, m.manifest.id)}>
                  {m.manifest.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Insert</ContextMenuSubTrigger>
            <ContextMenuSubContent className="max-h-[60vh] overflow-auto">
              {instruments.map((m) => (
                <ContextMenuItem key={m.manifest.id} onSelect={() => addInstrumentChannel(m.manifest.id)}>
                  {m.manifest.name}
                </ContextMenuItem>
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
          <ContextMenuItem
            onSelect={() =>
              editProject('Fill each 4 steps', (d) => {
                const pat = d.patterns.find((x) => x.id === patternId)
                if (!pat) return
                const list = (pat.notes[ch.id] = [] as Note[])
                for (let s = 0; s < steps; s += 4) list.push({ id: `${ch.id}-${s}-${Date.now()}`, key: root, pos: s * TICKS_PER_STEP, len: TICKS_PER_STEP, vel: 100 / 128, pan: 0, rel: 0.5, fine: 0, modX: 0.5, modY: 0.5, color: 0, slide: false, porta: false, muted: false })
              })
            }
          >
            Fill each 4 steps
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <button
        className={cn('h-[18px] w-[6px] rounded-[1px] border border-[#1d2326]', selected ? 'bg-fl-green shadow-[0_0_4px_var(--fl-green)]' : 'bg-[#4a565c]')}
        onClick={(e) => onSelect(ch.id, e)}
        title="Select"
      />
      {stepMode ? (
        <div className="flex gap-[2px] pl-1" onPointerLeave={() => (editing.current = false)}>
          {Array.from({ length: steps }, (_, i) => {
            const on = active.has(i)
            const group = Math.floor(i / 4) % 2
            return (
              <div
                key={i}
                className={cn('h-[20px] rounded-[2px] border border-[#1b2124]', (i + 1) % 4 === 0 && 'mr-[3px]')}
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
  const width = steps * STEP_W + Math.floor(steps / 4) * 3
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

export { currentPatternId }
