// Content packs (renderer): progress/ETA math, status transitions, menu badges / entry info, guard decisions,
// and pack-root resolution (installed pack vs dev checkout fallback vs not installed).
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { entryPack } from './entry'
import { resolvePackRoot, type PackEnv } from './paths'
import { etaSeconds, fmtBytes, fmtEta, fmtProgress, fmtSpeed, percent, updateRate } from './progress'
import { getPack, packForPlugin, PACKS } from './registry'
import { isUsable, nextStatus, packBadge, type PackStatus } from './status'

const installed = (version: string) => ({ id: 'concerto', version, sha256: 'x', files: 1, installedAt: '' })

describe('progress math', () => {
  it('smooths speed and computes ETA', () => {
    let r = updateRate(undefined, 0, 0)
    expect(r.speed).toBe(0)
    r = updateRate(r, 1_000_000, 1000) // 1 MB/s
    expect(r.speed).toBe(1_000_000)
    const same = updateRate(r, 1_100_000, 1100) // < minDt: ignored
    expect(same).toBe(r)
    r = updateRate(r, 4_000_000, 2000) // 3 MB/s instant → EMA 1 + 0.3*(3-1) = 1.6 MB/s
    expect(r.speed).toBeCloseTo(1_600_000)
    expect(etaSeconds(4_000_000, 20_000_000, r.speed)).toBeCloseTo(10)
    expect(etaSeconds(1, 0, 5)).toBeNull()
    expect(etaSeconds(1, 10, 0)).toBeNull()
    expect(updateRate(r, 10, 3000).speed).toBe(0) // restarted download resets
  })
  it('formats', () => {
    expect(percent(50, 200)).toBe(25)
    expect(percent(5, 0)).toBe(0)
    expect(percent(300, 200)).toBe(100)
    expect(fmtBytes(189467648)).toBe('181 MB')
    expect(fmtBytes(2048)).toBe('2 KB')
    expect(fmtProgress(12.5 * 1048576, 189467648)).toBe('12.5 / 181 MB')
    expect(fmtSpeed(2.5 * 1048576)).toBe('2.5 MB/s')
    expect(fmtSpeed(0)).toBe('—')
    expect(fmtEta(42.2)).toBe('43 s left')
    expect(fmtEta(125)).toBe('2 min 5 s left')
    expect(fmtEta(null)).toBe('—')
  })
})

describe('pack status transitions', () => {
  const unknown: PackStatus = { state: 'unknown' }
  it('disk checks', () => {
    expect(nextStatus(unknown, { type: 'checked', installed: null, dev: false, latest: '1.0.0' })).toEqual({ state: 'not-installed' })
    expect(nextStatus(unknown, { type: 'checked', installed: null, dev: true, latest: '1.0.0' })).toMatchObject({ state: 'installed', source: 'dev' })
    expect(nextStatus(unknown, { type: 'checked', installed: installed('1.0.0'), dev: true, latest: '1.0.0' })).toEqual({ state: 'installed', version: '1.0.0', source: 'pack' })
    expect(nextStatus(unknown, { type: 'checked', installed: installed('0.9.0'), dev: false, latest: '1.0.0' })).toEqual({ state: 'update-available', version: '0.9.0', latest: '1.0.0' })
  })
  it('download → install → done; checks never interrupt a running install', () => {
    let s = nextStatus({ state: 'not-installed' }, { type: 'start' })
    expect(s.state).toBe('downloading')
    s = nextStatus(s, { type: 'progress', p: { id: 'concerto', phase: 'manifest', received: 0, total: 0 }, now: 0 })
    expect(s.state).toBe('downloading')
    s = nextStatus(s, { type: 'progress', p: { id: 'concerto', phase: 'download', received: 0, total: 1000 }, now: 0 })
    s = nextStatus(s, { type: 'progress', p: { id: 'concerto', phase: 'download', received: 500, total: 1000 }, now: 1000 })
    expect(s).toMatchObject({ state: 'downloading', received: 500, total: 1000, speed: 500, eta: 1 })
    expect(nextStatus(s, { type: 'checked', installed: null, dev: false, latest: '1.0.0' })).toBe(s)
    s = nextStatus(s, { type: 'progress', p: { id: 'concerto', phase: 'verify', received: 1000, total: 1000 }, now: 2000 })
    expect(s).toMatchObject({ state: 'installing', phase: 'verify' })
    s = nextStatus(s, { type: 'progress', p: { id: 'concerto', phase: 'extract', received: 10, total: 1000 }, now: 2100 })
    expect(s).toMatchObject({ state: 'installing', phase: 'extract', done: 10 })
    s = nextStatus(s, { type: 'done', installed: installed('1.0.0'), latest: '1.0.0' })
    expect(s).toEqual({ state: 'installed', version: '1.0.0', source: 'pack' })
    expect(isUsable(s)).toBe(true)
  })
  it('failure → error (retry possible)', () => {
    const s = nextStatus({ state: 'downloading', received: 1, total: 2, speed: 0, eta: null }, { type: 'failed', code: 'not-published', message: 'Pack not published yet' })
    expect(s).toEqual({ state: 'error', code: 'not-published', message: 'Pack not published yet' })
    expect(nextStatus(s, { type: 'start' }).state).toBe('downloading')
    expect(isUsable(s)).toBe(false)
  })
})

describe('menu badges & catalogue entries', () => {
  it('badge per status', () => {
    expect(packBadge({ state: 'installed', version: '1', source: 'pack' }, 189467648)).toBeNull()
    expect(packBadge({ state: 'unknown' }, 189467648)).toBeNull()
    expect(packBadge({ state: 'not-installed' }, 189467648)).toMatchObject({ kind: 'download', label: '⬇ 181 MB' })
    expect(packBadge({ state: 'downloading', received: 50, total: 200, speed: 1, eta: 1 }, 1)).toMatchObject({ kind: 'progress', pct: 25, label: '25%' })
    expect(packBadge({ state: 'installing', phase: 'extract', done: 1, total: 2 }, 1)).toMatchObject({ kind: 'installing' })
    expect(packBadge({ state: 'error', code: 'network', message: 'offline' }, 1)).toMatchObject({ kind: 'error', label: '⚠ retry', title: 'offline' })
    expect(packBadge({ state: 'update-available', version: '1', latest: '2' }, 1)?.kind).toBe('update')
  })
  it('entryPack marks only pack plugins, only where packs are supported', () => {
    const status: Record<string, PackStatus> = { concerto: { state: 'not-installed' }, studiodrums: { state: 'installed', version: '1.0.0', source: 'pack' } }
    expect(entryPack('concerto', status, true)).toEqual({ id: 'concerto', installed: false, sizeBytes: getPack('concerto')!.sizeBytes })
    expect(entryPack('studiodrums', status, true)?.installed).toBe(true)
    expect(entryPack('triposc', status, true)).toBeUndefined()
    expect(entryPack('concerto', status, false)).toBeUndefined()
    expect(entryPack('concerto', { concerto: { state: 'unknown' } }, true)?.installed).toBe(true)
  })
  it('registry', () => {
    expect(packForPlugin('concerto')?.id).toBe('concerto')
    expect(packForPlugin('studiodrums')?.id).toBe('studiodrums')
    for (const p of PACKS) {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(p.sizeBytes).toBeGreaterThan(0)
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})

describe('pack root resolution', () => {
  const env = (o: Partial<PackEnv>): PackEnv => ({ packsDir: '/u/packs', isPackaged: true, resources: '/app/resources', repo: 'a/b', baseUrl: '', ...o })
  const fsWith = (paths: string[]) => async (p: string) => paths.includes(p)
  it('installed pack first', async () => {
    const r = await resolvePackRoot('concerto', 'concerto', env({ isPackaged: false }), fsWith(['/u/packs/concerto/pack.json', '/app/resources/concerto/index.json']), join)
    expect(r).toEqual({ dir: '/u/packs/concerto', source: 'pack' })
  })
  it('dev checkout fallback only when unpackaged', async () => {
    const files = fsWith(['/app/resources/drumkits/index.json'])
    expect(await resolvePackRoot('studiodrums', 'drumkits', env({ isPackaged: false }), files, join)).toEqual({ dir: '/app/resources/drumkits', source: 'dev' })
    expect(await resolvePackRoot('studiodrums', 'drumkits', env({ isPackaged: true }), files, join)).toBeNull()
  })
  it('a pack folder without pack.json (interrupted install) is not installed', async () => {
    expect(await resolvePackRoot('concerto', 'concerto', env({}), fsWith(['/u/packs/concerto/index.json']), join)).toBeNull()
  })
  it('no pack IPC (packsDir null) → dev fallback only', async () => {
    expect(await resolvePackRoot('concerto', 'concerto', env({ packsDir: null, isPackaged: false }), fsWith(['/app/resources/concerto/index.json']), join)).toMatchObject({ source: 'dev' })
  })
})

describe('selection guard', () => {
  it('runs the action when installed / not a pack plugin, prompts otherwise', async () => {
    const { packDecision } = await import('./guard')
    const { usePacks } = await import('./store')
    const set = (s: PackStatus) => usePacks.setState((st) => ({ status: { ...st.status, concerto: s } }))
    expect(packDecision('triposc', true)).toEqual({ action: 'run' })
    set({ state: 'not-installed' })
    expect(packDecision('concerto', true)).toEqual({ action: 'prompt', packId: 'concerto' })
    expect(packDecision('concerto', false)).toEqual({ action: 'run' }) // browser mode: legacy behaviour
    set({ state: 'downloading', received: 1, total: 2, speed: 0, eta: null })
    expect(packDecision('concerto', true).action).toBe('prompt')
    set({ state: 'unknown' })
    expect(packDecision('concerto', true).action).toBe('check')
    set({ state: 'update-available', version: '0.9.0', latest: '1.0.0' })
    expect(packDecision('concerto', true)).toEqual({ action: 'run' })
  })
})
