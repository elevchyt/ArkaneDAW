import { cn } from '@/lib/utils'

/** Round FL "LED" switch (channel/track on/off). */
export function Led({ on, onClick, color = 'var(--fl-green)', size = 10, title, className, onContextMenu }: { on: boolean; onClick?: (e: React.MouseEvent) => void; color?: string; size?: number; title?: string; className?: string; onContextMenu?: (e: React.MouseEvent) => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn('rounded-full border border-[#141819] shrink-0', className)}
      style={{ width: size, height: size, background: on ? color : 'var(--fl-led-off)', boxShadow: on ? `0 0 6px ${color}` : 'inset 0 1px 1px rgba(0,0,0,.6)' }}
    />
  )
}

/** Rectangular toolbar toggle used all over FL. */
export function ToggleButton({ active, onClick, children, title, className, activeColor = 'var(--fl-orange)' }: { active?: boolean; onClick?: (e: React.MouseEvent) => void; children: React.ReactNode; title?: string; className?: string; activeColor?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'h-6 min-w-6 px-1 rounded-[3px] flex items-center justify-center text-[11px] fl-bevel border border-[#1e2427] transition-colors',
        active ? 'text-[#1b1f22]' : 'bg-[#46525a] hover:bg-[#515e66] text-fl-text',
        className
      )}
      style={active ? { background: activeColor } : undefined}
    >
      {children}
    </button>
  )
}
