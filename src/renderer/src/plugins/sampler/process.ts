// FL's "precomputed effects": destructive-looking sample processing that is re-run from the original PCM
// whenever a setting changes (so it is never actually destructive). Pure: used by the DSP (worklet), the
// editor's waveform view and audio-clip playback in the playlist.

/** Params that change the processed sample data (everything else is playback-time). */
export const PRECOMPUTED = ['removeDC', 'normalize', 'polarity', 'swapStereo', 'reverse', 'fadeIn', 'fadeOut'] as const

const on = (p: Record<string, number>, id: string) => (p[id] ?? 0) >= 0.5

export function hasProcessing(p: Record<string, number>): boolean {
  return on(p, 'removeDC') || on(p, 'normalize') || on(p, 'polarity') || on(p, 'swapStereo') || on(p, 'reverse') || (p.fadeIn ?? 0) > 0 || (p.fadeOut ?? 0) > 0
}

/** Cache key of the processing settings (same key = same output). */
export function processingKey(p: Record<string, number>): string {
  return PRECOMPUTED.map((id) => p[id] ?? 0).join(',')
}

/**
 * Apply the precomputed effects in FL's order: DC offset, polarity, stereo swap, normalize, fades, reverse.
 * Returns the input arrays untouched when nothing is enabled. fadeIn/fadeOut are seconds.
 */
export function processSample(channels: Float32Array[], sampleRate: number, p: Record<string, number>): Float32Array[] {
  if (!channels.length || !hasProcessing(p)) return channels
  let out = channels.map((c) => c.slice())
  const len = out[0].length
  if (on(p, 'removeDC')) {
    for (const c of out) {
      let sum = 0
      for (let i = 0; i < len; i++) sum += c[i]
      const dc = sum / Math.max(1, len)
      if (dc !== 0) for (let i = 0; i < len; i++) c[i] -= dc
    }
  }
  if (on(p, 'polarity')) for (const c of out) for (let i = 0; i < len; i++) c[i] = -c[i]
  if (on(p, 'swapStereo') && out.length >= 2) out = [out[1], out[0], ...out.slice(2)]
  if (on(p, 'normalize')) {
    let peak = 0
    for (const c of out) for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(c[i]))
    if (peak > 1e-6) {
      const g = 1 / peak
      for (const c of out) for (let i = 0; i < len; i++) c[i] *= g
    }
  }
  const fadeIn = Math.min(len, Math.round((p.fadeIn ?? 0) * sampleRate))
  if (fadeIn > 1) for (const c of out) for (let i = 0; i < fadeIn; i++) c[i] *= i / fadeIn
  const fadeOut = Math.min(len, Math.round((p.fadeOut ?? 0) * sampleRate))
  if (fadeOut > 1) for (const c of out) for (let i = 0; i < fadeOut; i++) c[len - 1 - i] *= i / fadeOut
  if (on(p, 'reverse')) for (const c of out) c.reverse()
  return out
}

/** Declicking modes (FL "Declicking"): minimum fade-in / fade-out applied to every note, in seconds. */
export const DECLICK_MODES = ['Out only', 'Transient', 'Generic', 'Smooth', 'None'] as const
const DECLICK: [number, number][] = [
  [0, 0.01],
  [0, 0.02],
  [0.02, 0.02],
  [0.1, 0.1],
  [0, 0]
]

export function declickTimes(mode: number): { attack: number; release: number } {
  const [attack, release] = DECLICK[Math.max(0, Math.min(DECLICK.length - 1, Math.round(mode)))]
  return { attack, release }
}
