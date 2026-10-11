// Time ruler: bar numbers, time selection (loop), markers row, song position marker.
import { useEffect, useRef } from 'react'
import { useProject, getProject, editProject } from '@/store/project'
import { useTransport, playhead } from '@/store/transport'
import { useUI } from '@/store/ui'
import { barTicks, beatTicks } from '@/audio/sequence'
import { transport } from '@/audio/transport'
import { formatPos, snapRound, snapTicks, tickToX, xToTick, zoomAround, type View } from './geometry'
import { drawRuler, drawRulerHead, RULER_BARS_H, RULER_H } from './render'
import { effectiveSnap, getPl, usePlaylist } from './state'
import { openMenu } from './PopupMenu'
import { askText } from './Prompt'

type Drag =
  | { kind: 'sel'; x0: number; t0: number; moved: boolean }
  | { kind: 'pos'; x0: number; moved: boolean }
  | { kind: 'marker'; id: string; dx: number; moved: boolean }

export function setTimeSelection(sel: { start: number; end: number } | null): void {
  getPl().set({ timeSel: sel })
  useTransport.getState().set({ loop: sel })
}

export function Ruler() {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = useRef(0)
  const drag = useRef<Drag | null>(null)
  const raf = useRef(0)

  const view = (): View => {
    const s = getPl()
    return { scrollTick: s.scrollTick, ppt: s.ppt, scrollY: s.scrollY, vZoom: s.vZoom }
  }

  const paint = () => {
    raf.current = 0
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const p = getProject()
    const t = useTransport.getState()
    const v = view()
    drawRuler({ ctx, w: w.current, view: v, project: p, bar: barTicks(p), timeSel: getPl().timeSel, loop: t.loop, startTick: t.startTick, songMode: t.mode === 'song' })
    if (t.mode === 'song') drawRulerHead(ctx, w.current, v, playhead.tick, '#7dff3c')
    else drawRulerHead(ctx, w.current, v, t.startTick, 'rgba(197,205,209,0.35)')
  }
  const request = () => {
    if (!raf.current) raf.current = requestAnimationFrame(paint)
  }

  useEffect(() => {
    const cv = ref.current!
    const fit = () => {
      const r = cv.parentElement!.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      w.current = r.width
      cv.width = Math.max(1, Math.round(r.width * dpr))
      cv.height = Math.round(RULER_H * dpr)
      cv.style.width = `${r.width}px`
      cv.style.height = `${RULER_H}px`
      paint()
    }
    const ro = new ResizeObserver(fit)
    ro.observe(cv.parentElement!)
    fit()
    const uns = [useProject.subscribe(request), usePlaylist.subscribe(request), useTransport.subscribe(request), playhead.subscribe(request)]
    const onWheel = (e: WheelEvent) => {
      // wheel over the ruler zooms (FL)
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      const dy = e.deltaY || e.deltaX
      if (e.shiftKey) getPl().set({ scrollTick: Math.max(0, getPl().scrollTick + dy / getPl().ppt) })
      else getPl().set(zoomAround(view(), e.clientX - r.left, dy < 0 ? 1.18 : 1 / 1.18))
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      uns.forEach((u) => u())
      cv.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(raf.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    return { x, y, tick: Math.max(0, xToTick(view(), x)) }
  }
  const grid = (alt: boolean) => (alt ? 1 : snapTicks(effectiveSnap(), getPl().ppt, barTicks(getProject()), beatTicks(getProject())))
  const markerAt = (x: number) => {
    const v = view()
    const ms = getProject().markers
    for (let i = ms.length - 1; i >= 0; i--) {
      const mx = tickToX(v, ms[i].pos)
      if (x >= mx - 3 && x <= mx + 8) return ms[i]
    }
    return null
  }

  const seek = (tick: number) => {
    if (useTransport.getState().mode !== 'song') transport.setMode('song')
    transport.seek(tick)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y, tick } = pos(e)
    const inMarkers = y >= RULER_BARS_H
    const m = inMarkers ? markerAt(x) : null
    if (e.button === 2) {
      if (m) {
        openMenu(
          e,
          [
            { label: 'Rename...', onSelect: () => void askText('Marker name', m.name, e).then((v) => v && editProject('Rename marker', (d) => void (d.markers.find((q) => q.id === m.id)!.name = v))) },
            { label: 'Jump to', onSelect: () => seek(m.pos) },
            { label: 'Delete', onSelect: () => editProject('Delete marker', (d) => void (d.markers = d.markers.filter((q) => q.id !== m.id))) }
          ],
          m.name
        )
        return
      }
      setTimeSelection(null)
      return
    }
    if (e.button !== 0) return
    ref.current!.setPointerCapture(e.pointerId)
    if (m) {
      drag.current = { kind: 'marker', id: m.id, dx: tick - m.pos, moved: false }
      return
    }
    // Ctrl+drag: time selection (Ctrl+click without dragging clears it). Plain click/drag: song position.
    drag.current = e.ctrlKey || e.metaKey ? { kind: 'sel', x0: x, t0: tick, moved: false } : { kind: 'pos', x0: x, moved: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const { x, y, tick } = pos(e)
    const p = getProject()
    if (!d) {
      const m = y >= RULER_BARS_H ? markerAt(x) : null
      useUI.getState().setHint(m ? `Marker: ${m.name} (drag to move, right-click for menu, double-click to rename)` : `Timeline ${formatPos(tick, barTicks(p))} — click / drag: set song position, Ctrl+drag: time selection, Ctrl+click / right-click: clear it`)
      return
    }
    const g = grid(e.altKey)
    if (d.kind === 'sel') {
      if (!d.moved && Math.abs(x - d.x0) < 4) return
      d.moved = true
      const a = snapRound(d.t0, g)
      const b = snapRound(tick, g)
      if (a !== b) setTimeSelection({ start: Math.min(a, b), end: Math.max(a, b) })
      useUI.getState().setHint(`Time selection ${formatPos(Math.min(a, b), barTicks(p))} – ${formatPos(Math.max(a, b), barTicks(p))}`)
    } else if (d.kind === 'pos') {
      if (!d.moved && Math.abs(x - d.x0) < 4) return
      d.moved = true
      seek(snapRound(tick, g))
    } else {
      d.moved = true
      const np = Math.max(0, snapRound(tick - d.dx, g))
      editProject('Move marker', (dr) => {
        const m = dr.markers.find((q) => q.id === d.id)
        if (m) m.pos = np
        dr.markers.sort((a, b) => a.pos - b.pos)
      }, { coalesceKey: `marker:${d.id}` })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'sel' && !d.moved) setTimeSelection(null)
    if (d.kind === 'pos' && !d.moved) seek(snapRound(pos(e).tick, grid(e.altKey)))
    if (d.kind === 'marker' && !d.moved) {
      const m = getProject().markers.find((q) => q.id === d.id)
      if (m) seek(m.pos)
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    // (time selections are made with Ctrl+drag only, never by double-clicking)
    const { x, y } = pos(e)
    if (y < RULER_BARS_H) return
    const m = markerAt(x)
    if (m) void askText('Marker name', m.name, e).then((v) => v && editProject('Rename marker', (d) => void (d.markers.find((q) => q.id === m.id)!.name = v)))
  }

  return (
    <div className="relative w-full" style={{ height: RULER_H }}>
      <canvas
        ref={ref}
        className="absolute inset-0 cursor-pointer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}
