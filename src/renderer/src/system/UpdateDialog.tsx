// "Update available — ArkaneDAW vX.Y.Z" dialog (release notes, Update now / Later / Skip this version,
// download progress, Restart now) plus the results of HELP › Check for updates….
import { useMemo } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProject } from '@/store/project'
import { renderMarkdown } from './markdown'
import { CommandLine, DlgButton, ExtLink, FlDialog } from './FlDialog'
import {
  closeUpdateDialog,
  hasVisibleUpdate,
  installUpdate,
  openReleasePage,
  openUpdateDialog,
  remindLater,
  restartToUpdate,
  skipThisVersion,
  useUpdate
} from './update'

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`
const v = (s: string) => (s ? `v${s.replace(/^v/i, '')}` : '')

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function Notes({ md }: { md: string }) {
  const html = useMemo(() => renderMarkdown(md), [md])
  if (!md.trim()) return <div className="text-fl-dim">No release notes.</div>
  return (
    <div
      className={cn(
        'arkane-md select-text leading-[1.5] text-fl-text',
        '[&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-[13px] [&_h1]:font-semibold [&_h1]:text-[#eef2f4]',
        '[&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-[12px] [&_h2]:font-semibold [&_h2]:text-[#eef2f4]',
        '[&_h3]:mb-0.5 [&_h3]:mt-1.5 [&_h3]:font-semibold [&_h3]:text-[#eef2f4] [&_h4]:mt-1 [&_h4]:font-semibold',
        '[&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
        '[&_a]:text-fl-orange [&_a:hover]:underline [&_strong]:text-[#eef2f4] [&_hr]:my-2 [&_hr]:border-[#283034]',
        '[&_code]:rounded-[2px] [&_code]:bg-[#151a1c] [&_code]:px-1 [&_code]:font-mono [&_code]:text-[10px] [&_code]:text-[#cfe9b8]',
        '[&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-[2px] [&_pre]:bg-[#151a1c] [&_pre]:p-1.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-fl-orange/60 [&_blockquote]:pl-2 [&_blockquote]:text-fl-dim'
      )}
      // Safe: renderMarkdown escapes all input and emits only a fixed set of tags.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export function UpdateDialog() {
  const s = useUpdate()
  const dirty = useProject((p) => p.dirty)
  const info = s.info

  if (s.view !== 'update' || !info) {
    const title = 'Check for updates'
    return (
      <FlDialog open={s.open} onClose={closeUpdateDialog} title={title} width={380} label={title} footer={<><span className="flex-1" /><DlgButton primary onClick={closeUpdateDialog}>OK</DlgButton></>}>
        <div className="px-1 py-2">
          {s.view === 'checking' && <span className="text-fl-dim">Checking for updates…</span>}
          {s.view === 'uptodate' && <span>You’re up to date{s.current ? ` (${v(s.current)})` : ''}.</span>}
          {s.view === 'checkError' && <span className="text-[#ffb27a]">Could not check for updates: {s.message}</span>}
        </div>
      </FlDialog>
    )
  }

  const r = s.result
  const downloading = s.phase === 'downloading'
  const pct = s.progress && s.progress.total ? Math.min(100, Math.round((s.progress.received / s.progress.total) * 100)) : 0
  const title = (
    <>
      Update available — ArkaneDAW <span className="text-fl-orange">{v(info.version)}</span>
    </>
  )

  let footer: React.ReactNode
  if (r?.action === 'replaced')
    footer = (
      <>
        <span className={cn('min-w-0 flex-1 truncate text-[10px]', dirty ? 'text-[#ffb27a]' : 'text-fl-dim')}>{dirty ? 'Save your project first: unsaved changes will be lost.' : ''}</span>
        <DlgButton onClick={closeUpdateDialog}>Later</DlgButton>
        <DlgButton primary onClick={restartToUpdate}>Restart now</DlgButton>
      </>
    )
  else if (s.phase === 'done' || s.phase === 'error')
    footer = (
      <>
        <span className="flex-1" />
        {s.phase === 'error' && <DlgButton onClick={() => openReleasePage()}>Open release page</DlgButton>}
        {s.phase === 'error' && <DlgButton onClick={() => void installUpdate()}>Retry</DlgButton>}
        <DlgButton primary onClick={closeUpdateDialog}>Close</DlgButton>
      </>
    )
  else
    footer = (
      <>
        <DlgButton onClick={skipThisVersion} disabled={downloading} title="Don’t show this version again">Skip this version</DlgButton>
        <span className="flex-1" />
        <DlgButton onClick={downloading ? closeUpdateDialog : remindLater}>{downloading ? 'Hide' : 'Later'}</DlgButton>
        <DlgButton primary onClick={() => void installUpdate()} disabled={downloading}>Update now</DlgButton>
      </>
    )

  return (
    <FlDialog open={s.open} onClose={downloading ? closeUpdateDialog : remindLater} title={title} width={620} label={`Update available, ArkaneDAW ${v(info.version)}`} footer={footer}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-2 px-0.5">
          <span className="text-[12px] font-semibold text-[#eef2f4]">{info.name}</span>
          {info.prerelease && <span className="rounded-[2px] bg-fl-orange/15 px-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-fl-orange">pre-release</span>}
          <span className="flex-1" />
          <span className="text-[10px] text-fl-dim">
            {s.current ? `You have ${v(s.current)}` : ''}
            {info.publishedAt ? ` · released ${formatDate(info.publishedAt)}` : ''}
          </span>
        </div>
        <div className="max-h-[320px] min-h-[80px] overflow-auto rounded-[2px] bg-fl-well px-2.5 py-1.5 fl-inset">
          <Notes md={info.notes} />
        </div>
        <div className="px-0.5 text-[10px]">
          <ExtLink href={info.htmlUrl}>View release on GitHub</ExtLink>
        </div>

        {downloading && (
          <div className="relative h-[20px] overflow-hidden rounded-[2px] bg-fl-well fl-inset" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="absolute inset-y-0 left-0 bg-fl-orange/80 transition-[width] duration-150" style={{ width: `${pct}%` }} />
            <div className={cn('relative truncate px-2 font-mono text-[10px] leading-[20px]', pct > 45 ? 'text-[#1b1f22]' : 'text-fl-text')}>
              {s.progress ? `Downloading ${s.progress.file} · ${mb(s.progress.received)}${s.progress.total ? ` / ${mb(s.progress.total)} · ${pct}%` : ''}` : 'Preparing download…'}
            </div>
          </div>
        )}
        {r?.action === 'replaced' && <div className="px-0.5 text-fl-green">ArkaneDAW {v(r.version)} is installed. Restart to use it.</div>}
        {r?.action === 'downloaded' && (
          <div className="flex flex-col gap-1 px-0.5">
            <div className="text-fl-green">Downloaded to {r.path}</div>
            <div className="text-fl-dim">Install it with:</div>
            <CommandLine cmd={r.command} />
          </div>
        )}
        {r?.action === 'opened' && <div className="px-0.5 text-[#ffb27a]">{r.message}</div>}
        {s.phase === 'error' && <div className="px-0.5 text-fl-red">Update failed: {s.message}</div>}
      </div>
    </FlDialog>
  )
}

/** FL-style orange pill at the top right of the main bar (left of the window controls). */
export function UpdateIndicator() {
  const show = useUpdate(hasVisibleUpdate)
  const version = useUpdate((s) => s.info?.version)
  const downloading = useUpdate((s) => s.phase === 'downloading')
  if (!show) return null
  return (
    <button
      type="button"
      onClick={openUpdateDialog}
      title={`ArkaneDAW v${version} is available`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="mr-1 mt-[5px] flex h-[18px] shrink-0 items-center gap-1 self-start rounded-full border border-[#1e2427] bg-fl-orange pl-1 pr-2 text-[10px] font-semibold text-[#1b1f22] shadow-[0_0_6px_rgba(247,154,46,.45)] hover:brightness-110"
    >
      <ArrowUpCircle size={12} className={downloading ? 'animate-pulse' : undefined} />
      {downloading ? 'Updating…' : 'Update available'}
    </button>
  )
}
