// Audio helpers for the Concerto build: ffmpeg decode/resample to 48 kHz float, FLAC encoding, trimming,
// loudness measurement. (Encoding / pool helpers adapted from scripts/drumkits/lib/audio.mjs.)
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeWavF32 } from './wav.mjs'

export const SR = 48000
export const dbToGain = (db) => Math.pow(10, db / 20)

let tmpRoot = null
let tmpCounter = 0
function tmpFile(ext = 'wav') {
  if (!tmpRoot) {
    tmpRoot = mkdtempSync(join(tmpdir(), 'arkane-concerto-'))
    process.on('exit', () => rmSync(tmpRoot, { recursive: true, force: true }))
  }
  return join(tmpRoot, `s${tmpCounter++}.${ext}`)
}

function run(cmd, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
    const out = []
    let err = ''
    if (capture) p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(capture ? Buffer.concat(out) : null) : reject(new Error(`${cmd} exited ${code}: ${err}`))))
  })
}

function deinterleave(buf, channels) {
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2)
  const n = Math.floor(all.length / channels)
  const out = Array.from({ length: channels }, () => new Float32Array(n))
  for (let i = 0, k = 0; i < n; i++) for (let c = 0; c < channels; c++) out[c][i] = all[k++]
  return out
}

/** Decode any audio file to float channels at 48 kHz (soxr). */
export async function decodeFile(ffmpeg, path, channels) {
  const buf = await run(ffmpeg, ['-v', 'error', '-i', path, '-af', 'aresample=48000:resampler=soxr:precision=28', '-ac', String(channels), '-f', 'f32le', '-'], { capture: true })
  return deinterleave(buf, channels)
}

/** Resample float channels from `sr` to 48 kHz (identity when sr is already 48 kHz). */
export async function resample(ffmpeg, channels, sr) {
  if (sr === SR) return channels.map((c) => Float32Array.from(c))
  const tmp = tmpFile()
  writeFileSync(tmp, encodeWavF32(channels, sr))
  const buf = await run(ffmpeg, ['-v', 'error', '-i', tmp, '-af', 'aresample=48000:resampler=soxr:precision=28', '-f', 'f32le', '-'], { capture: true })
  rmSync(tmp, { force: true })
  return deinterleave(buf, channels.length)
}

/** Encode 48 kHz float channels to 16-bit FLAC (triangular dither). */
export async function encodeFlac(ffmpeg, channels, outPath) {
  const tmp = tmpFile()
  writeFileSync(tmp, encodeWavF32(channels, SR))
  await run(ffmpeg, ['-y', '-v', 'error', '-i', tmp, '-af', 'aresample=osf=s16:dither_method=triangular', '-c:a', 'flac', '-compression_level', '12', '-map_metadata', '-1', outPath])
  rmSync(tmp, { force: true })
}

export function peakOf(channels, from = 0, to = Infinity) {
  let p = 0
  for (const c of channels) for (let i = from, e = Math.min(to, c.length); i < e; i++) {
    const a = Math.abs(c[i])
    if (a > p) p = a
  }
  return p
}

/** Mono mixdown (new array). */
export function mono(channels) {
  if (channels.length === 1) return Float32Array.from(channels[0])
  const n = channels[0].length
  const m = new Float32Array(n)
  for (const c of channels) for (let i = 0; i < n; i++) m[i] += c[i] / channels.length
  return m
}

/** RMS envelope (hop seconds), mono mix. */
export function envelope(channels, hop = 0.01) {
  const h = Math.round(SR * hop)
  const n = channels[0].length
  const frames = Math.ceil(n / h)
  const env = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let s = 0, k = 0
    for (const c of channels) for (let i = f * h, e = Math.min(n, (f + 1) * h); i < e; i++, k++) s += c[i] * c[i]
    env[f] = Math.sqrt(s / Math.max(1, k))
  }
  return { env, hop: h }
}

/** RMS over [from, to) frames, channel powers summed (stereo plays as-is, mono at -3 dB per side). */
export function rms(channels, from, to) {
  from = Math.max(0, from | 0)
  to = Math.min(channels[0].length, to | 0)
  let s = 0
  for (const c of channels) for (let i = from; i < to; i++) s += c[i] * c[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

/** Index of the first frame above `db` relative to the peak (sample onset). */
export function onsetIndex(channels, db = -42) {
  const thr = peakOf(channels) * dbToGain(db)
  const n = channels[0].length
  for (let i = 0; i < n; i++) for (const c of channels) if (Math.abs(c[i]) > thr) return i
  return 0
}

/** Cut leading silence (keeps `preMs` of pre-roll with a short fade-in). */
export function trimStart(channels, { db = -42, preMs = 3 } = {}) {
  const on = onsetIndex(channels, db)
  const pre = Math.round((preMs / 1000) * SR)
  const start = Math.max(0, on - pre)
  return channels.map((c) => {
    const o = c.slice(start)
    const f = Math.min(pre, o.length)
    for (let i = 0; i < f; i++) o[i] *= i / f
    return o
  })
}

/**
 * One-shot tail handling: cut where the signal stays below `floorDb` (re peak) or at maxLen seconds, then fade.
 * Truncated ringing tails get a long fade (last 35 %).
 */
export function trimTail(channels, { maxLen = 4, floorDb = -60, fadeMs = 20 } = {}) {
  const n = channels[0].length
  const peak = peakOf(channels) || 1
  const floor = peak * dbToGain(floorDb)
  const w = Math.round(SR * 0.005)
  let end = n
  for (let s = n - w; s > 0; s -= w) {
    let m = 0
    for (const c of channels) for (let i = Math.max(s, 0); i < s + w && i < n; i++) m = Math.max(m, Math.abs(c[i]))
    if (m > floor) {
      end = Math.min(n, s + w)
      break
    }
  }
  const maxN = Math.round(maxLen * SR)
  const cut = end > maxN
  if (cut) end = maxN
  const fadeN = Math.min(end, cut ? Math.round(end * 0.35) : Math.round((fadeMs / 1000) * SR))
  return channels.map((c) => {
    const o = c.slice(0, end)
    for (let i = 0; i < fadeN; i++) o[end - fadeN + i] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / fadeN)
    return o
  })
}

export function applyGain(channels, g) {
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= g
}

/** Run async jobs with bounded concurrency. */
export async function pool(items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}
