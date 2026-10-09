// Canvas editors: Famitracker-style bar-graph sequence editor (with draggable loop/release markers)
// and the Game Boy 32x16 wave drawer.
import { useEffect, useRef } from 'react'
import { SEQ_MAX, SEQ_RANGES, type Seq, type SeqKind } from './data'
import { NES, monoFont } from './pixel'

const MARK_H = 11

const DUTY_LABEL = ['12', '25', '50', '75']

export function SeqCanvas({ kind, value, onChange, width, height, color, enabled, hint }: {
  kind: SeqKind
  value: Seq
  onChange: (s: Seq) => void
  width: number
  height: number
  color: string
  enabled: boolean
  hint: (t: string) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const valRef = useRef(value)
  valRef.current = value
  const { min, max } = SEQ_RANGES[kind]
  const gridH = height - MARK_H * 2
  const n = value.values.length
  const cols = Math.max(n, 16)
  const cw = width / cols

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.imageSmoothingEnabled = false
    g.fillStyle = NES.well
    g.fillRect(0, 0, width, height)
    const rows = max - min + 1
    const rh = gridH / rows
    // grid
    for (let r = 0; r <= rows; r++) {
      const v = max - r + 1
      g.fillStyle = kind === 'pitch' && v === 0 ? '#ffffff30' : v % (kind === 'vol' ? 4 : kind === 'pitch' ? 12 : 1) === 0 ? '#ffffff14' : '#ffffff07'
      g.fillRect(0, Math.round(r * rh), width, 1)
    }
    for (let i = 0; i <= cols; i++) {
      g.fillStyle = i % 4 === 0 ? '#ffffff16' : '#ffffff08'
      g.fillRect(Math.round(i * cw), 0, 1, gridH)
    }
    // loop region tint
    if (value.loop >= 0) {
      const end = value.release >= value.loop ? value.release + 1 : n
      g.fillStyle = '#58d85412'
      g.fillRect(value.loop * cw, 0, (end - value.loop) * cw, gridH)
    }
    // marker guide lines (behind the bars)
    if (value.loop >= 0) {
      g.fillStyle = NES.green
      g.fillRect(Math.round(value.loop * cw), 0, 1, gridH)
    }
    if (value.release >= 0) {
      g.fillStyle = NES.red
      g.fillRect(Math.round((value.release + 1) * cw) - 1, 0, 1, gridH)
    }
    // bars
    const zeroY = kind === 'pitch' ? (max + 1) * rh - rh / 2 : gridH
    for (let i = 0; i < n; i++) {
      const v = value.values[i]
      const x = Math.round(i * cw) + 1
      const w = Math.max(1, Math.round(cw) - 2)
      g.fillStyle = enabled ? color : '#555b66'
      if (kind === 'pitch') {
        const y = (max - v) * rh
        const top = Math.min(y, zeroY - rh / 2)
        const bot = Math.max(y + rh, zeroY + rh / 2)
        g.globalAlpha = 0.45
        g.fillRect(x, top, w, bot - top)
        g.globalAlpha = 1
        g.fillRect(x, y, w, rh)
      } else {
        const hgt = (v - min + (kind === 'duty' ? 1 : 0)) * rh
        g.fillRect(x, gridH - hgt, w, hgt)
        g.fillStyle = '#ffffff40'
        g.fillRect(x, gridH - hgt, w, Math.min(2, hgt))
      }
      if (cw >= 14) {
        g.fillStyle = NES.white
        g.font = 'bold 8px monospace'
        g.textAlign = 'center'
        g.fillText(kind === 'duty' ? DUTY_LABEL[v] : String(v), x + w / 2, kind === 'pitch' ? gridH - 2 : 9)
      }
    }
    // marker strips
    const ly = gridH
    g.fillStyle = '#0f1116'
    g.fillRect(0, ly, width, MARK_H * 2)
    g.fillStyle = '#ffffff10'
    g.fillRect(0, ly + MARK_H, width, 1)
    g.font = 'bold 8px monospace'
    g.textAlign = 'left'
    g.fillStyle = '#ffffff35'
    if (value.loop < 0) g.fillText('LOOP', 3, ly + 8)
    if (value.release < 0) g.fillText('RELEASE', 3, ly + MARK_H + 8)
    const drawMark = (idx: number, row: number, col: string, label: string): void => {
      if (idx < 0) return
      const x = idx * cw
      g.fillStyle = col
      g.fillRect(x, ly + row * MARK_H + 1, Math.max(cw, 18), MARK_H - 2)
      g.fillStyle = NES.black
      g.fillText(label, x + 2, ly + row * MARK_H + 8)
    }
    drawMark(value.loop, 0, NES.green, 'L')
    drawMark(value.release, 1, NES.red, 'R')
    // unused columns
    if (n < cols) {
      g.fillStyle = '#00000080'
      g.fillRect(n * cw, 0, width - n * cw, height)
    }
  }, [value, width, height, color, enabled, kind, min, max, gridH, cols, cw, n])

  const drag = useRef<{ mode: 'draw' | 'erase' | 'loop' | 'release'; last: number | null; lastV: number } | null>(null)

  const posFrom = (e: { clientX: number; clientY: number }): { i: number; v: number; y: number } => {
    const r = ref.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * width
    const y = ((e.clientY - r.top) / r.height) * height
    const i = Math.max(0, Math.min(valRef.current.values.length - 1, Math.floor(x / cw)))
    const rows = max - min + 1
    const rh = gridH / rows
    let v = kind === 'pitch' ? max - Math.floor(y / rh) : kind === 'duty' ? max - Math.floor(y / rh) : Math.round(max - (y / gridH) * (max - min + 1) + 0.5)
    v = Math.max(min, Math.min(max, v))
    return { i, v, y }
  }

  const apply = (e: { clientX: number; clientY: number }): void => {
    const d = drag.current
    if (!d) return
    const { i, v } = posFrom(e)
    const cur = valRef.current
    if (d.mode === 'loop' || d.mode === 'release') {
      const k = d.mode === 'loop' ? 'loop' : 'release'
      if (cur[k] !== i) onChange({ ...cur, [k]: i })
      hint(`${d.mode === 'loop' ? 'Loop' : 'Release'} point: step ${i}`)
      return
    }
    const nv = d.mode === 'erase' ? (kind === 'duty' ? 2 : 0) : v
    const vals = cur.values.slice()
    const from = d.last ?? i
    const a = Math.min(from, i)
    const b = Math.max(from, i)
    for (let k = a; k <= b; k++) {
      const t = b === a ? 1 : (k - from) / (i - from)
      vals[k] = d.mode === 'erase' || d.last === null ? nv : Math.round(d.lastV + (nv - d.lastV) * t)
    }
    d.last = i
    d.lastV = nv
    onChange({ ...cur, values: vals })
    hint(`${kind.toUpperCase()} step ${i}: ${kind === 'duty' ? DUTY_LABEL[nv] + '%' : nv}`)
  }

  const onDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    const { y, i } = posFrom(e)
    const cur = valRef.current
    if (y >= gridH) {
      const k = y >= gridH + MARK_H ? 'release' : 'loop'
      if (e.button === 2 || (e.button === 0 && cur[k] === i && e.detail >= 2)) {
        onChange({ ...cur, [k]: -1 })
        return
      }
      drag.current = { mode: k, last: null, lastV: 0 }
    } else drag.current = { mode: e.button === 2 ? 'erase' : 'draw', last: null, lastV: 0 }
    apply(e)
    const mv = (ev: MouseEvent): void => apply(ev)
    const up = (): void => {
      drag.current = null
      window.removeEventListener('mousemove', mv)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
  }

  return (
    <canvas
      ref={ref}
      style={{ width, height, display: 'block', cursor: 'crosshair', border: `2px solid ${NES.black}`, imageRendering: 'pixelated' }}
      onMouseDown={onDown}
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={() => hint(`${kind.toUpperCase()} sequence: left-drag draws, right-drag erases. Bottom strips: drag Loop / Release markers, right-click to clear`)}
    />
  )
}

export function resizeSeq(s: Seq, n: number, kind: SeqKind): Seq {
  n = Math.max(1, Math.min(SEQ_MAX, n))
  const fill = kind === 'duty' ? s.values[s.values.length - 1] ?? 2 : kind === 'vol' ? s.values[s.values.length - 1] ?? 15 : 0
  const values = s.values.slice(0, n)
  while (values.length < n) values.push(fill)
  return { values, loop: s.loop < n ? s.loop : -1, release: s.release < n ? s.release : -1 }
}

/** Game Boy wave RAM drawer: 32 samples x 16 levels. */
export function WaveDrawer({ wave, onChange, width, height, hint }: { wave: number[]; onChange: (w: number[]) => void; width: number; height: number; hint: (t: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const waveRef = useRef(wave)
  waveRef.current = wave
  const cw = width / 32
  const rh = height / 16
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = NES.well
    g.fillRect(0, 0, width, height)
    for (let r = 0; r <= 16; r++) {
      g.fillStyle = r === 8 ? '#ffffff26' : '#ffffff0a'
      g.fillRect(0, Math.round(r * rh), width, 1)
    }
    for (let i = 0; i <= 32; i++) {
      g.fillStyle = i % 8 === 0 ? '#ffffff20' : '#ffffff0a'
      g.fillRect(Math.round(i * cw), 0, 1, height)
    }
    for (let i = 0; i < 32; i++) {
      const v = wave[i]
      const x = Math.round(i * cw) + 1
      const w = Math.max(1, Math.round(cw) - 1)
      for (let lv = 0; lv <= v; lv++) {
        g.fillStyle = lv === v ? NES.cyan : '#0078f855'
        g.fillRect(x, Math.round((15 - lv) * rh) + 1, w, Math.max(1, Math.round(rh) - 1))
      }
    }
  }, [wave, width, height, cw, rh])

  const last = useRef<{ i: number; v: number } | null>(null)
  const apply = (e: { clientX: number; clientY: number }): void => {
    const r = ref.current!.getBoundingClientRect()
    const i = Math.max(0, Math.min(31, Math.floor(((e.clientX - r.left) / r.width) * 32)))
    const v = Math.max(0, Math.min(15, 15 - Math.floor(((e.clientY - r.top) / r.height) * 16)))
    const w = waveRef.current.slice()
    const l = last.current ?? { i, v }
    const a = Math.min(l.i, i)
    const b = Math.max(l.i, i)
    for (let k = a; k <= b; k++) w[k] = b === a ? v : Math.round(l.v + ((v - l.v) * (k - l.i)) / (i - l.i))
    last.current = { i, v }
    onChange(w)
    hint(`GB wave sample ${i}: ${v}`)
  }
  const onDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    last.current = null
    apply(e)
    const mv = (ev: MouseEvent): void => apply(ev)
    const up = (): void => {
      last.current = null
      window.removeEventListener('mousemove', mv)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
  }
  return (
    <canvas
      ref={ref}
      style={{ width, height, display: 'block', cursor: 'crosshair', border: `2px solid ${NES.black}` }}
      onMouseDown={onDown}
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={() => hint('GB wave RAM: 32 x 4-bit samples. Drag to draw (used by the GB Wave oscillator)')}
    />
  )
}

export const seqLabelStyle: React.CSSProperties = { ...monoFont, fontSize: 9, color: NES.ltgray }
