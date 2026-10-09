// Kabee editor: a React/SVG re-creation of upstream KabeeUI.cpp (NanoVG). Black, flat, minimal: pedals are the only
// thing you see. Same 1140x760 layout, colors, card/knob/footswitch drawing, drag-to-reorder, × remove on hover,
// ADD PEDAL picker, NEW / SAVE, preset menu with rename/delete for user presets, Guitar/Bass, gate + learn + meter,
// full-screen tuner, Mic / Presence / Input / Output.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import type { PluginEditorProps } from '../sdk/module'
import type { KabeeStatus } from './dsp'
import type { KabeeData } from './manifest'
import {
  KABEE_PEDALS,
  KABEE_PRESETS,
  MAX_SLOTS,
  PARAM_BY_SYMBOL,
  PRESET_NEW,
  PRESET_USER,
  availablePedals,
  cleanName,
  decodeChain,
  denormalize,
  encodeChain,
  factoryPresetLabel,
  factoryPresetsFor,
  firstFactoryPreset,
  formatValue,
  makeUserPreset,
  modeOf,
  newBoardValues,
  normalize,
  sameName,
  stateMatches,
  sym,
  value,
  type KabeeFactoryPreset,
  type UserPreset,
  type Values
} from './model'
import { useUserPresets } from './userPresets'

export const BASE_W = 1140
export const BASE_H = 760

const HEADER_H = 76
const BOARD_Y = 92
const CARD_W = 170
const CARD_H = 272
const GAP = 14
const BOARD_H = CARD_H * 2 + GAP
const FOOTER_Y = 676
const DRAG_THRESHOLD = 6
const MODE_X = 168, MODE_W = 160
const PRESET_X = 346, PRESET_W = 300
const NEW_X = 662, SAVE_X = 748, PILL_W = 76
const TUNER_W = 110
const PI = Math.PI

const rgb = (r: number, g: number, b: number): string => `rgb(${r},${g},${b})`
const C = {
  black: rgb(0, 0, 0),
  panel: rgb(9, 9, 9),
  cardOff: rgb(11, 11, 11),
  cardOn: rgb(20, 20, 20),
  line: rgb(38, 38, 38),
  track: rgb(40, 40, 40),
  dim: rgb(88, 88, 88),
  mid: rgb(150, 150, 150),
  white: rgb(240, 240, 240)
}
const FONT = '"DejaVu Sans", "Bitstream Vera Sans", Verdana, sans-serif'
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

type Overlay = 'none' | 'menu' | 'add' | 'save' | 'rename' | 'delete'

interface PedalDrag {
  pedal: number
  title: boolean
  active: boolean
  pressX: number
  pressY: number
  grabX: number
  grabY: number
  x: number
  y: number
  insert: number
}

interface MenuRow {
  type: 'header' | 'factory' | 'user' | 'note'
  name: string
  factory?: KabeeFactoryPreset
}

// ---- drawing primitives -------------------------------------------------------------------------------------------

function T(props: { x: number; y: number; size: number; ls?: number; anchor?: 'start' | 'middle' | 'end'; fill: string; children: ReactNode; weight?: number }) {
  const { x, y, size, ls = 0, anchor = 'start', fill, children } = props
  // CSS letter-spacing trails the last glyph; NanoVG's centred text doesn't, so shift by half a gap
  const dx = anchor === 'middle' ? ls / 2 : 0
  return (
    <text x={x + dx} y={y} fontSize={size} letterSpacing={ls} textAnchor={anchor} dominantBaseline="central" fill={fill} style={{ pointerEvents: 'none', userSelect: 'none' }}>
      {children}
    </text>
  )
}

function arcPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r
  const x2 = cx + Math.cos(a2) * r, y2 = cy + Math.sin(a2) * r
  return `M${x1} ${y1}A${r} ${r} 0 ${a2 - a1 > PI ? 1 : 0} 1 ${x2} ${y2}`
}

function Pill(props: { x: number; y: number; w: number; h: number; label: string; filled: boolean; emphasis?: boolean; onDown?: (e: RPointerEvent) => void; onHover?: () => void }) {
  const { x, y, w, h, label, filled, emphasis, onDown, onHover } = props
  return (
    <g onPointerDown={onDown} onPointerEnter={onHover} style={{ cursor: onDown ? 'pointer' : undefined }}>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={filled ? C.white : 'transparent'} stroke={filled ? 'none' : emphasis ? C.mid : C.line} strokeWidth={1} />
      <T x={x + w / 2} y={y + h / 2} size={10} ls={2} anchor="middle" fill={filled ? C.black : emphasis ? C.white : C.mid}>
        {label}
      </T>
    </g>
  )
}

function Chevron({ x, cy, left }: { x: number; cy: number; left: boolean }) {
  const d = left ? `M${x + 26} ${cy - 5}L${x + 21} ${cy}L${x + 26} ${cy + 5}` : `M${x - 26} ${cy - 5}L${x - 21} ${cy}L${x - 26} ${cy + 5}`
  return <path d={d} stroke={C.mid} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
}

// ---- editor -------------------------------------------------------------------------------------------------------

export function KabeeEditor(p: PluginEditorProps) {
  const values = p.instance.params as Values
  const data = (p.instance.data ?? {}) as KabeeData
  const userPresetName = data.presetName ?? ''
  const mode = modeOf(values)
  const chain = useMemo(() => decodeChain(values), [values])
  const spare = useMemo(() => availablePedals(values), [values])
  const presetIndex = Math.floor(value(values, 'preset') + 0.5)
  const tunerOn = value(values, 'tuner') > 0.5
  const gateOn = value(values, 'gate_on') > 0.5

  const [library, setLibrary] = useUserPresets()
  const userForMode = useMemo(() => library.filter((u) => u.mode === mode).sort((a, b) => a.name.localeCompare(b.name)), [library, mode])
  const findUser = useCallback((name: string) => userForMode.find((u) => sameName(u.name, cleanName(name))), [userForMode])

  const svgRef = useRef<SVGSVGElement>(null)
  const [status, setStatus] = useState<KabeeStatus | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [hoverPedal, setHoverPedal] = useState(-1)
  const [hoverRemove, setHoverRemove] = useState(false)
  const [hoverParam, setHoverParam] = useState(-1)
  const [dragParam, setDragParam] = useState(-1)
  const [menuHover, setMenuHover] = useState<number>(-1)
  const [menuScroll, setMenuScroll] = useState(0)
  const [drag, setDrag] = useState<PedalDrag | null>(null)
  const [dialogText, setDialogText] = useState('')
  const [dialogTarget, setDialogTarget] = useState('')
  const [dialogError, setDialogError] = useState('')
  const lastClick = useRef({ param: -1, time: 0 })
  const learn = useRef({ pending: false, countAtStart: 0 })

  // ---- DSP status (meter, gate, learn, tuner) ----------------------------------------------------------------------
  const setParamRef = useRef(p.setParam)
  setParamRef.current = p.setParam
  useEffect(() => {
    const off = p.onDSPMessage((msg) => {
      const m = msg as KabeeStatus
      if (!m || m.type !== 'status') return
      setStatus(m)
      const l = learn.current
      if (l.pending && m.learnCount >= l.countAtStart + 0.5) {
        l.pending = false
        setParamRef.current('gate_threshold', m.learnedDb)
      }
    })
    p.postToDSP({ type: 'hello' })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.onDSPMessage, p.postToDSP])

  // ---- coordinates ---------------------------------------------------------------------------------------------------
  const toLocal = useCallback((e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    const s = r.width / BASE_W
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }
  }, [])

  const perRow = mode === 1 ? 4 : 6
  const cellPosition = useCallback(
    (index: number, cells: number) => {
      const row = Math.floor(index / perRow)
      const inRow = Math.min(perRow, cells - row * perRow)
      const col = index - row * perRow
      const rowW = inRow * CARD_W + (inRow - 1) * GAP
      return { x: (BASE_W - rowW) / 2 + col * (CARD_W + GAP), y: BOARD_Y + row * (CARD_H + GAP) }
    },
    [perRow]
  )

  // ---- parameter helpers ---------------------------------------------------------------------------------------------
  const set = useCallback((symbol: string, v: number) => p.setParam(symbol, v), [p])
  const hintParam = useCallback(
    (index: number, v: number) => {
      const info = PARAM_BY_SYMBOL[sym(index)]
      p.hint(`${info.name}: ${formatValue(info, v)}`)
    },
    [p]
  )

  const writeChain = useCallback((ids: number[], extra: Values = {}) => p.setParams({ ...encodeChain(ids), ...extra }), [p])

  // ---- presets ---------------------------------------------------------------------------------------------------------
  const loadFactory = useCallback(
    (preset: KabeeFactoryPreset) => p.loadPreset({ name: factoryPresetLabel(preset), category: preset.mode === 1 ? 'Bass' : 'Guitar', params: { ...values, ...preset.values }, data: { presetName: '' } }),
    [p, values]
  )
  const loadUser = useCallback(
    (u: UserPreset) => p.loadPreset({ name: u.name, params: { ...values, ...u.values, preset: PRESET_USER }, data: { presetName: u.name } }),
    [p, values]
  )
  const setPresetIndex = useCallback(
    (index: number, name: string) => p.loadPreset({ name: name || (index === PRESET_NEW ? 'New Board' : 'Kabee'), params: { ...values, preset: index }, data: { presetName: name } }),
    [p, values]
  )
  const newBoard = () => p.loadPreset({ name: 'New Board', params: { ...values, ...newBoardValues(mode) }, data: { presetName: '' } })

  const currentUser = presetIndex === PRESET_USER && userPresetName ? findUser(userPresetName) : undefined
  let presetLabel: string
  let edited = false
  const factory = KABEE_PRESETS[presetIndex]
  if (factory && factory.mode === mode) {
    presetLabel = factory.name.toUpperCase()
    edited = !stateMatches(values, factory.values)
  } else if (presetIndex === PRESET_USER && userPresetName) {
    presetLabel = userPresetName.toUpperCase()
    edited = currentUser ? !stateMatches(values, currentUser.values) : false
  } else presetLabel = chain.length === 0 ? 'NEW BOARD' : 'UNSAVED'
  const unsaved = edited || presetIndex === PRESET_NEW

  const menuRows: MenuRow[] = useMemo(() => {
    const rows: MenuRow[] = [{ type: 'header', name: 'FACTORY' }]
    for (const f of factoryPresetsFor(mode)) rows.push({ type: 'factory', name: f.name, factory: f })
    rows.push({ type: 'header', name: 'YOUR PRESETS' })
    if (userForMode.length === 0) rows.push({ type: 'note', name: 'SAVE A BOARD TO SEE IT HERE' })
    for (const u of userForMode) rows.push({ type: 'user', name: u.name })
    return rows
  }, [mode, userForMode])

  const rowSelected = (row: MenuRow): boolean =>
    row.type === 'factory' ? presetIndex === row.factory!.index : row.type === 'user' && presetIndex === PRESET_USER && sameName(row.name, userPresetName)

  const loadRow = (row: MenuRow) => {
    if (row.type === 'factory') loadFactory(row.factory!)
    else if (row.type === 'user') {
      const u = findUser(row.name)
      if (u) loadUser(u)
    }
  }

  const stepPreset = (dir: number) => {
    const items = menuRows.filter((r) => r.type === 'factory' || r.type === 'user')
    if (!items.length) return
    const pos = items.findIndex(rowSelected)
    const next = pos < 0 ? (dir > 0 ? 0 : items.length - 1) : (((pos + dir) % items.length) + items.length) % items.length
    loadRow(items[next])
  }

  // ---- dialogs ---------------------------------------------------------------------------------------------------------
  const dialogNote = (() => {
    if (dialogError) return dialogError
    const name = cleanName(dialogText)
    if (!name) return 'TYPE A NAME'
    const existing = findUser(name)
    if (!existing) return ''
    if (overlay === 'save') return presetIndex === PRESET_USER && sameName(existing.name, userPresetName) ? 'UPDATES THIS PRESET' : 'REPLACES AN EXISTING PRESET'
    if (overlay === 'rename' && !sameName(existing.name, dialogTarget)) return 'NAME ALREADY TAKEN'
    return ''
  })()

  const openSave = () => {
    if (presetIndex === PRESET_USER && userPresetName) setDialogText(userPresetName)
    else if (factory) setDialogText(`My ${factory.name}`)
    else setDialogText('My Board')
    setDialogError('')
    setOverlay('save')
  }

  const closeOverlay = useCallback(() => {
    setOverlay((o) => (o === 'rename' || o === 'delete' ? 'menu' : 'none'))
    setMenuHover(-1)
  }, [])

  const confirmDialog = () => {
    const name = cleanName(dialogText)
    if (overlay === 'save') {
      if (!name) return
      const preset = makeUserPreset(name, values)
      const ok = setLibrary((list) => [...list.filter((u) => !(u.mode === mode && sameName(u.name, name))), preset])
      if (!ok) return setDialogError('COULD NOT SAVE: STORAGE UNAVAILABLE')
      setPresetIndex(PRESET_USER, name)
      setOverlay('none')
    } else if (overlay === 'rename') {
      if (!name) return
      const clash = findUser(name)
      if (clash && !sameName(clash.name, dialogTarget)) return
      const renamingCurrent = presetIndex === PRESET_USER && sameName(userPresetName, dialogTarget)
      const ok = setLibrary((list) => list.map((u) => (u.mode === mode && sameName(u.name, dialogTarget) ? { ...u, name } : u)))
      if (!ok) return setDialogError('COULD NOT RENAME: STORAGE UNAVAILABLE')
      if (renamingCurrent) setPresetIndex(PRESET_USER, name)
      setOverlay('menu')
    } else if (overlay === 'delete') {
      const deletingCurrent = presetIndex === PRESET_USER && sameName(userPresetName, dialogTarget)
      setLibrary((list) => list.filter((u) => !(u.mode === mode && sameName(u.name, dialogTarget))))
      if (deletingCurrent) setPresetIndex(PRESET_NEW, '')
      setOverlay('menu')
    }
    setMenuHover(-1)
  }

  // Escape closes overlays (capture phase so the DAW's shortcuts don't see it).
  useEffect(() => {
    if (overlay === 'none') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        closeOverlay()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [overlay, closeOverlay])

  // ---- knob dragging ---------------------------------------------------------------------------------------------------
  const knobDown = (e: RPointerEvent, index: number) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const info = PARAM_BY_SYMBOL[sym(index)]
    const now = performance.now()
    if (lastClick.current.param === index && now - lastClick.current.time < 350) {
      lastClick.current.param = -1
      set(info.symbol, info.def)
      hintParam(index, info.def)
      return
    }
    lastClick.current = { param: index, time: now }
    let norm = normalize(info, value(values, info.symbol))
    let lastY = toLocal(e).y
    let current = value(values, info.symbol)
    setDragParam(index)
    const move = (ev: PointerEvent) => {
      const y = toLocal(ev).y
      norm = Math.min(1, Math.max(0, norm + (lastY - y) * (ev.shiftKey ? 0.0008 : 0.005)))
      lastY = y
      const v = denormalize(info, norm)
      if (v !== current) {
        current = v
        set(info.symbol, v)
        hintParam(index, v)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragParam(-1)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const knobWheel = (e: React.WheelEvent, index: number) => {
    const info = PARAM_BY_SYMBOL[sym(index)]
    const step = e.shiftKey ? 0.005 : 0.025
    const dir = e.deltaY < 0 ? 1 : e.deltaY > 0 ? -1 : 0
    const v = denormalize(info, normalize(info, value(values, info.symbol)) + dir * step)
    set(info.symbol, v)
    hintParam(index, v)
  }

  // wheel must be non-passive to stop the window from scrolling
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const block = (e: WheelEvent) => {
      if ((e.target as Element)?.closest?.('[data-wheel]')) e.preventDefault()
    }
    el.addEventListener('wheel', block, { passive: false })
    return () => el.removeEventListener('wheel', block)
  }, [])

  // ---- pedal dragging --------------------------------------------------------------------------------------------------
  const insertionIndex = useCallback(
    (cx: number, cy: number) => {
      let best = 0, bestD = Infinity
      for (let i = 0; i < chain.length; i++) {
        const c = cellPosition(i, chain.length)
        const dx = cx - (c.x + CARD_W / 2), dy = cy - (c.y + CARD_H / 2)
        if (dx * dx + dy * dy < bestD) {
          bestD = dx * dx + dy * dy
          best = i
        }
      }
      return best
    },
    [chain, cellPosition]
  )

  const cardDown = (e: RPointerEvent, pedal: number, title: boolean, cardX: number, cardY: number) => {
    if (e.button !== 0) return
    e.preventDefault()
    const { x, y } = toLocal(e)
    const state: PedalDrag = { pedal, title, active: false, pressX: x, pressY: y, grabX: x - cardX, grabY: y - cardY, x, y, insert: 0 }
    const move = (ev: PointerEvent) => {
      const q = toLocal(ev)
      if (!state.active && Math.hypot(q.x - state.pressX, q.y - state.pressY) > DRAG_THRESHOLD) {
        state.active = true
        setHoverPedal(-1)
      }
      if (state.active) {
        state.x = q.x
        state.y = q.y
        state.insert = insertionIndex(q.x - state.grabX + CARD_W / 2, q.y - state.grabY + CARD_H / 2)
        setDrag({ ...state })
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (state.active) {
        const order = chain.filter((id) => id !== state.pedal)
        if (order.length === chain.length) return
        order.splice(Math.max(0, Math.min(state.insert, order.length)), 0, state.pedal)
        writeChain(order)
      } else if (state.title) togglePedal(state.pedal)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const togglePedal = (pedal: number) => {
    const on = sym(KABEE_PEDALS[pedal].onParam)
    set(on, value(values, on) > 0.5 ? 0 : 1)
  }
  const removePedal = (pedal: number) => {
    setHoverPedal(-1)
    writeChain(chain.filter((id) => id !== pedal))
  }
  const addPedal = (pedal: number) => {
    if (chain.length >= MAX_SLOTS) return
    writeChain([...chain, pedal], { [sym(KABEE_PEDALS[pedal].onParam)]: 1 })
  }

  const toggle = (symbol: string) => set(symbol, value(values, symbol) > 0.5 ? 0 : 1)

  // ---- drawing ---------------------------------------------------------------------------------------------------------
  const interacting = overlay === 'none' && dragParam < 0 && !drag

  function knob({ index, label, cx, cy, r, active, pedal, key }: { index: number; label: string; cx: number; cy: number; r: number; active: boolean; pedal: number; key?: string | number }) {
    const info = PARAM_BY_SYMBOL[sym(index)]
    const v = value(values, info.symbol)
    const a0 = 0.75 * PI, sweep = 1.5 * PI
    const t = Math.min(1, Math.max(0, normalize(info, v)))
    const origin = info.min < 0 && info.max > 0 ? normalize(info, 0) : 0
    const av = a0 + sweep * t, ao = a0 + sweep * origin
    const body = r - 7
    const hot = dragParam === index || hoverParam === index
    const small = r < 20
    const c = Math.cos(av), s = Math.sin(av)
    return (
      <g key={key}>
        <path d={arcPath(cx, cy, r, a0, a0 + sweep)} stroke={C.track} strokeWidth={3} fill="none" strokeLinecap="round" />
        {Math.abs(av - ao) > 0.01 && (
          <path d={arcPath(cx, cy, r, Math.min(ao, av), Math.max(ao, av))} stroke={active ? C.white : rgb(100, 100, 100)} strokeWidth={3} fill="none" strokeLinecap="round" />
        )}
        <circle cx={cx} cy={cy} r={body} fill={rgb(26, 26, 26)} />
        <line x1={cx + c * body * 0.3} y1={cy + s * body * 0.3} x2={cx + c * body * 0.85} y2={cy + s * body * 0.85} stroke={active ? C.white : C.mid} strokeWidth={2} strokeLinecap="round" />
        <T x={cx} y={cy + r + (small ? 13 : 14)} size={small ? 9.5 : 10.5} ls={hot ? 0.5 : small ? 0.8 : 1.5} anchor="middle" fill={hot ? C.white : active ? C.mid : C.dim}>
          {hot ? formatValue(info, v) : label.toUpperCase()}
        </T>
        <rect
          data-wheel
          x={cx - r - 8}
          y={cy - r - 8}
          width={2 * r + 16}
          height={2 * r + 30}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={(e) => knobDown(e, index)}
          onWheel={(e) => knobWheel(e, index)}
          onPointerEnter={() => {
            if (!interacting) return
            setHoverParam(index)
            if (pedal >= 0) setHoverPedal(pedal)
            hintParam(index, v)
          }}
          onPointerLeave={() => setHoverParam((h) => (h === index ? -1 : h))}
        />
      </g>
    )
  }

  function switchCtl({ index, label, cx, cy, active, key }: { index: number; label: string; cx: number; cy: number; active: boolean; key?: string | number }) {
    const info = PARAM_BY_SYMBOL[sym(index)]
    const second = value(values, info.symbol) > 0.5
    const w = 70, h = 26, x = cx - w / 2, y = cy - h / 2
    return (
      <g key={key}>
        <rect x={x} y={y} width={w} height={h} rx={h / 2} fill="none" stroke={C.line} />
        <rect x={x + (second ? w / 2 : 0) + 2.5} y={y + 2.5} width={w / 2 - 5} height={h - 5} rx={(h - 5) / 2} fill={active ? C.white : C.mid} />
        <T x={x + w * 0.25} y={cy} size={8.5} ls={1} anchor="middle" fill={second ? C.dim : C.black}>SLOW</T>
        <T x={x + w * 0.75} y={cy} size={8.5} ls={1} anchor="middle" fill={second ? C.black : C.dim}>FAST</T>
        <T x={cx} y={cy + 36} size={10.5} ls={1.5} anchor="middle" fill={active ? C.mid : C.dim}>{label.toUpperCase()}</T>
        <rect
          x={x - 6}
          y={y - 10}
          width={w + 12}
          height={h + 20}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            toggle(info.symbol)
            p.hint(`${info.name}: ${second ? 'Slow' : 'Fast'}`)
          }}
          onPointerEnter={() => p.hint(`${info.name}: ${formatValue(info, value(values, info.symbol))}`)}
        />
      </g>
    )
  }

  function pedalCard({ id, x, y, ghost, key }: { id: number; x: number; y: number; ghost: boolean; key?: string | number }) {
    const pedal = KABEE_PEDALS[id]
    const onSym = sym(pedal.onParam)
    const on = value(values, onSym) > 0.5
    const hover = !ghost && hoverPedal === id && interacting
    const n = pedal.knobs.length
    return (
      <g key={key}
        style={ghost ? { pointerEvents: 'none' } : undefined}
        onPointerEnter={() => interacting && setHoverPedal(id)}
        onPointerLeave={() => {
          setHoverPedal((h) => (h === id ? -1 : h))
          setHoverRemove(false)
        }}
      >
        <rect
          x={x + 0.5}
          y={y + 0.5}
          width={CARD_W - 1}
          height={CARD_H - 1}
          rx={14}
          fill={on ? C.cardOn : C.cardOff}
          stroke={on || ghost ? C.white : hover ? rgb(64, 64, 64) : C.line}
          strokeWidth={on ? 1.5 : 1}
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => cardDown(e, id, false, x, y)}
        />
        <T x={x + 18} y={y + 28} size={12} ls={2.5} fill={on ? C.white : C.mid}>{pedal.name.toUpperCase()}</T>
        <rect
          x={x}
          y={y}
          width={CARD_W}
          height={52}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onPointerDown={(e) => cardDown(e, id, true, x, y)}
          onPointerEnter={() => p.hint(`${pedal.name}: ${on ? 'On' : 'Off'} (click to toggle, drag to move)`)}
        />
        {hover ? (
          <g>
            <path
              d={`M${x + CARD_W - 26.5} ${y + 23.5}L${x + CARD_W - 17.5} ${y + 32.5}M${x + CARD_W - 17.5} ${y + 23.5}L${x + CARD_W - 26.5} ${y + 32.5}`}
              stroke={hoverRemove ? C.white : C.mid}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <rect
              x={x + CARD_W - 40}
              y={y + 10}
              width={36}
              height={36}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onPointerEnter={() => {
                setHoverRemove(true)
                p.hint(`Remove ${pedal.name} from the board`)
              }}
              onPointerLeave={() => setHoverRemove(false)}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.stopPropagation()
                removePedal(id)
              }}
            />
          </g>
        ) : (
          <circle cx={x + CARD_W - 22} cy={y + 28} r={3.5} fill={on ? C.white : 'none'} stroke={on ? 'none' : C.dim} strokeWidth={1} />
        )}
        {pedal.knobs.map((k, i) => {
          let cx: number, cy: number, r = 22
          if (n === 5) {
            const fx = [0.2, 0.5, 0.8, 0.29, 0.71]
            cx = x + CARD_W * fx[i]
            cy = y + (i < 3 ? 88 : 168)
            r = 17
          } else {
            cx = n === 3 && i === 2 ? x + CARD_W * 0.5 : x + CARD_W * (i % 2 === 0 ? 0.29 : 0.71)
            cy = y + (i < 2 ? 92 : 170)
          }
          return k.kind === 'switch' ? (
            switchCtl({ key: k.param, index: k.param, label: k.label, cx: cx, cy: cy, active: on })
          ) : (
            knob({ key: k.param, index: k.param, label: k.label, cx: cx, cy: cy, r: r, active: on, pedal: id })
          )
        })}
        {/* footswitch */}
        {on ? (
          <circle cx={x + CARD_W / 2} cy={y + CARD_H - 34} r={15} fill={C.white} />
        ) : (
          <g>
            <circle cx={x + CARD_W / 2} cy={y + CARD_H - 34} r={15} fill="none" stroke={rgb(70, 70, 70)} strokeWidth={1.5} />
            <circle cx={x + CARD_W / 2} cy={y + CARD_H - 34} r={8} fill="none" stroke={rgb(48, 48, 48)} strokeWidth={1.5} />
          </g>
        )}
        <rect
          x={x + CARD_W / 2 - 30}
          y={y + CARD_H - 34 - 22}
          width={60}
          height={44}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onPointerEnter={() => p.hint(`${pedal.name}: ${on ? 'On' : 'Off'}`)}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            togglePedal(id)
          }}
        />
      </g>
    )
  }

  const board = (() => {
    const out: ReactNode[] = []
    if (drag?.active) {
      const order = chain.filter((id) => id !== drag.pedal)
      const insert = Math.max(0, Math.min(drag.insert, order.length))
      for (let cell = 0, k = 0; cell < chain.length; cell++) {
        const { x, y } = cellPosition(cell, chain.length)
        if (cell === insert) out.push(<rect key="ph" x={x + 0.5} y={y + 0.5} width={CARD_W - 1} height={CARD_H - 1} rx={14} fill={rgb(6, 6, 6)} stroke={rgb(56, 56, 56)} />)
        else if (k < order.length) {
          const id = order[k++]
          out.push(pedalCard({ key: id, id: id, x: x, y: y, ghost: false }))
        }
      }
      out.push(pedalCard({ key: "ghost", id: drag.pedal, x: drag.x - drag.grabX, y: drag.y - drag.grabY, ghost: true }))
      return out
    }
    const showAdd = spare.length > 0
    const cells = chain.length + (showAdd ? 1 : 0)
    chain.forEach((id, i) => {
      const { x, y } = cellPosition(i, cells)
      out.push(pedalCard({ key: id, id: id, x: x, y: y, ghost: false }))
    })
    if (showAdd) {
      const { x, y } = cellPosition(chain.length, cells)
      const cx = x + CARD_W / 2, cy = y + CARD_H * 0.42
      out.push(
        <g
          key="add"
          style={{ cursor: 'pointer' }}
          onPointerEnter={() => p.hint('Add a pedal to the board')}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            setMenuHover(-1)
            setOverlay('add')
          }}
        >
          <rect x={x + 0.5} y={y + 0.5} width={CARD_W - 1} height={CARD_H - 1} rx={14} fill={rgb(7, 7, 7)} stroke={rgb(46, 46, 46)} />
          <circle cx={cx} cy={cy} r={22} fill="none" stroke={C.line} />
          <path d={`M${cx - 8} ${cy}L${cx + 8} ${cy}M${cx} ${cy - 8}L${cx} ${cy + 8}`} stroke={C.mid} strokeWidth={1.5} strokeLinecap="round" />
          <T x={cx} y={cy + 46} size={10.5} ls={2.5} anchor="middle" fill={C.mid}>ADD PEDAL</T>
          {chain.length === 0 && (
            <T x={cx} y={cy + 66} size={9} ls={1.5} anchor="middle" fill={C.dim}>BUILD YOUR CHAIN</T>
          )}
        </g>
      )
    }
    return out
  })()

  const tuner = (() => {
    const top = BOARD_Y, h = BOARD_H
    const cx = BASE_W / 2, cy = top + h * 0.4
    const freq = status?.tuner ?? 0
    const meterY = top + h * 0.74, meterW = 560
    const ticks: ReactNode[] = []
    for (let c = -50; c <= 50; c += 10) {
      const tx = cx + (c / 50) * meterW * 0.5
      const th = c === 0 ? 22 : 10
      ticks.push(<line key={c} x1={tx} y1={meterY - th / 2} x2={tx} y2={meterY + th / 2} stroke={c === 0 ? C.mid : C.line} strokeWidth={c === 0 ? 2 : 1} strokeLinecap="round" />)
    }
    let reading: ReactNode
    if (freq <= 0) {
      reading = <T x={cx} y={cy} size={16} ls={4} anchor="middle" fill={C.dim}>PLAY A STRING</T>
    } else {
      const midi = 69 + 12 * Math.log2(freq / 440)
      const note = Math.round(midi)
      const cents = (midi - note) * 100
      const inTune = Math.abs(cents) < 3
      const pc = ((note % 12) + 12) % 12
      const ix = cx + Math.max(-1, Math.min(1, cents / 50)) * meterW * 0.5
      const ct = `${cents >= 0 ? '+' : '-'}${Math.abs(Math.round(cents))}`
      reading = (
        <g>
          <T x={cx} y={cy} size={150} anchor="middle" fill={inTune ? C.white : C.mid}>{NOTE_NAMES[pc]}</T>
          <T x={cx} y={cy + 100} size={13} ls={2.5} anchor="middle" fill={C.mid}>
            {`${NOTE_NAMES[pc]}${Math.floor(note / 12) - 1}   ${freq.toFixed(1)} HZ   ${ct} CT`}
          </T>
          <line x1={cx} y1={meterY} x2={ix} y2={meterY} stroke={inTune ? C.white : C.mid} strokeWidth={2} strokeLinecap="round" />
          <circle cx={ix} cy={meterY} r={8} fill={inTune ? C.white : C.black} stroke={inTune ? C.white : C.mid} strokeWidth={2} />
        </g>
      )
    }
    return (
      <g>
        <rect x={25.5} y={top + 0.5} width={BASE_W - 51} height={h - 1} rx={14} fill={C.panel} stroke={C.line} />
        {ticks}
        {reading}
        <T x={cx} y={top + h - 28} size={9.5} ls={2.5} anchor="middle" fill={C.dim}>OUTPUT MUTED WHILE TUNING</T>
      </g>
    )
  })()

  const header = (() => {
    const cy = HEADER_H / 2
    const mh = 32, my = cy - mh / 2
    const bass = mode === 1
    const ph = 36, py = cy - ph / 2
    const bh = 32, by = cy - bh / 2
    const tx = BASE_W - 32 - TUNER_W
    const pickMode = (m: number) => {
      if (mode !== m) loadFactory(firstFactoryPreset(m))
    }
    return (
      <g>
        <T x={32} y={cy} size={22} ls={8} fill={C.white}>KABEE</T>
        <rect x={MODE_X} y={my} width={MODE_W} height={mh} rx={mh / 2} fill="none" stroke={C.line} />
        <rect x={MODE_X + (bass ? MODE_W / 2 : 0) + 3} y={my + 3} width={MODE_W / 2 - 6} height={mh - 6} rx={(mh - 6) / 2} fill={C.white} />
        <T x={MODE_X + MODE_W * 0.25} y={cy} size={10.5} ls={2.5} anchor="middle" fill={bass ? C.mid : C.black}>GUITAR</T>
        <T x={MODE_X + MODE_W * 0.75} y={cy} size={10.5} ls={2.5} anchor="middle" fill={bass ? C.black : C.mid}>BASS</T>
        <rect x={MODE_X} y={my} width={MODE_W / 2} height={mh} fill="transparent" style={{ cursor: 'pointer' }} onPointerDown={() => pickMode(0)} onPointerEnter={() => p.hint('Guitar mode (loads the guitar Clean preset)')} />
        <rect x={MODE_X + MODE_W / 2} y={my} width={MODE_W / 2} height={mh} fill="transparent" style={{ cursor: 'pointer' }} onPointerDown={() => pickMode(1)} onPointerEnter={() => p.hint('Bass mode (loads the bass Clean preset)')} />

        <rect x={PRESET_X} y={py} width={PRESET_W} height={ph} rx={ph / 2} fill="none" stroke={overlay === 'menu' ? C.mid : C.line} />
        <Chevron x={PRESET_X} cy={cy} left />
        <Chevron x={PRESET_X + PRESET_W} cy={cy} left={false} />
        <T x={PRESET_X + PRESET_W / 2} y={cy} size={13.5} ls={3} anchor="middle" fill={C.white}>{presetLabel}</T>
        {edited && <circle cx={PRESET_X + PRESET_W - 50} cy={cy} r={2.5} fill={C.mid} />}
        <rect x={PRESET_X} y={py} width={48} height={ph} fill="transparent" style={{ cursor: 'pointer' }} onPointerDown={() => stepPreset(-1)} onPointerEnter={() => p.hint('Previous preset')} />
        <rect x={PRESET_X + PRESET_W - 48} y={py} width={48} height={ph} fill="transparent" style={{ cursor: 'pointer' }} onPointerDown={() => stepPreset(1)} onPointerEnter={() => p.hint('Next preset')} />
        <rect
          x={PRESET_X + 48}
          y={py}
          width={PRESET_W - 96}
          height={ph}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onPointerEnter={() => p.hint('Presets: factory and your own')}
          onPointerDown={() => {
            setMenuHover(-1)
            setMenuScroll(0)
            setOverlay('menu')
          }}
        />

        <Pill x={NEW_X} y={by} w={PILL_W} h={bh} label="NEW" filled={false} onDown={() => newBoard()} onHover={() => p.hint('NEW: start an empty board')} />
        <Pill x={SAVE_X} y={by} w={PILL_W} h={bh} label="SAVE" filled={false} emphasis={unsaved} onDown={openSave} onHover={() => p.hint('SAVE: store this board as a user preset')} />
        <Pill x={tx} y={by} w={TUNER_W} h={bh} label="TUNER" filled={tunerOn} onDown={() => toggle('tuner')} onHover={() => p.hint('Tuner (output muted while tuning)')} />
      </g>
    )
  })()

  const footer = (() => {
    const cy = FOOTER_Y + 34
    const progress = status?.learn ?? 0
    const lx = 112, lw = 100
    const mx = 306, mw = 170, my = cy - 9
    const meterX = (dbv: number) => mx + mw * Math.min(1, Math.max(0, (dbv + 90) / 90))
    const lvl = meterX(status?.input ?? -96)
    const open = (status?.gateOpen ?? false) || !gateOn
    const thr = meterX(value(values, 'gate_threshold'))
    const master: [string, string][] = [['mic', 'Mic'], ['presence', 'Presence'], ['input', 'Input'], ['output', 'Output']]
    return (
      <g>
        <line x1={32} y1={FOOTER_Y - 8} x2={BASE_W - 32} y2={FOOTER_Y - 8} stroke={rgb(26, 26, 26)} />
        <Pill x={32} y={cy - 13} w={70} h={26} label="GATE" filled={gateOn} onDown={() => toggle('gate_on')} onHover={() => p.hint(`Noise gate: ${gateOn ? 'On' : 'Off'}`)} />
        <g
          style={{ cursor: 'pointer' }}
          onPointerEnter={() => p.hint('Learn: listens 1.5 s while you don’t play, then sets the threshold just above the noise')}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            learn.current = { pending: true, countAtStart: status?.learnCount ?? 0 }
            p.postToDSP({ type: 'learn' })
          }}
        >
          <defs>
            <clipPath id="kabee-learn-clip">
              <rect x={lx} y={cy - 13} width={lw * progress} height={26} />
            </clipPath>
          </defs>
          <rect x={lx} y={cy - 13} width={lw} height={26} rx={13} fill="transparent" stroke={progress > 0 ? C.mid : C.line} />
          {progress > 0 && <rect x={lx} y={cy - 13} width={lw} height={26} rx={13} fill={rgb(60, 60, 60)} clipPath="url(#kabee-learn-clip)" />}
          <T x={lx + lw / 2} y={cy} size={10} ls={2} anchor="middle" fill={progress > 0 ? C.white : C.mid}>{progress > 0 ? 'LISTENING' : 'LEARN'}</T>
        </g>
        {knob({ index: PARAM_BY_SYMBOL.gate_threshold.index, label: "Threshold", cx: 258, cy: cy - 6, r: 17, active: gateOn, pedal: -1 })}
        <rect x={mx} y={my} width={mw} height={4} rx={2} fill={C.track} />
        {lvl > mx + 1 && <rect x={mx} y={my} width={lvl - mx} height={4} rx={2} fill={open ? C.white : C.dim} />}
        <line x1={thr} y1={my - 5} x2={thr} y2={my + 9} stroke={gateOn ? C.white : C.dim} strokeWidth={1.5} strokeLinecap="round" />
        <T x={mx} y={my + 22} size={9.5} ls={1.5} fill={C.dim}>{open ? 'SIGNAL' : 'GATED'}</T>
        {master.map(([s, label], i) => (
          knob({ key: s, index: PARAM_BY_SYMBOL[s].index, label: label, cx: BASE_W - 58 - (3 - i) * 96, cy: cy - 6, r: 17, active: true, pedal: -1 })
        ))}
      </g>
    )
  })()

  const presetMenu = (() => {
    if (overlay !== 'menu') return null
    const rowH = 32, w = 340
    const x = PRESET_X + PRESET_W / 2 - w / 2, y = 62
    const maxRows = Math.floor((FOOTER_Y - 24 - y) / rowH)
    const visible = Math.min(menuRows.length, maxRows)
    const scroll = Math.max(0, Math.min(menuScroll, menuRows.length - visible))
    const h = visible * rowH + 12
    const items: ReactNode[] = []
    for (let k = 0; k < visible; k++) {
      const index = k + scroll
      const row = menuRows[index]
      const ry = y + 6 + k * rowH
      if (row.type === 'header' || row.type === 'note') {
        items.push(
          <T key={index} x={x + 22} y={ry + rowH * (row.type === 'header' ? 0.62 : 0.5)} size={row.type === 'header' ? 9 : 9.5} ls={2.5} fill={C.dim}>
            {row.name}
          </T>
        )
        continue
      }
      const selected = rowSelected(row)
      const hover = menuHover === index
      const icon = selected ? C.black : hover ? C.white : C.dim
      const ey = ry + rowH / 2, ex = x + w - 60, dx = x + w - 30
      items.push(
        <g key={index} onPointerEnter={() => setMenuHover(index)} onPointerLeave={() => setMenuHover((m) => (m === index ? -1 : m))}>
          {(selected || hover) && <rect x={x + 6} y={ry + 2} width={w - 12} height={rowH - 4} rx={(rowH - 4) / 2} fill={selected ? C.white : rgb(34, 34, 34)} />}
          <T x={x + 22} y={ry + rowH / 2} size={12} ls={2.5} fill={selected ? C.black : hover ? C.white : C.mid}>{row.name.toUpperCase()}</T>
          <rect
            x={x}
            y={ry}
            width={w}
            height={rowH}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              loadRow(row)
              closeOverlay()
            }}
          />
          {row.type === 'user' && (
            <g>
              <path d={`M${ex - 5} ${ey + 5}L${ex + 4} ${ey - 4}M${ex - 5} ${ey + 5}L${ex - 6} ${ey + 6}M${ex + 2} ${ey - 6}L${ex + 6} ${ey - 2}`} stroke={icon} strokeWidth={1.5} strokeLinecap="round" />
              <rect
                x={ex - 13}
                y={ry}
                width={26}
                height={rowH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setDialogTarget(row.name)
                  setDialogText(row.name)
                  setDialogError('')
                  setOverlay('rename')
                }}
              />
              <path d={`M${dx - 4} ${ey - 4}L${dx + 4} ${ey + 4}M${dx + 4} ${ey - 4}L${dx - 4} ${ey + 4}`} stroke={icon} strokeWidth={1.5} strokeLinecap="round" />
              <rect
                x={dx - 13}
                y={ry}
                width={26}
                height={rowH}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setDialogTarget(row.name)
                  setDialogError('')
                  setOverlay('delete')
                }}
              />
            </g>
          )}
        </g>
      )
    }
    let thumb: ReactNode = null
    if (menuRows.length > visible) {
      const trackH = h - 24
      const thumbH = (trackH * visible) / menuRows.length
      const thumbY = y + 12 + ((trackH - thumbH) * scroll) / (menuRows.length - visible)
      thumb = <rect x={x + w - 6} y={thumbY} width={2} height={thumbH} rx={1} fill={C.dim} />
    }
    return (
      <g>
        <rect x={0} y={0} width={BASE_W} height={BASE_H} fill="transparent" onPointerDown={closeOverlay} />
        <g
          onWheel={(e) => setMenuScroll(Math.max(0, Math.min(scroll + (e.deltaY > 0 ? 1 : -1), menuRows.length - visible)))}
          data-wheel
        >
          <rect x={x} y={y} width={w} height={h} rx={14} fill={rgb(14, 14, 14)} stroke={rgb(64, 64, 64)} onPointerDown={(e) => e.stopPropagation()} />
          {items}
          {thumb}
        </g>
      </g>
    )
  })()

  const addOverlay = (() => {
    if (overlay !== 'add') return null
    const w = 560, pillW = 150, pillH = 40, gapX = 15, gapY = 12
    const rows = Math.ceil(spare.length / 3)
    const h = 70 + rows * (pillH + gapY) - gapY + 36
    const x = (BASE_W - w) / 2, y = BOARD_Y + (BOARD_H - h) / 2
    return (
      <g>
        <rect x={0} y={0} width={BASE_W} height={BASE_H} fill="transparent" onPointerDown={closeOverlay} />
        <rect x={x} y={y} width={w} height={h} rx={16} fill={rgb(14, 14, 14)} stroke={rgb(64, 64, 64)} />
        <T x={x + 40} y={y + 36} size={12} ls={3} fill={C.white}>ADD PEDAL</T>
        {spare.map((id, i) => {
          const px = x + 40 + (i % 3) * (pillW + gapX)
          const py = y + 70 + Math.floor(i / 3) * (pillH + gapY)
          const hover = menuHover === id
          return (
            <g
              key={id}
              style={{ cursor: 'pointer' }}
              onPointerEnter={() => setMenuHover(id)}
              onPointerLeave={() => setMenuHover((m) => (m === id ? -1 : m))}
              onPointerDown={() => {
                addPedal(id)
                closeOverlay()
              }}
            >
              <rect x={px} y={py} width={pillW} height={pillH} rx={pillH / 2} fill={hover ? C.white : 'transparent'} stroke={hover ? 'none' : C.line} />
              <T x={px + pillW / 2} y={py + pillH / 2} size={10.5} ls={2} anchor="middle" fill={hover ? C.black : C.mid}>{KABEE_PEDALS[id].name.toUpperCase()}</T>
            </g>
          )
        })}
      </g>
    )
  })()

  const dialog = (() => {
    if (overlay !== 'save' && overlay !== 'rename' && overlay !== 'delete') return null
    const w = 440, h = 200
    const x = (BASE_W - w) / 2, y = (BASE_H - h) / 2
    const title = overlay === 'save' ? 'SAVE PRESET' : overlay === 'rename' ? 'RENAME PRESET' : 'DELETE PRESET'
    const action = overlay === 'save' ? 'SAVE' : overlay === 'rename' ? 'RENAME' : 'DELETE'
    const bw = 110, bh = 36
    const okX = x + w - 28 - bw, by = y + h - 28 - bh, cancelX = okX - 12 - bw
    return (
      <g>
        <rect x={0} y={0} width={BASE_W} height={BASE_H} fill="rgba(0,0,0,0.72)" />
        <rect x={x} y={y} width={w} height={h} rx={16} fill={rgb(14, 14, 14)} stroke={rgb(70, 70, 70)} />
        <T x={x + 28} y={y + 34} size={12} ls={3} fill={C.white}>{title}</T>
        {overlay === 'delete' ? (
          <g>
            <T x={x + 28} y={y + 84} size={12} ls={1.5} fill={C.mid}>{`"${dialogTarget.toUpperCase()}" WILL BE REMOVED`}</T>
            <T x={x + 28} y={y + 108} size={9.5} ls={1.5} fill={C.dim}>THIS CANNOT BE UNDONE</T>
          </g>
        ) : (
          <g>
            <rect x={x + 28} y={y + 60} width={w - 56} height={42} rx={10} fill={C.black} stroke={C.mid} />
            <T x={x + 28} y={y + 122} size={9.5} ls={1.5} fill={C.mid}>{dialogNote}</T>
          </g>
        )}
        <Pill x={cancelX} y={by} w={bw} h={bh} label="CANCEL" filled={false} onDown={closeOverlay} />
        <Pill x={okX} y={by} w={bw} h={bh} label={action} filled onDown={confirmDialog} />
      </g>
    )
  })()

  const showInput = overlay === 'save' || overlay === 'rename'
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])
  useEffect(() => {
    if (overlay !== 'delete') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.stopPropagation()
        confirmDialog()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div style={{ position: 'relative', width: BASE_W, height: BASE_H, background: C.black, overflow: 'hidden', fontFamily: FONT }} onContextMenu={(e) => e.preventDefault()}>
      <svg
        ref={svgRef}
        width={BASE_W}
        height={BASE_H}
        viewBox={`0 0 ${BASE_W} ${BASE_H}`}
        style={{ display: 'block', fontFamily: FONT, touchAction: 'none', userSelect: 'none' }}
        onPointerLeave={() => {
          setHoverParam(-1)
          setHoverPedal(-1)
        }}
      >
        {header}
        {tunerOn ? tuner : board}
        {footer}
        {presetMenu}
        {addOverlay}
        {dialog}
      </svg>
      {showInput && (
        <input
          ref={inputRef}
          value={dialogText}
          maxLength={60}
          placeholder="Preset name"
          spellCheck={false}
          onChange={(e) => {
            setDialogError('')
            setDialogText(e.target.value)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') confirmDialog()
            else if (e.key === 'Escape') closeOverlay()
          }}
          style={{
            position: 'absolute',
            left: (BASE_W - 440) / 2 + 28 + 16,
            top: (BASE_H - 200) / 2 + 60 + 1,
            width: 440 - 56 - 32,
            height: 40,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: C.white,
            caretColor: C.white,
            fontFamily: FONT,
            fontSize: 15,
            letterSpacing: 0.5
          }}
        />
      )}
    </div>
  )
}

export default KabeeEditor
