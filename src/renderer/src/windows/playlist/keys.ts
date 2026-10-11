// Playlist keyboard shortcuts (FL basics_shortcuts.htm, Playlist section).
import { getProject } from '@/store/project'
import { useUI, type Tool } from '@/store/ui'
import { useTransport, playhead } from '@/store/transport'
import { PLAYLIST_TRACKS, type Clip } from '@/store/types'
import { zeroCrossTick } from '@/audio/clips'
import { getBuffer } from '@/audio/samples'
import { uid } from '@/store/factory'
import { barTicks, beatTicks, songLength } from '@/audio/sequence'
import { transport } from '@/audio/transport'
import { clampMove, cloneShifted, deleteSpace, duplicateRight, insertSpace, moveClips, sliceAt, span } from './ops'
import { addMarker, commitClips, deleteClips, setClipsMuted } from './actions'
import { fitPpt, snapTicks, zoomAround } from './geometry'
import { effectiveSnap, getPl, mouse, setSelection, toggleStretch, viewport } from './state'
import { selectBySource } from './menus'
import { setTimeSelection } from './Ruler'

const TOOL_KEYS: Record<string, Tool> = {
  KeyP: 'draw',
  KeyB: 'paint',
  KeyD: 'delete',
  KeyT: 'mute',
  KeyS: 'slip',
  KeyC: 'slice',
  KeyE: 'select',
  KeyZ: 'zoom',
  KeyY: 'play'
}

const selectedClips = () => {
  const sel = getPl().selected
  return getProject().playlist.clips.filter((c) => sel.has(c.id))
}

const songPos = (): number => (useTransport.getState().mode === 'song' ? playhead.tick : useTransport.getState().startTick)

export function zoomPreset(n: number): void {
  const p = getProject()
  const bar = barTicks(p)
  const spanT = n === 1 ? bar * 4 : n === 2 ? bar * 16 : n === 3 ? bar * 64 : songLength(p) + bar
  getPl().set({ ppt: fitPpt(spanT, viewport.w), scrollTick: n === 4 ? 0 : getPl().scrollTick })
}

export function centerPlayhead(): void {
  const pl = getPl()
  pl.set({ scrollTick: Math.max(0, songPos() - viewport.w / 2 / pl.ppt) })
}

export function playlistKey(e: KeyboardEvent): boolean {
  const ctrl = e.ctrlKey || e.metaKey
  const alt = e.altKey
  const shift = e.shiftKey
  const ui = useUI.getState()
  const pl = getPl()
  const p = getProject()
  const clips = p.playlist.clips
  const bar = barTicks(p)

  // single letters (only when the typing keyboard is off)
  if (!ctrl && !alt && !shift && !ui.typingKeyboard && TOOL_KEYS[e.code]) {
    ui.set({ playlistTool: TOOL_KEYS[e.code] })
    ui.setHint(`Playlist tool: ${TOOL_KEYS[e.code]}`)
    return true
  }

  if (ctrl && !alt) {
    switch (e.code) {
      case 'KeyA':
        setSelection(clips.map((c) => c.id))
        return true
      case 'KeyD':
        setSelection([])
        return true
      case 'KeyC':
      case 'KeyX': {
        const sel = selectedClips()
        if (!sel.length) return true
        pl.set({ clipboard: sel.map((c) => ({ ...c })) })
        if (e.code === 'KeyX') deleteClips(new Set(sel.map((c) => c.id)), 'Cut clips')
        ui.setHint(`${sel.length} clip(s) ${e.code === 'KeyX' ? 'cut' : 'copied'}`)
        return true
      }
      case 'KeyV': {
        const cb = pl.clipboard
        const s = cb && span(cb)
        if (!cb || !s) return true
        const grid = snapTicks(effectiveSnap(), pl.ppt, bar, beatTicks(p))
        const at = Math.round(songPos() / Math.max(1, grid)) * Math.max(1, grid)
        const copies = cloneShifted(cb, at - s.start, 0, uid)
        commitClips('Paste clips', clips, [...clips, ...copies])
        setSelection(copies.map((c) => c.id))
        return true
      }
      case 'KeyB': {
        let sel = selectedClips()
        const ts = pl.timeSel
        if (!sel.length && ts) sel = clips.filter((c) => c.start >= ts.start && c.start < ts.end)
        if (!sel.length) return true
        const copies = ts && !pl.selected.size ? cloneShifted(sel, ts.end - ts.start, 0, uid) : duplicateRight(sel, bar, uid)
        commitClips('Duplicate clips', clips, [...clips, ...copies])
        if (ts && !pl.selected.size) setTimeSelection({ start: ts.end, end: ts.end + (ts.end - ts.start) })
        else setSelection(copies.map((c) => c.id))
        return true
      }
      case 'Insert': {
        const ts = pl.timeSel
        if (!ts) return true
        commitClips('Insert space', clips, insertSpace(clips, ts.start, ts.end - ts.start, uid))
        return true
      }
      case 'Delete': {
        const ts = pl.timeSel
        if (!ts) return true
        commitClips('Delete space', clips, deleteSpace(clips, ts.start, ts.end, uid))
        return true
      }
    }
    return false
  }

  if (alt && !ctrl) {
    switch (e.code) {
      case 'KeyM':
        setClipsMuted(pl.selected, !shift, shift ? 'Unmute selection' : 'Mute selection')
        return true
      case 'KeyT':
        if (shift) return false
        addMarker(songPos())
        return true
      case 'KeyP':
        pl.set({ picker: !pl.picker })
        return true
    }
    return false
  }

  if (shift && !ctrl && !alt) {
    switch (e.code) {
      case 'KeyM':
        if (ui.typingKeyboard) return false
        toggleStretch()
        return true
      case 'KeyC':
        if (ui.typingKeyboard) return false
        selectBySource(selectedClips())
        return true
      case 'KeyI': {
        if (ui.typingKeyboard) return false
        setSelection(clips.filter((c) => !pl.selected.has(c.id)).map((c) => c.id))
        return true
      }
      case 'Digit0':
        centerPlayhead()
        return true
      case 'Digit5': {
        // zoom to selection (clips, else time selection)
        const s = span(selectedClips()) ?? (pl.timeSel ? { start: pl.timeSel.start, end: pl.timeSel.end } : null)
        if (s) pl.set({ ppt: fitPpt(s.end - s.start, viewport.w), scrollTick: s.start })
        return true
      }
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
        zoomPreset(Number(e.code.slice(5)))
        return true
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        const sel = selectedClips()
        if (!sel.length) return true
        const grid = Math.max(1, snapTicks(effectiveSnap(), pl.ppt, bar, beatTicks(p)))
        const raw = { dTick: e.code === 'ArrowLeft' ? -grid : e.code === 'ArrowRight' ? grid : 0, dTrack: e.code === 'ArrowUp' ? -1 : e.code === 'ArrowDown' ? 1 : 0 }
        const { dTick, dTrack } = clampMove(sel, raw.dTick, raw.dTrack, PLAYLIST_TRACKS)
        commitClips('Move clips', clips, moveClips(clips, pl.selected, dTick, dTrack))
        return true
      }
    }
    return false
  }

  if (ctrl || alt || shift) return false
  switch (e.code) {
    case 'Delete':
      deleteClips(new Set(pl.selected))
      return true
    case 'Insert': {
      // slice at the mouse cursor (selected clips, or the clip track under the mouse)
      const zc = pl.zeroCross ? (c: Clip, t: number) => zeroCrossTick(p, c, t, getBuffer(c.ref)) : undefined
      const at = Math.round(mouse.tick / Math.max(1, snapTicks(effectiveSnap(), pl.ppt, bar, beatTicks(p)))) * Math.max(1, snapTicks(effectiveSnap(), pl.ppt, bar, beatTicks(p)))
      if (pl.selected.size) {
        const sel = new Set(pl.selected)
        const other = clips.filter((c) => !sel.has(c.id))
        commitClips('Slice clips', clips, [...other, ...sliceAt(clips.filter((c) => sel.has(c.id)), at, 0, PLAYLIST_TRACKS - 1, uid, zc)])
      } else if (mouse.inside) commitClips('Slice clips', clips, sliceAt(clips, at, mouse.track, mouse.track, uid, zc))
      return true
    }
    case 'Home':
      transport.seek(0)
      pl.set({ scrollTick: 0 })
      return true
    case 'PageUp':
      pl.set(zoomAround({ ...pl }, viewport.w / 2, 1.5))
      return true
    case 'PageDown':
      pl.set(zoomAround({ ...pl }, viewport.w / 2, 1 / 1.5))
      return true
    case 'Backspace':
      pl.set({ snap: effectiveSnap() === 'none' ? 'line' : 'none' })
      ui.setHint(`Playlist snap: ${getPl().snap}`)
      return true
    case 'Enter':
    case 'NumpadEnter': {
      const w = ui.windows.playlist
      if (w) ui.updateWindow('playlist', { maximized: !w.maximized })
      return true
    }
    case 'Escape':
      if (pl.selected.size) {
        setSelection([])
        return true
      }
      return false
  }
  return false
}
