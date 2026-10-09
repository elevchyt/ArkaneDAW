import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'
import { useVerticalDrag } from './useDrag'

export interface FaderProps {
  value: number // normalized 0..1
  onChange: (v: number) => void
  onReset?: () => void
  height?: number
  width?: number
  hint?: string
  /** draw a tick at this normalized value (0 dB) */
  unity?: number
  className?: string
}

/** Vertical mixer fader with FL-style grey cap. */
export function Fader({ value, onChange, onReset, height = 120, width = 18, hint, unity, className }: FaderProps) {
  const setHint = useUI((s) => s.setHint)
  const v = useRef(value)
  v.current = value
  const capH = 22
  const travel = height - capH
  const drag = useVerticalDrag((d) => {
    const nv = Math.min(1, Math.max(0, v.current + d))
    v.current = nv
    onChange(nv)
    if (hint) setHint(hint)
  }, travel)
  const top = (1 - value) * travel
  return (
    <div
      className={cn('relative cursor-ns-resize', className)}
      style={{ width, height }}
      {...drag}
      onDoubleClick={() => onReset?.()}
      onMouseEnter={() => hint && setHint(hint)}
      onWheel={(e) => onChange(Math.min(1, Math.max(0, value - Math.sign(e.deltaY) * 0.02)))}
    >
      <div className="absolute left-1/2 -translate-x-1/2 rounded-sm bg-[#15191b] fl-inset" style={{ top: capH / 2, bottom: capH / 2, width: 4 }} />
      {unity !== undefined && (
        <div className="absolute left-0 right-0 h-px bg-[#6d7a80]" style={{ top: capH / 2 + (1 - unity) * travel }} />
      )}
      <div
        className="absolute left-0 right-0 rounded-[2px] border border-[#1a1f22] bg-gradient-to-b from-[#9aa5aa] via-[#6c777c] to-[#4e585d] shadow"
        style={{ top, height: capH }}
      >
        <div className="absolute left-0.5 right-0.5 top-1/2 h-px bg-[#2a3134]" />
      </div>
    </div>
  )
}
