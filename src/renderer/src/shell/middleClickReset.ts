// FL Studio: middle-click a knob or fader to reset it. Every knob/fader in the app (shared controls and
// plugin-specific ones) resets on double-click and uses a vertical-drag cursor, so a middle-click without
// movement on such an element is turned into a double-click.
const DRAG_CURSORS = new Set(['ns-resize', 'row-resize', 'n-resize', 's-resize'])

function knobTarget(el: Element | null): Element | null {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if ((n as HTMLElement).dataset?.knob !== undefined) return n
    if (DRAG_CURSORS.has(getComputedStyle(n).cursor)) return n
  }
  return null
}

export function installMiddleClickReset(): () => void {
  let down: { x: number; y: number; el: Element } | null = null
  const onDown = (e: PointerEvent) => {
    if (e.button !== 1) return
    const el = knobTarget(e.target as Element)
    if (!el) return
    e.preventDefault() // no autoscroll / primary-selection paste
    down = { x: e.clientX, y: e.clientY, el }
  }
  const onUp = (e: PointerEvent) => {
    if (e.button !== 1 || !down) return
    const d = down
    down = null
    if (Math.abs(e.clientX - d.x) > 3 || Math.abs(e.clientY - d.y) > 3) return
    const target = (e.target as Element) ?? d.el
    if (!d.el.contains(target)) return
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 0, detail: 2 }))
  }
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 1 && knobTarget(e.target as Element)) e.preventDefault()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('mousedown', onMouseDown, true)
  return () => {
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('mousedown', onMouseDown, true)
  }
}
