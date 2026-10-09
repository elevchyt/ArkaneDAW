// Download dialog ("Download Concerto?" → progress → "Concerto installed" → Add to channel rack) and the
// "Sound libraries…" manager. Both are mounted once by <PackDialogHost/> (in MainMenu).
import { useEffect, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Download, HardDrive, X } from 'lucide-react'
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { closePackDialog, closeSoundLibraries, usePackDialog } from './guard'
import { packEnv, packsSupported, type PackEnv } from './paths'
import { fmtBytes, fmtEta, fmtProgress, fmtSpeed, percent } from './progress'
import { getPack, PACKS, type PackDef } from './registry'
import { isBusy, type PackStatus } from './status'
import { cancelInstall, initPacks, installPack, removePack, usePackStatus } from './store'

export function usePackEnv(): PackEnv | null {
  const [env, setEnv] = useState<PackEnv | null>(null)
  useEffect(() => {
    let alive = true
    packEnv().then((e) => alive && setEnv(e), () => {})
    return () => {
      alive = false
    }
  }, [])
  return env
}

export const licenseUrl = (def: PackDef, env: PackEnv | null): string => `https://github.com/${env?.repo ?? 'elevchyt/ArkaneDAW'}/blob/main/${def.licenseFile}`
export const installDir = (def: PackDef, env: PackEnv | null): string => (env?.packsDir ? `${env.packsDir}/${def.id}` : `~/.config/ArkaneDAW/packs/${def.id}`)

export function DlgButton({ primary, onClick, disabled, children, className }: { primary?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 min-w-[72px] items-center justify-center gap-1 rounded-[3px] border border-[#1e2427] px-3 text-[11px] fl-bevel disabled:opacity-40',
        primary ? 'bg-fl-orange font-semibold text-[#1b1f22] enabled:hover:brightness-110' : 'bg-[#46525a] text-fl-text enabled:hover:bg-[#515e66]',
        className
      )}
    >
      {children}
    </button>
  )
}

/** Progress bar + MB / speed / ETA for a downloading or installing pack. */
export function PackProgressBar({ status, compact }: { status: PackStatus; compact?: boolean }) {
  if (status.state !== 'downloading' && status.state !== 'installing') return null
  const pct = status.state === 'downloading' ? percent(status.received, status.total) : percent(status.done, status.total)
  const text =
    status.state === 'downloading'
      ? status.total
        ? `${fmtProgress(status.received, status.total)} · ${pct}%`
        : 'Connecting…'
      : status.phase === 'verify'
        ? 'Verifying checksum…'
        : `Installing… ${pct}%`
  return (
    <div className="flex flex-col gap-1">
      <div className="relative h-[20px] overflow-hidden rounded-[2px] bg-fl-well fl-inset" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="absolute inset-y-0 left-0 bg-fl-orange/80 transition-[width] duration-150" style={{ width: `${pct}%` }} />
        <div className={cn('relative truncate px-2 font-mono text-[10px] leading-[20px]', pct > 45 ? 'text-[#1b1f22]' : 'text-fl-text')}>{text}</div>
      </div>
      {!compact && status.state === 'downloading' && (
        <div className="flex justify-between font-mono text-[10px] text-fl-dim">
          <span>{fmtSpeed(status.speed)}</span>
          <span>{fmtEta(status.eta)}</span>
        </div>
      )}
    </div>
  )
}

export function errorText(status: PackStatus, def: PackDef): string | null {
  if (status.state !== 'error') return null
  if (status.code === 'not-published') return `Pack not published yet — the ${def.name} library hasn't been uploaded to the download server. Try again later.`
  return status.message
}

function Shell({ open, onClose, title, width = 460, children }: { open: boolean; onClose: () => void; title: React.ReactNode; width?: number; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPortal>
        <DialogOverlay className="z-[300000] bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onPointerDownOutside={(e) => e.preventDefault()}
          onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}
          className="fixed left-1/2 top-1/2 z-[300000] flex max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[3px] border border-[#11161a] bg-fl-panel text-[11px] text-fl-text shadow-[0_10px_40px_rgba(0,0,0,.65)] outline-none"
          style={{ width }}
        >
          <div className="flex h-[24px] shrink-0 items-center gap-2 bg-fl-title-active pl-2 pr-1 text-[#eef2f4]" style={{ boxShadow: 'inset 0 2px 0 var(--fl-orange)' }}>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-[11px] font-medium">{title}</DialogPrimitive.Title>
            <button className="flex h-[18px] w-[18px] items-center justify-center rounded-sm hover:bg-white/10" onClick={onClose} title="Close">
              <X size={12} />
            </button>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-fl-dim">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </>
  )
}

function PackDownloadDialog({ def, after }: { def: PackDef; after: { label: string; run: () => void } | null }) {
  const status = usePackStatus(def.id)
  const env = usePackEnv()
  const busy = isBusy(status)
  const done = status.state === 'installed'
  const err = errorText(status, def)
  const title = done ? `${def.name} installed` : busy ? `Downloading ${def.name}…` : status.state === 'update-available' ? `Update ${def.name}?` : `Download ${def.name}?`
  const close = (): void => closePackDialog()
  return (
    <Shell open onClose={close} title={title}>
      <div className="flex flex-col gap-3 px-3 py-3">
        <div className="flex gap-3">
          <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[3px] bg-fl-well fl-inset">
            {done ? <HardDrive size={18} className="text-fl-green" /> : <Download size={18} className="text-fl-orange" />}
          </div>
          <div className="min-w-0 leading-[1.45]">
            {done ? (
              <span>
                The {def.name} sound library is ready{status.source === 'dev' ? ' (development copy)' : ''}.
                {after ? '' : ' Open the instrument again to use it.'}
              </span>
            ) : (
              <span>
                <b>{def.name}</b> needs its sound library, which isn't included with ArkaneDAW to keep the app small. {def.description}
              </span>
            )}
          </div>
        </div>
        {!done && (
          <div className="grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 rounded-[2px] bg-fl-panel-2 px-2 py-1.5">
            <Field label="Download size">
              {fmtBytes(def.sizeBytes)} · {def.files} files · v{def.version}
              {status.state === 'update-available' ? ` (installed: v${status.version})` : ''}
            </Field>
            <Field label="Licence">
              {def.license}{' '}
              <a href={licenseUrl(def, env)} target="_blank" rel="noreferrer" className="text-fl-orange underline underline-offset-2">
                details
              </a>
            </Field>
            <Field label="Install location">
              <span className="font-mono text-[10px]">{installDir(def, env)}</span>
            </Field>
          </div>
        )}
        {busy && <PackProgressBar status={status} />}
        {busy && <div className="text-[10px] text-fl-dim">You can close this window — the download continues in the background (progress is shown in the add menus).</div>}
        {err && <div className="rounded-[2px] border border-fl-red/40 bg-fl-red/10 px-2 py-1.5 text-[#ffb3ae]">{err}</div>}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[#232b2f] bg-fl-panel-2 px-2 py-2">
        {done ? (
          <>
            {after && (
              <DlgButton
                primary
                onClick={() => {
                  close()
                  after.run()
                }}
              >
                {after.label}
              </DlgButton>
            )}
            <DlgButton onClick={close}>Close</DlgButton>
          </>
        ) : busy ? (
          <>
            <DlgButton onClick={() => cancelInstall(def.id)}>Cancel download</DlgButton>
            <DlgButton onClick={close}>Hide</DlgButton>
          </>
        ) : (
          <>
            <DlgButton primary disabled={!packsSupported()} onClick={() => void installPack(def.id)}>
              <Download size={11} />
              {status.state === 'error' ? 'Retry' : status.state === 'update-available' ? 'Update' : 'Download'}
            </DlgButton>
            <DlgButton onClick={close}>Cancel</DlgButton>
          </>
        )}
      </div>
    </Shell>
  )
}

function statusLabel(s: PackStatus): string {
  switch (s.state) {
    case 'unknown':
      return 'Checking…'
    case 'not-installed':
      return 'Not installed'
    case 'downloading':
      return s.total ? `Downloading ${percent(s.received, s.total)}%` : 'Connecting…'
    case 'installing':
      return s.phase === 'verify' ? 'Verifying…' : 'Installing…'
    case 'installed':
      return s.source === 'dev' ? 'Installed (dev checkout copy)' : `Installed · v${s.version}`
    case 'update-available':
      return `v${s.version} installed · v${s.latest} available`
    case 'error':
      return s.code === 'not-published' ? 'Pack not published yet' : 'Error'
  }
}

function PackRow({ def, env }: { def: PackDef; env: PackEnv | null }) {
  const st = usePackStatus(def.id)
  const [confirm, setConfirm] = useState(false)
  const busy = isBusy(st)
  const removable = st.state === 'update-available' || (st.state === 'installed' && st.source === 'pack')
  const err = errorText(st, def)
  return (
    <div className="flex flex-col gap-1.5 border-b border-[#2a3236] px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-white">{def.name}</div>
          <div className={cn('text-[10px]', st.state === 'error' ? 'text-fl-red' : st.state === 'installed' ? 'text-fl-green' : 'text-fl-dim')}>
            {statusLabel(st)} · {fmtBytes(def.sizeBytes)}
          </div>
        </div>
        {busy ? (
          <DlgButton onClick={() => cancelInstall(def.id)}>Cancel</DlgButton>
        ) : (
          <>
            {(st.state === 'not-installed' || st.state === 'error' || st.state === 'update-available' || (st.state === 'installed' && st.source === 'dev')) && (
              <DlgButton primary={st.state !== 'installed'} disabled={!packsSupported()} onClick={() => void installPack(def.id)}>
                <Download size={11} />
                {st.state === 'error' ? 'Retry' : st.state === 'update-available' ? 'Update' : 'Install'}
              </DlgButton>
            )}
            {removable &&
              (confirm ? (
                <DlgButton
                  className="bg-[#7a3632] text-white enabled:hover:bg-[#8c3d38]"
                  onClick={() => {
                    setConfirm(false)
                    void removePack(def.id)
                  }}
                >
                  Confirm remove
                </DlgButton>
              ) : (
                <DlgButton onClick={() => setConfirm(true)}>Remove</DlgButton>
              ))}
          </>
        )}
      </div>
      <div className="text-[10px] leading-[1.4] text-fl-dim">{def.description}</div>
      {busy && <PackProgressBar status={st} />}
      {err && <div className="text-[10px] text-[#ffb3ae]">{err}</div>}
      <div className="text-[10px] text-fl-dim">
        {def.license}{' '}
        <a href={licenseUrl(def, env)} target="_blank" rel="noreferrer" className="text-fl-orange underline underline-offset-2">
          details
        </a>
      </div>
    </div>
  )
}

function SoundLibraries() {
  const env = usePackEnv()
  return (
    <Shell open onClose={closeSoundLibraries} title="Sound libraries" width={520}>
      <div className="max-h-[60vh] overflow-auto">
        {PACKS.map((d) => (
          <PackRow key={d.id} def={d} env={env} />
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-[#232b2f] bg-fl-panel-2 px-2 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-fl-dim" title={env?.packsDir ?? ''}>
          {packsSupported() ? (env?.packsDir ?? '') : 'Sound libraries can only be downloaded in the desktop app.'}
        </span>
        <DlgButton onClick={closeSoundLibraries}>Close</DlgButton>
      </div>
    </Shell>
  )
}

/** Mount once: hosts the download dialog + sound library manager and starts the pack status checks. */
export function PackDialogHost() {
  const { packId, after, manager } = usePackDialog()
  useEffect(() => initPacks(), [])
  const def = packId ? getPack(packId) : undefined
  return (
    <>
      {def && <PackDownloadDialog key={def.id} def={def} after={after} />}
      {manager && <SoundLibraries />}
    </>
  )
}
