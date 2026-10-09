// Intercepts "add / replace channel with plugin X" when X needs a content pack that isn't installed: instead of
// adding a silent channel, the download dialog opens and offers to finish the action once installed.
import { create } from 'zustand'
import { packsSupported } from './paths'
import { packForPlugin } from './registry'
import { isUsable } from './status'
import { packStatus, refreshPacks } from './store'

export interface PendingAction {
  /** button label once installed, e.g. "Add to channel rack" */
  label: string
  run: () => void
}

interface PackDialogState {
  /** pack whose download dialog is open */
  packId: string | null
  after: PendingAction | null
  /** "Sound libraries…" manager */
  manager: boolean
}

export const usePackDialog = create<PackDialogState>(() => ({ packId: null, after: null, manager: false }))

/** Opens after the current event (lets a closing Radix menu restore focus first). */
export function openPackDialog(packId: string, after: PendingAction | null = null): void {
  setTimeout(() => usePackDialog.setState({ packId, after }), 0)
}
export function closePackDialog(): void {
  usePackDialog.setState({ packId: null, after: null })
}
export function openSoundLibraries(): void {
  setTimeout(() => usePackDialog.setState({ manager: true }), 0)
}
export function closeSoundLibraries(): void {
  usePackDialog.setState({ manager: false })
}

/**
 * What selecting a plugin should do: 'run' (no pack needed / installed / packs unsupported here → legacy
 * behaviour) or 'prompt' (open the download dialog). 'check' = status not known yet.
 */
export function packDecision(pluginId: string, supported = packsSupported()): { action: 'run' } | { action: 'prompt' | 'check'; packId: string } {
  const def = packForPlugin(pluginId)
  if (!def || !supported) return { action: 'run' }
  const st = packStatus(def.id)
  if (isUsable(st)) return { action: 'run' }
  if (st.state === 'unknown') return { action: 'check', packId: def.id }
  return { action: 'prompt', packId: def.id }
}

/** Run `run` now if the plugin's pack is available, else open the download dialog with `run` as follow-up. */
export function guardPack(pluginId: string, run: () => void, label = 'Add to channel rack'): void {
  const d = packDecision(pluginId)
  if (d.action === 'run') return run()
  if (d.action === 'prompt') return openPackDialog(d.packId, { label, run })
  void refreshPacks(d.packId).then(() => {
    const again = packDecision(pluginId)
    if (again.action === 'run') run()
    else openPackDialog(again.packId, { label, run })
  })
}
