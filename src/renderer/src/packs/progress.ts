// Download speed / ETA math and byte formatting for the pack progress UI (pure).

export interface Rate {
  /** time (ms) and byte count of the last sample */
  t: number
  bytes: number
  /** smoothed bytes per second (0 until the second sample) */
  speed: number
}

/** Exponentially smoothed transfer rate. Samples closer than `minDt` ms are folded into the next one. */
export function updateRate(prev: Rate | undefined, bytes: number, now: number, minDt = 250, alpha = 0.3): Rate {
  if (!prev || bytes < prev.bytes) return { t: now, bytes, speed: 0 }
  const dt = now - prev.t
  if (dt < minDt) return prev
  const inst = ((bytes - prev.bytes) * 1000) / dt
  return { t: now, bytes, speed: prev.speed ? prev.speed + alpha * (inst - prev.speed) : inst }
}

/** Seconds remaining, or null when unknown. */
export function etaSeconds(received: number, total: number, speed: number): number | null {
  if (!total || speed <= 0) return null
  return Math.max(0, (total - received) / speed)
}

export function percent(received: number, total: number): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.floor((100 * received) / total)))
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 * 1024) return `${Math.round(n / 1024 ** 2)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/** "12.3 / 181 MB" */
export function fmtProgress(received: number, total: number): string {
  const mb = (x: number): string => (x / 1024 ** 2).toFixed(1)
  return total ? `${mb(received)} / ${Math.round(total / 1024 ** 2)} MB` : `${mb(received)} MB`
}

export function fmtSpeed(bps: number): string {
  if (bps <= 0) return '—'
  if (bps >= 1024 * 1024) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`
  return `${Math.round(bps / 1024)} KB/s`
}

export function fmtEta(s: number | null): string {
  if (s === null || !isFinite(s)) return '—'
  if (s < 1) return 'almost done'
  if (s < 60) return `${Math.ceil(s)} s left`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${Math.round(s % 60)} s left`
  return `${Math.floor(m / 60)} h ${m % 60} min left`
}
