import { useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toolbar } from '@/shell/Toolbar'
import { Browser } from '@/shell/Browser'
import { Workspace } from '@/shell/Workspace'
import { useGlobalShortcuts } from '@/shell/shortcuts'
import { installMiddleClickReset } from '@/shell/middleClickReset'
import { useUI, installHintTracking } from '@/store/ui'
import { useProject } from '@/store/project'
import { initAudio } from '@/audio/transport'
import { host } from '@/platform'
import { SystemChecks } from '@/system/SystemChecks'
import { UnsavedDialog } from '@/system/UnsavedDialog'
import { ConfirmDialog } from '@/system/ConfirmDialog'
import { PopupMenuHost } from '@/windows/playlist/PopupMenu'
import { PromptHost } from '@/windows/playlist/Prompt'
import { startAutosave } from '@/store/autosave'
import { startFileWatch } from '@/store/filewatch'

export default function App() {
  const browser = useUI((s) => s.browserVisible)
  useGlobalShortcuts()
  useEffect(() => installHintTracking(), [])
  useEffect(() => installMiddleClickReset(), [])
  useEffect(() => startAutosave(), [])
  useEffect(() => startFileWatch(), [])

  useEffect(() => {
    // Boot audio right away in Electron; in a browser wait for the first gesture.
    const boot = () => void initAudio()
    if (host) boot()
    window.addEventListener('pointerdown', boot, { once: true })
    window.addEventListener('keydown', boot, { once: true })
  }, [])

  useEffect(() => {
    return useProject.subscribe((s, prev) => {
      if (s.filePath !== prev.filePath || s.project.name !== prev.project.name || s.dirty !== prev.dirty) {
        void host?.window.setTitle(`${s.project.name}${s.dirty ? ' *' : ''} - ArkaneDAW`)
      }
    })
  }, [])

  return (
    <TooltipProvider delayDuration={600}>
      <div className="flex h-full flex-col" onContextMenu={(e) => e.preventDefault()}>
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          {browser && <Browser />}
          <Workspace />
        </div>
      </div>
      <SystemChecks />
      <UnsavedDialog />
      <ConfirmDialog />
      <PopupMenuHost />
      <PromptHost />
    </TooltipProvider>
  )
}
