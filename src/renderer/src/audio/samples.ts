// Audio pool: decoded sample buffers keyed by Sample.id, plus file loading helpers.
import { uid } from '../store/factory'
import type { Sample } from '../store/types'
import { getProject, editProject } from '../store/project'
import { host } from '../platform'
import { getAudioContext } from './context'
import { hasProcessing, processSample, processingKey } from '../plugins/sampler/process'

const buffers = new Map<string, AudioBuffer>()
const loading = new Map<string, Promise<AudioBuffer | null>>()

export function getBuffer(id: string): AudioBuffer | undefined {
  return buffers.get(id)
}

export function putBuffer(id: string, buf: AudioBuffer): void {
  buffers.set(id, buf)
}

export async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = getAudioContext()
  return ctx.decodeAudioData(data)
}

const processed = new Map<string, { raw: AudioBuffer; key: string; buf: AudioBuffer }>()

/**
 * The buffer an audio clip plays: the pool sample with its channel's Sampler "precomputed effects"
 * (normalize, reverse, fades...) applied. Cached per sample + settings.
 */
export function clipBuffer(raw: AudioBuffer, sampleId: string, params: Record<string, number> | undefined): AudioBuffer {
  if (!params || !hasProcessing(params)) return raw
  const key = processingKey(params)
  const hit = processed.get(sampleId)
  if (hit && hit.raw === raw && hit.key === key) return hit.buf
  const chans = processSample(Array.from({ length: raw.numberOfChannels }, (_, c) => raw.getChannelData(c)), raw.sampleRate, params)
  const buf = new AudioBuffer({ numberOfChannels: chans.length, length: raw.length, sampleRate: raw.sampleRate })
  chans.forEach((d, c) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, c))
  processed.set(sampleId, { raw, key, buf })
  return buf
}

/** Ensure a project sample is decoded (reads from disk if needed). */
export function loadSample(sample: Sample): Promise<AudioBuffer | null> {
  const cached = buffers.get(sample.id)
  if (cached) return Promise.resolve(cached)
  if (loading.has(sample.id)) return loading.get(sample.id)!
  const p = (async () => {
    if (!sample.path || !host) return null
    try {
      const file = await host.fsp.readFile(sample.path)
      const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
      const buf = await decode(ab)
      buffers.set(sample.id, buf)
      return buf
    } catch (e) {
      console.warn('sample load failed', sample.path, e)
      return null
    }
  })()
  loading.set(sample.id, p)
  return p
}

/** Import an audio file from disk into the project pool (dedupes by path). */
export async function importSampleFile(path: string): Promise<Sample | null> {
  const existing = getProject().samples.find((s) => s.path === path)
  if (existing) {
    await loadSample(existing)
    return existing
  }
  if (!host) return null
  const file = await host.fsp.readFile(path)
  const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
  const buf = await decode(ab)
  const sample: Sample = {
    id: uid(),
    name: host.path.basename(path).replace(/\.[^.]+$/, ''),
    path,
    duration: buf.duration,
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
    embedded: false
  }
  buffers.set(sample.id, buf)
  editProject('Import sample', (d) => {
    d.samples.push(sample)
  })
  return sample
}

/** Register an in-memory buffer (recording, rendered audio, generated one-shot). */
export function registerBuffer(name: string, buf: AudioBuffer, path: string | null = null): Sample {
  const sample: Sample = {
    id: uid(),
    name,
    path,
    duration: buf.duration,
    sampleRate: buf.sampleRate,
    channels: buf.numberOfChannels,
    embedded: path === null
  }
  buffers.set(sample.id, buf)
  editProject('Add audio', (d) => {
    d.samples.push(sample)
  })
  return sample
}

export interface ResolvedSample {
  sampleRate: number
  channels: Float32Array[]
}

/**
 * Plugin data may reference pool samples as { sampleId } (or nested objects with `sampleId`).
 * Before handing data to the worklet, attach the decoded PCM as `sample: ResolvedSample`.
 */
export async function resolvePluginData(data: unknown): Promise<unknown> {
  if (!data || typeof data !== 'object') return data
  if (Array.isArray(data)) return Promise.all(data.map(resolvePluginData))
  const obj = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = v && typeof v === 'object' && !ArrayBuffer.isView(v) ? await resolvePluginData(v) : v
  if (typeof obj.sampleId === 'string') {
    const s = getProject().samples.find((x) => x.id === obj.sampleId)
    const buf = s ? await loadSample(s) : buffers.get(obj.sampleId)
    if (buf) {
      const channels: Float32Array[] = []
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice())
      out.sample = { sampleRate: buf.sampleRate, channels } satisfies ResolvedSample
    }
  }
  return out
}

/** Encode an AudioBuffer as 16/24/32f WAV. */
export function encodeWav(buf: AudioBuffer, bits: 16 | 24 | 32 = 24): ArrayBuffer {
  const ch = buf.numberOfChannels
  const len = buf.length
  const bps = bits / 8
  const dataSize = len * ch * bps
  const ab = new ArrayBuffer(44 + dataSize)
  const v = new DataView(ab)
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, bits === 32 ? 3 : 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, buf.sampleRate, true)
  v.setUint32(28, buf.sampleRate * ch * bps, true)
  v.setUint16(32, ch * bps, true)
  v.setUint16(34, bits, true)
  w(36, 'data')
  v.setUint32(40, dataSize, true)
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      if (bits === 16) {
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      } else if (bits === 24) {
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff)
        v.setUint8(o, x & 0xff)
        v.setUint8(o + 1, (x >> 8) & 0xff)
        v.setUint8(o + 2, (x >> 16) & 0xff)
      } else {
        v.setFloat32(o, s, true)
      }
      o += bps
    }
  }
  return ab
}
