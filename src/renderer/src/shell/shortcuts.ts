import { useEffect } from 'react'
import { useUI } from '@/store/ui'
import { useTransport } from '@/store/transport'
import { getProject } from '@/store/project'
import { DEFAULT_NOTE_KEY } from '@/store/types'
import { initAudio, transport } from '@/audio/transport'
import { cloneChannels, deleteChannels, moveChannels, routeToFreeInserts, selectPattern, nextEmptyPattern, addPattern, liveChannelId } from '@/store/actions'
import { commands } from './commands'
import { dispatchWindowKey } from './keys'
import { recordLiveNote } from '@/audio/recording'
import { TOOL_KEYS as PLAYLIST_TOOL_KEYS } from '@/windows/playlist/keys'

// FL's typing keyboard layout: Q-row = the typing octave, Z-row = one octave below. Q and ',' play the channel's
// root note (the note its steps play: the sample's own pitch, or a Drum Machine channel's pad).
const TYPING: Record<string, number> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31
}

const held = new Map<string, { id: number; key: number; channelId: string }>()

function isTextInput(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/** Keys typed inside an open menu, popover or dialog belong to it (arrow navigation, Enter...), not the DAW. */
function inOverlay(t: EventTarget | null): boolean {
  return !!(t as HTMLElement | null)?.closest?.('[role=menu],[role=menubar],[role=listbox],[role=dialog],[role=alertdialog]')
}

function typingNote(e: KeyboardEvent, down: boolean): boolean {
  const ui = useUI.getState()
  // always let go of a note that is sounding, whatever modifiers are held by now
  if (!down && held.has(e.code)) {
    const h = held.get(e.code)!
    void initAudio().then((engine) => engine.noteOff(h.channelId, h.id, h.key))
    recordLiveNote(h.channelId, h.key, 0, false, h.id)
    held.delete(e.code)
    return true
  }
  // modifiers are shortcuts (Shift+C, Shift+G...); the focused Playlist keeps its tool letters (P, B, C, D...)
  if (!ui.typingKeyboard || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false
  if (ui.focused === 'playlist' && PLAYLIST_TOOL_KEYS[e.code]) return false
  const off = TYPING[e.code]
  if (off === undefined) return false
  const channelId = liveChannelId()
  if (!channelId) return true
  if (down) {
    if (e.repeat || held.has(e.code)) return true
    const root = getProject().channels.find((c) => c.id === channelId)?.rootNote ?? DEFAULT_NOTE_KEY
    const key = Math.max(0, Math.min(127, root + off - 12 + (ui.typingOctave - 5) * 12))
    void initAudio().then((engine) => {
      const id = engine.noteOn(channelId, key, 0.78)
      held.set(e.code, { id, key, channelId })
      recordLiveNote(channelId, key, 0.78, true, id)
    })
  } else {
    const h = held.get(e.code)
    if (h) {
      void initAudio().then((engine) => engine.noteOff(h.channelId, h.id, h.key))
      recordLiveNote(h.channelId, h.key, 0, false, h.id)
      held.delete(e.code)
    }
  }
  return true
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTextInput(e.target) || inOverlay(e.target)) return
      const ui = useUI.getState()
      const ctrl = e.ctrlKey || e.metaKey
      if (typingNote(e, true)) {
        e.preventDefault()
        return
      }
      // Escape closes the active window, whatever it is (open menus/dialogs handle Escape themselves).
      if (e.code === 'Escape' && !document.querySelector('[role=dialog],[role=menu],[data-radix-popper-content-wrapper]')) {
        const w = ui.focused ? ui.windows[ui.focused] : null
        if (w?.open && !w.minimized) {
          ui.closeWindow(w.id)
          e.preventDefault()
          return
        }
      }
      if (dispatchWindowKey(ui.focused, e)) {
        e.preventDefault()
        return
      }
      let handled = true
      const sel = ui.selectedChannels
      switch (true) {
        case e.code === 'Space' && ctrl:
          commands.togglePause()
          break
        case e.code === 'Space':
          commands.togglePlay()
          break
        case ctrl && e.shiftKey && e.code === 'KeyZ':
          commands.redo()
          break
        case ctrl && e.code === 'KeyZ':
          commands.undo()
          break
        case ctrl && e.shiftKey && e.code === 'KeyS':
          commands.saveAs()
          break
        case ctrl && e.code === 'KeyS':
          commands.save()
          break
        case ctrl && e.code === 'KeyO':
          commands.open()
          break
        case ctrl && e.code === 'KeyN':
          commands.saveNewVersion()
          break
        case ctrl && e.code === 'KeyR':
          commands.exportWav()
          break
        case ctrl && e.shiftKey && e.code === 'KeyH':
          commands.arrangeWindows()
          break
        case ctrl && e.code === 'KeyH':
          commands.panic()
          break
        case ctrl && e.code === 'KeyM':
          useTransport.getState().set({ metronome: !useTransport.getState().metronome })
          break
        case ctrl && e.code === 'KeyT':
          ui.set({ typingKeyboard: !ui.typingKeyboard })
          break
        case ctrl && e.code === 'KeyP':
          useTransport.getState().set({ precount: !useTransport.getState().precount })
          break
        case ctrl && e.code === 'KeyI':
          useTransport.getState().set({ waitForInput: !useTransport.getState().waitForInput })
          break
        case ctrl && e.code === 'KeyE':
          ui.set({ stepEditMode: !ui.stepEditMode })
          break
        case ctrl && e.code === 'KeyL':
          routeToFreeInserts(sel)
          break
        case ctrl && e.code === 'F4':
          nextEmptyPattern()
          break
        case e.altKey && e.code === 'KeyC' && sel.length > 0:
          cloneChannels(sel)
          break
        case e.altKey && e.code === 'Delete' && sel.length > 0:
          deleteChannels(sel)
          break
        case e.altKey && e.code === 'ArrowUp' && sel.length > 0:
          moveChannels(sel, -1)
          break
        case e.altKey && e.code === 'ArrowDown' && sel.length > 0:
          moveChannels(sel, 1)
          break
        case e.altKey && e.code === 'F8':
          commands.toggleBrowser()
          break
        case e.code === 'F4':
          addPattern()
          break
        case e.code === 'F5':
          commands.togglePlaylist()
          break
        case e.code === 'F6':
          commands.toggleChannelRack()
          break
        case e.code === 'F7':
          commands.togglePianoRoll()
          break
        case e.code === 'F8':
          commands.pluginPicker()
          break
        case e.code === 'F9':
          commands.toggleMixer()
          break
        case e.code === 'F12':
          commands.closeAllWindows()
          break
        case e.code === 'Escape':
          if (ui.focused) ui.closeWindow(ui.focused)
          break
        case e.code === 'KeyL' && !ctrl:
          commands.toggleMode()
          break
        case e.code === 'KeyR' && !ctrl:
          useTransport.getState().set({ recording: !useTransport.getState().recording })
          break
        case e.code === 'NumpadAdd' || e.code === 'NumpadSubtract': {
          const p = getProject()
          const i = p.patterns.findIndex((x) => x.id === ui.currentPattern)
          const n = p.patterns[Math.max(0, Math.min(p.patterns.length - 1, i + (e.code === 'NumpadAdd' ? 1 : -1)))]
          if (n) selectPattern(n.id)
          break
        }
        case /^Numpad[1-9]$/.test(e.code): {
          const n = getProject().patterns[Number(e.code.slice(6)) - 1]
          if (n) selectPattern(n.id)
          break
        }
        default:
          handled = false
      }
      if (handled) e.preventDefault()
    }
    const up = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return
      typingNote(e, false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])
  void transport
}
