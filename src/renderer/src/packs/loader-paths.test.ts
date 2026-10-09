// Concerto / Studio Drums loaders against a fake Electron host: sample root = installed pack, else dev checkout
// (unpackaged only), else "not installed" (silent DSP data + 'unavailable' status), and the switch after install.
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(path.join(tmpdir(), 'arkane-loader-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const ctx = { sampleRate: 48000, decodeAudioData: async () => ({ numberOfChannels: 1, length: 0, getChannelData: () => new Float32Array(0) }) } as unknown as BaseAudioContext

function fakeHost(o: { packsDir: string; resources: string; isPackaged: boolean; withIpc?: boolean }): void {
  ;(globalThis as Record<string, unknown>).arkaneHost = {
    fsp,
    path,
    paths: async () => ({ resources: o.resources }),
    ...(o.withIpc === false ? {} : { packs: { info: async () => ({ packsDir: o.packsDir, isPackaged: o.isPackaged, resources: o.resources, repo: 'a/b', baseUrl: '' }) } })
  }
}

function writeConcerto(dir: string, marker: boolean): void {
  mkdirSync(path.join(dir, 'lute'), { recursive: true })
  writeFileSync(path.join(dir, 'index.json'), '{"format":1}')
  writeFileSync(path.join(dir, 'lute', 'instrument.json'), JSON.stringify({ id: 'lute', name: `Lute @ ${dir}`, articulations: [] }))
  if (marker) writeFileSync(path.join(dir, 'pack.json'), '{"id":"concerto","version":"1.0.0"}')
}

const lute = { layers: [{ inst: 'lute', lo: 0, hi: 127, gain: 0, transpose: 0 }] }

describe('Concerto loader sample root', () => {
  beforeEach(() => vi.resetModules())

  it('not installed (packaged, nothing downloaded) → silent data + "unavailable" status', async () => {
    const base = path.join(root, 'a')
    writeConcerto(path.join(base, 'resources', 'concerto'), false) // present in resources but app is packaged
    fakeHost({ packsDir: path.join(base, 'packs'), resources: path.join(base, 'resources'), isPackaged: true })
    const loader = await import('../plugins/concerto/loader')
    const r = await loader.resolveConcerto(lute, ctx)
    expect(r.error).toBe('not-installed')
    expect(r.defs).toBeUndefined()
    expect(loader.instStatus('lute')).toMatchObject({ state: 'unavailable', message: expect.stringMatching(/not installed/) })
  })

  it('dev checkout fallback when unpackaged; installed pack wins once present', async () => {
    const base = path.join(root, 'b')
    const res = path.join(base, 'resources')
    const packs = path.join(base, 'packs')
    writeConcerto(path.join(res, 'concerto'), false)
    fakeHost({ packsDir: packs, resources: res, isPackaged: false })
    const loader = await import('../plugins/concerto/loader')
    const paths = await import('./paths')
    expect(await loader.concertoDir()).toBe(path.join(res, 'concerto'))
    const a = await loader.resolveConcerto(lute, ctx)
    expect(a.defs?.lute.name).toBe(`Lute @ ${path.join(res, 'concerto')}`)
    // install the pack → invalidate → the loader re-reads from the pack dir
    writeConcerto(path.join(packs, 'concerto'), true)
    paths.invalidatePackRoot('concerto')
    expect(await loader.concertoDir()).toBe(path.join(packs, 'concerto'))
    const b = await loader.resolveConcerto(lute, ctx)
    expect(b.defs?.lute.name).toBe(`Lute @ ${path.join(packs, 'concerto')}`)
  })

  it('works with a main process without pack IPC (dev fallback only)', async () => {
    const base = path.join(root, 'c')
    writeConcerto(path.join(base, 'resources', 'concerto'), false)
    fakeHost({ packsDir: '', resources: path.join(base, 'resources'), isPackaged: false, withIpc: false })
    const loader = await import('../plugins/concerto/loader')
    expect((await loader.resolveConcerto(lute, ctx)).defs?.lute.id).toBe('lute')
  })
})

describe('Studio Drums loader sample root', () => {
  beforeEach(() => vi.resetModules())

  it('not installed → silent data; installed pack → kit loads', async () => {
    const base = path.join(root, 'd')
    const packs = path.join(base, 'packs')
    fakeHost({ packsDir: packs, resources: path.join(base, 'resources'), isPackaged: true })
    const loader = await import('../plugins/studiodrums/loader')
    const paths = await import('./paths')
    const r = await loader.resolveStudioDrums({ kit: 'latin' }, ctx)
    expect(r.error).toBe('not-installed')
    expect(loader.kitStatus('latin').state).toBe('unavailable')
    const dir = path.join(packs, 'studiodrums', 'latin')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(packs, 'studiodrums', 'index.json'), '{}')
    writeFileSync(path.join(dir, 'kit.json'), JSON.stringify({ id: 'latin', pieces: {} }))
    writeFileSync(path.join(packs, 'studiodrums', 'pack.json'), '{"id":"studiodrums","version":"1.0.0"}')
    paths.invalidatePackRoot('studiodrums')
    const ok = await loader.resolveStudioDrums({ kit: 'latin' }, ctx)
    expect(ok.error).toBeUndefined()
    expect(ok.kitDef?.id).toBe('latin')
  })
})
