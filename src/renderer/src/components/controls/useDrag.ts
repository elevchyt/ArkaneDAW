import { useRef } from 'react'

/**
 * Vertical drag helper for knobs/faders. Calls onDelta with a normalized delta per move
 * (pixels / range); Shift = fine (x0.1). Uses pointer lock so the drag never hits the screen edge.
 */
export function useVerticalDrag(onDelta: (d: number) => void, range = 200, onEnd?: () => void) {
  const dragging = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    const el = e.currentTarget as HTMLElement
    try {
      el.requestPointerLock?.()
    } catch {
      /* ignore */
    }
    const move = (ev: PointerEvent) => {
      if (!dragging.current) return
      const fine = ev.shiftKey ? 0.1 : 1
      onDelta((-ev.movementY / range) * fine)
    }
    const up = () => {
      dragging.current = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (document.pointerLockElement) document.exitPointerLock()
      onEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return { onPointerDown }
}
