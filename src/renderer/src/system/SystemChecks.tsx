// Mounted once by App: runs the startup dependency check (every start) and listens for updates.
// The update dialog waits until the dependency dialog is closed so the two never stack at startup.
import { useEffect } from 'react'
import { host } from '@/platform'
import { runStartupDependencyCheck, useDeps } from './deps'
import { initUpdates, showAutoUpdate, useUpdate } from './update'
import { DepsDialog } from './DepsDialog'
import { UpdateDialog } from './UpdateDialog'

export function SystemChecks() {
  const depsOpen = useDeps((s) => s.open)
  const depsChecking = useDeps((s) => s.checking)
  const autoPending = useUpdate((s) => s.autoPending)
  const updateOpen = useUpdate((s) => s.open)

  useEffect(() => {
    if (!host) return
    void runStartupDependencyCheck()
    return initUpdates()
  }, [])

  useEffect(() => {
    if (autoPending && !depsOpen && !depsChecking && !updateOpen) showAutoUpdate()
  }, [autoPending, depsOpen, depsChecking, updateOpen])

  return (
    <>
      <DepsDialog />
      <UpdateDialog />
    </>
  )
}
