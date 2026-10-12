// Commands shared by the main menu and keyboard shortcuts.
import { useUI } from '@/store/ui'
import { useProject } from '@/store/project'
import { useTransport } from '@/store/transport'
import { transport } from '@/audio/transport'
import { openProject, saveProject, saveNewVersion, newProject, openProjectFrom } from '@/store/io'
import { openPianoRoll } from '@/windows/pianoroll/open'
import { togglePluginPicker } from './PluginPicker'
import { nextEmptyPattern, addPattern, clonePattern, deletePattern, currentPatternId } from '@/store/actions'
import { openExportWizard } from '@/windows/export/open'
import type { ExportFormat } from '@/windows/export/core'
import { defaultTemplate } from '@/store/templates'
import { confirmUnsaved } from '@/system/UnsavedDialog'
import { recoverAutosave } from '@/store/autosave'
import { importMidiDialog } from '@/midi/import'

/** Run `fn` once unsaved changes are saved or discarded (no prompt when the project is clean). */
const guarded = (action: string, fn: () => void) => () => void confirmUnsaved(action).then((ok) => ok && fn())

export const commands = {
  newProject: guarded('starting a new project', () => newProject(defaultTemplate)),
  newEmptyProject: guarded('starting a new project', () => newProject()),
  open: guarded('opening another project', () => void openProject()),
  openRecent: (p: string) => guarded('opening another project', () => void openProjectFrom(p))(),
  recoverAutosave: guarded('recovering the autosave', () => void recoverAutosave()),
  save: () => void saveProject(false),
  saveAs: () => void saveProject(true),
  saveNewVersion: () => void saveNewVersion(),
  importMidi: () => void importMidiDialog(),
  exportWav: () => openExportWizard('wav'),
  exportAs: (format: ExportFormat) => openExportWizard(format),
  undo: () => useProject.getState().undo(),
  redo: () => useProject.getState().redo(),
  togglePlaylist: () => useUI.getState().toggleWindow('playlist', { kind: 'playlist', title: 'Playlist - Arrangement' }),
  toggleChannelRack: () => useUI.getState().toggleWindow('channelRack', { kind: 'channelRack', title: 'Channel rack' }),
  togglePianoRoll: () => {
    const ui = useUI.getState()
    if (ui.windows.pianoRoll?.open && ui.focused === 'pianoRoll') ui.closeWindow('pianoRoll')
    else openPianoRoll()
  },
  toggleMixer: () => useUI.getState().toggleWindow('mixer', { kind: 'mixer', title: 'Mixer' }),
  toggleBrowser: () => useUI.getState().set({ browserVisible: !useUI.getState().browserVisible }),
  pluginPicker: () => togglePluginPicker(),
  closeAllWindows: () => {
    const ui = useUI.getState()
    for (const id of Object.keys(ui.windows)) if (id !== 'playlist') ui.closeWindow(id)
  },
  arrangeWindows: () => {
    const ui = useUI.getState()
    ui.updateWindow('playlist', { open: true, maximized: true, minimized: false })
    ui.updateWindow('channelRack', { x: 60, y: 40, w: 640, h: 380, maximized: false })
    ui.updateWindow('mixer', { x: 80, y: 220, w: 1180, h: 470, maximized: false })
    ui.updateWindow('pianoRoll', { x: 140, y: 80, w: 980, h: 560, maximized: false })
  },
  togglePlay: () => transport.toggle(),
  togglePause: () => transport.togglePause(),
  toggleMode: () => {
    transport.setMode(useTransport.getState().mode === 'pattern' ? 'song' : 'pattern')
  },
  panic: () => transport.panic(),
  nextEmptyPattern: () => nextEmptyPattern(),
  addPattern: () => addPattern(),
  clonePattern: () => clonePattern(currentPatternId()),
  deletePattern: () => deletePattern(currentPatternId())
}
