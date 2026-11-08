import { useState } from 'react'
import { ChevronDown, Pencil, Plus, Split, Trash2 } from 'lucide-react'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { addPattern, deletePattern, patternChannels, renamePattern, selectPattern, splitPatternByChannel } from '@/store/actions'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** Current pattern selector (lives in the Channel rack title bar). Wheel steps through patterns. */
export function PatternSelector() {
  const patterns = useProject((s) => s.project.patterns)
  const cur = useUI((s) => s.currentPattern) ?? patterns[0]?.id
  const pat = patterns.find((p) => p.id === cur) ?? patterns[0]
  const [confirm, setConfirm] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  // a string, so the selector result is stable between renders
  const splitKey = useProject((s) => (pat ? patternChannels(s.project, pat.id).map((c) => c.name).join('\u0000') : ''))
  const splitChans = splitKey ? splitKey.split('\u0000') : []
  const canSplit = splitChans.length > 1
  const commitRename = () => {
    const name = renaming?.trim()
    if (pat && name && name !== pat.name) renamePattern(pat.id, name)
    setRenaming(null)
  }
  return (
    <div className="flex items-center gap-px">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-[17px] w-[130px] items-center gap-1 rounded-l-[3px] border border-[#20272a] bg-fl-well px-1.5 text-left text-[11px] fl-inset"
          title="Pattern selector (numpad +/-)"
          onWheel={(e) => {
            const i = patterns.findIndex((p) => p.id === pat?.id)
            const n = patterns[Math.min(patterns.length - 1, Math.max(0, i + Math.sign(e.deltaY)))]
            if (n) selectPattern(n.id)
          }}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: pat?.color }} />
          <span className="truncate">{pat?.name}</span>
          <ChevronDown size={10} className="ml-auto" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[60vh] overflow-auto">
          {patterns.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => selectPattern(p.id)}>
              <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => addPattern()}>New pattern</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        className="grid h-[17px] w-[18px] place-items-center border border-[#20272a] bg-[#46525a] fl-bevel hover:bg-[#53616a] disabled:opacity-40 disabled:hover:bg-[#46525a]"
        title={canSplit ? 'Split by channel: one pattern per channel' : 'Split by channel (needs notes on 2+ channels)'}
        disabled={!canSplit}
        onClick={() => setSplitting(true)}
      >
        <Split size={10} />
      </button>
      <button className="grid h-[17px] w-[18px] place-items-center border border-[#20272a] bg-[#46525a] fl-bevel hover:bg-[#53616a]" title="Rename pattern" onClick={() => pat && setRenaming(pat.name)}>
        <Pencil size={10} />
      </button>
      <button className="grid h-[17px] w-[18px] place-items-center border border-[#20272a] bg-[#46525a] fl-bevel hover:bg-[#53616a]" title="Add pattern (F4)" onClick={() => addPattern()}>
        <Plus size={11} />
      </button>
      <button className="grid h-[17px] w-[18px] place-items-center rounded-r-[3px] border border-[#20272a] bg-[#46525a] fl-bevel hover:bg-[#8a3b37]" title="Delete pattern" onClick={() => setConfirm(true)}>
        <Trash2 size={10} />
      </button>
      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="max-w-[320px] border-[#1d2326] bg-fl-panel p-4 text-fl-text">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Rename pattern</DialogTitle>
            <DialogDescription className="sr-only">New name for the pattern</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              commitRename()
            }}
          >
            <input
              autoFocus
              value={renaming ?? ''}
              maxLength={80}
              onChange={(e) => setRenaming(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="h-[22px] w-full rounded-[2px] bg-fl-well px-1.5 text-[11px] text-fl-text outline-none fl-inset"
            />
            <DialogFooter className="mt-3 gap-2">
              <button type="button" className="h-6 rounded-[3px] border border-[#20272a] bg-[#46525a] px-3 text-[11px] fl-bevel hover:bg-[#53616a]" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={!renaming?.trim()}
                className="h-6 rounded-[3px] border border-[#20272a] bg-fl-orange px-3 text-[11px] text-[#1b1f22] fl-bevel hover:brightness-110 disabled:opacity-50"
              >
                Rename
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={splitting} onOpenChange={setSplitting}>
        <DialogContent className="max-w-[360px] border-[#1d2326] bg-fl-panel p-4 text-fl-text">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Split by channel?</DialogTitle>
            <DialogDescription className="text-[11px] text-fl-dim">
              "{pat?.name}" will be replaced by {splitChans.length} patterns, one per channel ({splitChans.join(', ')}). Its playlist clips are split onto consecutive tracks. You can undo this with Ctrl+Z.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button className="h-6 rounded-[3px] border border-[#20272a] bg-[#46525a] px-3 text-[11px] fl-bevel hover:bg-[#53616a]" onClick={() => setSplitting(false)}>
              Cancel
            </button>
            <button
              autoFocus
              className="h-6 rounded-[3px] border border-[#20272a] bg-fl-orange px-3 text-[11px] text-[#1b1f22] fl-bevel hover:brightness-110"
              onClick={() => {
                if (pat) splitPatternByChannel(pat.id)
                setSplitting(false)
              }}
            >
              Split
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-[340px] border-[#1d2326] bg-fl-panel p-4 text-fl-text">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Delete pattern?</DialogTitle>
            <DialogDescription className="text-[11px] text-fl-dim">
              "{pat?.name}" and all its notes will be deleted, along with its clips in the playlist. You can undo this with Ctrl+Z.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button className="h-6 rounded-[3px] border border-[#20272a] bg-[#46525a] px-3 text-[11px] fl-bevel hover:bg-[#53616a]" onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button
              autoFocus
              className="h-6 rounded-[3px] border border-[#20272a] bg-[#b2453f] px-3 text-[11px] text-white fl-bevel hover:bg-[#c4524b]"
              onClick={() => {
                if (pat) deletePattern(pat.id)
                setConfirm(false)
              }}
            >
              Delete
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

