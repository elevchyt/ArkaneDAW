// Test support (node only): read kit.json files from resources/drumkits and decode FLAC samples with ffmpeg
// so the DSP can be rendered offline under vitest.
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { KitJson, ResolvedDrumsData } from './types'

export const DRUMKITS_DIR = resolve(__dirname, '../../../../../resources/drumkits')

export const hasKits = existsSync(join(DRUMKITS_DIR, 'index.json'))

export const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

export function kitIds(): string[] {
  if (!hasKits) return []
  return (JSON.parse(readFileSync(join(DRUMKITS_DIR, 'index.json'), 'utf8')) as { kits: { id: string }[] }).kits.map((k) => k.id)
}

export function readKit(id: string): KitJson {
  return JSON.parse(readFileSync(join(DRUMKITS_DIR, id, 'kit.json'), 'utf8')) as KitJson
}

const pcmCache = new Map<string, Promise<Int16Array[]>>()

/** Decode a kit file to 16-bit PCM at 48 kHz (one Int16Array per channel). */
export function decodeFile(file: string, channels: number): Promise<Int16Array[]> {
  let p = pcmCache.get(file)
  if (!p) {
    p = new Promise((res, rej) => {
      execFile('ffmpeg', ['-v', 'error', '-i', join(DRUMKITS_DIR, file), '-f', 's16le', '-ar', '48000', '-ac', String(channels), '-'], { encoding: 'buffer', maxBuffer: 1 << 28 }, (err, out) => {
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

/** Resolved DSP data for a kit with all of its PCM attached (what loader.ts produces in the app). */
export async function resolvedKit(id: string, pieces?: string[]): Promise<ResolvedDrumsData> {
  const kit = readKit(id)
  const jobs: [string, number][] = []
  for (const [pid, p] of Object.entries(kit.pieces)) {
    if (pieces && !pieces.includes(pid)) continue
    for (const l of p.layers) for (const f of l.files) jobs.push([f, p.channels])
  }
  const pcm: Record<string, Int16Array[]> = {}
  let next = 0
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < jobs.length) {
        const [f, ch] = jobs[next++]
        pcm[f] = await decodeFile(f, ch)
      }
    })
  )
  return { kit: id, kitDef: kit, pcm }
}
