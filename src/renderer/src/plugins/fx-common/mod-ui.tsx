// LFO display shared by the modulation effects (main thread only).
import { useRef } from 'react'
import { FxCanvas, drawScreen, withAlpha } from './ui'

/** One LFO cycle with animated L/R playheads. `offset` = R phase offset in cycles. */
export function LfoView({
  width,
  height,
  rate,
  depth,
  offset,
  shape = 'sin',
  color,
  caption
}: {
  width: number
  height: number
  rate: number
  depth: number
  offset: number
  shape?: 'sin' | 'tri'
  color: string
  caption?: string
}) {
  const st = useRef({ phase: 0, t: performance.now() })
  const f = (ph: number) => {
    ph = ((ph % 1) + 1) % 1
    return shape === 'sin' ? Math.sin(2 * Math.PI * ph) : 1 - 4 * Math.abs(ph - 0.5)
  }
  return (
    <FxCanvas
      width={width}
      height={height}
      animate
      className="fl-inset"
      draw={(ctx, w, h) => {
        const now = performance.now()
        st.current.phase = (st.current.phase + ((now - st.current.t) / 1000) * rate) % 1
        st.current.t = now
        drawScreen(ctx, w, h)
        const amp = (h / 2 - 6) * Math.max(0.04, depth)
        ctx.fillStyle = 'rgba(255,255,255,0.07)'
        ctx.fillRect(0, h / 2, w, 1)
        const curve = (off: number, stroke: string, lw: number) => {
          ctx.strokeStyle = stroke
          ctx.lineWidth = lw
          ctx.beginPath()
          for (let x = 0; x <= w; x++) {
            const y = h / 2 - f(x / w + off) * amp
            if (x === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
          ctx.lineWidth = 1
        }
        if (Math.abs(offset) > 0.001) curve(offset, 'rgba(230,236,240,0.35)', 1)
        curve(0, color, 2)
        const dot = (ph: number, off: number, c: string) => {
          const x = (((ph % 1) + 1) % 1) * w
          const y = h / 2 - f(ph + off) * amp
          ctx.fillStyle = withAlpha(c, 0.18)
          ctx.fillRect(x - 0.5, 0, 1, h)
          ctx.fillStyle = c
          ctx.beginPath()
          ctx.arc(x, y, 3.5, 0, Math.PI * 2)
          ctx.fill()
        }
        if (Math.abs(offset) > 0.001) dot(st.current.phase, offset, '#e6ecf0')
        dot(st.current.phase, 0, color)
        if (caption) {
          ctx.fillStyle = 'rgba(210,220,225,0.55)'
          ctx.font = '9px system-ui, sans-serif'
          ctx.fillText(caption, 4, h - 4)
        }
      }}
    />
  )
}
