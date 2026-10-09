// resolveData() with a fake Electron host (node fs/path) and a fake AudioContext whose decodeAudioData
// uses ffmpeg — checks that kits load from resources/drumkits and that PCM is shipped once per context.
import { execFileSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { dirname } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { DRUMKITS_DIR, hasFfmpeg, hasKits } from './testkit'
import type { ResolvedDrumsData } from './types'

type Loader = typeof import('./loader')

function fakeCtx(): BaseAudioContext {
  return {
    sampleRate: 48000,
    decodeAudioData: async (ab: ArrayBuffer) => {
      const out = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ar', '48000', '-'], { input: Buffer.from(ab), maxBuffer: 1 << 28 })
      const ch = ((new Uint8Array(ab)[20] >> 1) & 7) + 1 // FLAC STREAMINFO channel count
      const all = new Float32Array(out.buffer, out.byteOffset, out.byteLength >> 2)
      const n = (all.length / ch) | 0
      const chans = Array.from({ length: ch }, (_, c) => Float32Array.from({ length: n }, (_, i) => all[i * ch + c]))
      return { numberOfChannels: ch, length: n, sampleRate: 48000, getChannelData: (c: number) => chans[c] } as unknown as AudioBuffer
    }
  } as unknown as BaseAudioContext
}

describe.skipIf(!hasKits || !hasFfmpeg)('loader (resolveData)', () => {
  let loader: Loader
  beforeAll(async () => {
    ;(globalThis as Record<string, unknown>).arkaneHost = { fsp, path, paths: async () => ({ resources: dirname(DRUMKITS_DIR) }) }
    loader = await import('./loader')
  })

  it('loads a kit, attaches 16-bit PCM and ships each file only once per context', async () => {
    const ctx = fakeCtx()
    const a = (await loader.resolveStudioDrums({ kit: 'latin' }, ctx)) as ResolvedDrumsData
    expect(a.error).toBeUndefined()
    expect(a.kitDef?.id).toBe('latin')
    const files = loader.kitFiles(a.kitDef!)
    expect(Object.keys(a.pcm ?? {}).sort()).toEqual([...files].sort())
    const first = a.pcm![files[0]]
    expect(first[0]).toBeInstanceOf(Int16Array)
    expect(first[0].length).toBeGreaterThan(100)
    expect(loader.kitStatus('latin').state).toBe('ready')
    // second instance / kit re-select in the same context: no PCM resent
    const b = await loader.resolveStudioDrums({ kit: 'latin' }, ctx)
    expect(b.kitDef?.id).toBe('latin')
    expect(b.pcm).toBeUndefined()
    // a new context (e.g. offline export) gets the PCM again
    const c = await loader.resolveStudioDrums({ kit: 'latin' }, fakeCtx())
    expect(Object.keys(c.pcm ?? {}).length).toBe(files.length)
  }, 120_000)

  it('reports a missing kit instead of throwing', async () => {
    const r = await loader.resolveStudioDrums({ kit: 'does-not-exist' }, fakeCtx())
    expect(r.error).toBeDefined()
    expect(loader.kitStatus('does-not-exist').state).toBe('error')
  })
})
