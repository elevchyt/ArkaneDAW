// Canvas painters for the Playlist grid, clips and ruler.
import { PPQ, type Automation, type Clip, type Pattern, type Project } from '@/store/types'
import { automationValue, patternLength } from '@/audio/sequence'
import { getBuffer, loadSample } from '@/audio/samples'
import { FADE_HANDLE_PX, fadeGeom, headerHeight, lineTicks, tickToX, type View } from './geometry'
import { clipGainAt, hasFades } from '@/audio/fades'
import { peakRange, peaksFor } from './peaks'
import { handlePos } from './automation'
import { sourceColor, sourceName, ticksPerSecond } from './actions'

// ── colors ────────────────────────────────────────────────────────────────────
const rgbCache = new Map<string, [number, number, number]>()
export function hexRgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex)
  if (!c) {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h
    const n = parseInt(full.slice(0, 6), 16) || 0
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    rgbCache.set(hex, c)
  }
  return c
}
export function shade(hex: string, f: number, a = 1): string {
  const [r, g, b] = hexRgb(hex)
  const m = (x: number) => Math.round(f >= 0 ? x + (255 - x) * f : x * (1 + f))
  return `rgba(${m(r)},${m(g)},${m(b)},${a})`
}

export const COLORS = {
  bg: '#34424a',
  bgAlt: '#313e45',
  bgMuted: '#2b363c',
  lineStep: 'rgba(0,0,0,0.10)',
  lineBeat: 'rgba(0,0,0,0.22)',
  lineBar: 'rgba(0,0,0,0.45)',
  trackSep: 'rgba(0,0,0,0.32)',
  timeSel: 'rgba(255,255,255,0.07)',
  timeSelEdge: 'rgba(255,190,120,0.55)',
  playhead: '#7dff3c',
  rubber: 'rgba(255,138,138,0.9)',
  rubberFill: 'rgba(255,138,138,0.12)',
  sel: '#ff8a8a'
}

// ── pattern note preview cache ────────────────────────────────────────────────
interface NotePreview {
  stepLike: boolean
  lo: number
  hi: number
  notes: { key: number; pos: number; len: number }[]
}
const notePreview = new WeakMap<Pattern, { channels: Project['channels']; v: NotePreview }>()
/**
 * Notes for the clip preview. Step-sequencer patterns (every channel plays a single key) are shown
 * one row per channel like FL; anything else is shown by pitch.
 */
function previewFor(p: Pattern, channels: Project['channels']): NotePreview {
  const cached = notePreview.get(p)
  if (cached && cached.channels === channels) return cached.v
  const order = new Map(channels.map((c, i) => [c.id, i]))
  const used = Object.entries(p.notes).filter(([, l]) => l.some((n) => !n.muted))
  const stepLike = used.length > 1 && used.every(([, l]) => l.every((n) => n.key === l[0].key))
  let lo = Infinity
  let hi = -Infinity
  const notes: NotePreview['notes'] = []
  for (const [chId, list] of used) {
    const row = order.get(chId) ?? channels.length
    for (const n of list) {
      if (n.muted) continue
      const key = stepLike ? -row : n.key
      notes.push({ key, pos: n.pos, len: Math.max(1, n.len) })
      lo = Math.min(lo, key)
      hi = Math.max(hi, key)
    }
  }
  if (hi < lo) {
    lo = 60
    hi = 60
  }
  const v = { lo, hi, notes, stepLike }
  notePreview.set(p, { channels, v })
  return v
}

// ── grid ──────────────────────────────────────────────────────────────────────
export interface GridScene {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  view: View
  offsets: Float64Array
  project: Project
  clips: readonly Clip[]
  selected: ReadonlySet<string>
  bar: number
  timeSel: { start: number; end: number } | null
  autoOverride: { id: string; points: Automation['points'] } | null
  rubber: { x0: number; y0: number; x1: number; y1: number } | null
  sliceLine: { x: number; y0: number; y1: number } | null
  /** Called when a sample buffer finishes loading so the canvas can repaint. */
  onAsset: () => void
}

function visibleTracks(s: GridScene): [number, number] {
  const { offsets, view, h } = s
  const n = offsets.length - 1
  let a = 0
  while (a < n && offsets[a + 1] - view.scrollY <= 0) a++
  let b = a
  while (b < n && offsets[b] - view.scrollY < h) b++
  return [a, b - 1]
}

export function drawGrid(s: GridScene): void {
  const { ctx, w, h, view, offsets, project, bar } = s
  ctx.clearRect(0, 0, w, h)
  const [t0, t1] = visibleTracks(s)
  const tracks = project.playlist.tracks
  for (let i = t0; i <= t1; i++) {
    const y = offsets[i] - view.scrollY
    ctx.fillStyle = tracks[i]?.muted ? COLORS.bgMuted : i % 2 ? COLORS.bgAlt : COLORS.bg
    ctx.fillRect(0, y, w, offsets[i + 1] - offsets[i])
  }
  // alternate bar-group shading: blocks of as many bars as the time signature has beats (4/4: 4 bars, 3/4: 3)
  const beat = (PPQ * 4) / project.timeSig[1]
  const group = bar * Math.max(1, project.timeSig[0])
  const firstG = Math.floor(view.scrollTick / group)
  for (let g = firstG; ; g++) {
    const x = tickToX(view, g * group)
    if (x > w) break
    if (g % 2 === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.06)'
      ctx.fillRect(x, 0, group * view.ppt, h)
    }
  }
  // vertical lines
  const line = lineTicks(view.ppt, bar, 7, beat)
  const startT = Math.floor(view.scrollTick / line) * line
  for (let t = startT; ; t += line) {
    const x = Math.round(tickToX(view, t)) + 0.5
    if (x > w) break
    ctx.strokeStyle = t % bar === 0 ? COLORS.lineBar : t % beat === 0 ? COLORS.lineBeat : COLORS.lineStep
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  // track separators
  ctx.strokeStyle = COLORS.trackSep
  ctx.beginPath()
  for (let i = t0; i <= t1 + 1; i++) {
    const y = Math.round(offsets[i] - view.scrollY) - 0.5
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
  // time selection
  if (s.timeSel) {
    const x0 = tickToX(view, s.timeSel.start)
    const x1 = tickToX(view, s.timeSel.end)
    ctx.fillStyle = COLORS.timeSel
    ctx.fillRect(x0, 0, x1 - x0, h)
    ctx.fillStyle = COLORS.timeSelEdge
    ctx.fillRect(Math.round(x0), 0, 1, h)
    ctx.fillRect(Math.round(x1) - 1, 0, 1, h)
  }
  drawClips(s, t0, t1)
  if (s.rubber) {
    const { x0, y0, x1, y1 } = s.rubber
    ctx.fillStyle = COLORS.rubberFill
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
    ctx.strokeStyle = COLORS.rubber
    ctx.setLineDash([4, 3])
    ctx.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0))
    ctx.setLineDash([])
  }
  if (s.sliceLine) {
    ctx.strokeStyle = '#ffd36b'
    ctx.setLineDash([3, 2])
    ctx.beginPath()
    ctx.moveTo(Math.round(s.sliceLine.x) + 0.5, s.sliceLine.y0)
    ctx.lineTo(Math.round(s.sliceLine.x) + 0.5, s.sliceLine.y1)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

const requested = new Set<string>()

function drawClips(s: GridScene, t0: number, t1: number): void {
  const { ctx, w, view, offsets, project } = s
  const tStart = view.scrollTick
  const tEnd = view.scrollTick + w / view.ppt
  const patterns = new Map(project.patterns.map((p) => [p.id, p]))
  const autos = new Map(project.automations.map((a) => [a.id, a]))
  ctx.font = '10px "Segoe UI", "Noto Sans", Ubuntu, sans-serif'
  ctx.textBaseline = 'middle'
  for (const c of s.clips) {
    if (c.track < t0 || c.track > t1) continue
    if (c.start > tEnd || c.start + c.length < tStart) continue
    const x = tickToX(view, c.start)
    const cw = Math.max(1, c.length * view.ppt)
    const y = offsets[c.track] - view.scrollY + 1
    const th = offsets[c.track + 1] - offsets[c.track]
    const ch = th - 2
    const selected = s.selected.has(c.id)
    const color = sourceColor(project, c, c.channelId)
    const muted = c.muted || !!project.playlist.tracks[c.track]?.muted
    ctx.save()
    ctx.globalAlpha = muted ? 0.38 : 1
    const hh = headerHeight(th)
    // body
    ctx.fillStyle = shade(color, selected ? -0.05 : -0.35, 0.92)
    ctx.fillRect(x, y, cw, ch)
    // clip region for content
    ctx.beginPath()
    ctx.rect(Math.max(x, -2), y, Math.min(cw, w + 4 - Math.max(x, -2)), ch)
    ctx.clip()
    const bodyY = y + hh
    const bodyH = ch - hh
    if (bodyH > 3 && cw > 3) {
      if (c.kind === 'pattern') {
        const pat = patterns.get(c.ref)
        if (pat) drawPatternNotes(ctx, view, c, pat, project, bodyY, bodyH, color, w)
      } else if (c.kind === 'audio') {
        drawWaveform(ctx, view, c, project, bodyY, bodyH, color, w, s.onAsset)
        drawFadeCurves(ctx, view, c, x, y, cw, ch, th)
      } else {
        const a = autos.get(c.ref)
        if (a) {
          const pts = s.autoOverride?.id === a.id ? { ...a, points: s.autoOverride.points } : a
          drawAutomation(ctx, view, c, pts, bodyY, bodyH, color, w, th >= 40)
        }
      }
    }
    // header strip
    if (hh > 0) {
      ctx.fillStyle = selected ? shade(color, 0.35) : shade(color, -0.1)
      ctx.fillRect(x, y, cw, hh)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(x, y + hh - 1, cw, 1)
      if (cw > 14) {
        // menu arrow (top-left icon)
        ctx.fillStyle = selected ? '#1b1f22' : 'rgba(255,255,255,0.75)'
        const ax = Math.max(x, 0) + 3
        ctx.beginPath()
        ctx.moveTo(ax, y + 4)
        ctx.lineTo(ax + 6, y + 4)
        ctx.lineTo(ax + 3, y + 8)
        ctx.closePath()
        ctx.fill()
      }
      if (cw > 24) {
        ctx.fillStyle = selected ? '#1b1f22' : '#eef2f4'
        ctx.fillText(clipLabel(project, c), Math.max(x, 0) + 12, y + hh / 2 + 0.5, Math.max(0, cw - 14))
      }
    } else if (cw > 30 && ch >= 12) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillText(clipLabel(project, c), Math.max(x, 0) + 3, y + Math.min(ch / 2, 7), cw - 5)
    }
    ctx.restore()
    // outline
    ctx.strokeStyle = selected ? COLORS.sel : 'rgba(0,0,0,0.55)'
    ctx.lineWidth = selected ? 1.5 : 1
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, Math.round(cw) - 1), ch - 1)
    ctx.lineWidth = 1
    if (c.kind === 'audio' && !muted) drawFadeHandles(ctx, view, c, x, y, cw, ch, th, selected)
  }
  // crossfades: a later clip covers the earlier one's fade-out, so draw that curve and its handles on top
  for (const c of s.clips) {
    if (c.kind !== 'audio' || !c.fadeOut || c.track < t0 || c.track > t1) continue
    const end = c.start + c.length
    if (!s.clips.some((o) => o !== c && o.kind === 'audio' && o.track === c.track && o.start > c.start && o.start < end)) continue
    if (c.start > tEnd || end < tStart) continue
    const x = tickToX(view, c.start)
    const cw = Math.max(1, c.length * view.ppt)
    const y = offsets[c.track] - view.scrollY + 1
    const th = offsets[c.track + 1] - offsets[c.track]
    const ch = th - 2
    const g = fadeGeom(c, cw, ch, th, view.ppt)
    const bottom = y + g.top + g.height
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.setLineDash([3, 2])
    ctx.beginPath()
    const n = Math.max(2, Math.min(96, Math.ceil(cw - g.outX)))
    for (let i = 0; i <= n; i++) {
      const px = g.outX + ((cw - g.outX) * i) / n
      const py = bottom - clipGainAt(c, px / view.ppt) * g.height
      if (i) ctx.lineTo(x + px, py)
      else ctx.moveTo(x + px, py)
    }
    ctx.stroke()
    ctx.restore()
    drawFadeHandles(ctx, view, c, x, y, cw, ch, th, s.selected.has(c.id), 'out')
  }
}

/** Shade the faded-out part of an audio clip and draw the fade curves. */
function drawFadeCurves(ctx: CanvasRenderingContext2D, view: View, c: Clip, x: number, y: number, cw: number, ch: number, th: number): void {
  if (!hasFades(c)) return
  const g = fadeGeom(c, cw, ch, th, view.ppt)
  const bottom = y + g.top + g.height
  const yOf = (gain: number) => bottom - gain * g.height
  const curve = (x0: number, x1: number, gainAt: (px: number) => number) => {
    const pts: [number, number][] = []
    const n = Math.max(2, Math.min(96, Math.ceil(x1 - x0)))
    for (let i = 0; i <= n; i++) {
      const px = x0 + ((x1 - x0) * i) / n
      pts.push([x + px, yOf(gainAt(px))])
    }
    return pts
  }
  const shapes: [number, number][][] = []
  if (g.inX >= 1) shapes.push(curve(0, g.inX, (px) => clipGainAt(c, px / view.ppt)))
  if (cw - g.outX >= 1) shapes.push(curve(g.outX, cw, (px) => clipGainAt(c, px / view.ppt)))
  for (const pts of shapes) {
    // darken above the curve (the attenuated part)
    ctx.fillStyle = 'rgba(0,0,0,0.42)'
    ctx.beginPath()
    ctx.moveTo(pts[0][0], y + g.top)
    for (const [px, py] of pts) ctx.lineTo(px, py)
    ctx.lineTo(pts[pts.length - 1][0], y + g.top)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
    ctx.stroke()
  }
}

/** FL-style fade handles: small squares at the top corners of the body, plus tension dots on the curves. */
function drawFadeHandles(ctx: CanvasRenderingContext2D, view: View, c: Clip, x: number, y: number, cw: number, ch: number, th: number, selected: boolean, only?: 'out'): void {
  if (cw < 16 || ch - headerHeight(th) < 10) return
  const g = fadeGeom(c, cw, ch, th, view.ppt)
  const sz = FADE_HANDLE_PX
  ctx.fillStyle = selected ? '#ffd36b' : 'rgba(238,242,244,0.9)'
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  const box = (cx: number) => {
    const bx = Math.round(x + Math.min(cw - sz, Math.max(0, cx - sz / 2)))
    const by = Math.round(y + g.handleY - sz / 2)
    ctx.fillRect(bx, by, sz, sz)
    ctx.strokeRect(bx + 0.5, by + 0.5, sz - 1, sz - 1)
  }
  if (!only) box(g.inX)
  box(g.outX)
  for (const m of only ? [g.outMid] : [g.inMid, g.outMid]) {
    if (!m) continue
    ctx.beginPath()
    ctx.arc(x + m.x, y + m.y, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

export function clipLabel(p: Project, c: Clip): string {
  const name = sourceName(p, c)
  return c.muted ? `${name} (muted)` : name
}

function drawPatternNotes(ctx: CanvasRenderingContext2D, view: View, c: Clip, pat: Pattern, p: Project, by: number, bh: number, color: string, w: number): void {
  const pv = previewFor(pat, p.channels)
  if (!pv.notes.length) return
  const plen = patternLength(pat, p)
  const range = Math.max(pv.hi - pv.lo + 1, pv.stepLike ? 1 : 6)
  const top = pv.hi + Math.floor((range - (pv.hi - pv.lo + 1)) / 2) // key shown in the top row
  const pad = Math.min(3, bh * 0.1)
  const rowH = (bh - pad * 2) / range
  const nh = Math.max(1, Math.min(rowH > 3 ? rowH - 1 : rowH, 6))
  ctx.fillStyle = shade(color, 0.6, 0.95)
  const origin0 = c.start - c.offset
  const end = c.start + c.length
  const firstK = Math.max(0, Math.floor((Math.max(c.start, view.scrollTick) - origin0) / plen) - 1)
  const viewEnd = view.scrollTick + w / view.ppt
  let drawn = 0
  for (let k = firstK; origin0 + k * plen < Math.min(end, viewEnd); k++) {
    const origin = origin0 + k * plen
    for (const n of pv.notes) {
      if (n.pos >= plen) continue
      const a = origin + n.pos
      if (a >= end || a + n.len <= c.start) continue
      const s = Math.max(a, c.start)
      const e = Math.min(a + n.len, end)
      const x = tickToX(view, s)
      if (x > w) continue
      const nw = Math.max(1, (e - s) * view.ppt - (view.ppt * n.len > 3 ? 1 : 0))
      if (x + nw < 0) continue
      const ny = by + pad + (top - n.key) * rowH + (rowH - nh) / 2
      ctx.fillRect(x, Math.min(by + bh - nh, Math.max(by, ny)), nw, nh)
      if (++drawn > 20000) return
    }
  }
}

function drawWaveform(ctx: CanvasRenderingContext2D, view: View, c: Clip, p: Project, by: number, bh: number, color: string, w: number, onAsset: () => void): void {
  const buf = getBuffer(c.ref)
  if (!buf) {
    if (!requested.has(c.ref)) {
      requested.add(c.ref)
      const s = p.samples.find((x) => x.id === c.ref)
      if (s) void loadSample(s).then((b) => b && onAsset())
    }
    return
  }
  const peaks = peaksFor(buf)
  const tps = ticksPerSecond(p)
  const fpt = buf.sampleRate / tps // frames per tick
  const x0 = Math.max(0, Math.floor(tickToX(view, c.start)))
  const x1 = Math.min(w, Math.ceil(tickToX(view, c.start + c.length)))
  const mid = by + bh / 2
  const amp = bh / 2 - 1
  ctx.fillStyle = shade(color, 0.65, 0.95)
  const framesPerPx = fpt / view.ppt
  for (let px = x0; px < x1; px++) {
    const tick = view.scrollTick + px / view.ppt - c.start + c.offset
    const f0 = Math.floor(tick * fpt)
    if (f0 >= peaks.length) break
    const [lo, hi] = peakRange(peaks, f0, Math.ceil(f0 + framesPerPx))
    const top = mid - hi * amp
    const bot = mid - lo * amp
    ctx.fillRect(px, top, 1, Math.max(1, bot - top))
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(x0, Math.round(mid), x1 - x0, 1)
}

function drawAutomation(ctx: CanvasRenderingContext2D, view: View, c: Clip, a: Automation, by: number, bh: number, color: string, w: number, showPoints: boolean): void {
  const pad = 3
  const toY = (v: number) => by + pad + (1 - v) * (bh - pad * 2)
  const x0 = Math.max(0, Math.floor(tickToX(view, c.start)))
  const x1 = Math.min(w, Math.ceil(tickToX(view, c.start + c.length)))
  if (x1 <= x0) return
  ctx.beginPath()
  ctx.moveTo(x0, by + bh)
  for (let px = x0; px <= x1; px += 2) {
    const t = view.scrollTick + Math.min(px, x1) / view.ppt - c.start + c.offset
    ctx.lineTo(px, toY(automationValue(a, t)))
  }
  ctx.lineTo(x1, toY(automationValue(a, c.offset + c.length)))
  ctx.lineTo(x1, by + bh)
  ctx.closePath()
  ctx.fillStyle = shade(color, 0.2, 0.35)
  ctx.fill()
  ctx.beginPath()
  for (let px = x0; px <= x1; px += 2) {
    const t = view.scrollTick + px / view.ppt - c.start + c.offset
    const y = toY(automationValue(a, t))
    if (px === x0) ctx.moveTo(px, y)
    else ctx.lineTo(px, y)
  }
  ctx.strokeStyle = shade(color, 0.75)
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.lineWidth = 1
  if (!showPoints) return
  const toX = (t: number) => tickToX(view, c.start - c.offset + t)
  for (let i = 0; i < a.points.length; i++) {
    const pt = a.points[i]
    const x = toX(pt.t)
    if (x < -6 || x > w + 6) continue
    if (i > 0 && a.points[i].t - a.points[i - 1].t >= 2) {
      const hp = handlePos(a, i)
      const hx = toX(hp.t)
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath()
      ctx.arc(hx, toY(hp.v), 2.5, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.fillStyle = '#f2f5f7'
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.beginPath()
    ctx.arc(x, toY(pt.v), 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
}

/** Map for automation editing inside a clip (shared by renderer and interaction code). */
export function autoMapper(view: View, c: Clip, by: number, bh: number) {
  const pad = 3
  return {
    toX: (t: number) => tickToX(view, c.start - c.offset + t),
    toY: (v: number) => by + pad + (1 - v) * (bh - pad * 2),
    fromX: (x: number) => view.scrollTick + x / view.ppt - c.start + c.offset,
    fromY: (y: number) => 1 - (y - by - pad) / Math.max(1, bh - pad * 2)
  }
}

// ── ruler ─────────────────────────────────────────────────────────────────────
export const RULER_BARS_H = 18
export const RULER_MARKERS_H = 13
export const RULER_H = RULER_BARS_H + RULER_MARKERS_H

export interface RulerScene {
  ctx: CanvasRenderingContext2D
  w: number
  view: View
  project: Project
  bar: number
  timeSel: { start: number; end: number } | null
  loop: { start: number; end: number } | null
  startTick: number
  songMode: boolean
}

export function drawRuler(s: RulerScene): void {
  const { ctx, w, view, bar, project } = s
  ctx.clearRect(0, 0, w, RULER_H)
  ctx.fillStyle = '#2b3438'
  ctx.fillRect(0, 0, w, RULER_BARS_H)
  ctx.fillStyle = '#262e32'
  ctx.fillRect(0, RULER_BARS_H, w, RULER_MARKERS_H)
  if (s.timeSel) {
    const x0 = tickToX(view, s.timeSel.start)
    const x1 = tickToX(view, s.timeSel.end)
    ctx.fillStyle = 'rgba(247,154,46,0.35)'
    ctx.fillRect(x0, 0, x1 - x0, RULER_BARS_H)
    ctx.fillStyle = '#f79a2e'
    ctx.fillRect(x0, RULER_BARS_H - 3, x1 - x0, 3)
  }
  // label spacing: every n bars so labels don't collide
  const barPx = bar * view.ppt
  let every = 1
  while (every * barPx < 28) every *= 2
  const tickLine = lineTicks(view.ppt, bar, 7, (PPQ * 4) / project.timeSig[1])
  ctx.font = '10px "Segoe UI", "Noto Sans", Ubuntu, sans-serif'
  ctx.textBaseline = 'middle'
  const startT = Math.floor(view.scrollTick / tickLine) * tickLine
  for (let t = startT; ; t += tickLine) {
    const x = Math.round(tickToX(view, t)) + 0.5
    if (x > w) break
    const isBar = t % bar === 0
    const b = Math.round(t / bar)
    ctx.strokeStyle = isBar ? 'rgba(200,210,215,0.45)' : 'rgba(200,210,215,0.18)'
    ctx.beginPath()
    ctx.moveTo(x, isBar && b % every === 0 ? 2 : RULER_BARS_H - 5)
    ctx.lineTo(x, RULER_BARS_H)
    ctx.stroke()
    if (isBar && b % every === 0) {
      ctx.fillStyle = '#c5cdd1'
      ctx.fillText(String(b + 1), x + 3, 8)
    }
  }
  // markers
  for (const m of project.markers) {
    const x = tickToX(view, m.pos)
    if (x < -120 || x > w) continue
    ctx.fillStyle = '#d9e1e5'
    ctx.beginPath()
    ctx.moveTo(x, RULER_BARS_H + 1)
    ctx.lineTo(x + 5, RULER_BARS_H + 1)
    ctx.lineTo(x, RULER_BARS_H + 7)
    ctx.closePath()
    ctx.fill()
    ctx.fillRect(Math.round(x), RULER_BARS_H, 1, RULER_MARKERS_H)
    ctx.fillStyle = '#c5cdd1'
    ctx.fillText(m.name, x + 6, RULER_BARS_H + RULER_MARKERS_H / 2 + 0.5)
  }
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(0, RULER_BARS_H, w, 1)
  ctx.fillRect(0, RULER_H - 1, w, 1)
}

/** Song-start marker / playhead triangle in the ruler. */
export function drawRulerHead(ctx: CanvasRenderingContext2D, w: number, view: View, tick: number, color: string): void {
  const x = tickToX(view, tick)
  if (x < -8 || x > w + 8) return
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x - 6, RULER_BARS_H - 9)
  ctx.lineTo(x + 6, RULER_BARS_H - 9)
  ctx.lineTo(x, RULER_BARS_H - 1)
  ctx.closePath()
  ctx.fill()
}

/** Audio take being recorded right now: red-edged clip growing up to `endTick` with its live waveform. */
export function drawLiveTake(
  ctx: CanvasRenderingContext2D,
  view: View,
  offsets: Float64Array,
  w: number,
  take: { playlistTrack: number; startTick: number; tps: number; sampleRate: number; bucket: number; peaks: number[]; name: string; color: string },
  endTick: number
): void {
  const x0 = tickToX(view, take.startTick)
  const x1 = tickToX(view, Math.max(take.startTick, endTick))
  if (x1 < 0 || x0 > w || take.playlistTrack + 1 >= offsets.length) return
  const y = offsets[take.playlistTrack] - view.scrollY + 1
  const th = offsets[take.playlistTrack + 1] - offsets[take.playlistTrack]
  const ch = th - 2
  const cw = Math.max(2, x1 - x0)
  const hh = headerHeight(th)
  ctx.save()
  ctx.beginPath()
  ctx.rect(Math.max(x0, -2), y, Math.min(cw, w + 4), ch)
  ctx.clip()
  ctx.fillStyle = shade(take.color, -0.45, 0.92)
  ctx.fillRect(x0, y, cw, ch)
  // waveform: one bucket per pixel column at most
  const bodyY = y + hh
  const bodyH = ch - hh
  if (bodyH > 3 && take.peaks.length) {
    const ticksPerBucket = (take.bucket / take.sampleRate) * take.tps
    const mid = bodyY + bodyH / 2
    const amp = bodyH / 2 - 1
    ctx.fillStyle = shade(take.color, 0.45, 0.9)
    const from = Math.max(0, Math.floor(-x0))
    const to = Math.min(Math.ceil(cw), Math.ceil(w - x0))
    for (let px = from; px < to; px++) {
      const b0 = Math.floor(px / view.ppt / ticksPerBucket)
      const b1 = Math.max(b0 + 1, Math.floor((px + 1) / view.ppt / ticksPerBucket))
      let v = 0
      for (let b = b0; b < b1 && b < take.peaks.length; b++) if (take.peaks[b] > v) v = take.peaks[b]
      if (b0 >= take.peaks.length) break
      const hgt = Math.max(1, Math.min(1, v) * amp)
      ctx.fillRect(x0 + px, mid - hgt, 1, hgt * 2)
    }
  }
  if (hh > 0) {
    ctx.fillStyle = '#c8352b'
    ctx.fillRect(x0, y, cw, hh)
    if (cw > 24) {
      ctx.font = '10px "Segoe UI", "Noto Sans", Ubuntu, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'
      ctx.fillText(`● Recording ${take.name}`, Math.max(x0, 0) + 4, y + hh / 2 + 0.5, Math.max(0, cw - 8))
    }
  }
  ctx.restore()
  ctx.strokeStyle = '#ff4b3e'
  ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y) + 0.5, Math.max(1, Math.round(cw) - 1), ch - 1)
}
