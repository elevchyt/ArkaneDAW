// How a playlist audio clip sounds: the pool sample with its channel's Sampler precomputed effects, then the
// clip's own time-stretch (rendered pitch-keeping, or played faster / slower in Resample mode).
import { PPQ, type Clip, type Project } from '../store/types'
import { clipBuffer } from './samples'
import { processingKey } from '../plugins/sampler/process'
import { isResample, timeStretch } from '../plugins/sampler/stretch'

export interface ClipPlayback {
  buf: AudioBuffer
  /** AudioBufferSourceNode playbackRate: buffer seconds per timeline second */
  rate: number
}

const stretched = new Map<string, { base: AudioBuffer; buf: AudioBuffer }>()
const MAX_CACHED = 24

function samplerParams(p: Project, clip: Clip): Record<string, number> | undefined {
  const owner = clip.channelId ? p.channels.find((c) => c.id === clip.channelId) : undefined
  return owner?.plugin?.pluginId === 'sampler' ? owner.plugin.params : undefined
}

export function clipPlayback(p: Project, clip: Clip, raw: AudioBuffer): ClipPlayback {
  const params = samplerParams(p, clip)
  const base = clipBuffer(raw, clip.ref, params)
  const s = clip.stretch ?? 1
  if (Math.abs(s - 1) < 1e-4) return { buf: base, rate: 1 }
  const mode = params?.stretchMode ?? 0
  if (isResample(mode)) return { buf: base, rate: 1 / s }
  const key = `${clip.ref}|${params ? processingKey(params) : ''}|${s.toFixed(5)}|${Math.round(mode)}`
  const hit = stretched.get(key)
  if (hit && hit.base === base) return { buf: hit.buf, rate: 1 }
  const chans = timeStretch(Array.from({ length: base.numberOfChannels }, (_, c) => base.getChannelData(c)), base.sampleRate, s, mode)
  const buf = new AudioBuffer({ numberOfChannels: chans.length, length: chans[0].length, sampleRate: base.sampleRate })
  chans.forEach((d, c) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, c))
  stretched.delete(key)
  stretched.set(key, { base, buf })
  while (stretched.size > MAX_CACHED) stretched.delete(stretched.keys().next().value!)
  return { buf, rate: 1 }
}

/**
 * Start `clip` on `src` (already connected): `intoSec` timeline seconds into the clip, for `durSec`.
 * Returns false when there's nothing left to play.
 */
export function startClip(src: AudioBufferSourceNode, pb: ClipPlayback, clip: Clip, tempo: number, when: number, intoTicks = 0): boolean {
  const tps = (tempo * PPQ) / 60
  const offset = ((clip.offset + intoTicks) / tps) * pb.rate
  const dur = ((clip.length - intoTicks) / tps) * pb.rate
  if (offset >= pb.buf.duration || dur <= 0) return false
  src.buffer = pb.buf
  src.playbackRate.value = pb.rate
  src.start(when, offset, dur)
  return true
}

/** Nearest frame (within ±radius) where the signal crosses zero, or `frame` if there is none. */
export function nearestZeroCross(channels: readonly Float32Array[], frame: number, radius: number): number {
  const n = channels[0]?.length ?? 0
  const f = Math.round(frame)
  if (!n || f <= 0 || f >= n) return frame
  const mono = (i: number) => {
    let v = 0
    for (const c of channels) v += c[i]
    return v
  }
  if (mono(f) === 0) return f
  for (let d = 1; d <= radius; d++) {
    for (const i of [f - d, f + d]) {
      if (i <= 0 || i >= n) continue
      const a = mono(i - 1)
      const b = mono(i)
      if (b === 0 || (a < 0) !== (b < 0)) return i
    }
  }
  return frame
}

/** Zero-cross snap for playlist edits: move `tick` (inside audio clip `clip`) to the nearest zero crossing. */
export function zeroCrossTick(p: Project, clip: Clip, tick: number, raw: AudioBuffer | undefined): number {
  if (clip.kind !== 'audio' || !raw) return tick
  const pb = clipPlayback(p, clip, raw)
  const tps = (p.tempo * PPQ) / 60
  const framesPerTick = (pb.buf.sampleRate / tps) * pb.rate
  const frame = (tick - clip.start + clip.offset) * framesPerTick
  const chans = Array.from({ length: pb.buf.numberOfChannels }, (_, c) => pb.buf.getChannelData(c))
  const z = nearestZeroCross(chans, frame, Math.round(pb.buf.sampleRate * 0.01))
  return z === frame ? tick : clip.start - clip.offset + z / framesPerTick
}
