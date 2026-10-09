// Inline badge for menu items / tiles of plugins whose sound library isn't installed: "⬇ 181 MB", a mini progress
// bar while downloading, "installing…", "⚠ retry".
import { cn } from '@/lib/utils'
import { getPack } from './registry'
import { packBadge } from './status'
import { usePackStatus } from './store'

export function PackBadge({ packId, className }: { packId: string; className?: string }) {
  const st = usePackStatus(packId)
  const b = packBadge(st, getPack(packId)?.sizeBytes ?? 0)
  if (!b) return null
  return (
    <span
      title={b.title}
      data-pack-badge={b.kind}
      className={cn(
        'ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap pl-3 text-[10px] tabular-nums',
        b.kind === 'error' ? 'text-fl-red/80' : b.kind === 'update' ? 'text-fl-green/80' : 'text-[#d08a3c]',
        className
      )}
    >
      {b.kind === 'progress' && (
        <span className="relative h-[5px] w-[38px] overflow-hidden rounded-full bg-black/40">
          <span className="absolute inset-y-0 left-0 bg-fl-orange" style={{ width: `${b.pct}%` }} />
        </span>
      )}
      <span className={cn(b.kind === 'progress' && 'text-fl-orange')}>{b.label}</span>
    </span>
  )
}
