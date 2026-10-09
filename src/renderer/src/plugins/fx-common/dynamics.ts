// Gain computer shared by the dynamics plugins (pure math: safe for DSP and UI).

/** Static compressor curve in dB with soft knee. Returns the gain change (<= 0). */
export function compGain(levelDb: number, thr: number, ratio: number, knee: number): number {
  const over = levelDb - thr
  if (knee > 0 && 2 * Math.abs(over) <= knee) {
    const t = over + knee / 2
    return ((1 / ratio - 1) * t * t) / (2 * knee)
  }
  if (over <= 0) return 0
  return over * (1 / ratio - 1)
}

/** Make-up gain that roughly restores loudness for a curve (half the reduction at 0 dBFS). */
export function autoMakeup(thr: number, ratio: number, knee: number): number {
  return -0.5 * compGain(0, thr, ratio, knee)
}
