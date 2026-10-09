import { useEffect, useRef, useState } from 'react'
import { useUI } from '@/store/ui'
import { windowComponents } from '@/windows/registry'

/** The MDI desktop where FL's windows float. */
export function Workspace() {
  const windows = useUI((s) => s.windows)
  const ref = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ w: 1200, h: 800 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBounds({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBounds({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  const list = Object.values(windows)
    .filter((w) => w.open)
    .sort((a, b) => a.z - b.z)
  return (
    <div ref={ref} className="relative min-w-0 flex-1 overflow-hidden bg-fl-app" style={{ backgroundImage: 'radial-gradient(circle at 50% 40%, #2e373c 0%, #22292c 80%)' }}>
      {list.map((w) => {
        const C = windowComponents[w.kind]
        return C ? <C key={w.id} win={w} bounds={bounds} /> : null
      })}
      <MinimizedDock />
    </div>
  )
}

function MinimizedDock() {
  const windows = useUI((s) => s.windows)
  const mins = Object.values(windows).filter((w) => w.open && w.minimized)
  if (!mins.length) return null
  return (
    <div className="absolute bottom-1 left-1 z-[100000] flex gap-1">
      {mins.map((w) => (
        <button key={w.id} className="h-5 rounded-sm bg-fl-title px-2 text-[11px] text-fl-text hover:bg-fl-title-active" onClick={() => useUI.getState().openWindow(w.id)}>
          {w.title}
        </button>
      ))}
    </div>
  )
}
