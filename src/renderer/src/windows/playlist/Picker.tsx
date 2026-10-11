// FL "Picker panel": patterns, audio clips and automation clips that can be drawn/dragged into the arrangement.
import { Activity, AudioLines, Music, Plus, StretchHorizontal } from 'lucide-react'
import { useProject, getProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { addPattern } from '@/store/actions'
import { cn } from '@/lib/utils'
import { currentSource, createAutomationClip, selectSource, sourceColor } from './actions'
import { usePlaylist, getPl, toggleStretch, toggleZeroCross, type ClipSource } from './state'
import { CLIPSRC_MIME } from './drop'
import { automationTargetItems, openPickerMenu } from './menus'
import { openMenu } from './PopupMenu'
import { openPatternEditor } from './open'

export const PICKER_W = 150

function firstEmptyTrack(): number {
  const used = new Set(getProject().playlist.clips.map((c) => c.track))
  let i = 0
  while (used.has(i)) i++
  return i
}

/** Zero crossing glyph: a sine wave over its center line. */
function ZeroCrossIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <path d="M0.5 6 H11.5" strokeOpacity={0.45} />
      <path d="M0.5 6 C2 1, 4 1, 6 6 S10 11, 11.5 6" />
    </svg>
  )
}

/** FL's audio "Clip focus" options: Zero-cross and Stretch. */
function AudioFocus() {
  const zeroCross = usePlaylist((s) => s.zeroCross)
  const stretch = usePlaylist((s) => s.stretch)
  const btn = (on: boolean, title: string, onClick: () => void, icon: React.ReactNode) => (
    <button
      className={cn('grid h-[14px] w-[16px] place-items-center rounded-[2px]', on ? 'bg-fl-orange text-[#1b1f22]' : 'text-fl-dim hover:bg-white/10 hover:text-fl-text')}
      title={title}
      onClick={onClick}
      onPointerEnter={() => useUI.getState().setHint(title)}
    >
      {icon}
    </button>
  )
  return (
    <span className="flex items-center gap-px normal-case">
      {btn(zeroCross, `Zero-cross ${zeroCross ? 'on' : 'off'}: slices and trims of audio clips snap to the nearest zero crossing`, toggleZeroCross, <ZeroCrossIcon />)}
      {btn(stretch, `Stretch ${stretch ? 'on' : 'off'} (Shift+M): drag an audio clip's edge to time-stretch it. Pitch follows the channel's Sampler stretch mode`, toggleStretch, <StretchHorizontal size={10} />)}
    </span>
  )
}

export function Picker() {
  const patterns = useProject((s) => s.project.patterns)
  const samples = useProject((s) => s.project.samples)
  const automations = useProject((s) => s.project.automations)
  useProject((s) => s.project.channels) // audio clip colors follow their channel
  usePlaylist((s) => s.source)
  useUI((s) => s.currentPattern)
  const cur = currentSource()
  const p = getProject()

  const item = (src: ClipSource, name: string, color: string, onDouble?: () => void) => {
    const active = cur?.kind === src.kind && cur.ref === src.ref
    return (
      <div
        key={`${src.kind}:${src.ref}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(CLIPSRC_MIME, JSON.stringify(src))
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => selectSource(src)}
        onDoubleClick={onDouble}
        onContextMenu={(e) => {
          e.preventDefault()
          openPickerMenu(e, src.kind, src.ref)
        }}
        onPointerEnter={() => useUI.getState().setHint(`${name} — click to select for drawing, drag into the playlist, right-click for options`)}
        className={cn('mx-1 my-[1px] flex h-[18px] cursor-pointer items-center gap-1.5 truncate rounded-[2px] px-1.5 text-[11px]', active ? 'text-[#1b1f22]' : 'text-[#e3e9ec] hover:brightness-125')}
        style={{
          background: active ? `color-mix(in srgb, ${color} 40%, #f2f5f7)` : `color-mix(in srgb, ${color} 55%, #262e32)`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), inset 0 -1px 0 rgba(0,0,0,.3)'
        }}
      >
        <span className="truncate">{name}</span>
      </div>
    )
  }

  const section = (title: string, icon: React.ReactNode, children: React.ReactNode[], onAdd?: (e: React.MouseEvent) => void, extra?: React.ReactNode) => (
    <div className="pb-1">
      <div className="sticky top-0 z-10 flex h-[18px] items-center gap-1 bg-[#2a3236] px-1.5 text-[10px] uppercase tracking-wide text-fl-dim">
        {icon}
        <span className="flex-1">{title}</span>
        {extra}
        {onAdd && (
          <button className="grid h-[14px] w-[14px] place-items-center rounded-sm hover:bg-white/10" onClick={onAdd} title={`Add ${title.toLowerCase()}`}>
            <Plus size={10} />
          </button>
        )}
      </div>
      {children.length ? children : <div className="px-2 py-0.5 text-[10px] text-fl-dim/70">(none)</div>}
    </div>
  )

  return (
    <div className="h-full overflow-y-auto border-r border-[#1d2326] bg-[#262e32]" style={{ width: PICKER_W }}>
      {section(
        'Patterns',
        <Music size={10} />,
        patterns.map((pat) => item({ kind: 'pattern', ref: pat.id }, pat.name, pat.color, () => openPatternEditor(pat.id))),
        () => {
          const id = addPattern()
          getPl().set({ source: { kind: 'pattern', ref: id } })
        }
      )}
      {section(
        'Audio clips',
        <AudioLines size={10} />,
        samples.map((s) => item({ kind: 'audio', ref: s.id }, s.name, sourceColor(p, { kind: 'audio', ref: s.id }), undefined)),
        undefined,
        <AudioFocus />
      )}
      {section(
        'Automation',
        <Activity size={10} />,
        automations.map((a) => item({ kind: 'automation', ref: a.id }, a.name, a.color)),
        (e) => openMenu(e, automationTargetItems((t) => createAutomationClip(t, firstEmptyTrack(), getPl().timeSel ?? undefined)), 'Automate')
      )}
    </div>
  )
}
