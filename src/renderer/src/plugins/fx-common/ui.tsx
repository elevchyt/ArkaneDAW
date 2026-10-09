// Shared editor pieces for the built-in effects pack (main thread only — never import from dsp.ts).
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useProject } from '@/store/project'
import type { PluginEditorProps } from '../sdk/module'
import { PK, Section } from '../sdk/ui'
import { formatParam } from '../sdk/params'

export const BIG = 54
export const MID = 42
export const SMALL = 32

/** Current value of a param (falls back to its default). */
export function pv(p: PluginEditorProps, id: string): number {
  const v = p.instance.params[id]
  if (v !== undefined) return v
  return p.manifest.params.find((d) => d.id === id)?.default ?? 0
}

export function ptext(p: PluginEditorProps, id: string, v = pv(p, id)): string {
  const def = p.manifest.params.find((d) => d.id === id)
  return def ? formatParam(def, v) : String(v)
}

export function hintParam(p: PluginEditorProps, id: string, v = pv(p, id)): void {
  const def = p.manifest.params.find((d) => d.id === id)
  if (def) p.hint(`${def.name}: ${formatParam(def, v)}`)
}

/** Subscribe to DSP messages while the editor is mounted, sending UI heartbeats so the DSP posts visuals. */
export function useDspFeed(p: PluginEditorProps, cb: (msg: unknown) => void): void {
  const ref = useRef(cb)
  ref.current = cb
  const { onDSPMessage, postToDSP } = p
  useEffect(() => {
    const off = onDSPMessage((m) => ref.current(m))
    postToDSP({ t: 'ui' })
    const id = window.setInterval(() => postToDSP({ t: 'ui' }), 500)
    return () => {
      off()
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

/**
 * Project tempo for display. The host itself pushes it to the DSP via the hidden `tempo` param
 * (setParam('tempo', bpm) on creation and on every tempo change), so editors only read it.
 */
export function useTempoSync(p: PluginEditorProps): number {
  const tempo = useProject((s) => s.project.tempo)
  return tempo || p.instance.params.tempo || 120
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

function setupCanvas(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/**
 * HiDPI canvas. With `animate`, `draw` runs every animation frame (meters, scopes);
 * otherwise it redraws whenever `draw` changes identity.
 */
export function FxCanvas({
  width,
  height,
  draw,
  animate,
  className,
  style,
  ...rest
}: { width: number; height: number; draw: Draw; animate?: boolean; className?: string; style?: React.CSSProperties } & Omit<
  React.HTMLAttributes<HTMLCanvasElement>,
  'children'
>) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    const c = ref.current
    if (!c) return
    if (!animate) {
      const ctx = setupCanvas(c, width, height)
      if (ctx) {
        ctx.clearRect(0, 0, width, height)
        draw(ctx, width, height)
      }
      return
    }
    let raf = 0
    const loop = () => {
      const ctx = setupCanvas(c, width, height)
      if (ctx) {
        ctx.clearRect(0, 0, width, height)
        drawRef.current(ctx, width, height)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [animate, width, height, animate ? null : draw])
  return <canvas ref={ref} className={cn('block rounded-[3px]', className)} style={{ width, height, ...style }} {...rest} />
}

/** Dark recessed display background with a subtle grid. */
export function drawScreen(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#1a2124')
  g.addColorStop(1, '#13181a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

export function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Shared "meter value" box (written by DSP feed, read by rAF draws without React re-renders). */
export function useMeterRef<T extends object>(init: T): React.MutableRefObject<T> {
  return useRef(init)
}

/**
 * Vertical meter. `get()` returns a value in dB; `fromTop` draws gain reduction hanging from the top.
 */
export function VMeter({
  get,
  min = -60,
  max = 0,
  width = 14,
  height,
  color,
  fromTop,
  label,
  title
}: {
  get: () => number
  min?: number
  max?: number
  width?: number
  height: number
  color: string
  fromTop?: boolean
  label?: string
  title?: string
}) {
  const hold = useRef({ v: min, t: 0 })
  const disp = useRef(min)
  return (
    <div className="flex flex-col items-center gap-0.5" title={title}>
      <FxCanvas
        width={width}
        height={height}
        animate
        className="fl-inset"
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#121617'
          ctx.fillRect(0, 0, w, h)
          const raw = get()
          const v = Math.max(min, Math.min(max, Number.isFinite(raw) ? raw : min))
          // ballistics: fast attack, slower fall
          disp.current = v > disp.current ? v : disp.current + (v - disp.current) * 0.15
          const now = performance.now()
          if (disp.current >= hold.current.v || now - hold.current.t > 1200) hold.current = { v: disp.current, t: now }
          const norm = (x: number) => (x - min) / (max - min)
          const y = h * (1 - norm(disp.current))
          if (fromTop) {
            const gh = h * (1 - norm(disp.current))
            const g = ctx.createLinearGradient(0, 0, 0, h)
            g.addColorStop(0, color)
            g.addColorStop(1, '#ff5d55')
            ctx.fillStyle = g
            ctx.fillRect(1, 0, w - 2, gh)
            const hy = h * (1 - norm(hold.current.v))
            ctx.fillStyle = '#e9eef0'
            ctx.fillRect(1, Math.max(0, hy - 1), w - 2, 1.5)
          } else {
            const g = ctx.createLinearGradient(0, h, 0, 0)
            g.addColorStop(0, '#3e8e2a')
            g.addColorStop(0.7, color)
            g.addColorStop(1, '#ff5d55')
            ctx.fillStyle = g
            ctx.fillRect(1, y, w - 2, h - y)
            const hy = h * (1 - norm(hold.current.v))
            ctx.fillStyle = '#e9eef0'
            ctx.fillRect(1, hy, w - 2, 1.5)
          }
          // ticks every 6 dB (12 for big ranges)
          const step = max - min > 40 ? 12 : 6
          ctx.fillStyle = 'rgba(255,255,255,0.12)'
          for (let d = Math.ceil(min / step) * step; d <= max; d += step) ctx.fillRect(0, Math.round(h * (1 - norm(d))), w, 1)
        }}
      />
      {label && <span className="text-[9px] uppercase tracking-wide text-fl-dim">{label}</span>}
    </div>
  )
}

/** Knob row helpers. */
export function Big({ p, id, color, label }: { p: PluginEditorProps; id: string; color?: string; label?: string }) {
  return <PK p={p} id={id} size={BIG} color={color ?? p.manifest.color} label={label} />
}
export function Mid({ p, id, color, label }: { p: PluginEditorProps; id: string; color?: string; label?: string }) {
  return <PK p={p} id={id} size={MID} color={color ?? p.manifest.color} label={label} />
}
export function Small({ p, id, color, label }: { p: PluginEditorProps; id: string; color?: string; label?: string }) {
  return <PK p={p} id={id} size={SMALL} color={color ?? p.manifest.color} label={label} />
}

/** Knob with an LCD readout under it (for the main controls). */
export function KnobReadout({ p, id, size = BIG, color, label }: { p: PluginEditorProps; id: string; size?: number; color?: string; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <PK p={p} id={id} size={size} color={color ?? p.manifest.color} label={label} />
      <div className="fl-lcd min-w-[54px] px-1 py-px text-center text-[10px] text-[#9fe870]">{ptext(p, id)}</div>
    </div>
  )
}

/** Plugin title strip (big name + subtitle) in the plugin's accent, FL-style. */
export function FxTitle({ p, sub, right }: { p: PluginEditorProps; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="text-[13px] font-bold uppercase tracking-[0.18em]" style={{ color: p.manifest.color }}>
        {p.manifest.name}
      </span>
      {sub && <span className="text-[10px] uppercase tracking-wide text-fl-dim">{sub}</span>}
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div>
  )
}

/** Small accent segmented selector (accent-colored variant of PSelect, with optional label). */
export function Seg({
  p,
  id,
  label,
  className,
  options
}: {
  p: PluginEditorProps
  id: string
  label?: string | false
  className?: string
  /** override displayed option labels */
  options?: string[]
}) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def?.options) return null
  const v = Math.round(pv(p, id))
  const names = options ?? def.options
  const accent = p.manifest.color ?? 'var(--fl-orange)'
  return (
    <div className={cn('flex flex-col gap-0.5', className)} onMouseEnter={() => p.hint(`${def.name}: ${def.options![v]}`)}>
      {label !== false && <span className="text-[10px] uppercase tracking-wide text-fl-dim">{label ?? def.name}</span>}
      <div className="flex gap-px rounded-[3px] bg-[#1a1f22] p-px">
        {names.map((o, i) => (
          <button
            key={i}
            onClick={() => {
              p.setParam(id, i)
              p.hint(`${def.name}: ${def.options![i]}`)
            }}
            className={cn(
              'flex-1 rounded-[2px] px-1.5 py-0.5 text-[10px] whitespace-nowrap',
              i === v ? 'font-semibold text-[#15191b]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]'
            )}
            style={i === v ? { background: accent } : undefined}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

/** LED toggle for 0/1 params, accent colored. */
export function Toggle({ p, id, label }: { p: PluginEditorProps; id: string; label?: string }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def) return null
  const on = pv(p, id) >= 0.5
  const c = p.manifest.color ?? 'var(--fl-green)'
  return (
    <button
      onClick={() => {
        p.setParam(id, on ? 0 : 1)
        p.hint(`${def.name}: ${on ? 'Off' : 'On'}`)
      }}
      onMouseEnter={() => p.hint(`${def.name}: ${on ? 'On' : 'Off'}`)}
      className="flex items-center gap-1.5 rounded-[3px] bg-[#1f2528] px-1.5 py-1 text-[10px] uppercase tracking-wide text-fl-text hover:bg-[#283034]"
    >
      <span
        className="h-2.5 w-2.5 rounded-full border border-[#141819]"
        style={{ background: on ? c : 'var(--fl-led-off)', boxShadow: on ? `0 0 6px ${c}` : undefined }}
      />
      {label ?? def.name}
    </button>
  )
}

// ─── Frequency-axis helpers for graphs ─────────────────────────────────────────

export const F_MIN = 20
export const F_MAX = 20000
export const freqToX = (f: number, w: number): number => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w
export const xToFreq = (x: number, w: number): number => F_MIN * Math.pow(F_MAX / F_MIN, Math.min(1, Math.max(0, x / w)))

export function drawFreqGrid(ctx: CanvasRenderingContext2D, w: number, h: number, dbRange?: number): void {
  ctx.lineWidth = 1
  ctx.font = '9px system-ui, sans-serif'
  ctx.textBaseline = 'top'
  const marks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
  for (const f of [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000]) {
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    const x = Math.round(freqToX(f, w)) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (const f of marks) {
    const x = Math.round(freqToX(f, w)) + 0.5
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.fillStyle = 'rgba(200,210,215,0.35)'
    if (f > 20 && f < 20000) ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 2, h - 11)
  }
  if (dbRange) {
    for (let d = -dbRange; d <= dbRange; d += dbRange / 3) {
      const y = Math.round(h / 2 - (d / dbRange) * (h / 2 - 8)) + 0.5
      ctx.strokeStyle = d === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
      if (d !== 0) {
        ctx.fillStyle = 'rgba(200,210,215,0.3)'
        ctx.fillText(`${d > 0 ? '+' : ''}${Math.round(d)}`, 2, y - 10)
      }
    }
  }
}

/** Section whose body is laid out by `body` classes (the SDK Section puts the title in the same box). */
export function Sec({ title, accent, className, body, children }: { title?: string; accent?: string; className?: string; body?: string; children: React.ReactNode }) {
  return (
    <Section title={title} accent={accent} className={className}>
      <div className={body}>{children}</div>
    </Section>
  )
}
