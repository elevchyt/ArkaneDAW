// Keyboard routing: the focused MDI window gets first pick, then global FL shortcuts.
import { useEffect } from 'react'

export type KeyHandler = (e: KeyboardEvent) => boolean | void

const handlers = new Map<string, KeyHandler>()

/** Windows register a handler; return true to consume the key. */
export function useWindowKeys(windowId: string, handler: KeyHandler): void {
  useEffect(() => {
    handlers.set(windowId, handler)
    return () => {
      if (handlers.get(windowId) === handler) handlers.delete(windowId)
    }
  }, [windowId, handler])
}

export function dispatchWindowKey(windowId: string | null, e: KeyboardEvent): boolean {
  if (!windowId) return false
  const h = handlers.get(windowId) ?? handlers.get(windowId.split(':')[0])
  return h ? h(e) === true : false
}
