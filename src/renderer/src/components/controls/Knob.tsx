import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'
import { useVerticalDrag } from './useDrag'

export interface KnobProps {
  /** normalized 0..1 */
  value: number
  onChange: (v: number) => void
  onReset?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  size?: number
  label?: string
  /** text shown in hint bar while hovering/dragging */
  hint?: string
  /** bipolar knobs draw the arc from 12 o'clock (pan, detune) */
  bipolar?: boolean
  color?: string
  className?: string
  disabled?: boolean
  labelPosition?: 'below' | 'above' | 'none'
}

const A0 = -135
const A1 = 135

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arc(cx: number, cy: number, r: number, a: number, b: number): string {
  if (Math.abs(b - a) < 0.01) return ''
  const [x0, y0] = polar(cx, cy, r, a)
  const [x1, y1] = polar(cx, cy, r, b)
  const large = Math.abs(b - a) > 180 ? 1 : 0
  const sweep = b > a ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`
}

/** FL Studio style knob: dark cap, colored value arc, white pointer line. */
export function Knob({ value, onChange, onReset, onContextMenu, size = 32, label, hint, bipolar, color = 'var(--fl-orange)', className, disabled, labelPosition = 'below' }: KnobProps) {
  const setHint = useUI((s) => s.setHint)
  const v = useRef(value)
  v.current = value
  const drag = useVerticalDrag((d) => {
    const nv = Math.min(1, Math.max(0, v.current + d))
    v.current = nv
    onChange(nv)
    if (hint) setHint(hint)
  })
  const angle = A0 + (A1 - A0) * value
  const r = size / 2
  const cx = r
  const cy = r
  const track = r - 2
  const from = bipolar ? 0 : A0
  const [px, py] = polar(cx, cy, r * 0.62, angle)
  const [qx, qy] = polar(cx, cy, r * 0.2, angle)
  return (
    <div
      className={cn('flex flex-col items-center gap-0.5 select-none', disabled && 'opacity-40 pointer-events-none', className)}
      onMouseEnter={() => hint && setHint(hint)}
    >
      {label && labelPosition === 'above' && <span className="text-[10px] leading-none text-fl-dim uppercase tracking-wide">{label}</span>}
      <svg
        width={size}
        height={size}
        className="cursor-ns-resize"
        {...drag}
        onDoubleClick={() => onReset?.()}
        onContextMenu={(e) => {
          if (onContextMenu) {
            e.preventDefault()
            onContextMenu(e)
          }
        }}
        onWheel={(e) => {
          const nv = Math.min(1, Math.max(0, value - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02)))
          onChange(nv)
          if (hint) setHint(hint)
        }}
      >
        <path d={arc(cx, cy, track, A0, A1)} stroke="#1a1f22" strokeWidth={3} fill="none" strokeLinecap="round" />
        <path d={arc(cx, cy, track, Math.min(from, angle), Math.max(from, angle))} stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r * 0.68} fill="url(#knobcap)" stroke="#15191b" strokeWidth={1} />
        <defs>
          <radialGradient id="knobcap" cx="40%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#5d686e" />
            <stop offset="100%" stopColor="#2b3236" />
          </radialGradient>
        </defs>
        <line x1={qx} y1={qy} x2={px} y2={py} stroke="#e9eef0" strokeWidth={Math.max(1.5, size / 18)} strokeLinecap="round" />
      </svg>
      {label && labelPosition === 'below' && <span className="text-[10px] leading-none text-fl-dim uppercase tracking-wide whitespace-nowrap">{label}</span>}
    </div>
  )
}
