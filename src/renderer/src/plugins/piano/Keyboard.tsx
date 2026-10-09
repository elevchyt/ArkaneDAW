// 88-key on-screen keyboard (A0–C8): an overview strip with the visible window, and a playable
// zoomed keyboard. Wheel / ←→ scroll, click the overview to jump. Velocity follows where the key is
// struck (near the fallboard = soft, near the front edge = loud). Plays through p.previewNote.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginEditorProps } from '../sdk/module'
import { T } from './theme'

const LOW = 21
const HIGH = 108
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(k % 12)
export const noteName = (k: number) => `${NAMES[k % 12]}${Math.floor(k / 12) - 1}`

/** MIDI keys of the white keys, low to high (52 on an 88-key piano). */
const WHITES: number[] = []
for (let k = LOW; k <= HIGH; k++) if (!isBlack(k)) WHITES.push(k)
const WHITE_INDEX = new Map(WHITES.map((k, i) => [k, i]))

export interface SoundingKeys {
  held: number[]
  sus: number[]
}

export function Keyboard({ p, width, height, sounding, span = 36 }: { p: PluginEditorProps; width: number; height: number; sounding: SoundingKeys; span?: number }) {
  const MAP_H = 14
  const GAP = 4
  const keysH = height - MAP_H - GAP
  const maxStart = WHITES.length - span
  // start so that middle C sits in view
  const [start, setStart] = useState(() => Math.max(0, Math.min(maxStart, (WHITE_INDEX.get(48) ?? 0) - 2)))
  const [down, setDown] = useState<number | null>(null)
  const cur = useRef<number | null>(null)
  const ww = width / span
  const bw = ww * 0.62
  const bh = keysH * 0.62

  const scroll = useCallback((d: number) => setStart((s) => Math.max(0, Math.min(maxStart, s + d))), [maxStart])

  const play = useCallback(
    (k: number | null, vel = 0.8) => {
      if (cur.current === k) return
      if (cur.current !== null) p.previewNote?.(cur.current, 0, false)
      cur.current = k
      setDown(k)
      if (k !== null) p.previewNote?.(k, vel, true)
    },
    [p]
  )
  useEffect(() => () => {
    if (cur.current !== null) p.previewNote?.(cur.current, 0, false)
  }, [p])

  /** Hit-test the zoomed keyboard (black keys on top). Returns key + velocity. */
  const hit = (x: number, y: number): { key: number; vel: number } | null => {
    if (x < 0 || x >= width || y < 0 || y >= keysH) return null
    const wi = start + Math.floor(x / ww)
    const white = WHITES[Math.min(WHITES.length - 1, wi)]
    if (y < bh) {
      const fx = x / ww - Math.floor(x / ww)
      const cand = fx > 0.69 ? white + 1 : fx < 0.31 ? white - 1 : -1
      if (cand >= LOW && cand <= HIGH && isBlack(cand)) return { key: cand, vel: velAt(y, bh) }
    }
    return { key: white, vel: velAt(y, keysH) }
  }
  const velAt = (y: number, h: number) => Math.max(0.08, Math.min(1, 0.12 + 0.88 * (y / h)))

  const local = (e: React.PointerEvent) => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const sus = useMemo(() => new Set(sounding.sus), [sounding.sus])
  const held = useMemo(() => new Set(sounding.held), [sounding.held])
  const fill = (k: number, black: boolean) => {
    if (k === down) return T.gold
    if (held.has(k)) return black ? '#a98a4c' : '#ead29a'
    if (sus.has(k)) return black ? '#6d5a35' : '#d9c8a0'
    return black ? 'url(#pk-black)' : 'url(#pk-white)'
  }

  const visW = WHITES.slice(start, start + span)
  const whites = visW.map((k, i) => (
    <g key={k}>
      <rect x={i * ww + 0.5} y={0} width={ww - 1} height={keysH} rx={2.5} fill={fill(k, false)} stroke="#2a221b" />
      {k % 12 === 0 && (
        <text x={i * ww + ww / 2} y={keysH - 6} textAnchor="middle" fontSize={8.5} fill={k === down ? '#2b1d0c' : '#8a7a62'} style={{ pointerEvents: 'none' }}>
          {noteName(k)}
        </text>
      )}
    </g>
  ))
  const blacks: React.ReactNode[] = []
  visW.forEach((k, i) => {
    const b = k + 1
    if (b <= HIGH && isBlack(b)) {
      blacks.push(<rect key={b} x={(i + 1) * ww - bw / 2} y={0} width={bw} height={bh} rx={1.5} fill={fill(b, true)} stroke="#000" />)
    }
  })
  // left-edge black key of the first visible white (e.g. view starts on D → C# peeks in)
  if (visW.length && isBlack(visW[0] - 1) && visW[0] - 1 >= LOW) blacks.push(<rect key={visW[0] - 1} x={-bw / 2} y={0} width={bw} height={bh} rx={1.5} fill={fill(visW[0] - 1, true)} stroke="#000" />)

  // overview strip
  const mw = width / WHITES.length
  const mapWhites = WHITES.map((k, i) => <rect key={k} x={i * mw} y={0} width={mw - 0.4} height={MAP_H} fill={held.has(k) || k === down ? T.gold : sus.has(k) ? '#bfa36a' : '#d8cfbf'} />)
  const mapBlacks: React.ReactNode[] = []
  WHITES.forEach((k, i) => {
    const b = k + 1
    if (b <= HIGH && isBlack(b)) mapBlacks.push(<rect key={b} x={(i + 1) * mw - mw * 0.32} y={0} width={mw * 0.64} height={MAP_H * 0.6} fill={held.has(b) || b === down ? T.gold : sus.has(b) ? '#8a7448' : '#1b1612'} />)
  })
  const mapDrag = useRef(false)
  const jump = (x: number) => setStart(Math.max(0, Math.min(maxStart, Math.round(x / mw - span / 2))))

  return (
    <div
      tabIndex={0}
      className="outline-none"
      style={{ width, height }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') scroll(e.shiftKey ? -1 : -7)
        else if (e.key === 'ArrowRight') scroll(e.shiftKey ? 1 : 7)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
      onWheel={(e) => scroll((Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) > 0 ? 2 : -2)}
    >
      <svg
        width={width}
        height={MAP_H}
        style={{ display: 'block', cursor: 'pointer', touchAction: 'none' }}
        onPointerDown={(e) => {
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          mapDrag.current = true
          jump(local(e).x)
        }}
        onPointerMove={(e) => mapDrag.current && jump(local(e).x)}
        onPointerUp={() => (mapDrag.current = false)}
        onMouseEnter={() => p.hint('Keyboard overview (A0–C8): click or drag to move the playable range · wheel / ← → scroll')}
      >
        {mapWhites}
        {mapBlacks}
        <rect x={start * mw} y={0.5} width={span * mw} height={MAP_H - 1} fill="rgba(216,180,106,.18)" stroke={T.gold} strokeWidth={1.2} rx={1.5} />
      </svg>
      <div style={{ height: GAP }} />
      <svg
        width={width}
        height={keysH}
        style={{ display: 'block', touchAction: 'none', cursor: 'pointer' }}
        onPointerDown={(e) => {
          e.preventDefault()
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
          ;(e.currentTarget.parentElement as HTMLElement | null)?.focus()
          const { x, y } = local(e)
          const h = hit(x, y)
          if (h) play(h.key, h.vel)
        }}
        onPointerMove={(e) => {
          const { x, y } = local(e)
          const h = hit(x, y)
          if (h) p.hint(`${noteName(h.key)} (key ${h.key}) · velocity ${Math.round(h.vel * 127)} — strike lower on a key for louder`)
          if (e.buttons & 1 && cur.current !== null) play(h ? h.key : null, h?.vel ?? 0.8)
        }}
        onPointerUp={() => play(null)}
        onPointerCancel={() => play(null)}
        onLostPointerCapture={() => play(null)}
      >
        <defs>
          <linearGradient id="pk-white" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e9e1d3" />
            <stop offset="0.85" stopColor="#f8f3ea" />
            <stop offset="1" stopColor="#d9cfbf" />
          </linearGradient>
          <linearGradient id="pk-black" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0c0a09" />
            <stop offset="0.8" stopColor="#2a2420" />
            <stop offset="1" stopColor="#141110" />
          </linearGradient>
        </defs>
        {whites}
        {blacks}
        <rect x={0} y={0} width={width} height={3} fill="rgba(0,0,0,.45)" style={{ pointerEvents: 'none' }} />
      </svg>
    </div>
  )
}
