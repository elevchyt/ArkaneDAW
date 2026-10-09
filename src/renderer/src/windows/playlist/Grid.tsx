// The clip area: canvas rendering + FL tool interactions.
import { useEffect, useRef } from 'react'
import { useProject, getProject } from '@/store/project'
import { useUI, type Tool } from '@/store/ui'
import { useTransport, playhead } from '@/store/transport'
import { PLAYLIST_TRACKS, type AutomationPoint, type Clip } from '@/store/types'
import { barTicks } from '@/audio/sequence'
import { transport } from '@/audio/transport'
import { uid } from '@/store/factory'
import {
  clipsInRect,
  clipAt,
  formatPos,
  headerHeight,
  hitZone,
  snapFloor,
  snapRound,
  snapTicks,
  tickToX,
  trackAtY,
  xToTick,
  zoomAround,
  type View,
  type Zone
} from './geometry'
import { clampMove, cloneShifted, moveClips, paintRepeat, resizeRight, sliceAt, slipClip, trimLeft } from './ops'
import { addPoint, hitHandle, hitPoint, movePoint, removePoint, segmentAt, setTension, tensionFromDrag } from './automation'
import { autoMapper, drawGrid, clipLabel } from './render'
import { effectiveSnap, getPl, mouse, setSelection, usePlaylist, viewport } from './state'
import {
  clipMaxLen,
  clipWrap,
  commitClips,
  currentSource,
  deleteClips,
  makeClip,
  selectSource,
  setAutomationPoints,
  sourceLength
} from './actions'
import { openClipMenu } from './menus'
import { openPatternEditor } from './open'
import { handleGridDrop } from './drop'

type Drag =
  | { kind: 'move'; before: Clip[]; moving: Clip[]; add: boolean; anchor: Clip; downTick: number; downTrack: number; label: string; preview: Clip[] }
  | { kind: 'resize'; side: 'left' | 'right'; before: Clip[]; ids: Set<string>; anchor: Clip; downTick: number; preview: Clip[] }
  | { kind: 'slip'; before: Clip[]; ids: Set<string>; downTick: number; preview: Clip[] }
  | { kind: 'delete'; before: Clip[]; removed: Set<string>; preview: Clip[] }
  | { kind: 'mute'; before: Clip[]; touched: Set<string>; to: boolean; preview: Clip[] }
  | { kind: 'paint'; before: Clip[]; proto: Clip; added: Clip[]; preview: Clip[] }
  | { kind: 'rubber'; x0: number; y0: number; x1: number; y1: number; base: Set<string> }
  | { kind: 'slice'; x: number; y0: number; y1: number }
  | { kind: 'zoomRect'; x0: number; x1: number; moved: boolean }
  | { kind: 'pan'; sx: number; sy: number; scrollTick: number; scrollY: number }
  | { kind: 'auto'; clip: Clip; autoId: string; before: AutomationPoint[]; points: AutomationPoint[]; index: number; mode: 'point' | 'tension'; orig: number; downY: number; bh: number; by: number }
  | { kind: 'scrub' }

interface Hit {
  clip: Clip
  zone: Zone
  x: number // clip rect, local px
  y: number
  w: number
  h: number
  th: number
}

const TOOL_CURSOR: Partial<Record<Tool, string>> = {
  delete: 'not-allowed',
  slice: 'crosshair',
  zoom: 'zoom-in',
  select: 'crosshair',
  play: 'pointer',
  slip: 'col-resize',
  mute: 'pointer'
}

export function Grid({ offsets }: { offsets: Float64Array }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const offsetsRef = useRef(offsets)
  offsetsRef.current = offsets
  const drag = useRef<Drag | null>(null)
  const raf = useRef(0)
  const size = useRef({ w: 0, h: 0 })

  const view = (): View => {
    const s = getPl()
    return { scrollTick: s.scrollTick, ppt: s.ppt, scrollY: s.scrollY, vZoom: s.vZoom }
  }

  // ── painting ────────────────────────────────────────────────────────────────
  const paint = () => {
    raf.current = 0
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const p = getProject()
    const d = drag.current
    const pl = getPl()
    drawGrid({
      ctx,
      w: size.current.w,
      h: size.current.h,
      view: view(),
      offsets: offsetsRef.current,
      project: p,
      clips: d && 'preview' in d ? d.preview : p.playlist.clips,
      selected: pl.selected,
      bar: barTicks(p),
      timeSel: pl.timeSel,
      autoOverride: d?.kind === 'auto' ? { id: d.autoId, points: d.points } : null,
      rubber: d?.kind === 'rubber' ? d : d?.kind === 'zoomRect' && d.moved ? { x0: d.x0, x1: d.x1, y0: 0, y1: size.current.h } : null,
      sliceLine: d?.kind === 'slice' ? d : null,
      onAsset: requestPaint
    })
  }
  const requestPaint = () => {
    if (!raf.current) raf.current = requestAnimationFrame(paint)
  }

  const paintOverlay = (tick: number) => {
    const cv = overlayRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const { w, h } = size.current
    ctx.clearRect(0, 0, w, h)
    const t = useTransport.getState()
    if (t.mode !== 'song') return
    const v = view()
    let x = tickToX(v, tick)
    if (t.playing && (x > w - 4 || x < 0)) {
      // FL page-follows the playhead
      getPl().set({ scrollTick: Math.max(0, tick - 8 / v.ppt) })
      x = 8
    }
    if (x < -2 || x > w + 2) return
    ctx.fillStyle = 'rgba(125,255,60,0.18)'
    ctx.fillRect(Math.round(x) - 2, 0, 5, h)
    ctx.fillStyle = '#7dff3c'
    ctx.fillRect(Math.round(x), 0, 1, h)
  }

  useEffect(() => {
    const wrap = wrapRef.current!
    const fit = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      size.current = { w: r.width, h: r.height }
      viewport.w = r.width
      viewport.h = r.height
      for (const cv of [canvasRef.current, overlayRef.current]) {
        if (!cv) continue
        cv.width = Math.max(1, Math.round(r.width * dpr))
        cv.height = Math.max(1, Math.round(r.height * dpr))
        cv.style.width = `${r.width}px`
        cv.style.height = `${r.height}px`
      }
      paint()
      paintOverlay(playhead.tick)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    fit()
    const un1 = useProject.subscribe(requestPaint)
    const un2 = usePlaylist.subscribe(() => {
      requestPaint()
      paintOverlay(playhead.tick)
    })
    const un3 = playhead.subscribe(paintOverlay)
    const un4 = useTransport.subscribe(() => paintOverlay(playhead.tick))
    const un5 = useUI.subscribe((s, prev) => {
      if (s.globalSnap !== prev.globalSnap) requestPaint()
    })
    return () => {
      ro.disconnect()
      un1()
      un2()
      un3()
      un4()
      un5()
      cancelAnimationFrame(raf.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(requestPaint, [offsets])

  // ── wheel ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = wrap.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const pl = getPl()
      const v = view()
      const dy = e.deltaY || e.deltaX
      if (e.ctrlKey || e.metaKey) {
        pl.set(zoomAround(v, x, dy < 0 ? 1.18 : 1 / 1.18))
      } else if (e.altKey) {
        const nz = Math.min(4, Math.max(0.3, v.vZoom * (dy < 0 ? 1.12 : 1 / 1.12)))
        const contentY = y + v.scrollY
        pl.set({ vZoom: nz, scrollY: Math.max(0, contentY * (nz / v.vZoom) - y) })
      } else if (e.shiftKey) {
        pl.set({ scrollTick: Math.max(0, v.scrollTick + dy / v.ppt) })
      } else {
        const total = offsetsRef.current[offsetsRef.current.length - 1]
        pl.set({
          scrollY: Math.max(0, Math.min(total - size.current.h + 20, v.scrollY + e.deltaY)),
          scrollTick: Math.max(0, v.scrollTick + e.deltaX / v.ppt)
        })
      }
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])

  // ── hit testing ─────────────────────────────────────────────────────────────
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const v = view()
    const off = offsetsRef.current
    const track = trackAtY(off, y + v.scrollY)
    return { x, y, tick: xToTick(v, x), track, v }
  }

  const hitAt = (x: number, y: number, clips: readonly Clip[]): Hit | null => {
    const v = view()
    const off = offsetsRef.current
    const cy = y + v.scrollY
    if (cy < 0 || cy >= off[off.length - 1]) return null
    const track = trackAtY(off, cy)
    const clip = clipAt(clips, xToTick(v, x), track)
    if (!clip) return null
    const cx = tickToX(v, clip.start)
    const top = off[track] - v.scrollY + 1
    const th = off[track + 1] - off[track]
    const w = clip.length * v.ppt
    return { clip, zone: hitZone(x - cx, y - top, w, th - 2), x: cx, y: top, w, h: th - 2, th }
  }

  const gridSize = (alt: boolean): number => (alt ? 1 : snapTicks(effectiveSnap(), getPl().ppt, barTicks(getProject())))

  // ── pointer handlers ────────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    const cv = canvasRef.current!
    const { x, y, tick, track, v } = local(e)
    const p = getProject()
    const clips = p.playlist.clips
    const ui = useUI.getState()
    const tool = ui.playlistTool
    const grid = gridSize(e.altKey)
    const hit = hitAt(x, y, clips)
    const pl = getPl()
    const start = (d: Drag) => {
      drag.current = d
      cv.setPointerCapture(e.pointerId)
      requestPaint()
    }

    if (e.button === 1) {
      e.preventDefault()
      return start({ kind: 'pan', sx: e.clientX, sy: e.clientY, scrollTick: v.scrollTick, scrollY: v.scrollY })
    }
    // clip menu: top-left arrow of the header
    if (e.button === 0 && hit && hit.zone === 'header' && x - Math.max(hit.x, 0) < 12 && hit.w > 14) {
      openClipMenu(e, hit.clip)
      return
    }
    // Ctrl+drag = select from any tool
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      const base = e.shiftKey ? new Set(pl.selected) : new Set<string>()
      if (!e.shiftKey) setSelection([])
      return start({ kind: 'rubber', x0: x, y0: y, x1: x, y1: y, base })
    }

    if (e.button === 2) {
      if (tool === 'zoom') {
        pl.set(zoomAround(v, x, 1 / 2))
        return
      }
      if (hit && hit.clip.kind === 'automation' && hit.zone === 'body' && hit.th >= 40) {
        const a = p.automations.find((q) => q.id === hit.clip.ref)
        if (a) {
          const hh = headerHeight(hit.th)
          const m = autoMapper(v, hit.clip, hit.y + hh, hit.h - hh)
          const i = hitPoint(a.points, m, x, y)
          if (i >= 0) {
            setAutomationPoints(a.id, removePoint(a.points, i), 'Delete automation point')
            return
          }
        }
      }
      // right-click / right-drag = delete
      const removed = new Set<string>()
      if (hit) removed.add(hit.clip.id)
      return start({ kind: 'delete', before: clips, removed, preview: clips.filter((c) => !removed.has(c.id)) })
    }
    if (e.button !== 0) return

    switch (tool) {
      case 'zoom':
        return start({ kind: 'zoomRect', x0: x, x1: x, moved: false })
      case 'play':
        if (useTransport.getState().mode !== 'song') transport.setMode('song')
        transport.seek(Math.max(0, tick))
        void transport.play()
        return start({ kind: 'scrub' })
      case 'slice':
        return start({ kind: 'slice', x: tickToX(v, snapRound(tick, grid)), y0: y, y1: y })
      case 'delete': {
        const removed = new Set<string>()
        if (hit) removed.add(hit.clip.id)
        return start({ kind: 'delete', before: clips, removed, preview: clips.filter((c) => !removed.has(c.id)) })
      }
      case 'mute': {
        if (!hit) return
        const to = !hit.clip.muted
        const touched = new Set([hit.clip.id])
        return start({ kind: 'mute', before: clips, touched, to, preview: clips.map((c) => (touched.has(c.id) ? { ...c, muted: to } : c)) })
      }
      case 'slip': {
        if (!hit) return
        const ids = pl.selected.has(hit.clip.id) ? new Set(pl.selected) : new Set([hit.clip.id])
        return start({ kind: 'slip', before: clips, ids, downTick: tick, preview: clips })
      }
      case 'select': {
        if (hit) {
          let sel = new Set(pl.selected)
          if (e.shiftKey) {
            if (sel.has(hit.clip.id)) sel.delete(hit.clip.id)
            else sel.add(hit.clip.id)
          } else if (!sel.has(hit.clip.id)) sel = new Set([hit.clip.id])
          setSelection(sel)
          if (!sel.has(hit.clip.id)) return
          if (hit.zone === 'left' || hit.zone === 'right') return start(resizeDrag(hit, clips, sel, tick))
          return start(moveDrag(hit.clip, clips, sel, tick, track, false))
        }
        const base = e.shiftKey ? new Set(pl.selected) : new Set<string>()
        if (!e.shiftKey) setSelection([])
        return start({ kind: 'rubber', x0: x, y0: y, x1: x, y1: y, base })
      }
      default: {
        // draw / paint
        if (hit) {
          // automation editing inside the clip body
          if (hit.clip.kind === 'automation' && hit.zone === 'body' && hit.th >= 40) {
            const d = autoDrag(hit, x, y, e.altKey, grid)
            if (d) return start(d)
          }
          if (hit.zone === 'left' || hit.zone === 'right') {
            const ids = pl.selected.has(hit.clip.id) ? new Set(pl.selected) : new Set([hit.clip.id])
            return start(resizeDrag(hit, clips, ids, tick))
          }
          // clicking a clip makes its source the current one (FL)
          selectSource({ kind: hit.clip.kind, ref: hit.clip.ref })
          const ids = pl.selected.has(hit.clip.id) ? new Set(pl.selected) : new Set([hit.clip.id])
          return start(moveDrag(hit.clip, clips, ids, tick, track, e.shiftKey))
        }
        if (pl.selected.size) setSelection([])
        const src = currentSource()
        if (!src) return
        const c = makeClip(p, src, track, snapFloor(tick, grid))
        if (tool === 'paint') return start({ kind: 'paint', before: clips, proto: c, added: [c], preview: [...clips, c] })
        return start({ kind: 'move', before: clips, moving: [c], add: true, anchor: c, downTick: tick, downTrack: track, label: 'Add clip', preview: [...clips, c] })
      }
    }
  }

  const moveDrag = (anchor: Clip, clips: Clip[], ids: Set<string>, tick: number, track: number, clone: boolean): Drag => {
    const orig = clips.filter((c) => ids.has(c.id))
    if (clone) {
      const copies = cloneShifted(orig, 0, 0, uid)
      const a = copies[orig.findIndex((c) => c.id === anchor.id)] ?? copies[0]
      if (getPl().selected.has(anchor.id)) setSelection(copies.map((c) => c.id))
      return { kind: 'move', before: clips, moving: copies, add: true, anchor: a, downTick: tick, downTrack: track, label: 'Clone clips', preview: [...clips, ...copies] }
    }
    return { kind: 'move', before: clips, moving: orig, add: false, anchor, downTick: tick, downTrack: track, label: orig.length > 1 ? 'Move clips' : 'Move clip', preview: clips }
  }

  const resizeDrag = (hit: Hit, clips: Clip[], ids: Set<string>, tick: number): Drag => ({
    kind: 'resize',
    side: hit.zone === 'left' ? 'left' : 'right',
    before: clips,
    ids,
    anchor: hit.clip,
    downTick: tick,
    preview: clips
  })

  const autoDrag = (hit: Hit, x: number, y: number, alt: boolean, grid: number): Drag | null => {
    const p = getProject()
    const a = p.automations.find((q) => q.id === hit.clip.ref)
    if (!a) return null
    const v = view()
    const hh = headerHeight(hit.th)
    const by = hit.y + hh
    const bh = hit.h - hh
    const m = autoMapper(v, hit.clip, by, bh)
    const base = { kind: 'auto' as const, clip: hit.clip, autoId: a.id, before: a.points, downY: y, by, bh }
    const pi = hitPoint(a.points, m, x, y)
    if (pi >= 0) return { ...base, points: a.points, index: pi, mode: 'point', orig: 0 }
    const hi = hitHandle(a, m, x, y)
    if (hi > 0) return { ...base, points: a.points, index: hi, mode: 'tension', orig: a.points[hi].tension }
    const t = m.fromX(x)
    if (alt) {
      const si = segmentAt(a.points, t)
      if (si > 0) return { ...base, points: a.points, index: si, mode: 'tension', orig: a.points[si].tension }
      return null
    }
    const absT = snapRound(t + hit.clip.start - hit.clip.offset, grid) - (hit.clip.start - hit.clip.offset)
    const r = addPoint(a.points, Math.max(0, absT), m.fromY(y))
    return { ...base, points: r.points, index: r.index, mode: 'point', orig: 0 }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const { x, y, tick, track, v } = local(e)
    mouse.tick = tick
    mouse.track = track
    mouse.inside = true
    if (!d) {
      hover(e, x, y)
      return
    }
    const grid = gridSize(e.altKey)
    const p = getProject()
    switch (d.kind) {
      case 'pan':
        getPl().set({
          scrollTick: Math.max(0, d.scrollTick - (e.clientX - d.sx) / v.ppt),
          scrollY: Math.max(0, d.scrollY - (e.clientY - d.sy))
        })
        return
      case 'move': {
        const raw = tick - d.downTick
        let dTick = snapRound(d.anchor.start + raw, grid) - d.anchor.start
        let dTrack = track - d.downTrack
        ;({ dTick, dTrack } = clampMove(d.moving, dTick, dTrack, PLAYLIST_TRACKS))
        if (d.add) d.preview = [...d.before, ...d.moving.map((c) => ({ ...c, start: c.start + dTick, track: c.track + dTrack }))]
        else d.preview = moveClips(d.before, new Set(d.moving.map((c) => c.id)), dTick, dTrack)
        useUI.getState().setHint(`${clipLabel(p, d.anchor)} @ ${formatPos(d.anchor.start + dTick, barTicks(p))}`)
        break
      }
      case 'resize': {
        const raw = tick - d.downTick
        if (d.side === 'right') {
          const end0 = d.anchor.start + d.anchor.length
          const dEnd = snapRound(end0 + raw, grid) - end0
          d.preview = d.before.map((c) => (d.ids.has(c.id) ? resizeRight(c, c.start + c.length + dEnd, clipMaxLen(p, c)) : c))
          const a = d.preview.find((c) => c.id === d.anchor.id)
          if (a) useUI.getState().setHint(`Length: ${(a.length / barTicks(p)).toFixed(2)} bars`)
        } else {
          const dS = snapRound(d.anchor.start + raw, grid) - d.anchor.start
          d.preview = d.before.map((c) => (d.ids.has(c.id) ? trimLeft(c, c.start + dS, clipWrap(p, c)) : c))
        }
        break
      }
      case 'slip': {
        const dT = snapRound(tick - d.downTick, grid)
        d.preview = d.before.map((c) => {
          if (!d.ids.has(c.id)) return c
          const maxOff = c.kind === 'audio' ? Math.max(0, sourceLength(p, c) - 6) : Infinity
          return slipClip(c, dT, c.offset, clipWrap(p, c), maxOff)
        })
        break
      }
      case 'delete': {
        const h = hitAt(x, y, d.preview)
        if (h && !d.removed.has(h.clip.id)) {
          d.removed.add(h.clip.id)
          d.preview = d.before.filter((c) => !d.removed.has(c.id))
        } else return
        break
      }
      case 'mute': {
        const h = hitAt(x, y, d.preview)
        if (h && !d.touched.has(h.clip.id)) {
          d.touched.add(h.clip.id)
          d.preview = d.before.map((c) => (d.touched.has(c.id) ? { ...c, muted: d.to } : c))
        } else return
        break
      }
      case 'paint': {
        const n = Math.max(0, Math.floor((tick - d.proto.start) / d.proto.length))
        if (n + 1 === d.added.length) return
        if (n + 1 < d.added.length) d.added = d.added.slice(0, n + 1)
        else d.added = [...d.added, ...paintRepeat({ ...d.proto, start: d.added[d.added.length - 1].start }, d.proto.start + n * d.proto.length, uid)]
        d.preview = [...d.before, ...d.added]
        break
      }
      case 'rubber': {
        d.x1 = x
        d.y1 = y
        const off = offsetsRef.current
        const tr0 = trackAtY(off, Math.min(d.y0, y) + v.scrollY)
        const tr1 = trackAtY(off, Math.max(d.y0, y) + v.scrollY)
        const inRect = clipsInRect(p.playlist.clips, xToTick(v, d.x0), xToTick(v, x), tr0, tr1)
        setSelection([...d.base, ...inRect.map((c) => c.id)])
        break
      }
      case 'slice':
        d.y1 = y
        d.x = tickToX(v, snapRound(tick, grid))
        break
      case 'zoomRect':
        d.x1 = x
        d.moved = d.moved || Math.abs(d.x1 - d.x0) > 4
        break
      case 'scrub':
        transport.seek(Math.max(0, tick))
        return
      case 'auto': {
        const m = autoMapper(v, d.clip, d.by, d.bh)
        if (d.mode === 'point') {
          const origin = d.clip.start - d.clip.offset
          const t = snapRound(m.fromX(x) + origin, grid) - origin
          d.points = movePoint(d.points, d.index, t, m.fromY(y))
          useUI.getState().setHint(`Value: ${Math.round(d.points[d.index].v * 100)}%`)
        } else {
          const tension = tensionFromDrag(d.orig, y - d.downY, d.bh, d.points[d.index - 1], d.points[d.index])
          d.points = setTension(d.points, d.index, tension)
          useUI.getState().setHint(`Tension: ${Math.round(tension * 100)}%`)
        }
        break
      }
    }
    requestPaint()
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const cv = canvasRef.current
    if (cv?.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId)
    const { x, y, track, v } = local(e)
    const p = getProject()
    switch (d.kind) {
      case 'move':
        commitClips(d.label, d.before, d.preview)
        break
      case 'resize':
        commitClips(d.side === 'right' ? 'Resize clips' : 'Trim clips', d.before, d.preview)
        break
      case 'slip':
        commitClips('Slip clips', d.before, d.preview)
        break
      case 'delete':
        if (d.removed.size) deleteClips(d.removed, d.removed.size > 1 ? 'Delete clips' : 'Delete clip')
        break
      case 'mute':
        commitClips(d.to ? 'Mute clips' : 'Unmute clips', d.before, d.preview)
        break
      case 'paint':
        commitClips('Paint clips', d.before, d.preview)
        break
      case 'slice': {
        const off = offsetsRef.current
        const tr0 = trackAtY(off, d.y0 + v.scrollY)
        const at = Math.round(xToTick(v, d.x))
        commitClips('Slice clips', p.playlist.clips, sliceAt(p.playlist.clips, at, tr0, track, uid))
        break
      }
      case 'zoomRect':
        if (d.moved) {
          const t0 = xToTick(v, Math.min(d.x0, d.x1))
          const t1 = xToTick(v, Math.max(d.x0, d.x1))
          const ppt = Math.min(2.5, size.current.w / Math.max(24, t1 - t0))
          getPl().set({ ppt, scrollTick: Math.max(0, t0) })
        } else getPl().set(zoomAround(v, x, 2))
        break
      case 'scrub':
        transport.stop()
        break
      case 'auto':
        if (d.points !== d.before) setAutomationPoints(d.autoId, d.points, d.mode === 'tension' ? 'Automation tension' : 'Edit automation')
        break
      default:
        break
    }
    void y
    requestPaint()
  }

  const hover = (e: React.PointerEvent, x: number, y: number) => {
    const cv = canvasRef.current!
    const p = getProject()
    const tool = useUI.getState().playlistTool
    const hit = hitAt(x, y, p.playlist.clips)
    let cursor = TOOL_CURSOR[tool] ?? 'default'
    if (hit) {
      if ((tool === 'draw' || tool === 'paint' || tool === 'select') && (hit.zone === 'left' || hit.zone === 'right')) cursor = 'ew-resize'
      else if (hit.zone === 'header' && x - Math.max(hit.x, 0) < 12) cursor = 'context-menu'
      else if (tool === 'draw' || tool === 'paint') cursor = hit.clip.kind === 'automation' && hit.zone === 'body' && hit.th >= 40 ? 'crosshair' : 'move'
      const bar = barTicks(p)
      useUI.getState().setHint(`${clipLabel(p, hit.clip)} — ${formatPos(hit.clip.start, bar)} — ${(hit.clip.length / bar).toFixed(2)} bars${hit.clip.muted ? ' (muted)' : ''}`)
    } else {
      useUI.getState().setHint(`Playlist — ${formatPos(Math.max(0, local(e).tick), barTicks(p))} — Track ${local(e).track + 1}`)
    }
    if (cv.style.cursor !== cursor) cv.style.cursor = cursor
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = local(e)
    const hit = hitAt(x, y, getProject().playlist.clips)
    if (!hit) return
    if (hit.clip.kind === 'pattern') openPatternEditor(hit.clip.ref)
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        const { tick, track } = local(e)
        void handleGridDrop(e, Math.max(0, snapFloor(tick, gridSize(false))), track)
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => (mouse.inside = false)}
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" />
    </div>
  )
}
