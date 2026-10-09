// "Missing dependencies" dialog: on every start when a required/recommended dependency is missing, and
// focused on one dependency when the user picks a feature that needs it (requireDependency).
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { deps, useDeps, type Dependency, type DepStatus } from './deps'
import { CommandLine, DlgButton, ExtLink, FlDialog } from './FlDialog'

const FAMILY_LABEL: Record<string, string> = { apt: 'apt', dnf: 'dnf', pacman: 'pacman', zypper: 'zypper', generic: 'unknown package manager' }

function DepCard({ dep, status, feature }: { dep: Dependency; status: DepStatus; feature?: string }) {
  const family = useDeps((s) => s.family)
  const isPackaged = useDeps((s) => s.isPackaged)
  const help = dep.install({ family, isPackaged }, status)
  const optional = dep.severity === 'optional'
  const partial = !!status.found && !status.ok
  const led = optional ? '#7f8c92' : partial ? 'var(--fl-orange)' : 'var(--fl-red)'
  return (
    <div className="flex flex-col gap-1.5 rounded-[3px] border border-[#232b2f] bg-fl-panel-2 px-2.5 pb-2.5 pt-2 fl-bevel">
      <div className="flex items-center gap-2">
        <span className="h-[9px] w-[9px] shrink-0 rounded-full border border-[#141819]" style={{ background: led, boxShadow: optional ? undefined : `0 0 5px ${led}` }} />
        <span className="text-[12px] font-semibold text-[#eef2f4]">{dep.name}</span>
        <span
          className={cn(
            'rounded-[2px] px-1 text-[9px] font-semibold uppercase tracking-[0.1em]',
            optional ? 'bg-[#3a454b] text-fl-dim' : dep.severity === 'required' ? 'bg-fl-red/20 text-fl-red' : 'bg-fl-orange/15 text-fl-orange'
          )}
        >
          {dep.severity}
        </span>
        <span className="flex-1" />
        {dep.homepage && <ExtLink href={dep.homepage.url}>{dep.homepage.label}</ExtLink>}
      </div>
      <div className="text-fl-text">{dep.why}</div>
      <div>
        <span className="text-fl-dim">Affects: </span>
        <span className="text-[#eef2f4]">{dep.affects}</span>
        {feature && <span className="text-fl-dim"> (needs {feature})</span>}
      </div>
      {status.detail && <div className={cn('text-[10px]', optional ? 'text-fl-dim' : 'text-[#ffb27a]')}>{status.detail}</div>}
      {help.steps.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-1">
          {help.steps.map((s, i) => (
            <CommandLine key={i} cmd={s.cmd} label={s.label} />
          ))}
        </div>
      )}
      {help.note && <div className="text-[10px] text-fl-dim">{help.note}</div>}
    </div>
  )
}

export function DepsDialog() {
  const state = useDeps((s) => s)
  const rows = deps.visible(state)
  const blocking = rows.filter((r) => r.dep.severity !== 'optional')
  const optional = rows.filter((r) => r.dep.severity === 'optional')
  const focusDep = state.mode === 'focus' && state.focus ? deps.registry.find((d) => d.id === state.focus!.id) : undefined
  const title = focusDep ? `${focusDep.name} is needed` : 'Missing dependencies'

  return (
    <FlDialog open={state.open} onClose={() => deps.dismiss()} title={title} width={600} label={title}
      footer={
        <>
          <span className="min-w-0 flex-1 truncate text-[10px] text-fl-dim" title={state.distroName}>
            {state.checking ? 'Checking…' : `Detected: ${state.distroName || 'Linux'} (${FAMILY_LABEL[state.family] ?? state.family})`}
          </span>
          <DlgButton onClick={() => void deps.recheck()} disabled={state.checking} title="Look for the dependencies again">
            <span className="flex items-center justify-center gap-1">
              <RefreshCw size={11} className={state.checking ? 'animate-spin' : undefined} /> Re-check
            </span>
          </DlgButton>
          <DlgButton primary onClick={() => deps.dismiss()}>
            Continue
          </DlgButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="px-0.5 text-fl-dim">
          {focusDep
            ? `This option needs ${focusDep.name}. Install it with the command below, then press Re-check to continue.`
            : 'Some features are unavailable until these are installed. Install them, then press Re-check, or Continue without them.'}
        </div>
        {(focusDep ? rows : blocking).map((r) => (
          <DepCard key={r.dep.id} dep={r.dep} status={r.status} feature={state.focus?.id === r.dep.id ? state.focus.feature : undefined} />
        ))}
        {!focusDep && optional.length > 0 && (
          <>
            <div className="mt-1 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fl-dim">Optional</div>
            {optional.map((r) => (
              <DepCard key={r.dep.id} dep={r.dep} status={r.status} />
            ))}
          </>
        )}
        {rows.length === 0 && <div className="px-0.5 py-2 text-fl-green">Everything is installed.</div>}
      </div>
    </FlDialog>
  )
}
