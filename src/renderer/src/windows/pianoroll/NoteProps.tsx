// FL "Note properties" dialog (double-click a note). Edits a draft; Accept commits one undo step to the
// note — or to the whole selection when the note is selected (time is only editable for a single note).
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Knob } from '@/components/controls'
import { useProject } from '@/store/project'
import { setPatternNotes } from '@/store/actions'
import type { Note } from '@/store/types'
import { cn } from '@/lib/utils'
import { NOTE_COLORS, formatLength, formatTime, noteName, parseTime } from './music'
import { usePR } from './state'
import { sortNotes } from './noteOps'
import type { PianoRollController } from './controller'

type Draft = Pick<Note, 'vel' | 'pan' | 'rel' | 'modX' | 'modY' | 'fine' | 'color' | 'slide' | 'porta'>

export function NoteProps({ ctl }: { ctl: PianoRollController }) {
  const noteId = usePR((s) => s.propsNote)
  const project = useProject((s) => s.project)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [time, setTime] = useState('')
  const [len, setLen] = useState('')
  const info = noteId ? ctl.info() : null
  const note = noteId ? ctl.storeNotes().find((n) => n.id === noteId) : undefined
  const multi = !!note && ctl.sel.has(note.id) && ctl.sel.size > 1
  const ts = project.timeSig

  useEffect(() => {
    if (!note) {
      setDraft(null)
      return
    }
    setDraft({ vel: note.vel, pan: note.pan, rel: note.rel, modX: note.modX, modY: note.modY, fine: note.fine, color: note.color, slide: note.slide, porta: note.porta })
    setTime(formatTime(note.pos, ts))
    setLen(formatLength(note.len, ts))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId])

  const close = () => usePR.getState().set({ propsNote: null })

  const accept = () => {
    if (!note || !draft || !info?.channelId) return close()
    const pos = parseTime(time, ts, true)
    const l = parseTime(len, ts, false)
    const ids = multi ? ctl.sel : new Set([note.id])
    const next = ctl.storeNotes().map((n) => {
      if (!ids.has(n.id)) return n
      const m: Note = { ...n, ...draft }
      if (n.id === note.id && !multi && pos !== null) m.pos = pos
      if (l !== null && l > 0) m.len = l
      return m
    })
    setPatternNotes(info.patternId, info.channelId, sortNotes(next), multi ? 'Note properties (selection)' : 'Note properties')
    close()
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <Dialog open={!!note && !!draft} onOpenChange={(o) => !o && close()}>
      <DialogContent
        showCloseButton={false}
        className="w-[340px] gap-0 rounded-[3px] border border-[#11161a] bg-fl-panel p-0 text-[11px] text-fl-text shadow-[0_8px_30px_rgba(0,0,0,.6)] sm:max-w-[340px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement)) accept()
          e.stopPropagation()
        }}
      >
        <div className="flex h-[22px] items-center bg-fl-title-active px-2 text-[11px] text-[#eef2f4]">
          <DialogTitle className="text-[11px] font-medium">
            {note ? `${noteName(note.key)} – note properties${multi ? ` (${ctl.sel.size} notes)` : ''}` : 'Note properties'}
          </DialogTitle>
          <DialogDescription className="sr-only">Edit per-note properties</DialogDescription>
        </div>
        {draft && note && (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex justify-between">
              <Knob size={34} label="Pan" bipolar value={(draft.pan + 1) / 2} onChange={(v) => set({ pan: Math.abs(v - 0.5) < 0.01 ? 0 : v * 2 - 1 })} onReset={() => set({ pan: 0 })} hint={`Panning: ${draft.pan === 0 ? 'Centered' : `${Math.round(Math.abs(draft.pan) * 100)}% ${draft.pan < 0 ? 'left' : 'right'}`}`} />
              <Knob size={34} label="Vel" value={draft.vel} onChange={(v) => set({ vel: v })} onReset={() => set({ vel: 100 / 128 })} hint={`Velocity: ${Math.round(draft.vel * 128)}`} color="var(--fl-green)" />
              <Knob size={34} label="Rel" value={draft.rel} onChange={(v) => set({ rel: v })} onReset={() => set({ rel: 0.5 })} hint={`Release: ${pct(draft.rel)}`} />
              <Knob size={34} label="Mod X" bipolar value={draft.modX} onChange={(v) => set({ modX: v })} onReset={() => set({ modX: 0.5 })} hint={`Mod X: ${pct(draft.modX)}`} />
              <Knob size={34} label="Mod Y" bipolar value={draft.modY} onChange={(v) => set({ modY: v })} onReset={() => set({ modY: 0.5 })} hint={`Mod Y: ${pct(draft.modY)}`} />
              <Knob size={34} label="Pitch" bipolar value={(draft.fine + 120) / 240} onChange={(v) => set({ fine: Math.round(v * 240 - 120) })} onReset={() => set({ fine: 0 })} hint={`Fine pitch: ${draft.fine} cents`} />
            </div>
            <div className="flex items-center gap-1">
              <span className="w-12 text-fl-dim">Color</span>
              {NOTE_COLORS.map((c, i) => (
                <button
                  key={c}
                  title={`Color group ${i + 1}`}
                  className={cn('h-3.5 w-3.5 rounded-[2px] border', draft.color === i ? 'border-white' : 'border-[#1b2124]')}
                  style={{ background: c }}
                  onClick={() => set({ color: i })}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-fl-dim">Mode</span>
              <Toggle on={draft.slide} onClick={() => set({ slide: !draft.slide })}>
                Slide
              </Toggle>
              <Toggle on={draft.porta} onClick={() => set({ porta: !draft.porta })}>
                Porta
              </Toggle>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-fl-dim">Time</span>
              <input
                disabled={multi}
                value={multi ? '(multiple)' : time}
                onChange={(e) => setTime(e.target.value)}
                className={cn('h-5 w-20 rounded-sm bg-fl-well px-1 font-mono text-[11px] outline-none fl-inset', parseTime(time, ts, true) === null && !multi && 'text-fl-red')}
              />
              <span className="text-fl-dim">Length</span>
              <input
                value={len}
                onChange={(e) => setLen(e.target.value)}
                className={cn('h-5 w-20 rounded-sm bg-fl-well px-1 font-mono text-[11px] outline-none fl-inset', parseTime(len, ts, false) === null && 'text-fl-red')}
              />
            </div>
            <div className="flex justify-end gap-1.5 pt-1">
              <DlgButton
                onClick={() => {
                  setDraft({ vel: note.vel, pan: note.pan, rel: note.rel, modX: note.modX, modY: note.modY, fine: note.fine, color: note.color, slide: note.slide, porta: note.porta })
                  setTime(formatTime(note.pos, ts))
                  setLen(formatLength(note.len, ts))
                }}
              >
                Reset
              </DlgButton>
              <DlgButton onClick={close}>Cancel</DlgButton>
              <DlgButton primary onClick={accept}>
                Accept
              </DlgButton>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('flex h-5 items-center gap-1 rounded-[3px] border border-[#1e2427] px-2 fl-bevel', on ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#46525a] hover:bg-[#515e66]')}>
      {children}
    </button>
  )
}

function DlgButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cn('h-6 rounded-[3px] border border-[#1e2427] px-3 fl-bevel', primary ? 'bg-fl-orange text-[#1b1f22] hover:brightness-110' : 'bg-[#46525a] hover:bg-[#515e66]')}>
      {children}
    </button>
  )
}
