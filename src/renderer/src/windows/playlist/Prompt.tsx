// Small in-app text prompt (window.prompt is unavailable in Electron).
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

interface PromptState {
  req: { x: number; y: number; title: string; value: string; resolve: (v: string | null) => void } | null
  set: (req: PromptState['req']) => void
}

const usePrompt = create<PromptState>((set) => ({ req: null, set: (req) => set({ req }) }))

export function askText(title: string, value: string, at?: { clientX: number; clientY: number }): Promise<string | null> {
  return new Promise((resolve) => {
    const prev = usePrompt.getState().req
    prev?.resolve(null)
    usePrompt.getState().set({ x: at?.clientX ?? window.innerWidth / 2 - 120, y: at?.clientY ?? window.innerHeight / 3, title, value, resolve })
  })
}

export function PromptHost() {
  const req = usePrompt((s) => s.req)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (req) requestAnimationFrame(() => ref.current?.select())
  }, [req])
  if (!req) return null
  const done = (v: string | null) => {
    if (usePrompt.getState().req !== req) return
    usePrompt.getState().set(null)
    req.resolve(v)
  }
  return createPortal(
    <div
      className="fixed z-[1001] w-[240px] rounded-[3px] border border-[#1d2326] bg-[#353f44] p-2 text-[11px] shadow-[0_6px_18px_rgba(0,0,0,.6)]"
      style={{ left: Math.min(req.x, window.innerWidth - 250), top: Math.min(req.y, window.innerHeight - 70) }}
    >
      <div className="mb-1 text-fl-dim">{req.title}</div>
      <input
        ref={ref}
        autoFocus
        defaultValue={req.value}
        className="h-[20px] w-full rounded-[2px] bg-fl-well px-1.5 text-fl-text outline-none fl-inset"
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') done((e.target as HTMLInputElement).value)
          if (e.key === 'Escape') done(null)
        }}
        onBlur={(e) => done(e.target.value)}
      />
    </div>,
    document.body
  )
}
