// Wraps a plugin editor that needs a content pack: while the pack isn't installed the editor area shows a
// "sound library not installed — Download" panel with the same progress UI as the download dialog.
import { useEffect, type ComponentType } from 'react'
import { Download, Library } from 'lucide-react'
import type { PluginEditorProps } from '../plugins/sdk/module'
import { openSoundLibraries } from './guard'
import { DlgButton, errorText, PackProgressBar } from './PackDialog'
import { packsSupported } from './paths'
import { fmtBytes } from './progress'
import { getPack } from './registry'
import { isBusy, isUsable } from './status'
import { initPacks, installPack, cancelInstall, usePackStatus } from './store'

export function PackMissingPanel({ packId, accent = '#f79a2e' }: { packId: string; accent?: string }) {
  const def = getPack(packId)!
  const st = usePackStatus(packId)
  const busy = isBusy(st)
  const err = errorText(st, def)
  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(120%_90%_at_50%_0%,#3a4448_0%,#262d31_70%)] text-[11px] text-fl-text">
      <div className="flex w-[380px] flex-col gap-3 rounded-[4px] border border-[#14191b] bg-fl-panel p-4 shadow-[0_6px_24px_rgba(0,0,0,.45)]">
        <div className="flex items-center gap-2">
          <Download size={18} style={{ color: accent }} />
          <div className="text-[13px] font-semibold text-white">{st.state === 'unknown' ? `Checking the ${def.name} sound library…` : `${def.name} sound library not installed`}</div>
        </div>
        <div className="leading-[1.45] text-fl-dim">{def.description}</div>
        {busy && <PackProgressBar status={st} />}
        {err && <div className="rounded-[2px] border border-fl-red/40 bg-fl-red/10 px-2 py-1.5 text-[#ffb3ae]">{err}</div>}
        <div className="flex items-center gap-2">
          {busy ? (
            <DlgButton onClick={() => cancelInstall(packId)}>Cancel download</DlgButton>
          ) : (
            <DlgButton primary disabled={!packsSupported() || st.state === 'unknown'} onClick={() => void installPack(packId)}>
              <Download size={11} />
              {st.state === 'error' ? 'Retry' : 'Download'} ({fmtBytes(def.sizeBytes)})
            </DlgButton>
          )}
          <button className="ml-auto flex items-center gap-1 text-[10px] text-fl-dim hover:text-white" onClick={openSoundLibraries}>
            <Library size={11} /> Sound libraries…
          </button>
        </div>
        <div className="text-[10px] text-fl-dim">{def.license}</div>
      </div>
    </div>
  )
}

/** Editor wrapper: real editor once the pack is usable (or when packs aren't supported, e.g. browser mode). */
export function withPack(packId: string, Editor: ComponentType<PluginEditorProps>): ComponentType<PluginEditorProps> {
  function PackGatedEditor(p: PluginEditorProps) {
    const st = usePackStatus(packId)
    useEffect(() => initPacks(), [])
    if (!packsSupported() || isUsable(st)) return <Editor {...p} />
    return <PackMissingPanel packId={packId} />
  }
  PackGatedEditor.displayName = `withPack(${packId})`
  return PackGatedEditor
}
