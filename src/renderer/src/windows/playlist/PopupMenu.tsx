// Lightweight positioned menu for canvas hits (clip menu, track menu, marker menu).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label?: string
  onSelect?: () => void
  checked?: boolean
  disabled?: boolean
  separator?: boolean
  hint?: string
  items?: MenuItem[] // submenu
  /** Custom content (color swatches...) rendered instead of a label row. */
  render?: (close: () => void) => React.ReactNode
}

interface MenuState {
  menu: { x: number; y: number; items: MenuItem[]; title?: string } | null
  open: (x: number, y: number, items: MenuItem[], title?: string) => void
  close: () => void
}

export const usePopupMenu = create<MenuState>((set) => ({
  menu: null,
  open: (x, y, items, title) => set({ menu: { x, y, items, title } }),
  close: () => set({ menu: null })
}))

export const openMenu = (e: { clientX: number; clientY: number }, items: MenuItem[], title?: string): void =>
  usePopupMenu.getState().open(e.clientX, e.clientY, items, title)

/** Rows the arrow keys stop on. */
const selectable = (it: MenuItem): boolean => !it.separator && !it.render && !it.disabled

/** Next selectable row from `from` in direction `dir` (wraps), or -1. */
function step(items: MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length
  for (let k = 1; k <= n; k++) {
    const i = (((from < 0 && dir < 0 ? n : from) + dir * k) % n + n) % n
    if (selectable(items[i])) return i
  }
  return -1
}

/** Render once (App). */
export function PopupMenuHost() {
  const menu = usePopupMenu((s) => s.menu)
  const close = usePopupMenu((s) => s.close)
  // Highlighted row per level; `open` = how many panels show (a submenu opens off the highlighted row).
  const [nav, setNav] = useState<{ path: number[]; open: number }>({ path: [], open: 1 })
  const panels = useRef<(HTMLDivElement | null)[]>([])
  useEffect(() => setNav({ path: [], open: 1 }), [menu])

  const levels: MenuItem[][] = []
  if (menu) {
    levels.push(menu.items)
    for (let l = 1; l < nav.open; l++) {
      const parent = levels[l - 1][nav.path[l - 1]]
      if (!parent?.items) break
      levels.push(parent.items)
    }
  }

  useEffect(() => {
    if (!menu) return
    const down = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popup-menu]')) close()
    }
    // The menu owns the keyboard while it is open: nothing reaches the DAW's shortcuts.
    const key = (e: KeyboardEvent) => {
      e.stopPropagation()
      e.preventDefault()
      const level = levels.length - 1
      const items = levels[level]
      const cur = nav.path[level] ?? -1
      const it = cur >= 0 ? items[cur] : undefined
      const openSub = () => {
        const first = step(it!.items!, -1, 1)
        setNav({ path: [...nav.path.slice(0, level + 1), first], open: level + 2 })
      }
      switch (e.key) {
        case 'Escape':
          close()
          break
        case 'ArrowDown':
        case 'ArrowUp':
          setNav({ path: [...nav.path.slice(0, level), step(items, cur, e.key === 'ArrowDown' ? 1 : -1)], open: level + 1 })
          break
        case 'ArrowRight':
          if (it?.items) openSub()
          break
        case 'ArrowLeft':
          if (level > 0) setNav({ path: nav.path.slice(0, level), open: level })
          break
        case 'Enter':
        case ' ':
          if (!it || !selectable(it)) break
          if (it.items) openSub()
          else {
            close()
            it.onSelect?.()
          }
          break
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  })
  if (!menu) return null

  const hover = (level: number, i: number, hasSub: boolean) => setNav({ path: [...nav.path.slice(0, level), i], open: hasSub ? level + 2 : level + 1 })
  return createPortal(
    <>
      {levels.map((items, l) => {
        let x = menu.x
        let y = menu.y
        if (l > 0) {
          const row = panels.current[l - 1]?.querySelector(`[data-row="${nav.path[l - 1]}"]`)
          const r = row?.getBoundingClientRect()
          if (r) {
            x = r.right - 2
            y = r.top - 2
          }
        }
        return (
          <MenuPanel
            key={l === 0 ? 'root' : `${l}:${nav.path.slice(0, l).join('.')}`}
            panelRef={(el) => (panels.current[l] = el)}
            x={x}
            y={y}
            items={items}
            title={l === 0 ? menu.title : undefined}
            hot={nav.path[l] ?? -1}
            onHover={(i, hasSub) => hover(l, i, hasSub)}
            close={close}
          />
        )
      })}
    </>,
    document.body
  )
}

function MenuPanel({
  x,
  y,
  items,
  title,
  hot,
  onHover,
  close,
  panelRef
}: {
  x: number
  y: number
  items: MenuItem[]
  title?: string
  hot: number
  onHover: (i: number, hasSub: boolean) => void
  close: () => void
  panelRef: (el: HTMLDivElement | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.max(0, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(0, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y])
  useEffect(() => {
    if (hot >= 0) ref.current?.querySelector(`[data-row="${hot}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [hot])
  return (
    <div
      ref={(el) => {
        ref.current = el
        panelRef(el)
      }}
      data-popup-menu
      className="fixed z-[1000] max-h-[80vh] min-w-[150px] overflow-y-auto rounded-[3px] border border-[#1d2326] bg-[#2b3337] py-0.5 text-[11px] text-[#d4dadd] shadow-[0_6px_18px_rgba(0,0,0,.6)]"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {title && <div className="px-2 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-fl-dim">{title}</div>}
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="my-0.5 h-px bg-[#1d2326]" />
        if (it.render) return <div key={i}>{it.render(close)}</div>
        return (
          <div
            key={i}
            data-row={i}
            className={cn('flex h-[20px] cursor-default items-center gap-2 px-2', it.disabled && 'opacity-40', hot === i && !it.disabled && 'bg-[#46535a]')}
            onPointerEnter={() => !it.disabled && onHover(i, !!it.items)}
            onClick={() => {
              if (it.disabled || it.items) return
              close()
              it.onSelect?.()
            }}
          >
            <span className="w-2 text-fl-orange">{it.checked ? '✓' : ''}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-[10px] text-fl-dim">{it.hint}</span>}
            {it.items && <ChevronRight size={11} className="opacity-70" />}
          </div>
        )
      })}
    </div>
  )
}

export const SWATCHES = [
  '#6b8496', '#7d6e9c', '#9c6e8b', '#9c7a6e', '#8e9c6e', '#6e9c7d', '#6e8e9c', '#a37a52',
  '#5f86b3', '#b35f86', '#86b35f', '#b3a05f', '#5fb3a6', '#a65fb3', '#b36a5f', '#7f8f98',
  '#c75a4a', '#d0903a', '#c9c24a', '#5aa856', '#4aa3c7', '#5a6fd0', '#9a5ad0', '#5f6e77'
]

/** A menu item that shows a grid of color swatches. */
export function colorItem(current: string | undefined, onPick: (c: string) => void): MenuItem {
  return {
    render: (close) => (
      <div className="grid grid-cols-8 gap-[3px] px-2 py-1">
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={cn('h-3.5 w-3.5 rounded-[2px] border', c === current ? 'border-white' : 'border-black/50')}
            style={{ background: c }}
            onClick={() => {
              close()
              onPick(c)
            }}
          />
        ))}
      </div>
    )
  }
}
