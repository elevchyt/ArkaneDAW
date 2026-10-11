// FL-styled modal shell shared by the dependency and update dialogs (same look as the export wizard).
import { useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Check, Copy } from 'lucide-react'
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** Above the export wizard (z 300000) so prompts opened from it are on top. */
const Z = 'z-[300010]'

export function FlDialog({
  open,
  onClose,
  title,
  width = 560,
  children,
  footer,
  closable = true,
  label
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  width?: number
  children: React.ReactNode
  footer: React.ReactNode
  closable?: boolean
  label?: string
}) {
  const footerRef = useRef<HTMLDivElement>(null)
  const buttons = () => Array.from(footerRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closable && onClose()}>
      <DialogPortal>
        <DialogOverlay className={cn(Z, 'bg-black/40')} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          aria-label={label}
          onEscapeKeyDown={(e) => !closable && e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            // Start on the primary button: Enter confirms, the arrows move to the others.
            const b = buttons()
            const first = b.find((x) => x.hasAttribute('data-primary')) ?? b[0]
            if (first) {
              e.preventDefault()
              first.focus()
            }
          }}
          onKeyDown={(e) => {
            // Keep Space/Ctrl+R/… from reaching the global shortcut handler.
            if (e.key !== 'Escape') e.stopPropagation()
            const t = e.target as HTMLElement
            if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
            const b = buttons()
            if (!b.length) return
            const i = b.indexOf(document.activeElement as HTMLButtonElement)
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
              b[i < 0 ? (dir > 0 ? 0 : b.length - 1) : (i + dir + b.length) % b.length].focus()
            } else if (e.key === 'Enter' && i < 0 && t.tagName !== 'BUTTON' && t.tagName !== 'A') {
              // focus somewhere in the body: Enter = the primary button
              e.preventDefault()
              ;(b.find((x) => x.hasAttribute('data-primary')) ?? b[0]).click()
            }
          }}
          style={{ width }}
          className={cn(
            Z,
            'fixed left-1/2 top-1/2 flex max-h-[calc(100vh-48px)] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[3px] border border-[#11161a] bg-fl-panel text-[11px] text-fl-text shadow-[0_10px_40px_rgba(0,0,0,.65)] outline-none'
          )}
        >
          <div className="flex h-[24px] shrink-0 items-center gap-2 bg-fl-title-active px-2 text-[#eef2f4]" style={{ boxShadow: 'inset 0 2px 0 var(--fl-orange)' }}>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-[11px] font-medium">{title}</DialogPrimitive.Title>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
          <div ref={footerRef} className="flex shrink-0 items-center gap-2 border-t border-[#232b2f] bg-fl-panel-2 px-2 py-2">
            {footer}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

export function DlgButton({ primary, onClick, disabled, children, title }: { primary?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      data-primary={primary ? '' : undefined}
      className={cn(
        // keyboard focus shows as a light border (outlines are off app-wide)
        'h-6 min-w-[72px] shrink-0 rounded-[3px] border border-[#1e2427] px-3 text-[11px] fl-bevel focus:border-[#e9f3ff] disabled:opacity-40',
        primary ? 'bg-fl-orange font-semibold text-[#1b1f22] enabled:hover:brightness-110' : 'bg-[#46525a] text-fl-text enabled:hover:bg-[#515e66]'
      )}
    >
      {children}
    </button>
  )
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** A shell command in a recessed well with a Copy button. */
export function CommandLine({ cmd, label }: { cmd: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-0.5">
      {label && <span className="text-[10px] text-fl-dim">{label}</span>}
      <div className="flex items-center gap-1 rounded-[2px] bg-fl-well py-0.5 pl-2 pr-0.5 fl-inset">
        <code className="min-w-0 flex-1 select-text overflow-x-auto whitespace-nowrap font-mono text-[11px] text-[#cfe9b8]">
          <span className="select-none text-fl-dim">$ </span>
          {cmd}
        </code>
        <button
          type="button"
          title="Copy to clipboard"
          onClick={() =>
            void copyText(cmd).then((ok) => {
              if (!ok) return
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }
          className="flex h-[18px] shrink-0 items-center gap-1 rounded-[2px] bg-[#46525a] px-1.5 text-[10px] text-fl-text hover:bg-[#515e66]"
        >
          {copied ? <Check size={10} /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}

export function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-fl-orange underline-offset-2 hover:underline">
      {children}
    </a>
  )
}
