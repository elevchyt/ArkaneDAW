// One-shot audio played outside the transport (browser sample previews). Tracked so Stop can silence them.
const live = new Set<AudioScheduledSourceNode>()

export function trackOneShot(src: AudioScheduledSourceNode): void {
  live.add(src)
  src.addEventListener('ended', () => live.delete(src), { once: true })
}

export function stopOneShots(): void {
  for (const s of live) {
    try {
      s.stop()
    } catch {
      /* not started */
    }
  }
  live.clear()
}
