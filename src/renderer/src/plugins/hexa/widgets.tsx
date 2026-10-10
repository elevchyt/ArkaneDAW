// Hexa editor widgets: DX7-flavoured number cells, algorithm diagram, draggable envelope graphs, wheels, mini keyboard.
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { PluginEditorProps } from '../sdk/module'
import { useHeldKeys } from '../sdk/ui'
import { ALGORITHMS, CURVE_NAMES, PITCHENV_TAB } from './tables'
import { algoLayout } from './layout'

export const C = {
  panel: 'linear-gradient(180deg,#5b302b 0%,#43231f 55%,#351b18 100%)',
  section: 'rgba(20,8,6,0.32)',
  border: '#24100d',
  label: '#d8b8a6',
  dim: '#a88676',
  op: '#f0a35e',
  global: '#63c5b5',
  lcdBg: 'linear-gradient(180deg,#b7d466,#93b347)',
  lcdText: '#1b280c'
}

type P = PluginEditorProps

export function def(p: P, id: string) {
  return p.manifest.params.find((x) => x.id === id)
}
export function val(p: P, id: string): number {
  return p.instance.params[id] ?? def(p, id)?.default ?? 0
}

/** Small LCD-ish number that you drag vertically (or wheel) to edit. Double-click = default. */
export function NumCell({ p, id, width = 20, format, className, title }: { p: P; id: string; width?: number; format?: (v: number) => string; className?: string; title?: string }) {
  const d = def(p, id)
  const v = val(p, id)
  const acc = useRef(0)
  const live = useRef(v)
  live.current = v
  if (!d) return null
  const text = format ? format(v) : d.options ? d.options[Math.round(v)] : String(Math.round(v))
  const hint = (x: number) => p.hint(`${d.name}: ${format ? format(x) : d.options ? d.options[Math.round(x)] : Math.round(x)}`)
  const set = (x: number) => {
    const nv = Math.min(d.max, Math.max(d.min, Math.round(x)))
    if (nv !== live.current) {
      live.current = nv
      p.setParam(id, nv)
    }
    hint(nv)
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    acc.current = 0
    let lastY = e.clientY
    const range = d.max - d.min
    const pxPerStep = range > 40 ? 2 : range > 10 ? 5 : 9
    const move = (ev: PointerEvent) => {
      acc.current += (lastY - ev.clientY) / (ev.shiftKey ? pxPerStep * 4 : pxPerStep)
      lastY = ev.clientY
      const steps = Math.trunc(acc.current)
      if (steps) {
        acc.current -= steps
        set(live.current + steps)
      }
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div
      title={title}
      onPointerDown={onPointerDown}
      onWheel={(e) => set(v - Math.sign(e.deltaY))}
      onDoubleClick={() => set(d.default)}
      onMouseEnter={() => hint(v)}
      className={cn('h-[15px] cursor-ns-resize select-none rounded-[2px] text-center font-mono text-[10px] leading-[15px] tabular-nums', className)}
      style={{ width, background: '#1a0d0b', color: '#f3c99a', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.6)' }}
    >
      {text}
    </div>
  )
}

/** Click-to-cycle selector (curves, waves...). */
export function CycleCell({ p, id, width = 30, labels }: { p: P; id: string; width?: number; labels?: string[] }) {
  const d = def(p, id)
  if (!d?.options) return null
  const v = Math.round(val(p, id))
  const names = labels ?? d.options
  const n = d.options.length
  return (
    <button
      onClick={() => p.setParam(id, (v + 1) % n)}
      onContextMenu={(e) => {
        e.preventDefault()
        p.setParam(id, (v + n - 1) % n)
      }}
      onMouseEnter={() => p.hint(`${d.name}: ${d.options![v]} (click / right-click to change)`)}
      className="h-[15px] rounded-[2px] font-mono text-[9px] leading-[15px] hover:brightness-125"
      style={{ width, background: '#2a1512', color: '#f3c99a', border: `1px solid ${C.border}` }}
    >
      {names[v]}
    </button>
  )
}

export const CURVE_SHORT = ['-LN', '-EX', '+EX', '+LN']
export { CURVE_NAMES }

// ─── Algorithm diagram ───────────────────────────────────────────────────────

export function AlgoDiagram({ algo, opOn, fb, width = 168, height = 104, onOpClick }: { algo: number; opOn: boolean[]; fb: number; width?: number; height?: number; onOpClick?: (op: number) => void }) {
  const alg = ALGORITHMS[algo]
  const { nodes, cols, rows } = algoLayout(algo)
  const bw = 18
  const bh = 14
  const cw = Math.min(27, (width - 16) / cols)
  const rh = Math.min(23, (height - 16) / rows)
  const ox = (width - cw * (cols - 1)) / 2
  const busY = height - 6
  const pos = (op: number) => ({ x: ox + nodes[op].x * cw, y: busY - 12 - bh - nodes[op].y * rh })
  const lines: React.ReactNode[] = []
  alg.mods.forEach((ms, t) =>
    ms.forEach((m) => {
      const a = pos(m)
      const b = pos(t)
      lines.push(<line key={`${m}-${t}`} x1={a.x} y1={a.y + bh} x2={b.x} y2={b.y} stroke="#e7c9a6" strokeWidth={1.2} />)
    })
  )
  const carriers = alg.carriers.map((c, i) => (c ? i : -1)).filter((i) => i >= 0)
  const cx = carriers.map((i) => pos(i).x)
  const f = pos(alg.fbFrom)
  const t = pos(alg.fbTo)
  const right = Math.max(f.x, t.x) + bw / 2 + 5
  const fbPath = `M ${f.x} ${f.y + bh} v 3 H ${right} V ${t.y - 4} H ${t.x} V ${t.y}`
  return (
    <svg width={width} height={height}>
      {lines}
      {carriers.map((i) => (
        <line key={`c${i}`} x1={pos(i).x} y1={pos(i).y + bh} x2={pos(i).x} y2={busY} stroke="#e7c9a6" strokeWidth={1.2} />
      ))}
      <line x1={Math.min(...cx) - 4} y1={busY} x2={Math.max(...cx) + 4} y2={busY} stroke="#e7c9a6" strokeWidth={2} />
      <path d={fbPath} fill="none" stroke={fb > 0 ? C.global : '#7c5a4c'} strokeWidth={1.3} strokeDasharray={fb > 0 ? undefined : '2 2'} />
      {nodes.map((_, op) => {
        const q = pos(op)
        const car = alg.carriers[op]
        return (
          <g key={op} onClick={() => onOpClick?.(op)} style={{ cursor: onOpClick ? 'pointer' : undefined }}>
            <rect x={q.x - bw / 2} y={q.y} width={bw} height={bh} rx={2} fill={!opOn[op] ? '#3a2522' : car ? C.global : C.op} stroke="#1a0b09" />
            <text x={q.x} y={q.y + 10.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={opOn[op] ? '#1d0f0c' : '#8a6a60'}>
              {op + 1}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Envelope graphs ─────────────────────────────────────────────────────────

/** Drag helper with pointer capture: reports pixel deltas. */
function useDragDelta(onDelta: (dx: number, dy: number, shift: boolean) => void) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as Element
    el.setPointerCapture(e.pointerId)
    let lx = e.clientX
    let ly = e.clientY
    const move = (ev: Event) => {
      const pe = ev as PointerEvent
      onDelta(pe.clientX - lx, pe.clientY - ly, pe.shiftKey)
      lx = pe.clientX
      ly = pe.clientY
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
}

function EnvHandle({ p, x, y, rateId, levelId, w, h, invert }: { p: P; x: number; y: number; rateId: string; levelId: string; w: number; h: number; invert?: boolean }) {
  const acc = useRef({ r: 0, l: 0 })
  const live = useRef({ r: val(p, rateId), l: val(p, levelId) })
  live.current = { r: val(p, rateId), l: val(p, levelId) }
  const [hover, setHover] = useState(false)
  const down = useDragDelta((dx, dy, shift) => {
    const k = shift ? 0.25 : 1
    acc.current.r += -dx * 0.6 * k
    acc.current.l += (-dy / h) * 99 * k * (invert ? 1 : 1)
    const dr = Math.trunc(acc.current.r)
    const dl = Math.trunc(acc.current.l)
    if (dr) {
      acc.current.r -= dr
      const nv = Math.min(99, Math.max(0, live.current.r + dr))
      live.current.r = nv
      p.setParam(rateId, nv)
    }
    if (dl) {
      acc.current.l -= dl
      const nv = Math.min(99, Math.max(0, live.current.l + dl))
      live.current.l = nv
      p.setParam(levelId, nv)
    }
    p.hint(`${def(p, rateId)?.name}: ${live.current.r}  ·  ${def(p, levelId)?.name}: ${live.current.l}`)
  })
  void w
  return (
    <circle
      cx={x}
      cy={y}
      r={hover ? 4 : 3}
      fill={hover ? '#fff3dc' : '#f3c99a'}
      stroke="#1a0b09"
      style={{ cursor: 'move' }}
      onPointerDown={down}
      onMouseEnter={() => {
        setHover(true)
        p.hint(`Drag: ← → ${def(p, rateId)?.name} ${live.current.r} · ↑ ↓ ${def(p, levelId)?.name} ${live.current.l}`)
      }}
      onMouseLeave={() => setHover(false)}
    />
  )
}

/**
 * DX-style 4-rate/4-level envelope graph. prefix 'op3' → op3.r1..r4/l1..l4; 'peg' → pitch EG.
 * Horizontal drag on a handle changes the rate of the segment that ends there, vertical drag its level.
 */
export function EnvGraph({ p, prefix, width, height, color, pitch }: { p: P; prefix: string; width: number; height: number; color: string; pitch?: boolean }) {
  const r = [1, 2, 3, 4].map((i) => val(p, `${prefix}.r${i}`))
  const l = [1, 2, 3, 4].map((i) => val(p, `${prefix}.l${i}`))
  const pad = 4
  const H = height - pad * 2
  const sus = Math.max(10, width * 0.14)
  const seg = (width - pad * 2 - sus) / 4
  const t = r.map((x) => 2 + (seg - 2) * Math.pow((99 - x) / 99, 1.6))
  const ly = (lv: number) => (pitch ? pad + H / 2 - (PITCHENV_TAB[Math.round(lv)] / 128) * (H / 2) : pad + H - (lv / 99) * H)
  const xs = [pad, pad + t[0], pad + t[0] + t[1], pad + t[0] + t[1] + t[2]]
  const x3s = xs[3] + sus
  const x4 = x3s + t[3]
  const pts = [
    [xs[0], ly(pitch ? l[3] : l[3])],
    [xs[1], ly(l[0])],
    [xs[2], ly(l[1])],
    [xs[3], ly(l[2])],
    [x3s, ly(l[2])],
    [x4, ly(l[3])]
  ]
  const d = pts.map((q, i) => `${i ? 'L' : 'M'} ${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ')
  const handleX = [xs[1], xs[2], xs[3], x4]
  return (
    <svg width={width} height={height} className="rounded-[2px]" style={{ background: '#1a0d0b', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.7)' }}>
      {pitch && <line x1={0} x2={width} y1={pad + H / 2} y2={pad + H / 2} stroke="#3c2420" />}
      <line x1={xs[3]} x2={xs[3]} y1={0} y2={height} stroke="#3c2420" strokeDasharray="2 2" />
      <line x1={x3s} x2={x3s} y1={0} y2={height} stroke="#3c2420" strokeDasharray="2 2" />
      <path d={`${d} L ${x4} ${pad + H} L ${pad} ${pad + H} Z`} fill={color} opacity={pitch ? 0 : 0.15} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.4} />
      {[0, 1, 2, 3].map((i) => (
        <EnvHandle key={i} p={p} x={handleX[i]} y={ly(l[i])} rateId={`${prefix}.r${i + 1}`} levelId={`${prefix}.l${i + 1}`} w={width} h={H} />
      ))}
    </svg>
  )
}

// ─── Wheels & keyboard ───────────────────────────────────────────────────────

/** Vertical wheel. spring=true snaps back to centre on release (pitch bend). */
export function Wheel({ p, id, spring, label }: { p: P; id: string; spring?: boolean; label: string }) {
  const d = def(p, id)!
  const v = val(p, id)
  const live = useRef(v)
  live.current = v
  const H = 58
  const down = useDragDelta((_dx, dy) => {
    const nv = Math.min(d.max, Math.max(d.min, live.current - (dy / H) * (d.max - d.min)))
    live.current = nv
    p.setParam(id, nv)
    p.hint(`${d.name}: ${nv.toFixed(2)}`)
  })
  const norm = (v - d.min) / (d.max - d.min)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        onPointerDown={down}
        onPointerUp={() => spring && p.setParam(id, 0)}
        onDoubleClick={() => p.setParam(id, d.default)}
        onMouseEnter={() => p.hint(`${d.name}: ${v.toFixed(2)}${spring ? ' (springs back)' : ''}`)}
        className="relative cursor-ns-resize overflow-hidden rounded-[3px]"
        style={{ width: 16, height: H, background: 'linear-gradient(90deg,#140806,#3b2420 50%,#140806)', border: `1px solid ${C.border}` }}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className="absolute left-0 right-0" style={{ top: ((i * 7 + norm * 20) % 62) - 2, height: 1, background: '#5a3a33' }} />
        ))}
        <div className="absolute left-0 right-0" style={{ top: (1 - norm) * (H - 6), height: 6, background: C.global, opacity: 0.85 }} />
      </div>
      <span className="text-[9px] uppercase tracking-wide" style={{ color: C.dim }}>
        {label}
      </span>
    </div>
  )
}

const WHITE = [0, 2, 4, 5, 7, 9, 11]
const BLACK = [1, 3, -1, 6, 8, 10, -1]

export function MiniKeys({ p, low = 48, octaves = 3, width = 232, height = 52 }: { p: P; low?: number; octaves?: number; width?: number; height?: number }) {
  const cur = useRef<number | null>(null)
  const [down, setDown] = useState<number | null>(null)
  const live = useHeldKeys(p)
  const lit = (k: number) => down === k || live.has(k)
  const ww = width / (octaves * 7 + 1)
  const play = (k: number | null) => {
    if (cur.current === k) return
    if (cur.current !== null) p.previewNote?.(cur.current, 0, false)
    cur.current = k
    setDown(k)
    if (k !== null) p.previewNote?.(k, 0.8, true)
  }
  const keyHandlers = (k: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
      play(k)
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.buttons & 1) play(k)
    },
    onMouseEnter: () => p.hint(`Preview note ${k}`)
  })
  const whites: React.ReactNode[] = []
  const blacks: React.ReactNode[] = []
  for (let o = 0; o <= octaves; o++) {
    for (let i = 0; i < 7; i++) {
      if (o === octaves && i > 0) break
      const k = low + o * 12 + WHITE[i]
      const x = (o * 7 + i) * ww
      whites.push(<rect key={`w${k}`} x={x} y={0} width={ww - 1} height={height} rx={1.5} fill={lit(k) ? C.op : '#efe6da'} stroke="#2a1512" {...keyHandlers(k)} />)
      if (o < octaves && BLACK[i] >= 0) {
        const kb = low + o * 12 + BLACK[i]
        blacks.push(<rect key={`b${kb}`} x={x + ww * 0.65} y={0} width={ww * 0.7} height={height * 0.6} rx={1} fill={lit(kb) ? C.op : '#1f1210'} stroke="#000" {...keyHandlers(kb)} />)
      }
    }
  }
  return (
    <svg width={width} height={height} onPointerUp={() => play(null)} onPointerLeave={() => play(null)} style={{ touchAction: 'none' }}>
      {whites}
      {blacks}
    </svg>
  )
}
