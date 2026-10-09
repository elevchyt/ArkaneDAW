// Pack status model + transitions + menu badge logic (pure, unit-tested).
import type { InstalledPack, PackErrorCode, PackProgress } from '../../../main/packs'
import { etaSeconds, fmtBytes, percent, updateRate, type Rate } from './progress'

export type PackStatus =
  | { state: 'unknown' }
  | { state: 'not-installed' }
  | { state: 'downloading'; received: number; total: number; speed: number; eta: number | null; rate?: Rate }
  | { state: 'installing'; phase: 'verify' | 'extract'; done: number; total: number }
  | { state: 'installed'; version: string; source: 'pack' | 'dev' }
  | { state: 'update-available'; version: string; latest: string }
  | { state: 'error'; code: PackErrorCode | 'unsupported'; message: string }

export type PackEvent =
  /** result of looking at disk: installed pack (or null) and whether a dev checkout copy exists */
  | { type: 'checked'; installed: InstalledPack | null; dev: boolean; latest: string }
  | { type: 'start' }
  | { type: 'progress'; p: PackProgress; now: number }
  | { type: 'done'; installed: InstalledPack; latest: string }
  | { type: 'failed'; code: PackErrorCode | 'unsupported'; message: string }

export const isBusy = (s: PackStatus | undefined): boolean => s?.state === 'downloading' || s?.state === 'installing'
/** Usable right now (an outdated pack still works until updated). */
export const isUsable = (s: PackStatus | undefined): boolean => s?.state === 'installed' || s?.state === 'update-available'

function fromDisk(installed: InstalledPack | null, dev: boolean, latest: string): PackStatus {
  if (installed) return installed.version === latest ? { state: 'installed', version: installed.version, source: 'pack' } : { state: 'update-available', version: installed.version, latest }
  if (dev) return { state: 'installed', version: 'dev', source: 'dev' }
  return { state: 'not-installed' }
}

export function nextStatus(prev: PackStatus, ev: PackEvent): PackStatus {
  switch (ev.type) {
    case 'checked':
      // a disk check never interrupts a running install
      return isBusy(prev) ? prev : fromDisk(ev.installed, ev.dev, ev.latest)
    case 'start':
      return { state: 'downloading', received: 0, total: 0, speed: 0, eta: null }
    case 'progress': {
      const { p } = ev
      if (p.phase === 'manifest') return prev.state === 'downloading' ? prev : { state: 'downloading', received: 0, total: 0, speed: 0, eta: null }
      if (p.phase === 'download') {
        const rate = updateRate(prev.state === 'downloading' ? prev.rate : undefined, p.received, ev.now)
        return { state: 'downloading', received: p.received, total: p.total, speed: rate.speed, eta: etaSeconds(p.received, p.total, rate.speed), rate }
      }
      if (p.phase === 'verify' || p.phase === 'extract') return { state: 'installing', phase: p.phase, done: p.received, total: p.total }
      return prev // 'done' is confirmed by the install result
    }
    case 'done':
      return fromDisk(ev.installed, false, ev.latest)
    case 'failed':
      return { state: 'error', code: ev.code, message: ev.message }
  }
}

export type Badge =
  | { kind: 'download'; label: string; title: string }
  | { kind: 'progress'; pct: number; label: string; title: string }
  | { kind: 'installing'; label: string; title: string }
  | { kind: 'update'; label: string; title: string }
  | { kind: 'error'; label: string; title: string }

/** What a menu item for a pack plugin shows next to its name (null = nothing: installed). */
export function packBadge(s: PackStatus | undefined, sizeBytes: number): Badge | null {
  const size = sizeBytes ? fmtBytes(sizeBytes) : ''
  switch (s?.state) {
    case undefined:
    case 'unknown':
    case 'installed':
      return null
    case 'not-installed':
      return { kind: 'download', label: `⬇ ${size}`.trim(), title: `Sound library not installed — click to download${size ? ` (${size})` : ''}` }
    case 'downloading': {
      const pct = percent(s.received, s.total)
      return { kind: 'progress', pct, label: `${pct}%`, title: `Downloading… ${pct}%` }
    }
    case 'installing':
      return { kind: 'installing', label: s.phase === 'verify' ? 'verifying…' : 'installing…', title: 'Installing the sound library…' }
    case 'update-available':
      return { kind: 'update', label: '⬆ update', title: `Sound library ${s.version} installed — ${s.latest} available` }
    case 'error':
      return { kind: 'error', label: s.code === 'not-published' ? '⬇ n/a' : '⚠ retry', title: s.message }
  }
}
