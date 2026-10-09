import { useRef } from 'react'
import { ChevronDown, Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUI, type WindowState } from '@/store/ui'

export interface MdiWindowProps {
  win: WindowState
  /** Area of the workspace in px, for clamping & maximize. */
  bounds: { w: number; h: number }
  children: React.ReactNode
  /** Extra title-bar content (FL puts tool icons, selectors and the pattern name here). */
  titleExtra?: React.ReactNode
  /** Click on the ▼ arrow at the left of the title (FL window options menu). */
  menu?: React.ReactNode
  /** Fixed-size windows (plugin editors) can't be resized. */
  resizable?: boolean
  minW?: number
  minH?: number
  accent?: string
}

/** FL Studio style child window: slim title bar, options arrow, min/max/close on the right. */
export function MdiWindow({ win, bounds, children, titleExtra, menu, resizable = true, minW = 240, minH = 120, accent }: MdiWindowProps) {
  const { focusWindow, updateWindow, closeWindow } = useUI.getState()
  const focused = useUI((s) => s.focused === win.id)
  const ref = useRef<HTMLDivElement>(null)

  const startMove = (e: React.PointerEvent) => {
    if (e.button !== 0 || win.maximized) return
    if ((e.target as HTMLElement).closest('button,input,select,[data-nodrag]')) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const ox = win.x
    const oy = win.y
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(ox + ev.clientX - sx, -win.w + 80), bounds.w - 60)
      const y = Math.min(Math.max(oy + ev.clientY - sy, 0), bounds.h - 22)
      updateWindow(win.id, { x, y })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startResize = (edge: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const sy = e.clientY
    const o = { x: win.x, y: win.y, w: win.w, h: win.h }
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      const n = { ...o }
      if (edge.includes('e')) n.w = Math.max(minW, o.w + dx)
      if (edge.includes('s')) n.h = Math.max(minH, o.h + dy)
      if (edge.includes('w')) {
        n.w = Math.max(minW, o.w - dx)
        n.x = o.x + (o.w - n.w)
      }
      if (edge.includes('n')) {
        n.h = Math.max(minH, o.h - dy)
        n.y = o.y + (o.h - n.h)
      }
      updateWindow(win.id, n)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!win.open || win.minimized) return null
  const style: React.CSSProperties = win.maximized
    ? { left: 0, top: 0, width: bounds.w, height: bounds.h, zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z }

  return (
    <div
      ref={ref}
      className={cn(
        'absolute flex flex-col overflow-hidden border bg-fl-panel shadow-[0_6px_24px_rgba(0,0,0,.55)]',
        win.maximized ? 'border-transparent' : 'rounded-[3px]',
        focused ? 'border-[#11161a]' : 'border-[#1b2124]'
      )}
      style={style}
      onPointerDownCapture={() => focusWindow(win.id)}
    >
      <div
        className={cn('relative flex h-[22px] shrink-0 items-center gap-1 pl-1 pr-0.5 text-[11px]', focused ? 'bg-fl-title-active text-[#eef2f4]' : 'bg-fl-title text-[#b6c0c5]')}
        style={accent ? { boxShadow: `inset 0 2px 0 ${accent}` } : undefined}
        onPointerDown={startMove}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button,[data-nodrag]')) return
          updateWindow(win.id, { maximized: !win.maximized })
        }}
      >
        {menu ?? <ChevronDown size={12} className="opacity-70" />}
        <span className="truncate font-medium">{win.title}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1" data-nodrag>
          {titleExtra}
        </div>
        <button className="grid h-[18px] w-[18px] place-items-center rounded-sm hover:bg-white/10" onClick={() => updateWindow(win.id, { minimized: true })} title="Minimize">
          <Minus size={11} />
        </button>
        <button className="grid h-[18px] w-[18px] place-items-center rounded-sm hover:bg-white/10" onClick={() => updateWindow(win.id, { maximized: !win.maximized })} title={win.maximized ? 'Restore' : 'Maximize'}>
          {win.maximized ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
        </button>
        <button className="grid h-[18px] w-[18px] place-items-center rounded-sm hover:bg-[#c8463f]" onClick={() => closeWindow(win.id)} title="Close">
          <X size={12} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
      {resizable && !win.maximized && (
        <>
          <div className="absolute right-0 top-0 h-full w-1 cursor-ew-resize" onPointerDown={startResize('e')} />
          <div className="absolute left-0 top-0 h-full w-1 cursor-ew-resize" onPointerDown={startResize('w')} />
          <div className="absolute bottom-0 left-0 h-1 w-full cursor-ns-resize" onPointerDown={startResize('s')} />
          <div className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize" onPointerDown={startResize('se')} />
          <div className="absolute bottom-0 left-0 h-3 w-3 cursor-nesw-resize" onPointerDown={startResize('sw')} />
        </>
      )}
    </div>
  )
}
