// Top-down drawing of the kit (drummer's view). Every drum / cymbal is clickable and plays its key;
// rims, bells and hat edges play their articulation. A separate layout is drawn for the Latin kit.
import { useState } from 'react'
import type { KitMeta } from './types'

interface Piece {
  /** main key, and the key played near the edge (rim / open hat) or on the bell */
  key: number
  edgeKey?: number
  bellKey?: number
  x: number
  y: number
  r: number
  kind: 'drum' | 'cym' | 'hat' | 'kick' | 'bell' | 'block' | 'shaker'
  label: string
}

const DRUMSET: Piece[] = [
  { key: 36, x: 160, y: 182, r: 44, kind: 'kick', label: 'Kick' },
  { key: 44, x: 40, y: 222, r: 11, kind: 'block', label: 'Pedal' },
  { key: 38, edgeKey: 37, x: 98, y: 168, r: 27, kind: 'drum', label: 'Snare' },
  { key: 48, edgeKey: 50, x: 128, y: 112, r: 21, kind: 'drum', label: 'Tom 1' },
  { key: 45, edgeKey: 47, x: 190, y: 108, r: 22, kind: 'drum', label: 'Tom 2' },
  { key: 43, x: 238, y: 168, r: 28, kind: 'drum', label: 'Floor 1' },
  { key: 41, x: 284, y: 204, r: 25, kind: 'drum', label: 'Floor 2' },
  { key: 42, edgeKey: 46, x: 42, y: 146, r: 26, kind: 'hat', label: 'Hi-Hat' },
  { key: 49, edgeKey: 29, x: 70, y: 66, r: 36, kind: 'cym', label: 'Crash 1' },
  { key: 55, x: 160, y: 50, r: 17, kind: 'cym', label: 'Splash' },
  { key: 57, edgeKey: 30, x: 236, y: 46, r: 35, kind: 'cym', label: 'Crash 2' },
  { key: 51, edgeKey: 59, bellKey: 53, x: 290, y: 118, r: 40, kind: 'cym', label: 'Ride' },
  { key: 52, x: 306, y: 36, r: 24, kind: 'cym', label: 'China' }
]

const LATIN: Piece[] = [
  { key: 85, x: 44, y: 160, r: 25, kind: 'drum', label: 'Quinto' },
  { key: 63, edgeKey: 62, x: 100, y: 176, r: 28, kind: 'drum', label: 'Conga' },
  { key: 64, x: 160, y: 190, r: 31, kind: 'drum', label: 'Tumba' },
  { key: 60, edgeKey: 90, x: 222, y: 186, r: 18, kind: 'drum', label: 'Bongo H' },
  { key: 61, x: 262, y: 192, r: 22, kind: 'drum', label: 'Bongo L' },
  { key: 65, edgeKey: 84, x: 110, y: 96, r: 25, kind: 'drum', label: 'Timbal H' },
  { key: 66, edgeKey: 84, x: 172, y: 92, r: 28, kind: 'drum', label: 'Timbal L' },
  { key: 56, x: 140, y: 40, r: 15, kind: 'bell', label: 'Cowbell' },
  { key: 89, x: 186, y: 36, r: 13, kind: 'bell', label: 'Cha-cha' },
  { key: 67, edgeKey: 68, x: 240, y: 40, r: 14, kind: 'bell', label: 'Agogo' },
  { key: 75, x: 300, y: 84, r: 13, kind: 'block', label: 'Claves' },
  { key: 74, edgeKey: 73, x: 252, y: 108, r: 16, kind: 'shaker', label: 'Güiro' },
  { key: 82, x: 300, y: 140, r: 13, kind: 'shaker', label: 'Shaker' },
  { key: 70, x: 56, y: 96, r: 12, kind: 'shaker', label: 'Maracas' },
  { key: 54, x: 54, y: 40, r: 18, kind: 'cym', label: 'Tamb.' },
  { key: 87, edgeKey: 88, x: 302, y: 216, r: 18, kind: 'block', label: 'Cajon' },
  { key: 81, edgeKey: 80, x: 92, y: 40, r: 12, kind: 'bell', label: 'Triangle' }
]

export function KitView({ kit, onPlay, onHint }: { kit: KitMeta | undefined; onPlay: (key: number, vel: number, on: boolean) => void; onHint: (t: string) => void }) {
  const [down, setDown] = useState<number | null>(null)
  const layout = kit?.id === 'latin' ? LATIN : DRUMSET
  const has = (k?: number) => k !== undefined && !!kit?.keys[k]
  const nameOf = (k: number) => kit?.keys[k]?.name ?? `Key ${k}`

  const hitKey = (pc: Piece, e: React.PointerEvent<SVGGElement>): number => {
    const svg = (e.currentTarget.ownerSVGElement ?? e.currentTarget) as SVGSVGElement
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    const p = m ? pt.matrixTransform(m.inverse()) : pt
    const d = Math.hypot(p.x - pc.x, p.y - pc.y) / pc.r
    if (pc.bellKey !== undefined && d < 0.25 && has(pc.bellKey)) return pc.bellKey
    if (pc.edgeKey !== undefined && d > 0.75 && has(pc.edgeKey)) return pc.edgeKey
    if (pc.key === 42 && e.shiftKey && has(44)) return 44
    return pc.key
  }

  const order = [...layout].sort((a, b) => (a.kind === 'cym' ? 1 : 0) - (b.kind === 'cym' ? 1 : 0))
  return (
    <svg viewBox="0 0 340 250" className="h-full w-full select-none" onPointerUp={() => down !== null && (onPlay(down, 0, false), setDown(null))} onPointerLeave={() => down !== null && (onPlay(down, 0, false), setDown(null))}>
      <defs>
        <radialGradient id="sd-head" cx="45%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#f4efe4" />
          <stop offset="100%" stopColor="#c9c1b0" />
        </radialGradient>
        <radialGradient id="sd-kick" cx="45%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#3b4348" />
          <stop offset="100%" stopColor="#1d2225" />
        </radialGradient>
        <radialGradient id="sd-cym" cx="45%" cy="40%" r="75%">
          <stop offset="0%" stopColor="#f2cf7a" />
          <stop offset="60%" stopColor="#c99a3e" />
          <stop offset="100%" stopColor="#8a6524" />
        </radialGradient>
        <radialGradient id="sd-wood" cx="45%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#d8a46a" />
          <stop offset="100%" stopColor="#8c5a2b" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="340" height="250" rx="4" fill="#20272a" />
      {order.map((pc) => {
        const enabled = has(pc.key)
        const active = down !== null && (down === pc.key || down === pc.edgeKey || down === pc.bellKey || (pc.key === 42 && down === 44))
        const fill = pc.kind === 'cym' || pc.kind === 'hat' ? 'url(#sd-cym)' : pc.kind === 'kick' ? 'url(#sd-kick)' : pc.kind === 'bell' ? '#9aa3a8' : pc.kind === 'block' || pc.kind === 'shaker' ? 'url(#sd-wood)' : 'url(#sd-head)'
        return (
          <g
            key={pc.label}
            opacity={enabled ? (pc.kind === 'cym' ? 0.92 : 1) : 0.25}
            style={{ cursor: enabled ? 'pointer' : 'default' }}
            onPointerDown={(e) => {
              if (!enabled) return
              e.preventDefault()
              const k = hitKey(pc, e)
              setDown(k)
              onPlay(k, e.altKey ? 0.4 : 0.85, true)
              onHint(nameOf(k))
            }}
            onPointerMove={(e) => enabled && onHint(`${nameOf(hitKey(pc, e))}${pc.edgeKey !== undefined && has(pc.edgeKey) ? ` · edge: ${nameOf(pc.edgeKey)}` : ''}${pc.bellKey !== undefined ? ` · bell: ${nameOf(pc.bellKey)}` : ''}`)}
          >
            {pc.kind === 'kick' && <circle cx={pc.x} cy={pc.y} r={pc.r + 4} fill="#5e1f1f" stroke="#2a0f0f" strokeWidth={2} />}
            {pc.kind === 'drum' && <circle cx={pc.x} cy={pc.y} r={pc.r + 3} fill="#7a2626" stroke="#2a1010" strokeWidth={1.5} />}
            <circle cx={pc.x} cy={pc.y} r={pc.r} fill={fill} stroke={active ? 'var(--fl-orange)' : '#151a1c'} strokeWidth={active ? 3 : 1.2} />
            {pc.kind === 'drum' && <circle cx={pc.x} cy={pc.y} r={pc.r * 0.75} fill="none" stroke="#00000022" strokeWidth={1} />}
            {(pc.kind === 'cym' || pc.kind === 'hat') && (
              <>
                <circle cx={pc.x} cy={pc.y} r={pc.r * 0.66} fill="none" stroke="#7a5a2066" strokeWidth={1} />
                <circle cx={pc.x} cy={pc.y} r={pc.r * 0.33} fill="none" stroke="#7a5a2066" strokeWidth={1} />
                <circle cx={pc.x} cy={pc.y} r={Math.max(3, pc.r * 0.22)} fill="#dcb767" stroke="#6b4f1c" strokeWidth={0.8} />
              </>
            )}
            {active && <circle cx={pc.x} cy={pc.y} r={pc.r + 6} fill="none" stroke="var(--fl-orange)" strokeOpacity={0.5} strokeWidth={4} />}
            <text x={pc.x} y={pc.y + pc.r + 10} textAnchor="middle" fontSize="8.5" fill="#aeb8bd" style={{ pointerEvents: 'none' }}>
              {pc.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
