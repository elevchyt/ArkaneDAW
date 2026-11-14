// UI zoom (Ctrl + / Ctrl - / Ctrl 0). The Electron window is frameless and has no application menu, so the
// usual Chromium zoom accelerators don't exist: we drive webFrame's zoom factor ourselves and remember it.
import { host } from '@/platform'

const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
const KEY = 'arkane.uiZoom'

function stored(): number {
  try {
    const v = Number(localStorage.getItem(KEY))
    return STEPS.includes(v) ? v : 1
  } catch {
    return 1
  }
}

function apply(factor: number): void {
  if (!host) return
  host.zoom.set(factor)
  try {
    localStorage.setItem(KEY, String(factor))
  } catch {
    /* zoom still applies, it just isn't remembered */
  }
}

/** Next zoom step from the current factor: +1 zooms in, -1 out, 0 resets to 100%. */
export function stepZoom(dir: -1 | 0 | 1): number {
  if (dir === 0) {
    apply(1)
    return 1
  }
  const cur = host ? host.zoom.get() : 1
  // nearest step at or past the current factor, in the direction asked
  const next = dir > 0 ? (STEPS.find((s) => s > cur + 1e-3) ?? STEPS[STEPS.length - 1]) : ([...STEPS].reverse().find((s) => s < cur - 1e-3) ?? STEPS[0])
  apply(next)
  return next
}

export function restoreZoom(): void {
  const f = stored()
  if (host && f !== 1) host.zoom.set(f)
}

/** Ctrl + (also Ctrl = and numpad +), Ctrl -, Ctrl 0. Returns the direction, or null if `e` isn't a zoom key. */
export function zoomKey(e: KeyboardEvent): -1 | 0 | 1 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null
  if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=') return 1
  if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') return -1
  if (!e.shiftKey && (e.code === 'Digit0' || e.code === 'Numpad0')) return 0
  return null
}
