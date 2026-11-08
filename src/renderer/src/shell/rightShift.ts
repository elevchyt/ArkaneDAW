// Right-Shift tracking (FL: Right-Shift + click slices clips/notes, Right-Shift + right-click trims a clip).
// Pointer events only report "a Shift is down", so the physical key is tracked here.
const state = { held: false }

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => e.code === 'ShiftRight' && (state.held = true), true)
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftRight' || !e.shiftKey) state.held = false
  }, true)
  window.addEventListener('blur', () => (state.held = false))
}

/** True while Right-Shift is held (and some Shift is still reported down by the event, when given one). */
export function rightShiftHeld(e?: { shiftKey: boolean }): boolean {
  if (e && !e.shiftKey) state.held = false
  return state.held
}
