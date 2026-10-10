// "Save changes to <project>?" prompt before anything that would throw away unsaved work: closing the app,
// New, Open, recovering an autosave. confirmUnsaved() resolves true when it's fine to go ahead.
import { useEffect } from 'react'
import { create } from 'zustand'
import { host } from '@/platform'
import { useProject } from '@/store/project'
import { saveProject } from '@/store/io'
import { DlgButton, FlDialog } from './FlDialog'

interface Prompt {
  /** what happens after the prompt, e.g. "closing", "opening another project" */
  action: string
  resolve: (ok: boolean) => void
}

const usePrompt = create<{ prompt: Prompt | null; saving: boolean }>(() => ({ prompt: null, saving: false }))

/** Ask about unsaved changes (no-op when the project is clean). Save → saves first (Save as… if untitled). */
export function confirmUnsaved(action: string): Promise<boolean> {
  if (!useProject.getState().dirty) return Promise.resolve(true)
  const pending = usePrompt.getState().prompt
  if (pending) return Promise.resolve(false) // already asking
  return new Promise((resolve) => usePrompt.setState({ prompt: { action, resolve } }))
}

function finish(ok: boolean): void {
  const p = usePrompt.getState().prompt
  usePrompt.setState({ prompt: null, saving: false })
  p?.resolve(ok)
}

async function saveThenFinish(): Promise<void> {
  usePrompt.setState({ saving: true })
  try {
    await saveProject(false)
  } catch (e) {
    console.error('[save] failed', e)
  }
  // Save dialog cancelled or the write failed: stay put.
  if (useProject.getState().dirty) usePrompt.setState({ saving: false })
  else finish(true)
}

/** Mounted once: the dialog, plus the window-close hook (desktop) / beforeunload guard (browser). */
export function UnsavedDialog() {
  const prompt = usePrompt((s) => s.prompt)
  const saving = usePrompt((s) => s.saving)
  const name = useProject((s) => s.project.name)

  useEffect(() => {
    if (host) {
      return host.window.onCloseRequest(() => {
        void confirmUnsaved('closing').then((ok) => ok && void host!.window.forceClose())
      })
    }
    const guard = (e: BeforeUnloadEvent) => {
      if (useProject.getState().dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  return (
    <FlDialog
      open={!!prompt}
      onClose={() => !saving && finish(false)}
      title="Unsaved changes"
      width={400}
      label="Unsaved changes"
      footer={
        <>
          <div className="flex-1" />
          <DlgButton primary disabled={saving} onClick={() => void saveThenFinish()}>
            {saving ? 'Saving…' : 'Save'}
          </DlgButton>
          <DlgButton disabled={saving} onClick={() => finish(true)}>
            Don&apos;t save
          </DlgButton>
          <DlgButton disabled={saving} onClick={() => finish(false)}>
            Cancel
          </DlgButton>
        </>
      }
    >
      <div className="px-1 py-2 leading-[1.5]">
        Save changes to <b className="text-white">{name}</b> before {prompt?.action ?? 'continuing'}?
        <div className="mt-1 text-[10px] text-fl-dim">Unsaved changes will be lost if you don&apos;t save them.</div>
      </div>
    </FlDialog>
  )
}
