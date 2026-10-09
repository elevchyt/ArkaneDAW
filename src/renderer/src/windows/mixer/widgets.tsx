// Small FL-mixer-sized controls (the shared Knob/Fader are too chunky for 32 px strips).
import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useVerticalDrag } from '@/components/controls'

const A0 = -135
const A1 = 135
function polar(c: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [c + r * Math.cos(a), c + r * Math.sin(a)]
}
function arc(c: number, r: number, a: number, b: number): string {
  if (Math.abs(b - a) < 0.5) return ''
  const [x0, y0] = polar(c, r, a)
  const [x1, y1] = polar(c, r, b)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${Math.abs(b - a) > 180 ? 1 : 0} 1 ${x1} ${y1}`
}

/** Tiny round FL knob: thin value ring, dark cap, light pointer. */
export function TinyKnob({
  value,
  onChange,
  onReset,
  size = 16,
  bipolar,
  color = '#c9d3d8',
  dim
}: {
  value: number
  onChange: (v: number) => void
  onReset?: () => void
  size?: number
  bipolar?: boolean
  color?: string
  dim?: boolean
}) {
  const v = useRef(value)
  v.current = value
  const drag = useVerticalDrag((d) => {
    const nv = Math.min(1, Math.max(0, v.current + d))
    v.current = nv
    onChange(nv)
  }, 150)
  const c = size / 2
  const ang = A0 + (A1 - A0) * value
  const from = bipolar ? 0 : A0
  const ring = c - 1.25
  const [px, py] = polar(c, c * 0.62, ang)
  return (
    <svg
      width={size}
      height={size}
      className={cn('block shrink-0 cursor-ns-resize', dim && 'opacity-50')}
      {...drag}
      onDoubleClick={() => onReset?.()}
      onWheel={(e) => onChange(Math.min(1, Math.max(0, value - Math.sign(e.deltaY) * (e.shiftKey ? 0.005 : 0.02))))}
    >
      <circle cx={c} cy={c} r={ring} fill="none" stroke="#1b2124" strokeWidth={1.5} />
      <path d={arc(c, ring, Math.min(from, ang), Math.max(from, ang))} stroke={color} strokeWidth={1.5} fill="none" />
      <circle cx={c} cy={c} r={c - 3} fill="#4b575d" stroke="#1d2427" strokeWidth={0.75} />
      <circle cx={c} cy={c - 0.6} r={c - 4.2} fill="#58656b" />
      <line x1={c} y1={c} x2={px} y2={py} stroke="#eef3f5" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}

/** Long thin mixer fader with a small light cap (orange accent when selected). */
export function SlimFader({
  value,
  onChange,
  onReset,
  height,
  width,
  unity = 0.8,
  accent
}: {
  value: number
  onChange: (v: number) => void
  onReset?: () => void
  height: number
  width: number
  unity?: number
  accent?: boolean
}) {
  const v = useRef(value)
  v.current = value
  const capH = 11
  const travel = Math.max(1, height - capH)
  const drag = useVerticalDrag((d) => {
    const nv = Math.min(1, Math.max(0, v.current + d))
    v.current = nv
    onChange(nv)
  }, travel)
  const top = (1 - value) * travel
  const ticks = [0, 0.25, 0.5, unity, 1]
  return (
    <div
      className="relative shrink-0 cursor-ns-resize"
      style={{ width, height }}
      {...drag}
      onDoubleClick={() => onReset?.()}
      onWheel={(e) => onChange(Math.min(1, Math.max(0, value - Math.sign(e.deltaY) * 0.02)))}
    >
      {ticks.map((t) => (
        <div
          key={t}
          className="absolute h-px"
          style={{ top: capH / 2 + (1 - t) * travel, left: 1, right: 1, background: t === unity ? '#7b888e' : '#2a3236' }}
        />
      ))}
      <div className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-[1px] bg-[#151a1c]" style={{ top: capH / 2 - 1, bottom: capH / 2 - 1 }} />
      <div
        className="absolute left-0 right-0 rounded-[2px] border border-[#15191b]"
        style={{
          top,
          height: capH,
          background: 'linear-gradient(#dfe5e8, #a9b3b8 45%, #858f94 55%, #a3adb2)',
          boxShadow: '0 1px 2px rgba(0,0,0,.6)'
        }}
      >
        <div className="absolute left-[2px] right-[2px] top-1/2 h-[2px] -translate-y-1/2 rounded-full" style={{ background: accent ? 'var(--fl-orange)' : '#3b4447' }} />
      </div>
    </div>
  )
}

/** 12 px icon toggle used in the strip's lower button rows. */
export function IconToggle({
  on,
  onClick,
  onHover,
  children,
  activeColor = 'var(--fl-orange)',
  className,
  onWheel,
  onDoubleClick
}: {
  on: boolean
  onClick?: (e: React.MouseEvent) => void
  onHover: () => void
  children: React.ReactNode
  activeColor?: string
  className?: string
  onWheel?: (e: React.WheelEvent) => void
  onDoubleClick?: () => void
}) {
  return (
    <button
      className={cn('grid h-[11px] min-w-[11px] place-items-center rounded-[2px] px-[1px] text-[8px] font-bold leading-none', !on && 'text-[#6c797f] hover:text-[#a8b4b9]', className)}
      style={on ? { color: activeColor } : undefined}
      onClick={onClick}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onMouseEnter={(e) => {
        e.stopPropagation()
        onHover()
      }}
    >
      {children}
    </button>
  )
}
