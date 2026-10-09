// resolveData() with a fake Electron host (node fs/path) and a fake AudioContext whose decodeAudioData uses
// ffmpeg — checks that instruments load from resources/concerto and that PCM is shipped once per context.
import { execFileSync } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { dirname } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CONCERTO_DIR, hasData, hasFfmpeg } from './testkit'
import { readData } from './types'

type Loader = typeof import('./loader')

function fakeCtx(): BaseAudioContext {
  return {
    sampleRate: 48000,
    decodeAudioData: async (ab: ArrayBuffer) => {
      const out = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'f32le', '-ar', '48000', '-'], { input: Buffer.from(ab), maxBuffer: 1 << 28 })
      const ch = ((new Uint8Array(ab)[20] >> 1) & 7) + 1
      const all = new Float32Array(out.buffer, out.byteOffset, out.byteLength >> 2)
      const n = (all.length / ch) | 0
      const chans = Array.from({ length: ch }, (_, c) => Float32Array.from({ length: n }, (_, i) => all[i * ch + c]))
      return { numberOfChannels: ch, length: n, sampleRate: 48000, getChannelData: (c: number) => chans[c] } as unknown as AudioBuffer
    }
  } as unknown as BaseAudioContext
}

describe.skipIf(!hasData || !hasFfmpeg)('Concerto loader (resolveData)', () => {
  let loader: Loader
  beforeAll(async () => {
    ;(globalThis as Record<string, unknown>).arkaneHost = { fsp, path, paths: async () => ({ resources: dirname(CONCERTO_DIR) }) }
    loader = await import('./loader')
  })

  it('loads every layer, attaches 16-bit PCM and ships each file only once per context', async () => {
    const ctx = fakeCtx()
    const data = { layers: [{ inst: 'lute', lo: 0, hi: 127, gain: 0, transpose: 0 }, { inst: 'choir', lo: 0, hi: 127, gain: -6, transpose: 0 }] }
    const a = await loader.resolveConcerto(data, ctx)
    expect(a.error).toBeUndefined()
    expect(Object.keys(a.defs ?? {}).sort()).toEqual(['choir', 'lute'])
    const files = [...loader.instrumentFiles(a.defs!.lute), ...loader.instrumentFiles(a.defs!.choir)]
    expect(Object.keys(a.pcm ?? {}).sort()).toEqual([...files].sort())
    expect(a.pcm![files[0]][0]).toBeInstanceOf(Int16Array)
    expect(loader.instStatus('lute').state).toBe('ready')
    // same context again: no PCM resent
    const b = await loader.resolveConcerto(data, ctx)
    expect(b.defs?.lute.id).toBe('lute')
    expect(b.pcm).toBeUndefined()
    // a new context (offline export) gets the PCM again
    const c = await loader.resolveConcerto({ layers: [data.layers[0]] }, fakeCtx())
    expect(Object.keys(c.pcm ?? {}).length).toBe(loader.instrumentFiles(a.defs!.lute).length)
  }, 120_000)

  it('reports a missing instrument instead of throwing; unknown data falls back to the default', async () => {
    const r = await loader.resolveConcerto({ layers: [{ inst: 'does-not-exist', lo: 0, hi: 127, gain: 0, transpose: 0 }] }, fakeCtx())
    expect(r.error).toBeDefined()
    expect(loader.instStatus('does-not-exist').state).toBe('error')
    expect(readData(null).layers[0].inst).toBe('strings')
    expect(readData({ layers: [{ inst: 'harp' }, 5, { inst: 'flute', gain: -3 }, { inst: 'oboe' }, { inst: 'horn' }] }).layers.map((l) => l.inst)).toEqual(['harp', 'flute', 'oboe'])
  }, 120_000)
})
