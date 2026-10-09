// Piano roll engine: one canvas, region-based hit testing, preview-while-dragging editing
// (one drag = one undo step), cached base layer + per-frame playhead overlay.
import { getProject, useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { playhead, useTransport } from '@/store/transport'
import { currentPatternId, findChannel, findPattern, setPatternNotes } from '@/store/actions'
import { defaultNote, uid } from '@/store/factory'
import type { Note, Project } from '@/store/types'
import { getPlugin } from '@/plugins/registry'
import type { KeyName } from '@/plugins/sdk/module'
import { patternLength } from '@/audio/sequence'
import { getEngine, initAudio, transport } from '@/audio/transport'
import { CHORDS, KEY_COUNT, MAX_KEY, formatTime, inScale, isBlack, noteColor, noteName } from './music'
import { barOf, beatOf, gridLineTicks, snapCeil, snapFloor, snapRound, snapTicks } from './snap'
import * as ops from './noteOps'
import { LANES, LANE_ORDER, usePR } from './state'

export const KEYS_W = 74 // piano keyboard width (wider when keys are named)
export const RULER_H = 26
export const SB = 12
export const SPLIT = 5
const MIN_PPT = 0.004
const MAX_PPT = 12
const MIN_ROW = 5
const MAX_ROW = 44
const EMPTY: Note[] = []

type Region = 'ruler' | 'keys' | 'grid' | 'vscroll' | 'hscroll' | 'split' | 'lane' | 'laneLabel' | 'corner' | 'none'

interface View {
  x: number // tick at left edge of grid
  y: number // content px offset from top (key 131)
  ppt: number // px per tick
  rowH: number
}

interface Template {
  len: number | null
  vel: number
  pan: number
  rel: number
  fine: number
  modX: number
  modY: number
}

type Drag =
  | { kind: 'move'; anchor: string; ids: Set<string>; orig: Map<string, Note>; base: Note[]; offT: number; startT: number; startRow: number; shiftAtStart: boolean; hMoved: boolean; last: string; label: string }
  | { kind: 'resize'; anchor: string; ids: Set<string>; orig: Map<string, Note>; base: Note[]; label: string }
  | { kind: 'erase'; lx: number; ly: number }
  | { kind: 'mute'; value: boolean; lx: number; ly: number }
  | { kind: 'paint'; origin: number; len: number; slots: Set<number>; mono: boolean; lastSlot: number }
  | { kind: 'rubber'; t0: number; y0: number; t1: number; y1: number; base: Set<string>; moved: boolean; clickHit: Note | null; toggle: boolean }
  | { kind: 'slice'; t0: number; y0: number; t1: number; y1: number; alt: boolean }
  | { kind: 'zoom'; x0: number; x1: number }
  | { kind: 'scrub'; sounding: Map<string, Promise<number | null>> }
  | { kind: 'pan'; sx: number; sy: number; v0: View }
  | { kind: 'seek'; last: number }
  | { kind: 'tsel'; anchor: number }
  | { kind: 'keys'; key: number; id: Promise<number | null> }
  | { kind: 'lane'; mode: 'draw' | 'line' | 'flat'; lx: number; lv: number; sx: number; sv: number; base: Note[] }
  | { kind: 'hthumb'; part: 'move' | 'l' | 'r'; sx: number; v0: View; total: number; tx: number; tw: number }
  | { kind: 'vthumb'; part: 'move' | 't' | 'b'; sy: number; v0: View; ty: number; th: number }
  | { kind: 'split'; sy: number; h0: number }

let clipboard: Note[] = []

// ── audio helpers ────────────────────────────────────────────────────────────
function noteOnAsync(channelId: string, key: number, vel: number, extra: Partial<Note> = {}): Promise<number | null> {
  return initAudio()
    .then((e) => e.noteOn(channelId, key, vel, { pan: extra.pan ?? 0, fine: extra.fine ?? 0, modX: extra.modX ?? 0.5, modY: extra.modY ?? 0.5 }))
    .catch(() => null)
}
function noteOffAsync(channelId: string, key: number, id: Promise<number | null>): void {
  void id.then((i) => {
    if (i !== null) getEngine()?.noteOff(channelId, i, key)
  })
}
function audition(channelId: string | null, notes: { key: number; vel: number; pan?: number; fine?: number }[], ms = 220): void {
  if (!channelId) return
  for (const n of notes.slice(0, 8)) {
    const id = noteOnAsync(channelId, n.key, n.vel, n as Partial<Note>)
    setTimeout(() => noteOffAsync(channelId, n.key, id), ms)
  }
}

// ── color helpers ────────────────────────────────────────────────────────────
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}
function mix(a: string, b: string, f: number): string {
  const x = hexRgb(a)
  const y = hexRgb(b)
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * f)},${Math.round(x[1] + (y[1] - x[1]) * f)},${Math.round(x[2] + (y[2] - x[2]) * f)})`
}
const GROUP_COLORS: Record<string, string> = {
  kick: '#e8946e', kicks: '#e8946e', snare: '#e3d585', snares: '#e3d585', clap: '#e3b585', claps: '#e3b585',
  hat: '#8fd2e1', hats: '#8fd2e1', 'hi-hat': '#8fd2e1', 'hi-hats': '#8fd2e1', tom: '#b498e6', toms: '#b498e6',
  cymbal: '#8fb3e1', cymbals: '#8fb3e1', perc: '#8fe1a5', percussion: '#8fe1a5', sfx: '#e394cf', fx: '#e394cf'
}
function groupColor(group: string | undefined): string {
  if (!group) return '#9aa6ab'
  const g = GROUP_COLORS[group.toLowerCase()]
  if (g) return g
  let h = 0
  for (let i = 0; i < group.length; i++) h = (h * 31 + group.charCodeAt(i)) >>> 0
  return NOTE_COLORS_SAFE[h % NOTE_COLORS_SAFE.length]
}
const NOTE_COLORS_SAFE = ['#8fe19a', '#8fd2e1', '#b498e6', '#e8a48c', '#e3d585', '#e394cf', '#a3c4b0']

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export class PianoRollController {
  canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private base: HTMLCanvasElement | null = null
  private W = 0
  private H = 0
  private dpr = 1
  view: View = { x: 0, y: 0, ppt: 16 / 24, rowH: 14 }
  sel = new Set<string>()
  timeSel: { start: number; end: number } | null = null
  template: Template = { len: null, vel: 100 / 128, pan: 0, rel: 0.5, fine: 0, modX: 0.5, modY: 0.5 }
  private preview: Note[] | null = null
  private drag: Drag | null = null
  private hover: { x: number; y: number } | null = null
  private pressedKey: number | null = null
  private scrubX: number | null = null
  private baseDirty = true
  private raf = 0
  private unsubs: (() => void)[] = []
  private lastCtx = ''
  private lastDown = { t: 0, x: 0, y: 0, button: -1 }
  private prevSnap: import('@/store/ui').Snap = 'main'
  private colors = new Map<string, string>()
  private phVisible = false
  private initialScroll = false
  /** keyboard column width */
  kw = KEYS_W
  /** visible rows, top to bottom (MIDI keys) and the inverse map */
  private rows: number[] = Array.from({ length: KEY_COUNT }, (_, i) => MAX_KEY - i)
  private rowIdx: Int16Array = Int16Array.from({ length: KEY_COUNT }, (_, k) => MAX_KEY - k)
  names: Record<number, KeyName> | null = null
  drum = false
  private namesSrc: unknown = undefined
  private rowsSig = ''
  private selBeforeClone: Set<string> | null = null
  private C = {
    note: '#8fe19a',
    sel: '#ff8a8a',
    playhead: '#7dff3c',
    bg: '#34424a',
    bg2: '#2d3940',
    line: '#2a353b',
    beat: '#26313a',
    bar: '#1d262c'
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.base = document.createElement('canvas')
    this.C = {
      note: cssVar('--fl-note', this.C.note),
      sel: cssVar('--fl-note-sel', this.C.sel),
      playhead: cssVar('--fl-playhead', this.C.playhead),
      bg: cssVar('--fl-grid-bg', this.C.bg),
      bg2: '#2c383e',
      line: cssVar('--fl-grid-line', this.C.line),
      beat: cssVar('--fl-grid-beat', this.C.beat),
      bar: cssVar('--fl-grid-bar', this.C.bar)
    }
    this.unsubs.push(
      useProject.subscribe((s, prev) => {
        if (s.project !== prev.project) this.invalidate()
      }),
      useUI.subscribe((s, prev) => {
        if (s.currentPattern !== prev.currentPattern || s.pianoRollChannel !== prev.pianoRollChannel || s.globalSnap !== prev.globalSnap || s.pianoRollTool !== prev.pianoRollTool) this.invalidate()
      }),
      usePR.subscribe(() => this.invalidate()),
      useTransport.subscribe((s, prev) => {
        if (s.mode !== prev.mode || s.playing !== prev.playing) this.requestFrame()
      }),
      playhead.subscribe(() => this.requestFrame())
    )
    const onWheel = (e: WheelEvent) => this.onWheel(e)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    this.unsubs.push(() => canvas.removeEventListener('wheel', onWheel))
    this.invalidate()
  }

  detach(): void {
    for (const u of this.unsubs) u()
    this.unsubs = []
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.canvas = null
    this.ctx = null
  }

  resize(w: number, h: number): void {
    if (!this.canvas || !this.base) return
    this.dpr = window.devicePixelRatio || 1
    this.W = Math.max(1, Math.floor(w))
    this.H = Math.max(1, Math.floor(h))
    for (const c of [this.canvas, this.base]) {
      c.width = Math.floor(this.W * this.dpr)
      c.height = Math.floor(this.H * this.dpr)
    }
    this.canvas.style.width = `${this.W}px`
    this.canvas.style.height = `${this.H}px`
    if (!this.initialScroll && this.gridH() > 20) {
      this.initialScroll = true
      // Start with the C5 octave in view (FL opens around the middle of the keyboard).
      this.view.y = (MAX_KEY - 77) * this.view.rowH
      const notes = this.notes()
      if (notes.length) {
        const avg = notes.reduce((a, n) => a + n.key, 0) / notes.length
        this.view.y = (MAX_KEY - avg) * this.view.rowH - this.gridH() / 2
      }
      this.rowsSig = ''
      this.updateRows()
    }
    this.clampView()
    this.invalidate()
  }

  invalidate(): void {
    this.baseDirty = true
    this.requestFrame()
  }

  private requestFrame(): void {
    if (this.raf || !this.canvas) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.draw()
    })
  }

  // ── data access ────────────────────────────────────────────────────────────
  info(): { p: Project; patternId: string; channelId: string | null; timeSig: [number, number]; patLen: number } {
    const p = getProject()
    const patternId = currentPatternId()
    const ui = useUI.getState()
    const channelId = ui.pianoRollChannel && findChannel(p, ui.pianoRollChannel) ? ui.pianoRollChannel : (p.channels[0]?.id ?? null)
    const pat = findPattern(p, patternId)
    return { p, patternId, channelId, timeSig: p.timeSig, patLen: pat ? patternLength(pat, p) : barOf(p.timeSig) }
  }

  storeNotes(): Note[] {
    const { p, patternId, channelId } = this.info()
    if (!channelId) return EMPTY
    return findPattern(p, patternId)?.notes[channelId] ?? EMPTY
  }

  notes(): Note[] {
    return this.preview ?? this.storeNotes()
  }

  /** Commit the working copy as one undo step. */
  private commit(label: string, notes = this.preview): void {
    this.preview = null
    if (!notes) return
    const { patternId, channelId } = this.info()
    if (!channelId || !patternId) return
    if (notes === this.storeNotes()) return
    setPatternNotes(patternId, channelId, ops.sortNotes(notes), label)
    this.invalidate()
  }

  /** Apply an immediate (non-drag) edit. */
  apply(label: string, fn: (notes: Note[], ids: ops.IdSet) => Note[], coalesceKey?: string): void {
    const { patternId, channelId } = this.info()
    if (!channelId) return
    const cur = this.storeNotes()
    const next = fn(cur, this.sel.size ? this.sel : null)
    if (next === cur) return
    setPatternNotes(patternId, channelId, ops.sortNotes(next), label, coalesceKey)
    this.invalidate()
  }

  grid(alt = false): number {
    if (alt) return 0
    const pr = usePR.getState()
    return snapTicks(pr.snap, this.view.ppt, getProject().timeSig, useUI.getState().globalSnap)
  }

  /** Selection-sensitive context (clears selection when pattern/channel changes). */
  private checkContext(): void {
    this.updateRows()
    const { patternId, channelId } = this.info()
    const key = `${patternId}|${channelId}`
    if (key !== this.lastCtx) {
      if (this.lastCtx) {
        this.sel.clear()
        this.timeSel = null
        this.preview = null
        this.drag = null
      }
      this.lastCtx = key
      const ch = channelId ? findChannel(getProject(), channelId) : null
      useUI.getState().updateWindow('pianoRoll', { title: ch ? `Piano roll - ${ch.name}` : 'Piano roll' })
    }
  }

  /** Drum maps: plugin key names for the target channel; rebuilds the row list (drum view). */
  private updateRows(): void {
    const { p, channelId } = this.info()
    const ch = channelId ? findChannel(p, channelId) : undefined
    const plugin = ch?.plugin ?? null
    if (plugin !== this.namesSrc) {
      this.namesSrc = plugin
      let names: Record<number, KeyName> | undefined
      try {
        names = plugin ? getPlugin(plugin.pluginId)?.keyNames?.({ params: plugin.params, data: plugin.data, presetName: plugin.presetName }) : undefined
      } catch {
        names = undefined
      }
      this.names = names && Object.keys(names).length ? names : null
      this.rowsSig = ''
    }
    const override = channelId ? usePR.getState().drumView[channelId] : undefined
    const drum = !!this.names && (override ?? (plugin ? getPlugin(plugin.pluginId)?.defaultKeyView !== 'piano' : true))
    const sig = `${channelId}|${drum}`
    if (sig === this.rowsSig) return
    const switched = this.rowsSig !== '' && drum !== this.drum
    this.rowsSig = sig
    this.drum = drum
    const keyAtCenter = this.rows.length ? this.keyAt(RULER_H + this.gridH() / 2) : 60
    this.rows = drum
      ? Object.keys(this.names!)
          .map(Number)
          .filter((k) => k >= 0 && k <= MAX_KEY)
          .sort((a, b) => b - a)
      : Array.from({ length: KEY_COUNT }, (_, i) => MAX_KEY - i)
    if (!this.rows.length) this.rows = [60]
    this.rowIdx = new Int16Array(KEY_COUNT).fill(-1)
    this.rows.forEach((k, i) => (this.rowIdx[k] = i))
    this.kw = drum ? 136 : this.names ? 124 : KEYS_W
    if (usePR.getState().keysW !== this.kw) queueMicrotask(() => usePR.getState().set({ keysW: this.kw }))
    if (drum) {
      if (this.gridH() > 0) this.view.rowH = Math.max(this.view.rowH, Math.min(20, this.gridH() / this.rows.length))
      // show the used rows (or the bottom of the kit, where kicks/snares live)
      const used = this.notes().map((n) => this.rowIdx[n.key]).filter((r) => r >= 0)
      this.view.y = used.length ? ((Math.min(...used) + Math.max(...used) + 1) / 2) * this.view.rowH - this.gridH() / 2 : 1e9
    } else if (switched || this.names) {
      const named = this.names ? Object.keys(this.names).map(Number) : []
      const target = named.length ? (Math.min(...named) + Math.max(...named)) / 2 : keyAtCenter
      const r = this.rowIdx[Math.round(target)] >= 0 ? this.rowIdx[Math.round(target)] : MAX_KEY - 60
      this.view.y = r * this.view.rowH - this.gridH() / 2
    }
    this.clampView()
    this.baseDirty = true
  }

  /** M: switch keyboard view (piano / drum names) for the target channel. */
  toggleDrumView(): void {
    this.updateRows()
    const { channelId } = this.info()
    if (!channelId || !this.names) {
      this.hint('Keyboard view: this instrument has no named keys')
      return
    }
    const pr = usePR.getState()
    pr.set({ drumView: { ...pr.drumView, [channelId]: !this.drum } })
    this.updateRows()
    this.hint(`Keyboard view: ${this.drum ? 'drum names' : 'piano'}`)
    this.invalidate()
  }

  /** Key label for hints: drum name + note name when the plugin names the key. */
  keyLabel(key: number): string {
    const n = this.names?.[key]
    return n ? `${n.name} (${noteName(key)})` : noteName(key)
  }

  // ── geometry ───────────────────────────────────────────────────────────────
  private laneH(): number {
    return Math.max(0, Math.min(usePR.getState().laneH, this.H - RULER_H - SB - SPLIT - 40))
  }
  private gridBottom(): number {
    return this.H - SB - this.laneH() - SPLIT
  }
  private gridH(): number {
    return Math.max(0, this.gridBottom() - RULER_H)
  }
  private gridW(): number {
    return Math.max(0, this.W - SB - this.kw)
  }
  private laneTop(): number {
    return this.gridBottom() + SPLIT
  }
  xOf(t: number): number {
    return this.kw + (t - this.view.x) * this.view.ppt
  }
  tickAt(x: number): number {
    return this.view.x + (x - this.kw) / this.view.ppt
  }
  yOf(key: number): number {
    const r = this.rowIdx[key] ?? -1
    return r < 0 ? -1e6 : RULER_H + r * this.view.rowH - this.view.y
  }
  keyAt(y: number): number {
    return this.rows[this.rowAt(y)]
  }
  rowAt(y: number): number {
    return Math.max(0, Math.min(this.rows.length - 1, Math.floor((y - RULER_H + this.view.y) / this.view.rowH)))
  }
  private contentY(y: number): number {
    return y - RULER_H + this.view.y
  }
  private visTicks(): number {
    return this.gridW() / this.view.ppt
  }

  private region(x: number, y: number): Region {
    const gb = this.gridBottom()
    if (y < RULER_H) return x < this.kw ? 'corner' : x < this.W - SB ? 'ruler' : 'corner'
    if (y < gb) return x < this.kw ? 'keys' : x < this.W - SB ? 'grid' : 'vscroll'
    if (y < gb + SPLIT) return 'split'
    if (y < this.H - SB) return x < this.kw ? 'laneLabel' : x < this.W - SB ? 'lane' : 'none'
    return x >= this.kw && x < this.W - SB ? 'hscroll' : 'none'
  }

  private clampView(): void {
    const v = this.view
    v.ppt = Math.max(MIN_PPT, Math.min(MAX_PPT, v.ppt))
    v.rowH = Math.max(MIN_ROW, Math.min(MAX_ROW, v.rowH))
    v.x = Math.max(0, v.x)
    v.y = Math.max(0, Math.min(Math.max(0, this.rows.length * v.rowH - this.gridH()), v.y))
  }

  private hTotal(): number {
    const { patLen, timeSig } = this.info()
    return Math.max(patLen + barOf(timeSig) * 4, this.view.x + this.visTicks())
  }

  zoomH(factor: number, anchorX = this.kw + this.gridW() / 2): void {
    const t = this.tickAt(anchorX)
    this.view.ppt = Math.max(MIN_PPT, Math.min(MAX_PPT, this.view.ppt * factor))
    this.view.x = t - (anchorX - this.kw) / this.view.ppt
    this.clampView()
    this.invalidate()
  }

  zoomV(factor: number, anchorY = RULER_H + this.gridH() / 2): void {
    const cy = (this.contentY(anchorY)) / this.view.rowH
    this.view.rowH = Math.max(MIN_ROW, Math.min(MAX_ROW, this.view.rowH * factor))
    this.view.y = cy * this.view.rowH - (anchorY - RULER_H)
    this.clampView()
    this.invalidate()
  }

  zoomToRange(start: number, end: number): void {
    if (end <= start) return
    this.view.ppt = this.gridW() / (end - start)
    this.view.x = start
    this.clampView()
    this.view.x = start
    this.invalidate()
  }

  /** Shift+1..5 zoom presets. */
  zoomPreset(n: number): void {
    const { patLen } = this.info()
    if (n === 1) this.view.ppt = 40 / 24
    else if (n === 2) this.view.ppt = 16 / 24
    else if (n === 3) this.view.ppt = 6 / 24
    else if (n === 4) return this.zoomToRange(0, patLen)
    else if (n === 5) {
      const sp = ops.span(this.notes(), this.sel.size ? this.sel : null)
      if (sp) {
        this.zoomToRange(sp.start, sp.end)
        const keys = this.notes().filter((x) => !this.sel.size || this.sel.has(x.id)).map((x) => x.key)
        const mid = (Math.min(...keys) + Math.max(...keys)) / 2
        const r = this.rowIdx[Math.round(mid)]
        if (r >= 0) this.view.y = r * this.view.rowH - this.gridH() / 2
        this.clampView()
      }
      return
    }
    this.clampView()
    this.invalidate()
  }

  // ── hit testing ────────────────────────────────────────────────────────────
  hitNote(x: number, y: number, notes = this.notes()): { note: Note; edge: boolean } | null {
    const key = this.keyAt(y)
    const t = this.tickAt(x)
    const ppt = this.view.ppt
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]
      if (n.key !== key) continue
      const w = n.len * ppt
      const extra = Math.min(4, w * 0.25) / ppt
      if (t >= n.pos && t < n.pos + n.len + extra) {
        const edgeW = Math.max(3, Math.min(8, w * 0.3))
        return { note: n, edge: w >= 5 && this.xOf(n.pos + n.len) - x <= edgeW }
      }
    }
    return null
  }

  private ghostAt(x: number, y: number): { channelId: string; note: Note } | null {
    if (!usePR.getState().ghosts) return null
    const { p, patternId, channelId } = this.info()
    const pat = findPattern(p, patternId)
    if (!pat) return null
    const key = this.keyAt(y)
    const t = this.tickAt(x)
    for (const [cid, list] of Object.entries(pat.notes)) {
      if (cid === channelId) continue
      for (const n of list) if (n.key === key && t >= n.pos && t < n.pos + n.len) return { channelId: cid, note: n }
    }
    return null
  }

  private hint(text: string): void {
    useUI.getState().setHint(text)
  }

  private noteHint(n: Note): void {
    const ts = getProject().timeSig
    this.hint(`${this.keyLabel(n.key)} · ${formatTime(n.pos, ts)} · len ${Math.round(n.len)} ticks · vel ${Math.round(n.vel * 128)}${n.muted ? ' · muted' : ''}${n.slide ? ' · slide' : ''}${n.porta ? ' · porta' : ''}`)
  }

  // ── note creation ──────────────────────────────────────────────────────────
  private newNotes(pos: number, key: number, len?: number): Note[] {
    const pr = usePR.getState()
    const tpl = this.template
    const L = len ?? tpl.len ?? (this.grid() || 24)
    const ivs = pr.stamp ? (CHORDS[pr.stamp]?.iv ?? [0]) : [0]
    return ivs
      .map((iv) => key + iv)
      .filter((k) => k >= 0 && k <= MAX_KEY)
      .map((k) =>
        defaultNote({
          key: k,
          pos: Math.max(0, pos),
          len: Math.max(1, L),
          vel: tpl.vel,
          pan: tpl.pan,
          rel: tpl.rel,
          fine: tpl.fine,
          modX: tpl.modX,
          modY: tpl.modY,
          color: pr.colorGroup,
          slide: pr.slide,
          porta: pr.porta
        })
      )
  }

  private setTemplate(n: Note): void {
    this.template = { len: n.len, vel: n.vel, pan: n.pan, rel: n.rel, fine: n.fine, modX: n.modX, modY: n.modY }
  }

  // ── pointer input ──────────────────────────────────────────────────────────
  private local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
  }

  onPointerDown = (e: PointerEvent): void => {
    if (!this.canvas) return
    this.checkContext()
    const { x, y } = this.local(e)
    const now = performance.now()
    const dbl = now - this.lastDown.t < 320 && Math.abs(x - this.lastDown.x) < 5 && Math.abs(y - this.lastDown.y) < 5 && this.lastDown.button === e.button
    this.lastDown = dbl ? { t: 0, x, y, button: -1 } : { t: now, x, y, button: e.button }
    const region = this.region(x, y)
    this.canvas.setPointerCapture(e.pointerId)
    e.preventDefault()

    if (e.button === 1 || (e.button === 2 && e.shiftKey && (region === 'grid' || region === 'lane'))) {
      this.drag = { kind: 'pan', sx: x, sy: y, v0: { ...this.view } }
      this.canvas.style.cursor = 'grabbing'
      return
    }
    switch (region) {
      case 'grid':
        return this.gridDown(e, x, y, dbl)
      case 'keys':
        return this.keysDown(e, x, y)
      case 'ruler':
        return this.rulerDown(e, x, dbl)
      case 'lane':
        return this.laneDown(e, x, y)
      case 'split':
        this.drag = { kind: 'split', sy: y, h0: this.laneH() }
        return
      case 'hscroll':
        return this.hscrollDown(x)
      case 'vscroll':
        return this.vscrollDown(y)
    }
  }

  private gridDown(e: PointerEvent, x: number, y: number, dbl: boolean): void {
    const tool = useUI.getState().pianoRollTool
    const { channelId } = this.info()
    const t = this.tickAt(x)
    const key = this.keyAt(y)
    const hit = this.hitNote(x, y)
    const alt = e.altKey
    const grid = this.grid(alt)

    if (e.button === 2) {
      if (dbl) {
        const g = this.ghostAt(x, y)
        if (g && !hit) {
          useUI.getState().set({ pianoRollChannel: g.channelId })
          return
        }
      }
      if (e.ctrlKey) return this.zoomPreset(5)
      if (alt) {
        if (hit) audition(channelId, [hit.note], 300)
        return
      }
      if (tool === 'zoom') return this.zoomH(0.5, x)
      // right = delete (whole selection when clicking a selected note)
      this.preview = this.storeNotes()
      if (hit) {
        const del = this.sel.has(hit.note.id) ? this.sel : new Set([hit.note.id])
        this.preview = this.preview.filter((n) => !del.has(n.id))
        for (const id of del) this.sel.delete(id)
      }
      this.drag = { kind: 'erase', lx: x, ly: y }
      this.invalidate()
      return
    }
    if (e.button !== 0) return

    if (dbl && hit) {
      usePR.getState().set({ propsNote: hit.note.id })
      return
    }

    // Ctrl+drag = rubber band selection from any tool (Ctrl+Shift adds)
    if (e.ctrlKey || tool === 'select' && !(hit && this.sel.has(hit.note.id) && !e.shiftKey)) {
      const additive = e.shiftKey
      this.drag = { kind: 'rubber', t0: t, y0: this.contentY(y), t1: t, y1: this.contentY(y), base: additive ? new Set(this.sel) : new Set(), moved: false, clickHit: hit?.note ?? null, toggle: additive }
      return
    }

    switch (tool) {
      case 'draw':
      case 'paint':
      case 'paintDrum':
      case 'select': {
        if (hit) {
          this.setTemplate(hit.note)
          this.noteHint(hit.note)
          audition(channelId, [hit.note])
          if (hit.edge && !e.shiftKey && tool !== 'select') return this.startResize(hit.note)
          return this.startMove(hit.note, x, y, e.shiftKey && tool !== 'select', e.shiftKey)
        }
        if (tool === 'select') return
        const pos = snapFloor(t, grid)
        if (tool === 'paint' || tool === 'paintDrum') {
          const added = this.newNotes(pos, key)
          let base = this.storeNotes()
          if (e.shiftKey) base = base.filter((n) => !(n.pos < pos + added[0].len && n.pos + n.len > pos))
          this.preview = [...base, ...added]
          this.drag = { kind: 'paint', origin: pos, len: added[0]?.len ?? 24, slots: new Set([0]), mono: e.shiftKey, lastSlot: 0 }
          audition(channelId, added)
          this.invalidate()
          return
        }
        if (e.shiftKey) {
          // stretch mode: add and drag out the length
          const added = this.newNotes(pos, key, grid || 24)
          const base = this.storeNotes()
          this.preview = [...base, ...added]
          audition(channelId, added)
          this.drag = { kind: 'resize', anchor: added[0].id, ids: new Set(added.map((n) => n.id)), orig: new Map(added.map((n) => [n.id, n])), base, label: 'Add note' }
          this.invalidate()
          return
        }
        const added = this.newNotes(pos, key)
        if (!added.length) return
        const base = this.storeNotes()
        this.preview = [...base, ...added]
        audition(channelId, added)
        this.noteHint(added[0])
        this.drag = {
          kind: 'move',
          anchor: added[0].id,
          ids: new Set(added.map((n) => n.id)),
          orig: new Map(added.map((n) => [n.id, n])),
          base,
          offT: t - pos,
          startT: t,
          startRow: this.rowAt(y),
          shiftAtStart: e.shiftKey,
          hMoved: false,
          last: '0:0',
          label: 'Add note'
        }
        this.invalidate()
        return
      }
      case 'delete': {
        this.preview = this.storeNotes()
        if (hit) this.preview = this.preview.filter((n) => n.id !== hit.note.id)
        this.drag = { kind: 'erase', lx: x, ly: y }
        this.invalidate()
        return
      }
      case 'mute': {
        const value = hit ? !hit.note.muted : true
        this.preview = this.storeNotes()
        if (hit) this.preview = this.preview.map((n) => (n.id === hit.note.id ? { ...n, muted: value } : n))
        this.drag = { kind: 'mute', value, lx: x, ly: y }
        this.invalidate()
        return
      }
      case 'slice': {
        if (e.shiftKey) {
          // slice without dragging at the click point
          if (hit) {
            const st = snapRound(t, grid)
            const parts = ops.sliceNote(hit.note, st)
            if (parts) this.commit('Slice note', [...this.storeNotes().filter((n) => n.id !== hit.note.id), ...parts])
          }
          return
        }
        const cy = this.contentY(y)
        this.drag = { kind: 'slice', t0: t, y0: cy, t1: t, y1: cy, alt }
        this.invalidate()
        return
      }
      case 'zoom':
        this.drag = { kind: 'zoom', x0: x, x1: x }
        return
      case 'play': {
        this.drag = { kind: 'scrub', sounding: new Map() }
        this.scrubTo(x)
        return
      }
      default:
        return
    }
  }

  private startMove(n: Note, x: number, y: number, clone: boolean, shiftAtStart: boolean): void {
    const all = this.storeNotes()
    const group = this.sel.has(n.id) ? all.filter((m) => this.sel.has(m.id)) : [n]
    let base: Note[]
    let moving: Note[]
    let anchor = n.id
    if (clone) {
      this.selBeforeClone = new Set(this.sel)
      moving = group.map((m) => ({ ...m, id: uid() }))
      anchor = moving[group.findIndex((m) => m.id === n.id)].id
      base = all
      this.sel = new Set(moving.map((m) => m.id))
    } else {
      const ids = new Set(group.map((m) => m.id))
      moving = group
      base = all.filter((m) => !ids.has(m.id))
    }
    const t = this.tickAt(x)
    this.preview = [...base, ...moving]
    this.drag = {
      kind: 'move',
      anchor,
      ids: new Set(moving.map((m) => m.id)),
      orig: new Map(moving.map((m) => [m.id, m])),
      base,
      offT: t - n.pos,
      startT: t,
      startRow: this.rowAt(y),
      shiftAtStart,
      hMoved: false,
      last: '0:0',
      label: clone ? 'Clone notes' : group.length > 1 ? 'Move notes' : 'Move note'
    }
    if (clone) this.invalidate()
  }

  private startResize(n: Note): void {
    const all = this.storeNotes()
    const group = this.sel.has(n.id) ? all.filter((m) => this.sel.has(m.id)) : [n]
    const ids = new Set(group.map((m) => m.id))
    this.preview = all
    this.drag = { kind: 'resize', anchor: n.id, ids, orig: new Map(group.map((m) => [m.id, m])), base: all.filter((m) => !ids.has(m.id)), label: 'Resize notes' }
  }

  private keysDown(e: PointerEvent, x: number, y: number): void {
    const key = this.keyAt(y)
    const { channelId } = this.info()
    if (e.ctrlKey && e.button === 0) {
      // Ctrl+click a key: select all notes of that pitch (Shift adds)
      if (!e.shiftKey) this.sel.clear()
      for (const n of this.notes()) if (n.key === key) this.sel.add(n.id)
      this.invalidate()
      return
    }
    if (e.button !== 0 || !channelId) return
    // velocity from horizontal click position (like FL: further right = louder)
    const vel = Math.max(0.2, Math.min(1, x / this.kw))
    this.pressedKey = key
    this.drag = { kind: 'keys', key, id: noteOnAsync(channelId, key, vel) }
    this.hint(`${this.keyLabel(key)} (MIDI ${key})`)
    this.invalidate()
  }

  private rulerDown(e: PointerEvent, x: number, dbl: boolean): void {
    const t = this.tickAt(x)
    if (e.button === 2) {
      this.timeSel = null
      this.invalidate()
      return
    }
    if (e.button !== 0) return
    if (e.ctrlKey || dbl) {
      const a = Math.max(0, snapRound(t, this.grid(e.altKey)))
      this.drag = { kind: 'tsel', anchor: a }
      this.timeSel = null
      this.invalidate()
      return
    }
    this.drag = { kind: 'seek', last: -1 }
    this.seekTo(x, e.altKey)
  }

  private seekTo(x: number, alt: boolean): void {
    if (this.drag?.kind !== 'seek') return
    const tick = Math.max(0, snapFloor(this.tickAt(x), this.grid(alt)))
    if (tick === this.drag.last) return
    this.drag.last = tick
    const ts = getProject().timeSig
    this.hint(`Position ${formatTime(tick, ts)}`)
    if (useTransport.getState().mode === 'pattern') transport.seek(tick)
  }

  private laneValue(y: number): number {
    const top = this.laneTop() + 4
    const h = this.laneH() - 8
    return Math.max(0, Math.min(1, 1 - (y - top) / Math.max(1, h)))
  }

  private laneDown(e: PointerEvent, x: number, y: number): void {
    const lane = LANES[usePR.getState().lane]
    const v = this.laneValue(y)
    const all = this.storeNotes()
    if (e.button === 0 && e.altKey) {
      const hit = this.laneNotesBetween(all, x - 5, x + 5)
      if (hit.size) this.commit(`Reset ${lane.label.toLowerCase()}`, all.map((n) => (hit.has(n.id) ? lane.set(n, lane.def) : n)))
      return
    }
    const mode = e.button === 2 ? 'line' : e.button === 0 ? (e.shiftKey ? 'flat' : 'draw') : null
    if (!mode) return
    this.preview = all
    this.drag = { kind: 'lane', mode, lx: x, lv: v, sx: x, sv: v, base: all }
    this.laneMove(x, y)
  }

  /** Ids of notes (respecting the selection) whose lollipop x is within [x0, x1]. */
  private laneNotesBetween(notes: Note[], x0: number, x1: number): Set<string> {
    const lo = Math.min(x0, x1)
    const hi = Math.max(x0, x1)
    const out = new Set<string>()
    const useSel = this.sel.size > 0
    for (const n of notes) {
      if ((useSel && !this.sel.has(n.id)) || this.rowIdx[n.key] < 0) continue
      const nx = this.xOf(n.pos)
      if (nx >= lo && nx <= hi) out.add(n.id)
    }
    return out
  }

  private laneMove(x: number, y: number): void {
    const d = this.drag
    if (d?.kind !== 'lane') return
    const lane = LANES[usePR.getState().lane]
    const v = this.laneValue(y)
    const lerp = (x0: number, v0: number, x1: number, v1: number, nx: number) => (x1 === x0 ? v1 : v0 + ((v1 - v0) * (nx - x0)) / (x1 - x0))
    if (d.mode === 'draw') {
      const cur = this.preview ?? d.base
      const ids = this.laneNotesBetween(cur, Math.min(d.lx, x) - (d.lx === x ? 3 : 0), Math.max(d.lx, x) + (d.lx === x ? 3 : 0))
      if (ids.size) this.preview = cur.map((n) => (ids.has(n.id) ? lane.set(n, Math.max(0, Math.min(1, lerp(d.lx, d.lv, x, v, this.xOf(n.pos))))) : n))
      d.lx = x
      d.lv = v
    } else {
      const ids = this.laneNotesBetween(d.base, d.sx - (d.mode === 'flat' ? 0 : 0), x)
      this.preview = d.base.map((n) => {
        if (!ids.has(n.id)) return n
        const val = d.mode === 'flat' ? d.sv : lerp(d.sx, d.sv, x, v, this.xOf(n.pos))
        return lane.set(n, Math.max(0, Math.min(1, val)))
      })
    }
    const shown = d.mode === 'flat' ? d.sv : v
    const probe = lane.set(defaultNote(), shown)
    this.hint(`${lane.label}: ${lane.fmt(probe)}`)
    this.invalidate()
  }

  private hThumb(): { tx: number; tw: number; total: number } {
    const total = this.hTotal()
    const trackW = this.gridW()
    const visT = this.visTicks()
    const tw = Math.min(trackW, Math.max(16, (visT / total) * trackW))
    const tx = this.kw + (this.view.x / Math.max(1, total - visT)) * (trackW - tw)
    return { tx, tw, total }
  }

  private vThumb(): { ty: number; th: number } {
    const total = this.rows.length * this.view.rowH
    const trackH = this.gridH()
    const th = Math.max(16, Math.min(trackH, (trackH / total) * trackH))
    const maxY = Math.max(1, total - trackH)
    const ty = RULER_H + (this.view.y / maxY) * (trackH - th)
    return { ty, th }
  }

  private hscrollDown(x: number): void {
    const { tx, tw, total } = this.hThumb()
    if (x < tx || x > tx + tw) {
      // page
      this.view.x += (x < tx ? -1 : 1) * this.visTicks() * 0.9
      this.clampView()
      this.invalidate()
      return
    }
    const part = x - tx < 6 ? 'l' : tx + tw - x < 6 ? 'r' : 'move'
    this.drag = { kind: 'hthumb', part, sx: x, v0: { ...this.view }, total, tx, tw }
  }

  private vscrollDown(y: number): void {
    const { ty, th } = this.vThumb()
    if (y < ty || y > ty + th) {
      this.view.y += (y < ty ? -1 : 1) * this.gridH() * 0.9
      this.clampView()
      this.invalidate()
      return
    }
    const part = y - ty < 6 ? 't' : ty + th - y < 6 ? 'b' : 'move'
    this.drag = { kind: 'vthumb', part, sy: y, v0: { ...this.view }, ty, th }
  }

  onPointerMove = (e: PointerEvent): void => {
    if (!this.canvas) return
    const { x, y } = this.local(e)
    this.hover = { x, y }
    const d = this.drag
    if (!d) return this.hoverAt(x, y)
    const ts = getProject().timeSig
    switch (d.kind) {
      case 'move':
        return this.moveDrag(d, e, x, y)
      case 'resize': {
        const a = d.orig.get(d.anchor)!
        const grid = this.grid(e.altKey)
        const end = Math.max(a.pos + 1, snapRound(this.tickAt(x), grid))
        const dl = end - (a.pos + a.len)
        const resized = [...d.orig.values()].map((o) => ({ ...o, len: Math.max(grid > 0 ? Math.min(grid, o.len) : 1, o.len + dl) }))
        this.preview = [...d.base, ...resized]
        const an = resized.find((n) => n.id === d.anchor)!
        this.template.len = an.len
        this.hint(`${this.keyLabel(an.key)} length: ${an.len} ticks (${(an.len / 24).toFixed(2)} steps)`)
        this.invalidate()
        return
      }
      case 'erase':
      case 'mute': {
        const cur = this.preview ?? this.storeNotes()
        const touched = new Set<string>()
        const steps = Math.max(1, Math.ceil(Math.hypot(x - d.lx, y - d.ly) / 3))
        for (let i = 1; i <= steps; i++) {
          const px = d.lx + ((x - d.lx) * i) / steps
          const py = d.ly + ((y - d.ly) * i) / steps
          const h = this.hitNote(px, py, cur)
          if (h) touched.add(h.note.id)
        }
        d.lx = x
        d.ly = y
        if (touched.size) {
          if (d.kind === 'erase') {
            this.preview = cur.filter((n) => !touched.has(n.id))
            for (const id of touched) this.sel.delete(id)
          } else this.preview = cur.map((n) => (touched.has(n.id) && n.muted !== d.value ? { ...n, muted: d.value } : n))
          this.invalidate()
        }
        return
      }
      case 'paint': {
        const t = this.tickAt(x)
        const slot = Math.floor((t - d.origin) / d.len)
        if (slot === d.lastSlot) return
        const key = this.keyAt(y)
        const from = Math.min(slot, d.lastSlot)
        const to = Math.max(slot, d.lastSlot)
        let cur = this.preview ?? this.storeNotes()
        const added: Note[] = []
        for (let s = from; s <= to; s++) {
          if (d.slots.has(s)) continue
          const pos = d.origin + s * d.len
          if (pos < 0) continue
          d.slots.add(s)
          const nn = this.newNotes(pos, key, d.len)
          if (d.mono) cur = cur.filter((n) => !(n.pos < pos + d.len && n.pos + n.len > pos))
          added.push(...nn)
        }
        d.lastSlot = slot
        if (added.length) {
          this.preview = [...cur, ...added]
          audition(this.info().channelId, added.filter((n) => n.pos === added[added.length - 1].pos), 120)
          this.invalidate()
        }
        return
      }
      case 'rubber': {
        d.t1 = this.tickAt(x)
        d.y1 = this.contentY(y)
        if (Math.abs(this.xOf(d.t1) - this.xOf(d.t0)) > 3 || Math.abs(d.y1 - d.y0) > 3) d.moved = true
        if (d.moved) {
          const t0 = Math.min(d.t0, d.t1)
          const t1 = Math.max(d.t0, d.t1)
          const r0 = Math.floor(Math.min(d.y0, d.y1) / this.view.rowH)
          const r1 = Math.floor(Math.max(d.y0, d.y1) / this.view.rowH)
          const s = new Set(d.base)
          for (const n of this.notes()) {
            const ri = this.rowIdx[n.key]
            if (ri >= r0 && ri <= r1 && n.pos < t1 && n.pos + n.len > t0) s.add(n.id)
          }
          this.sel = s
          this.hint(`${s.size} note${s.size === 1 ? '' : 's'} selected`)
        }
        this.invalidate()
        return
      }
      case 'slice':
        d.t1 = this.tickAt(x)
        d.y1 = this.contentY(y)
        this.invalidate()
        return
      case 'zoom':
        d.x1 = x
        this.invalidate()
        return
      case 'scrub':
        return this.scrubTo(x)
      case 'pan':
        this.view.x = d.v0.x - (x - d.sx) / this.view.ppt
        this.view.y = d.v0.y - (y - d.sy)
        this.clampView()
        this.invalidate()
        return
      case 'seek':
        return this.seekTo(x, e.altKey)
      case 'tsel': {
        const b = Math.max(0, snapRound(this.tickAt(x), this.grid(e.altKey)))
        const start = Math.min(d.anchor, b)
        const end = Math.max(d.anchor, b)
        this.timeSel = end > start ? { start, end } : null
        if (this.timeSel) {
          this.sel = new Set(ops.notesInRange(this.notes(), start, end).map((n) => n.id))
          this.hint(`Time selection ${formatTime(start, ts)} – ${formatTime(end, ts)}`)
        }
        this.invalidate()
        return
      }
      case 'keys': {
        const key = this.keyAt(y)
        if (key === d.key) return
        const { channelId } = this.info()
        if (!channelId) return
        noteOffAsync(channelId, d.key, d.id)
        d.key = key
        d.id = noteOnAsync(channelId, key, Math.max(0.2, Math.min(1, x / this.kw)))
        this.pressedKey = key
        this.hint(`${this.keyLabel(key)} (MIDI ${key})`)
        this.invalidate()
        return
      }
      case 'lane':
        return this.laneMove(x, y)
      case 'hthumb': {
        const trackW = this.gridW()
        const dx = x - d.sx
        if (d.part === 'move') this.view.x = d.v0.x + (dx / Math.max(1, trackW - d.tw)) * Math.max(0, d.total - trackW / d.v0.ppt)
        else {
          const visT0 = d.v0.ppt > 0 ? trackW / d.v0.ppt : 1
          const tw = Math.max(8, d.part === 'r' ? d.tw + dx : d.tw - dx)
          const visT = (tw / d.tw) * visT0
          this.view.ppt = Math.max(MIN_PPT, Math.min(MAX_PPT, trackW / visT))
          if (d.part === 'l') this.view.x = d.v0.x + visT0 - trackW / this.view.ppt
        }
        this.clampView()
        this.invalidate()
        return
      }
      case 'vthumb': {
        const trackH = this.gridH()
        const dy = y - d.sy
        if (d.part === 'move') {
          const total = this.rows.length * d.v0.rowH
          this.view.y = d.v0.y + (dy / Math.max(1, trackH - d.th)) * Math.max(0, total - trackH)
        } else {
          const th = Math.max(8, d.part === 'b' ? d.th + dy : d.th - dy)
          const rowsVisible = (th / trackH) * this.rows.length
          const centerKey = (d.v0.y + trackH / 2) / d.v0.rowH
          this.view.rowH = Math.max(MIN_ROW, Math.min(MAX_ROW, trackH / rowsVisible))
          this.view.y = centerKey * this.view.rowH - trackH / 2
        }
        this.clampView()
        this.invalidate()
        return
      }
      case 'split': {
        const h = d.h0 - (y - d.sy)
        usePR.getState().set({ laneH: Math.max(0, Math.min(this.H - RULER_H - SB - SPLIT - 40, h)) })
        return
      }
    }
  }

  private moveDrag(d: Extract<Drag, { kind: 'move' }>, e: PointerEvent, x: number, y: number): void {
    const grid = this.grid(e.altKey)
    const a = d.orig.get(d.anchor)!
    const t = this.tickAt(x)
    if (!d.hMoved && Math.abs(t - d.startT) >= Math.max(grid / 2, 2 / this.view.ppt)) d.hMoved = true
    let dt = d.hMoved ? snapRound(t - d.offT, grid) - a.pos : 0
    // vertical movement works in row space (rows = keys in piano view, named keys in drum view)
    let dk = this.rowAt(y) - d.startRow
    if (e.shiftKey && !d.shiftAtStart) dk = 0 // Shift while dragging: lock pitch
    if (e.ctrlKey) dt = 0 // Ctrl while dragging: lock time
    let minPos = Infinity
    let minRow = Infinity
    let maxRow = -Infinity
    for (const o of d.orig.values()) {
      minPos = Math.min(minPos, o.pos)
      const r = this.rowIdx[o.key]
      if (r < 0) continue
      minRow = Math.min(minRow, r)
      maxRow = Math.max(maxRow, r)
    }
    dt = Math.max(-minPos, dt)
    if (minRow === Infinity) dk = 0
    else dk = Math.max(-minRow, Math.min(this.rows.length - 1 - maxRow, dk))
    const sig = `${dt}:${dk}`
    if (sig === d.last && this.preview) return
    const prevDk = Number(d.last.split(':')[1])
    d.last = sig
    const moved = [...d.orig.values()].map((o) => {
      if (dt === 0 && dk === 0) return o
      const r = this.rowIdx[o.key]
      return { ...o, pos: o.pos + dt, key: r < 0 ? o.key : this.rows[r + dk] }
    })
    this.preview = [...d.base, ...moved]
    const an = moved.find((n) => n.id === d.anchor)!
    if (dk !== prevDk) audition(this.info().channelId, moved.length <= 4 ? moved : [an], 160)
    this.noteHint(an)
    this.invalidate()
  }

  private scrubTo(x: number): void {
    const d = this.drag
    if (d?.kind !== 'scrub') return
    const { channelId } = this.info()
    const t = this.tickAt(x)
    this.scrubX = x
    if (!channelId) return
    const now = new Map<string, Note>()
    for (const n of this.notes()) if (!n.muted && n.pos <= t && n.pos + n.len > t) now.set(n.id, n)
    for (const [id, p] of d.sounding) {
      if (!now.has(id)) {
        const n = this.notes().find((m) => m.id === id)
        if (n) noteOffAsync(channelId, n.key, p)
        d.sounding.delete(id)
      }
    }
    for (const [id, n] of now) if (!d.sounding.has(id)) d.sounding.set(id, noteOnAsync(channelId, n.key, n.vel, n))
    this.hint(`Playback ${formatTime(Math.max(0, t), getProject().timeSig)}`)
    this.requestFrame()
  }

  onPointerUp = (e: PointerEvent): void => {
    const d = this.drag
    this.drag = null
    if (this.canvas?.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId)
    if (!d) return
    const { channelId } = this.info()
    switch (d.kind) {
      case 'move':
        if (d.last === '0:0' && d.label !== 'Add note') {
          // nothing moved: no edit (a Shift+click without dragging doesn't leave stacked clones)
          this.preview = null
          if (d.label === 'Clone notes' && this.selBeforeClone) this.sel = this.selBeforeClone
        } else this.commit(d.label)
        this.selBeforeClone = null
        break
      case 'resize':
        this.commit(d.label)
        break
      case 'erase':
        this.commit('Delete notes')
        break
      case 'mute':
        this.commit(d.value ? 'Mute notes' : 'Unmute notes')
        break
      case 'paint':
        this.commit('Paint notes')
        break
      case 'rubber':
        if (!d.moved) {
          if (d.clickHit) {
            if (d.toggle) {
              if (this.sel.has(d.clickHit.id)) this.sel.delete(d.clickHit.id)
              else this.sel.add(d.clickHit.id)
            } else this.sel = new Set([d.clickHit.id])
          } else if (!d.toggle) this.sel.clear()
        }
        break
      case 'slice':
        this.finishSlice(d)
        break
      case 'zoom': {
        if (Math.abs(d.x1 - d.x0) > 4) this.zoomToRange(this.tickAt(Math.min(d.x0, d.x1)), this.tickAt(Math.max(d.x0, d.x1)))
        else this.zoomH(0.5, d.x0)
        break
      }
      case 'scrub':
        if (channelId) {
          const notes = this.notes()
          for (const [id, p] of d.sounding) {
            const n = notes.find((m) => m.id === id)
            if (n) noteOffAsync(channelId, n.key, p)
          }
        }
        this.scrubX = null
        break
      case 'keys':
        if (channelId) noteOffAsync(channelId, d.key, d.id)
        this.pressedKey = null
        break
      case 'lane':
        this.commit(`Edit ${LANES[usePR.getState().lane].label.toLowerCase()}`)
        break
      case 'pan':
        if (this.canvas) this.canvas.style.cursor = ''
        break
    }
    this.invalidate()
  }

  private finishSlice(d: Extract<Drag, { kind: 'slice' }>): void {
    const grid = this.grid(d.alt)
    const rowH = this.view.rowH
    const notes = this.storeNotes()
    const y0 = Math.min(d.y0, d.y1)
    const y1 = Math.max(d.y0, d.y1)
    const single = Math.abs(d.y1 - d.y0) < rowH / 2
    const out: Note[] = []
    let changed = false
    for (const n of notes) {
      const ri = this.rowIdx[n.key]
      const cy = ri * rowH + rowH / 2
      const inRow = ri >= 0 && (single ? Math.floor(d.y0 / rowH) === ri : cy >= y0 && cy <= y1)
      if (!inRow) {
        out.push(n)
        continue
      }
      const f = single ? 0 : (cy - d.y0) / (d.y1 - d.y0)
      const t = snapRound(d.t0 + (d.t1 - d.t0) * f, grid)
      const parts = ops.sliceNote(n, t)
      if (parts) {
        out.push(...parts)
        changed = true
      } else out.push(n)
    }
    if (changed) this.commit('Slice notes', out)
  }

  onPointerLeave = (): void => {
    this.hover = null
    if (!this.drag) this.invalidate()
  }

  onDoubleClick = (_e: MouseEvent): void => {
    /* handled in pointerdown */
  }

  private hoverAt(x: number, y: number): void {
    const region = this.region(x, y)
    const c = this.canvas!
    let cursor = 'default'
    const tool = useUI.getState().pianoRollTool
    const ts = getProject().timeSig
    if (region === 'grid') {
      const hit = this.hitNote(x, y)
      if (hit) {
        this.noteHint(hit.note)
        if (tool === 'draw' || tool === 'paint' || tool === 'paintDrum') cursor = hit.edge ? 'ew-resize' : 'move'
        else if (tool === 'delete') cursor = 'not-allowed'
        else cursor = 'pointer'
      } else {
        this.hint(`${this.keyLabel(this.keyAt(y))} · ${formatTime(Math.max(0, this.tickAt(x)), ts)}`)
        cursor = tool === 'zoom' ? 'zoom-in' : tool === 'slice' ? 'col-resize' : tool === 'select' ? 'crosshair' : tool === 'play' ? 'text' : 'crosshair'
      }
    } else if (region === 'keys') {
      cursor = 'pointer'
      this.hint(`${this.keyLabel(this.keyAt(y))} – click to preview, Ctrl+click to select notes of this key`)
    } else if (region === 'ruler') {
      cursor = 'pointer'
      this.hint(`Bar ${formatTime(Math.max(0, this.tickAt(x)), ts)} – click to move playback position, Ctrl+drag / double-click drag: time selection`)
    } else if (region === 'split') cursor = 'ns-resize'
    else if (region === 'lane') {
      cursor = 'crosshair'
      const lane = LANES[usePR.getState().lane]
      const notes = this.notes()
      const near = notes.find((n) => Math.abs(this.xOf(n.pos) - x) < 4 && (!this.sel.size || this.sel.has(n.id)))
      this.hint(near ? `${this.keyLabel(near.key)} ${lane.label}: ${lane.fmt(near)}` : `${lane.label} – drag to draw, right-drag: line, Shift: flat, Alt+click: reset`)
    } else if (region === 'hscroll') {
      const { tx, tw } = this.hThumb()
      cursor = x >= tx && x <= tx + tw && (x - tx < 6 || tx + tw - x < 6) ? 'ew-resize' : 'default'
    } else if (region === 'vscroll') {
      const { ty, th } = this.vThumb()
      cursor = y >= ty && y <= ty + th && (y - ty < 6 || ty + th - y < 6) ? 'ns-resize' : 'default'
    }
    c.style.cursor = cursor
    if (region === 'grid' || region === 'keys') this.invalidate() // hover row highlight
  }

  private onWheel(e: WheelEvent): void {
    const { x, y } = this.local(e)
    const region = this.region(x, y)
    if (region === 'none' || region === 'corner') return
    e.preventDefault()
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
    const dy = e.deltaY * scale
    const dx = e.deltaX * scale
    const dir = dy > 0 ? -1 : dy < 0 ? 1 : 0
    const ctrl = e.ctrlKey || e.metaKey

    if (e.altKey && (region === 'grid' || region === 'lane') && dir) {
      if (region === 'grid' && e.shiftKey) {
        // Shift+Alt+wheel: nudge notes under the mouse (or the selection)
        const hit = this.hitNote(x, y)
        if (!hit) return
        const ids = this.sel.has(hit.note.id) ? this.sel : new Set([hit.note.id])
        const amt = ctrl ? 1 : this.grid() || 1
        this.apply('Nudge notes', (notes) => ops.nudge(notes, ids, dir * amt), 'pr-wheel-nudge')
        return
      }
      const laneT = region === 'lane' ? usePR.getState().lane : 'vel'
      const lane = LANES[laneT]
      let ids: Set<string>
      if (region === 'grid') {
        const hit = this.hitNote(x, y)
        if (!hit) return
        ids = this.sel.has(hit.note.id) ? new Set(this.sel) : new Set([hit.note.id])
      } else ids = this.laneNotesBetween(this.storeNotes(), x - 5, x + 5)
      if (!ids.size) return
      const step = ctrl ? 1 / 256 : 4 / 128
      this.apply(`Change ${lane.label.toLowerCase()}`, (notes) => notes.map((n) => (ids.has(n.id) ? lane.set(n, Math.max(0, Math.min(1, lane.get(n) + dir * step))) : n)), `pr-wheel-${laneT}`)
      const n = this.storeNotes().find((m) => ids.has(m.id))
      if (n) this.hint(`${this.keyLabel(n.key)} ${lane.label}: ${lane.fmt(n)}`)
      return
    }
    if (ctrl) {
      if (region === 'keys' || region === 'vscroll') this.zoomV(dy < 0 ? 1.15 : 1 / 1.15, y)
      else this.zoomH(dy < 0 ? 1.2 : 1 / 1.2, Math.max(this.kw, x))
      return
    }
    if (region === 'ruler') {
      this.zoomH(dy < 0 ? 1.2 : 1 / 1.2, x)
      return
    }
    if (e.shiftKey || region === 'hscroll' || region === 'lane') {
      this.view.x += (dy || dx) / this.view.ppt
    } else {
      this.view.y += dy
      if (dx) this.view.x += dx / this.view.ppt
    }
    this.clampView()
    this.invalidate()
  }

  // ── keyboard ───────────────────────────────────────────────────────────────
  handleKey = (e: KeyboardEvent): boolean => {
    this.checkContext()
    const ui = useUI.getState()
    const pr = usePR.getState()
    const ctrl = e.ctrlKey || e.metaKey
    const shift = e.shiftKey
    const alt = e.altKey
    const single = !ctrl && !alt && !shift && !ui.typingKeyboard
    const code = e.code
    const ids = (): Set<string> | null => (this.sel.size ? this.sel : null)
    const gridOrStep = () => this.grid() || 24

    // tools (single letters, only when the typing keyboard is off)
    const TOOLS: Record<string, import('@/store/ui').Tool> = { KeyP: 'draw', KeyB: 'paint', KeyD: 'delete', KeyT: 'mute', KeyC: 'slice', KeyE: 'select', KeyZ: 'zoom', KeyY: 'play' }
    if (single && TOOLS[code]) {
      ui.set({ pianoRollTool: TOOLS[code] })
      this.hint(`Tool: ${TOOLS[code]}`)
      return true
    }
    if (single && code === 'KeyS') {
      pr.set({ slide: !pr.slide })
      this.hint(`Slide ${!pr.slide ? 'on' : 'off'}`)
      return true
    }
    if (single && code === 'KeyM') {
      this.toggleDrumView()
      return true
    }
    if (single && code === 'KeyO') {
      pr.set({ porta: !pr.porta })
      this.hint(`Portamento ${!pr.porta ? 'on' : 'off'}`)
      return true
    }
    if (!ctrl && !alt && !ui.typingKeyboard && code === 'KeyF') {
      const i = LANE_ORDER.indexOf(pr.lane)
      const next = LANE_ORDER[(i + (shift ? LANE_ORDER.length - 1 : 1)) % LANE_ORDER.length]
      pr.set({ lane: next })
      this.hint(`Event editor: ${LANES[next].label}`)
      return true
    }
    if (single && (code === 'KeyG' || code === 'KeyK' || code === 'KeyH' || code === 'KeyJ')) {
      const { p, patternId, channelId } = this.info()
      const pat = findPattern(p, patternId)
      const withNotes = code === 'KeyH' || code === 'KeyJ'
      const list = p.channels.filter((c) => !withNotes || c.id === channelId || (pat?.notes[c.id]?.length ?? 0) > 0)
      const i = list.findIndex((c) => c.id === channelId)
      const dir = code === 'KeyG' || code === 'KeyH' ? -1 : 1
      const next = list[(i + dir + list.length) % list.length]
      if (next) ui.set({ pianoRollChannel: next.id, selectedChannels: [next.id] })
      return true
    }
    if (!ctrl && !alt && code === 'Backspace') {
      if (pr.snap !== 'none') {
        this.prevSnap = pr.snap
        pr.set({ snap: 'none' })
      } else pr.set({ snap: this.prevSnap === 'none' ? 'main' : this.prevSnap })
      this.hint(`Snap ${usePR.getState().snap === 'none' ? 'off' : 'on'}`)
      return true
    }
    if (!ctrl && !alt && !shift && code === 'Delete') {
      if (!this.sel.size) return true
      const del = new Set(this.sel)
      this.sel.clear()
      this.apply('Delete notes', (n) => n.filter((m) => !del.has(m.id)))
      return true
    }
    if (ctrl && !shift && !alt) {
      switch (code) {
        case 'KeyA':
          this.sel = new Set(this.storeNotes().map((n) => n.id))
          this.invalidate()
          return true
        case 'KeyD':
          this.sel.clear()
          this.timeSel = null
          this.invalidate()
          return true
        case 'KeyC':
        case 'KeyX': {
          const s = ids()
          clipboard = this.storeNotes().filter((n) => !s || s.has(n.id)).map((n) => ({ ...n }))
          this.hint(`${clipboard.length} notes copied`)
          if (code === 'KeyX' && clipboard.length) {
            const del = new Set(clipboard.map((n) => n.id))
            this.sel.clear()
            this.apply('Cut notes', (n) => n.filter((m) => !del.has(m.id)))
          }
          return true
        }
        case 'KeyV': {
          if (!clipboard.length) return true
          const minPos = Math.min(...clipboard.map((n) => n.pos))
          const offset = this.timeSel ? this.timeSel.start - minPos : 0
          const pasted = clipboard.map((n) => ({ ...n, id: uid(), pos: n.pos + offset }))
          this.sel = new Set(pasted.map((n) => n.id))
          this.apply('Paste notes', (n) => [...n, ...pasted])
          return true
        }
        case 'KeyB': {
          const notes = this.storeNotes()
          let target: Set<string> | null = ids()
          let offset: number
          if (this.timeSel) {
            offset = this.timeSel.end - this.timeSel.start
            if (!target) target = new Set(ops.notesInRange(notes, this.timeSel.start, this.timeSel.end).map((n) => n.id))
            this.timeSel = { start: this.timeSel.end, end: this.timeSel.end + offset }
          } else {
            const sp = ops.span(notes, target)
            if (!sp) return true
            const g = this.grid() || 24
            offset = Math.max(g, snapCeil(sp.end - sp.start, g))
            // FL aligns to the grid: duplicate starts at the next grid line after the selection
            offset = snapCeil(sp.start + offset, g) - sp.start
          }
          if (!target || !target.size) target = new Set(notes.map((n) => n.id))
          const res = ops.duplicate(notes, target, offset)
          this.sel = res.ids
          this.apply('Duplicate notes', () => res.notes)
          return true
        }
        case 'ArrowUp':
        case 'ArrowDown':
          this.apply('Transpose octave', (n, s) => ops.transpose(n, s, code === 'ArrowUp' ? 12 : -12), 'pr-transpose')
          return true
        case 'KeyQ':
          this.apply('Quick quantize', (n, s) => ops.quantizeStarts(n, s, gridOrStep()))
          return true
        case 'KeyL':
          this.apply('Quick legato', (n, s) => ops.legato(n, s))
          return true
        case 'KeyG':
          this.apply('Glue notes', (n, s) => ops.glue(n, s))
          return true
        case 'KeyU':
          this.apply('Quick chop', (n, s) => ops.chop(n, s, gridOrStep()))
          return true
      }
    }
    if (shift && !ctrl && !alt) {
      switch (code) {
        case 'ArrowUp':
        case 'ArrowDown':
          this.apply('Transpose', (n, s) => ops.transpose(n, s, code === 'ArrowUp' ? 1 : -1), 'pr-transpose')
          return true
        case 'ArrowLeft':
        case 'ArrowRight':
          this.apply('Move notes', (n, s) => ops.nudge(n, s, (code === 'ArrowRight' ? 1 : -1) * gridOrStep()), 'pr-nudge')
          return true
        case 'KeyI': {
          const all = this.storeNotes()
          this.sel = new Set(all.filter((n) => !this.sel.has(n.id)).map((n) => n.id))
          this.invalidate()
          return true
        }
        case 'KeyC': {
          const notes = this.storeNotes()
          const colors = this.sel.size ? new Set(notes.filter((n) => this.sel.has(n.id)).map((n) => n.color)) : new Set([pr.colorGroup])
          this.sel = new Set(notes.filter((n) => colors.has(n.color)).map((n) => n.id))
          this.invalidate()
          return true
        }
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Digit4':
        case 'Digit5':
          this.zoomPreset(Number(code.slice(5)))
          return true
      }
    }
    if (alt && !ctrl) {
      switch (code) {
        case 'KeyV':
          pr.set({ ghosts: !pr.ghosts })
          this.hint(`Ghost notes ${!pr.ghosts ? 'on' : 'off'}`)
          return true
        case 'KeyM':
          this.apply(shift ? 'Unmute notes' : 'Mute notes', (n, s) => ops.setProp(n, s, 'muted', !shift))
          return true
        case 'KeyC':
          if (shift) return false
          this.apply('Change note color', (n, s) => ops.setProp(n, s, 'color', pr.colorGroup))
          return true
        case 'KeyQ':
          this.apply('Quantize', (n, s) => ops.quantizeStarts(n, s, gridOrStep()))
          return true
        case 'ArrowLeft':
        case 'ArrowRight':
          this.apply('Nudge notes', (n, s) => ops.nudge(n, s, code === 'ArrowRight' ? 1 : -1), 'pr-nudge')
          return true
        case 'ArrowUp':
        case 'ArrowDown':
          this.apply('Transpose', (n, s) => ops.transpose(n, s, code === 'ArrowUp' ? 1 : -1), 'pr-transpose')
          return true
      }
    }
    if (ctrl && alt && code === 'KeyQ') {
      this.apply('Quick quantize', (n, s) => ops.quantizeStarts(n, s, gridOrStep()))
      return true
    }
    if (!ctrl && !alt && (code === 'PageUp' || code === 'PageDown')) {
      this.zoomH(code === 'PageUp' ? 1.25 : 0.8)
      return true
    }
    return false
  }

  // ── rendering ──────────────────────────────────────────────────────────────
  private draw(): void {
    const ctx = this.ctx
    if (!ctx || !this.canvas || !this.base || this.W < 2) return
    this.checkContext()
    if (this.baseDirty) {
      this.baseDirty = false
      const b = this.base.getContext('2d')!
      b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      this.drawBase(b)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(this.base, 0, 0)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.drawOverlay(ctx)
  }

  /** Playhead tick inside this pattern, or null if the transport isn't on it. */
  private patternTick(): number | null {
    const t = useTransport.getState()
    const { p, patternId, patLen } = this.info()
    const tick = playhead.tick
    if (t.mode === 'pattern') return tick
    for (const c of p.playlist.clips) {
      if (c.kind === 'pattern' && c.ref === patternId && tick >= c.start && tick < c.start + c.length) return (tick - c.start + c.offset) % Math.max(1, patLen)
    }
    return null
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    const tick = this.patternTick()
    const gb = this.gridBottom()
    const playing = useTransport.getState().playing
    if (tick !== null) {
      let x = this.xOf(tick)
      // page-follow while playing (only when the playhead naturally leaves the view)
      if (playing && !this.drag && this.phVisible && (x > this.W - SB || x < this.kw)) {
        this.view.x = Math.max(0, x < this.kw ? tick : tick)
        this.clampView()
        this.invalidate()
        x = this.xOf(tick)
      }
      this.phVisible = x >= this.kw && x <= this.W - SB
      if (this.phVisible) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(this.kw, 0, this.gridW(), this.H)
        ctx.clip()
        ctx.fillStyle = this.C.playhead
        ctx.globalAlpha = 0.9
        ctx.fillRect(Math.round(x), RULER_H, 1, gb - RULER_H)
        ctx.globalAlpha = 0.45
        ctx.fillRect(Math.round(x), this.laneTop(), 1, this.laneH())
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.moveTo(x - 6, RULER_H - 11)
        ctx.lineTo(x + 6, RULER_H - 11)
        ctx.lineTo(x, RULER_H - 2)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
    } else this.phVisible = false
    if (this.scrubX !== null) {
      ctx.fillStyle = '#ffd36b'
      ctx.fillRect(Math.round(this.scrubX), RULER_H, 1, gb - RULER_H)
    }
  }

  private noteFill(base: string, vel: number, selected: boolean, muted: boolean): string {
    const vb = Math.round(Math.max(0, Math.min(1, vel)) * 16)
    const k = `${base}|${vb}|${selected ? 1 : 0}|${muted ? 1 : 0}`
    let c = this.colors.get(k)
    if (!c) {
      const col = muted ? '#7c878c' : selected ? this.C.sel : base
      c = mix(col, '#1a2226', (1 - vb / 16) * 0.55)
      this.colors.set(k, c)
    }
    return c
  }

  private drawBase(g: CanvasRenderingContext2D): void {
    const { p, patternId, channelId, timeSig, patLen } = this.info()
    const pr = usePR.getState()
    const W = this.W
    const H = this.H
    const v = this.view
    const gb = this.gridBottom()
    const gw = this.gridW()
    const rowH = v.rowH
    const ppt = v.ppt
    const bar = barOf(timeSig)
    const beat = beatOf(timeSig)
    const lineT = gridLineTicks(ppt, timeSig)
    const t0 = v.x
    const t1 = this.tickAt(W - SB)
    const notes = this.notes()
    const hoverKey = this.hover && (this.region(this.hover.x, this.hover.y) === 'grid' || this.region(this.hover.x, this.hover.y) === 'keys') ? this.keyAt(this.hover.y) : null

    g.clearRect(0, 0, W, H)
    g.font = '10px "Segoe UI", "Noto Sans", Ubuntu, sans-serif'
    g.textBaseline = 'middle'

    // ── grid ──
    g.save()
    g.beginPath()
    g.rect(this.kw, RULER_H, gw, gb - RULER_H)
    g.clip()
    const r0 = this.rowAt(RULER_H)
    const r1 = this.rowAt(gb - 1)
    const scaleOn = pr.scale !== 'none' && !this.drum
    for (let r = r0; r <= r1; r++) {
      const k = this.rows[r]
      const y = this.yOf(k)
      let fill = this.drum ? (r % 2 ? this.C.bg2 : this.C.bg) : isBlack(k) ? this.C.bg2 : this.C.bg
      if (scaleOn) fill = inScale(k, pr.scaleRoot, pr.scale) ? (isBlack(k) ? '#34434b' : '#3a4a52') : '#283238'
      g.fillStyle = fill
      g.fillRect(this.kw, y, gw, rowH)
      if (scaleOn && (((k - pr.scaleRoot) % 12) + 12) % 12 === 0) {
        g.fillStyle = 'rgba(247,154,46,0.07)'
        g.fillRect(this.kw, y, gw, rowH)
      }
      const nm = this.names?.[k]
      if (nm) {
        g.fillStyle = groupColor(nm.group)
        g.globalAlpha = 0.06
        g.fillRect(this.kw, y, gw, rowH)
        g.globalAlpha = 1
      }
      if (k === hoverKey) {
        g.fillStyle = 'rgba(255,255,255,0.045)'
        g.fillRect(this.kw, y, gw, rowH)
      }
      // row separator (octave line stronger)
      const nextNm = this.drum ? this.names?.[this.rows[r + 1]] : undefined
      g.fillStyle = (!this.drum && k % 12 === 0) || (this.drum && nextNm?.group !== nm?.group) ? '#1f292e' : 'rgba(30,40,45,0.55)'
      g.fillRect(this.kw, y + rowH - 1, gw, 1)
    }
    // alternating bar shading
    for (let b = Math.floor(t0 / bar); b * bar < t1; b++) {
      if (b % 2 === 1) {
        g.fillStyle = 'rgba(0,0,0,0.07)'
        g.fillRect(this.xOf(b * bar), RULER_H, bar * ppt, gb - RULER_H)
      }
    }
    // vertical lines
    for (let t = Math.floor(t0 / lineT) * lineT; t <= t1; t += lineT) {
      const x = Math.round(this.xOf(t))
      if (t % bar === 0) g.fillStyle = this.C.bar
      else if (t % beat === 0) g.fillStyle = this.C.beat
      else g.fillStyle = this.C.line
      g.fillRect(x, RULER_H, t % bar === 0 ? 2 : 1, gb - RULER_H)
    }
    // beyond pattern end
    const xe = this.xOf(patLen)
    if (xe < W - SB) {
      g.fillStyle = 'rgba(10,14,16,0.22)'
      g.fillRect(Math.max(this.kw, xe), RULER_H, W - SB - Math.max(this.kw, xe), gb - RULER_H)
    }
    // time selection
    if (this.timeSel) {
      g.fillStyle = 'rgba(255,120,100,0.10)'
      g.fillRect(this.xOf(this.timeSel.start), RULER_H, (this.timeSel.end - this.timeSel.start) * ppt, gb - RULER_H)
    }

    // ghost notes
    const pat = findPattern(p, patternId)
    if (pr.ghosts && pat) {
      for (const [cid, list] of Object.entries(pat.notes)) {
        if (cid === channelId || !list.length) continue
        g.fillStyle = 'rgba(205,225,215,0.13)'
        g.strokeStyle = 'rgba(205,225,215,0.28)'
        g.lineWidth = 1
        for (const n of list) {
          const ri = this.rowIdx[n.key]
          if (n.pos > t1 || n.pos + n.len < t0 || ri < r0 || ri > r1) continue
          const x = this.xOf(n.pos)
          const y = this.yOf(n.key)
          const w = Math.max(2, n.len * ppt - 1)
          g.fillRect(x, y + 1, w, rowH - 2)
          g.strokeRect(x + 0.5, y + 1.5, w - 1, rowH - 3)
        }
      }
    }

    // notes
    const showText = rowH >= 9
    const r = Math.min(3, rowH / 4)
    for (const n of notes) {
      const ri = this.rowIdx[n.key]
      if (n.pos > t1 || n.pos + n.len < t0 || ri < r0 || ri > r1) continue
      const x = this.xOf(n.pos)
      const y = this.yOf(n.key)
      const w = Math.max(2, n.len * ppt - 1)
      const h = rowH - 1
      const selected = this.sel.has(n.id)
      const base = noteColor(n.color)
      g.fillStyle = this.noteFill(n.color === 0 ? this.C.note : base, n.vel, selected, n.muted)
      g.beginPath()
      g.roundRect(x, y, w, h, r)
      g.fill()
      g.strokeStyle = n.muted ? 'rgba(0,0,0,0.35)' : 'rgba(10,20,14,0.55)'
      g.lineWidth = 1
      g.beginPath()
      g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r)
      g.stroke()
      if (h > 6 && w > 4) {
        g.fillStyle = 'rgba(255,255,255,0.22)'
        g.fillRect(x + 1.5, y + 1, w - 3, 1)
      }
      if (n.slide) {
        // FL slide notes: triangle marker pointing right
        const s = Math.min(h - 2, 10, w - 2)
        if (s > 2) {
          g.fillStyle = 'rgba(15,25,20,0.65)'
          g.beginPath()
          g.moveTo(x + 2, y + 1)
          g.lineTo(x + 2 + s, y + h / 2)
          g.lineTo(x + 2, y + h - 1)
          g.closePath()
          g.fill()
        }
      }
      if (n.porta) {
        g.fillStyle = 'rgba(15,25,20,0.6)'
        g.beginPath()
        g.arc(x + w - Math.min(5, w / 2), y + h / 2, Math.max(1.5, Math.min(3, h / 4)), 0, Math.PI * 2)
        g.fill()
      }
      if (showText && w > 26) {
        g.fillStyle = n.muted ? 'rgba(30,35,38,0.7)' : 'rgba(16,30,20,0.85)'
        g.fillText(this.names?.[n.key]?.name ?? noteName(n.key), x + (n.slide ? Math.min(h, 12) + 3 : 4), y + h / 2 + 0.5, w - 8)
      }
    }

    // drag decorations
    const d = this.drag
    if (d?.kind === 'rubber' && d.moved) {
      const x0 = this.xOf(Math.min(d.t0, d.t1))
      const x1 = this.xOf(Math.max(d.t0, d.t1))
      const y0 = Math.min(d.y0, d.y1) - v.y + RULER_H
      const y1 = Math.max(d.y0, d.y1) - v.y + RULER_H
      g.fillStyle = 'rgba(255,138,138,0.12)'
      g.fillRect(x0, y0, x1 - x0, y1 - y0)
      g.strokeStyle = 'rgba(255,150,150,0.85)'
      g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0)
    } else if (d?.kind === 'slice') {
      const grid = this.grid(d.alt)
      g.strokeStyle = '#ff6b5e'
      g.lineWidth = 1.5
      g.beginPath()
      g.moveTo(this.xOf(snapRound(d.t0, grid)), d.y0 - v.y + RULER_H)
      g.lineTo(this.xOf(snapRound(d.t1, grid)), d.y1 - v.y + RULER_H)
      g.stroke()
    } else if (d?.kind === 'zoom') {
      g.fillStyle = 'rgba(255,255,255,0.10)'
      g.fillRect(Math.min(d.x0, d.x1), RULER_H, Math.abs(d.x1 - d.x0), gb - RULER_H)
    }
    g.restore()

    this.drawRuler(g, timeSig, patLen)
    this.drawKeys(g, hoverKey)
    this.drawLane(g, notes)
    this.drawScrollbars(g)
  }

  private drawRuler(g: CanvasRenderingContext2D, timeSig: [number, number], patLen: number): void {
    const W = this.W
    const ppt = this.view.ppt
    const bar = barOf(timeSig)
    const beat = beatOf(timeSig)
    const t0 = this.view.x
    const t1 = this.tickAt(W - SB)
    g.fillStyle = '#2b3438'
    g.fillRect(0, 0, W, RULER_H)
    g.save()
    g.beginPath()
    g.rect(this.kw, 0, this.gridW(), RULER_H)
    g.clip()
    if (this.timeSel) {
      g.fillStyle = '#c4544a'
      const x = this.xOf(this.timeSel.start)
      g.fillRect(x, 2, (this.timeSel.end - this.timeSel.start) * ppt, RULER_H - 4)
    }
    // pattern region marker
    g.fillStyle = 'rgba(255,255,255,0.05)'
    g.fillRect(this.xOf(0), RULER_H - 6, patLen * ppt, 6)
    let every = 1
    while (bar * ppt * every < 30) every *= 2
    const lineT = gridLineTicks(ppt, timeSig, 6)
    g.fillStyle = '#5d6a70'
    for (let t = Math.floor(t0 / lineT) * lineT; t <= t1; t += lineT) {
      const x = Math.round(this.xOf(t))
      const h = t % bar === 0 ? 10 : t % beat === 0 ? 6 : 3
      g.fillRect(x, RULER_H - h, 1, h)
    }
    g.fillStyle = '#c5cdd1'
    g.font = '10px "Segoe UI", "Noto Sans", Ubuntu, sans-serif'
    g.textBaseline = 'middle'
    for (let b = Math.floor(t0 / bar); b * bar <= t1; b++) {
      if (b % every !== 0) continue
      const x = this.xOf(b * bar)
      g.fillText(String(b + 1), x + 3, 8)
      // beat numbers when there is room
      if (beat * ppt > 34 && every === 1) {
        g.fillStyle = '#7f8c92'
        for (let i = 1; i < timeSig[0]; i++) g.fillText(`${b + 1}.${i + 1}`, this.xOf(b * bar + i * beat) + 3, 8)
        g.fillStyle = '#c5cdd1'
      }
    }
    // pattern end marker
    const xe = this.xOf(patLen)
    g.fillStyle = '#f79a2e'
    g.beginPath()
    g.moveTo(xe, RULER_H - 1)
    g.lineTo(xe - 5, RULER_H - 7)
    g.lineTo(xe, RULER_H - 7)
    g.closePath()
    g.fill()
    g.restore()
    g.fillStyle = '#1d2326'
    g.fillRect(0, RULER_H - 1, W, 1)
    // corner
    g.fillStyle = '#262e32'
    g.fillRect(0, 0, this.kw, RULER_H - 1)
    g.fillStyle = '#7f8c92'
    const { channelId, p } = this.info()
    const ch = channelId ? findChannel(p, channelId) : null
    g.save()
    g.beginPath()
    g.rect(0, 0, this.kw - 2, RULER_H)
    g.clip()
    const hidden = this.drum ? this.notes().reduce((a, n) => a + (this.rowIdx[n.key] < 0 ? 1 : 0), 0) : 0
    g.fillText(ch?.name ?? '(no channel)', 6, hidden ? 8 : RULER_H / 2)
    if (hidden) {
      g.fillStyle = '#f79a2e'
      g.fillText(`+${hidden} hidden (M)`, 6, 19)
    }
    g.restore()
    g.fillStyle = '#262e32'
    g.fillRect(W - SB, 0, SB, RULER_H)
  }

  private drawKeys(g: CanvasRenderingContext2D, hoverKey: number | null): void {
    const gb = this.gridBottom()
    const rowH = this.view.rowH
    const font = (px: number) => `${px}px "Segoe UI", "Noto Sans", Ubuntu, sans-serif`
    g.save()
    g.beginPath()
    g.rect(0, RULER_H, this.kw, gb - RULER_H)
    g.clip()
    const r0 = this.rowAt(RULER_H)
    const r1 = this.rowAt(gb - 1)

    if (this.drum) {
      // Drum view: one labelled cell per named key (FL "keyboard view: names")
      g.fillStyle = '#2a3337'
      g.fillRect(0, RULER_H, this.kw, gb - RULER_H)
      g.font = font(Math.max(8, Math.min(11, rowH - 3)))
      for (let r = r0; r <= r1; r++) {
        const k = this.rows[r]
        const y = this.yOf(k)
        const nm = this.names?.[k]
        const gc = groupColor(nm?.group)
        g.fillStyle = k === this.pressedKey ? '#c97a28' : k === hoverKey ? '#46535a' : r % 2 ? '#323c41' : '#364146'
        g.fillRect(0, y, this.kw, rowH)
        g.fillStyle = gc
        g.fillRect(0, y, 4, rowH - 1)
        g.fillStyle = 'rgba(0,0,0,0.35)'
        g.fillRect(0, y + rowH - 1, this.kw, 1)
        if (rowH >= 8) {
          g.fillStyle = k === this.pressedKey ? '#1b1f22' : '#dfe5e8'
          g.textAlign = 'left'
          g.fillText(nm?.name ?? noteName(k), 8, y + rowH / 2 + 0.5, this.kw - 44)
          g.fillStyle = '#7f8c92'
          g.textAlign = 'right'
          g.fillText(noteName(k), this.kw - 5, y + rowH / 2 + 0.5)
          g.textAlign = 'left'
        }
      }
      g.restore()
      g.fillStyle = '#1d2326'
      g.fillRect(this.kw - 1, RULER_H, 1, gb - RULER_H)
      return
    }

    // Piano view. With key names, a name column sits left of the keys.
    const px0 = this.kw - KEYS_W
    const blackW = Math.round(KEYS_W * 0.6)
    const kTop = Math.min(MAX_KEY, this.rows[r0] + 1)
    const kBot = Math.max(0, this.rows[r1] - 1)
    if (px0 > 0) {
      g.fillStyle = '#2a3337'
      g.fillRect(0, RULER_H, px0, gb - RULER_H)
      g.font = font(Math.max(8, Math.min(10, rowH - 2)))
      for (let k = kTop; k >= kBot; k--) {
        const nm = this.names?.[k]
        if (!nm) continue
        const y = this.yOf(k)
        g.fillStyle = groupColor(nm.group)
        g.globalAlpha = 0.22
        g.fillRect(0, y, px0, rowH)
        g.globalAlpha = 1
        g.fillRect(0, y, 3, rowH - 1)
        if (rowH >= 7) {
          g.fillStyle = k === hoverKey || k === this.pressedKey ? '#ffffff' : '#d5dde0'
          g.fillText(nm.name, 6, y + rowH / 2 + 0.5, px0 - 9)
        }
      }
    }
    g.fillStyle = '#dde2e4'
    g.fillRect(px0, RULER_H, KEYS_W, gb - RULER_H)
    // white key boundaries (realistic layout: C-E = 3 keys over 5 rows, F-B = 4 keys over 7 rows)
    g.fillStyle = '#8f999e'
    for (let o = Math.floor(kBot / 12); o * 12 <= kTop; o++) {
      const c = o * 12
      const b1 = this.yOf(c) + rowH // bottom of C
      for (let i = 0; i <= 3; i++) g.fillRect(px0, Math.round(b1 - (i * 5 * rowH) / 3), KEYS_W, 1)
      const b2 = this.yOf(c + 5) + rowH // bottom of F
      for (let i = 1; i <= 4; i++) g.fillRect(px0, Math.round(b2 - (i * 7 * rowH) / 4), KEYS_W, 1)
    }
    // pressed / hover highlight on white keys (full row)
    for (const [k, col] of [
      [hoverKey, 'rgba(120,140,150,0.25)'],
      [this.pressedKey, 'rgba(247,154,46,0.75)']
    ] as const) {
      if (k === null || isBlack(k)) continue
      g.fillStyle = col
      g.fillRect(px0, this.yOf(k), KEYS_W, rowH)
    }
    const pr = usePR.getState()
    for (let k = kTop; k >= kBot; k--) {
      const y = this.yOf(k)
      if (isBlack(k)) {
        g.fillStyle = k === this.pressedKey ? '#c97a28' : k === hoverKey ? '#3a4448' : '#1c2225'
        g.fillRect(px0, y + 1, blackW, rowH - 1)
        g.fillStyle = 'rgba(255,255,255,0.10)'
        g.fillRect(px0 + blackW - 3, y + 2, 2, rowH - 3)
      }
      if (pr.scale !== 'none' && !inScale(k, pr.scaleRoot, pr.scale)) {
        g.fillStyle = 'rgba(40,50,56,0.25)'
        g.fillRect(px0 + (isBlack(k) ? 0 : blackW), y, isBlack(k) ? blackW : KEYS_W - blackW, rowH)
      }
      if (k % 12 === 0 && rowH >= 7) {
        g.fillStyle = '#3b464c'
        g.font = font(Math.min(10, rowH - 1))
        g.textAlign = 'right'
        g.fillText(noteName(k), this.kw - 4, y + rowH / 2 + 0.5)
        g.textAlign = 'left'
      }
    }
    g.restore()
    g.fillStyle = '#1d2326'
    g.fillRect(this.kw - 1, RULER_H, 1, gb - RULER_H)
  }

  private drawLane(g: CanvasRenderingContext2D, notes: Note[]): void {
    const lh = this.laneH()
    const gb = this.gridBottom()
    const W = this.W
    // splitter
    g.fillStyle = '#2a3236'
    g.fillRect(0, gb, W, SPLIT)
    g.fillStyle = '#1b2124'
    g.fillRect(0, gb, W, 1)
    g.fillRect(0, gb + SPLIT - 1, W, 1)
    if (lh < 4) return
    const top = this.laneTop()
    const pr = usePR.getState()
    const lane = LANES[pr.lane]
    g.fillStyle = '#262f33'
    g.fillRect(0, top, this.kw, lh)
    g.fillStyle = '#2b353a'
    g.fillRect(this.kw, top, this.gridW(), lh)
    const vy = (val: number) => top + 4 + (1 - val) * (lh - 8)
    g.fillStyle = 'rgba(255,255,255,0.05)'
    for (const f of [0.25, 0.5, 0.75]) g.fillRect(this.kw, Math.round(vy(f)), this.gridW(), 1)
    if (lane.bipolar) {
      g.fillStyle = 'rgba(255,255,255,0.12)'
      g.fillRect(this.kw, Math.round(vy(0.5)), this.gridW(), 1)
    }
    // bar lines
    const { timeSig } = this.info()
    const bar = barOf(timeSig)
    const t0 = this.view.x
    const t1 = this.tickAt(W - SB)
    let every = 1
    while (bar * this.view.ppt * every < 12) every *= 2
    g.fillStyle = '#1f272b'
    for (let b = Math.floor(t0 / bar); b * bar <= t1; b++) if (b % every === 0) g.fillRect(Math.round(this.xOf(b * bar)), top, 1, lh)

    g.save()
    g.beginPath()
    g.rect(this.kw, top, this.gridW(), lh)
    g.clip()
    const useSel = this.sel.size > 0
    const base = vy(lane.bipolar ? 0.5 : 0)
    for (const n of notes) {
      if (n.pos > t1 || n.pos < t0 - 10 / this.view.ppt || this.rowIdx[n.key] < 0) continue
      const x = Math.round(this.xOf(n.pos)) + 0.5
      const val = lane.get(n)
      const y = vy(val)
      const selected = this.sel.has(n.id)
      const col = selected ? this.C.sel : n.color === 0 ? this.C.note : noteColor(n.color)
      g.globalAlpha = useSel && !selected ? 0.35 : n.muted ? 0.45 : 1
      g.strokeStyle = col
      g.fillStyle = col
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(x, base)
      g.lineTo(x, y)
      g.stroke()
      // tail across the note length
      const xe = this.xOf(n.pos + n.len)
      g.globalAlpha *= 0.35
      g.fillRect(x, Math.round(y), Math.max(0, xe - x - 1), 1)
      g.globalAlpha = useSel && !selected ? 0.35 : n.muted ? 0.45 : 1
      g.beginPath()
      g.arc(x, y, 3, 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
    g.restore()
    // labels in the left column (value scale)
    g.fillStyle = '#7f8c92'
    g.font = '9px "Segoe UI", "Noto Sans", Ubuntu, sans-serif'
    g.textAlign = 'right'
    if (lh > 50) {
      g.fillText(lane.bipolar ? '+' : '100%', this.kw - 4, vy(1) + 3)
      g.fillText(lane.bipolar ? '−' : '0', this.kw - 4, vy(0) - 3)
    }
    g.textAlign = 'left'
    g.fillStyle = '#1d2326'
    g.fillRect(this.kw - 1, top, 1, lh)
  }

  private drawScrollbars(g: CanvasRenderingContext2D): void {
    const W = this.W
    const H = this.H
    const gb = this.gridBottom()
    // corners/background
    g.fillStyle = '#232a2d'
    g.fillRect(0, H - SB, W, SB)
    g.fillRect(W - SB, RULER_H, SB, H - RULER_H)
    const thumb = (x: number, y: number, w: number, h: number, horiz: boolean) => {
      g.fillStyle = '#4d585e'
      g.beginPath()
      g.roundRect(x + 1, y + 1, w - 2, h - 2, 2)
      g.fill()
      g.fillStyle = '#6a777d'
      if (horiz) {
        g.fillRect(x + 3, y + 3, 2, h - 6)
        g.fillRect(x + w - 5, y + 3, 2, h - 6)
      } else {
        g.fillRect(x + 3, y + 3, w - 6, 2)
        g.fillRect(x + 3, y + h - 5, w - 6, 2)
      }
    }
    const { tx, tw } = this.hThumb()
    thumb(tx, H - SB, tw, SB, true)
    const { ty, th } = this.vThumb()
    if (gb - RULER_H > 10) thumb(W - SB, ty, SB, th, false)
  }
}
