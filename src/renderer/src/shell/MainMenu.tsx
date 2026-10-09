import { useProject } from '@/store/project'
import { useTransport } from '@/store/transport'
import { useUI } from '@/store/ui'
import { groupPlugins, useAllPlugins } from '@/plugins/catalog'
import { addInstrumentChannel } from '@/store/actions'
import { recentFiles } from '@/store/io'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
  MenubarCheckboxItem,
  MenubarLabel
} from '@/components/ui/menubar'
import { commands } from './commands'

const trig = 'h-[18px] rounded-sm px-1.5 py-0 text-[11px] font-semibold tracking-wide text-[#d4dbde] data-[state=open]:bg-fl-orange data-[state=open]:text-[#1b1f22]'

function Item({ label, shortcut, onSelect, disabled }: { label: string; shortcut?: string; onSelect: () => void; disabled?: boolean }) {
  return (
    <MenubarItem onSelect={onSelect} disabled={disabled}>
      {label}
      {shortcut && <MenubarShortcut>{shortcut}</MenubarShortcut>}
    </MenubarItem>
  )
}

export function MainMenu() {
  const past = useProject((s) => s.past)
  const future = useProject((s) => s.future)
  const undoTo = useProject((s) => s.undoTo)
  const instruments = useAllPlugins('instrument')
  const recent = recentFiles()

  return (
    <Menubar className="h-[20px] gap-0 border-none bg-transparent p-0 shadow-none">
      <MenubarMenu>
        <MenubarTrigger className={trig}>FILE</MenubarTrigger>
        <MenubarContent>
          <Item label="New from template" onSelect={commands.newProject} />
          <Item label="New (empty)" onSelect={commands.newEmptyProject} />
          <Item label="Open..." shortcut="Ctrl+O" onSelect={commands.open} />
          <MenubarSub>
            <MenubarSubTrigger>Open recent</MenubarSubTrigger>
            <MenubarSubContent>
              {recent.length === 0 && <MenubarLabel>No recent files</MenubarLabel>}
              {recent.map((r, i) => (
                <Item key={r} label={r.split('/').pop() ?? r} shortcut={`Alt+${i}`} onSelect={() => commands.openRecent(r)} />
              ))}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <Item label="Save" shortcut="Ctrl+S" onSelect={commands.save} />
          <Item label="Save as..." shortcut="Ctrl+Shift+S" onSelect={commands.saveAs} />
          <Item label="Save new version" shortcut="Ctrl+N" onSelect={commands.saveNewVersion} />
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger>Export</MenubarSubTrigger>
            <MenubarSubContent>
              <Item label="WAVE file..." shortcut="Ctrl+R" onSelect={commands.exportWav} />
              <Item label="MP3 file..." onSelect={() => commands.exportAs('mp3')} />
              <Item label="OGG file..." onSelect={() => commands.exportAs('ogg')} />
              <Item label="FLAC file..." onSelect={() => commands.exportAs('flac')} />
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={trig}>EDIT</MenubarTrigger>
        <MenubarContent>
          <Item label={`Undo ${past[past.length - 1]?.label ?? ''}`} shortcut="Ctrl+Z" onSelect={commands.undo} disabled={!past.length} />
          <Item label={`Redo ${future[0]?.label ?? ''}`} shortcut="Ctrl+Shift+Z" onSelect={commands.redo} disabled={!future.length} />
          <MenubarSub>
            <MenubarSubTrigger>History</MenubarSubTrigger>
            <MenubarSubContent className="max-h-[60vh] overflow-auto">
              <Item label="(initial state)" onSelect={() => undoTo(0)} />
              {past.map((h, i) => (
                <Item key={i} label={`${i + 1}. ${h.label}`} onSelect={() => undoTo(i + 1)} />
              ))}
            </MenubarSubContent>
          </MenubarSub>
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={trig}>ADD</MenubarTrigger>
        <MenubarContent className="max-h-[70vh] overflow-auto">
          <MenubarLabel>Channel</MenubarLabel>
          {groupPlugins(instruments).map(([cat, list]) => (
            <MenubarSub key={cat}>
              <MenubarSubTrigger>{cat}</MenubarSubTrigger>
              <MenubarSubContent className="max-h-[60vh] overflow-auto">
                {list.map((m) => (
                  <Item key={m.id} label={m.name} onSelect={() => addInstrumentChannel(m.id)} />
                ))}
              </MenubarSubContent>
            </MenubarSub>
          ))}
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={trig}>PATTERNS</MenubarTrigger>
        <MenubarContent>
          <Item label="Find first empty" shortcut="F4" onSelect={commands.nextEmptyPattern} />
          <Item label="New pattern" onSelect={commands.addPattern} />
          <Item label="Clone" onSelect={commands.clonePattern} />
          <Item label="Delete..." onSelect={commands.deletePattern} />
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={trig}>VIEW</MenubarTrigger>
        <MenubarContent>
          <Item label="Playlist" shortcut="F5" onSelect={commands.togglePlaylist} />
          <Item label="Channel rack" shortcut="F6" onSelect={commands.toggleChannelRack} />
          <Item label="Piano roll" shortcut="F7" onSelect={commands.togglePianoRoll} />
          <Item label="Plugin picker" shortcut="F8" onSelect={commands.pluginPicker} />
          <Item label="Mixer" shortcut="F9" onSelect={commands.toggleMixer} />
          <Item label="Browser" shortcut="Alt+F8" onSelect={commands.toggleBrowser} />
          <MenubarSeparator />
          <Item label="Arrange windows" shortcut="Ctrl+Shift+H" onSelect={commands.arrangeWindows} />
          <Item label="Close all windows" shortcut="F12" onSelect={commands.closeAllWindows} />
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={trig}>OPTIONS</MenubarTrigger>
        <MenubarContent>
          <Item label="Audio settings..." onSelect={() => useUI.getState().openWindow('audioSettings', { kind: 'audioSettings', title: 'Settings - Audio', w: 520, h: 420 })} />
          <Item label="Plugin manager..." onSelect={() => useUI.getState().openWindow('pluginManager', { kind: 'pluginManager', title: 'Plugin manager', w: 760, h: 480 })} />
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={trig}>TOOLS</MenubarTrigger>
        <MenubarContent>
          <Item label="Panic (stop all sound)" shortcut="Ctrl+H" onSelect={commands.panic} />
        </MenubarContent>
      </MenubarMenu>

      <MenubarMenu>
        <MenubarTrigger className={trig}>HELP</MenubarTrigger>
        <MenubarContent>
          <MenubarLabel>ArkaneDAW 0.1</MenubarLabel>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}
