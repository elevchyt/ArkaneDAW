// Test support (node only): read instrument.json files from resources/concerto and decode the FLAC samples with
// ffmpeg so the DSP can be rendered offline under vitest.
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { InstrumentJson, LayerData, ResolvedConcertoData } from './types'

export const CONCERTO_DIR = resolve(__dirname, '../../../../../resources/concerto')

export const hasData = existsSync(join(CONCERTO_DIR, 'index.json'))

export const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

export function instrumentIds(): string[] {
  if (!hasData) return []
  return (JSON.parse(readFileSync(join(CONCERTO_DIR, 'index.json'), 'utf8')) as { instruments: { id: string }[] }).instruments.map((i) => i.id)
}

export function readInstrument(id: string): InstrumentJson {
  return JSON.parse(readFileSync(join(CONCERTO_DIR, id, 'instrument.json'), 'utf8')) as InstrumentJson
}

/** FLAC STREAMINFO channel count. */
function flacChannels(path: string): number {
  const b = readFileSync(path).subarray(0, 64)
  return ((b[20] >> 1) & 7) + 1
}

const pcmCache = new Map<string, Promise<Int16Array[]>>()

/** Decode a sample file to 16-bit PCM at 48 kHz (one Int16Array per channel). */
export function decodeFile(file: string): Promise<Int16Array[]> {
  let p = pcmCache.get(file)
  if (!p) {
    const path = join(CONCERTO_DIR, file)
    const channels = flacChannels(path)
    p = new Promise((res, rej) => {
      execFile('ffmpeg', ['-v', 'error', '-i', path, '-f', 's16le', '-ar', '48000', '-ac', String(channels), '-'], { encoding: 'buffer', maxBuffer: 1 << 28 }, (err, out) => {
        if (err) return rej(err)
        const all = new Int16Array(out.buffer, out.byteOffset, out.byteLength >> 1)
        const n = (all.length / channels) | 0
        const chans = Array.from({ length: channels }, () => new Int16Array(n))
        for (let i = 0; i < n; i++) for (let c = 0; c < channels; c++) chans[c][i] = all[i * channels + c]
        res(chans)
      })
    })
    pcmCache.set(file, p)
  }
  return p
}

export function allFiles(def: InstrumentJson): string[] {
  const s = new Set<string>()
  for (const a of def.articulations) for (const zl of [a.zones, a.release ?? []]) for (const z of zl) for (const l of z.layers) for (const f of l.files) s.add(f.f)
  return [...s]
}

/** Decode many files with bounded parallelism. */
export async function decodeAll(files: string[]): Promise<Record<string, Int16Array[]>> {
  const out: Record<string, Int16Array[]> = {}
  let next = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < files.length) {
        const f = files[next++]
        out[f] = await decodeFile(f)
      }
    })
  )
  return out
}

/** Resolved DSP data for 1–3 layers with all PCM attached (what loader.ts produces in the app). */
export async function resolved(layers: (string | LayerData)[]): Promise<ResolvedConcertoData> {
  const ls: LayerData[] = layers.map((l) => (typeof l === 'string' ? { inst: l, lo: 0, hi: 127, gain: 0, transpose: 0 } : l))
  const defs: Record<string, InstrumentJson> = {}
  for (const l of ls) defs[l.inst] = readInstrument(l.inst)
  const pcm = await decodeAll([...new Set(Object.values(defs).flatMap(allFiles))])
  return { layers: ls, defs, pcm }
}
