// Sample processing for the drum kit build: multi-mic mixdown, onset/tail trimming, loudness,
// gain and FLAC encoding (via ffmpeg: soxr resampling to 48 kHz + triangular dither to 16 bit).
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeWavF32 } from './wav.mjs'

const dbToGain = (db) => Math.pow(10, db / 20)

function panGains(pan) {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2]
}

function correlation(a, b, n) {
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

/**
 * Mix a multi-mic hit down to stereo.
 * @param chans   Float32Array per file channel
 * @param names   mic name per file channel (same order)
 * @param mics    { [micName]: { pan, gain, close?: boolean } }
 * @param use     Set of mic names to include (DrumGizmo "main" channels), or null = all configured
 * Close mics after the first one are polarity-checked against the first (kick in/out, snare top/bottom).
 */
export function mixdown(chans, names, mics, use, sampleRate) {
  const n = chans[0].length
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  let ref = null
  const win = Math.min(n, Math.round(sampleRate * 0.02))
  names.forEach((name, i) => {
    const m = mics[name]
    if (!m || (use && !use.has(name)) || m.gain === 0) return
    let g = m.gain
    if (m.close) {
      if (!ref) ref = chans[i]
      else if (correlation(ref, chans[i], win) < 0) g = -g
    }
    const [gl, gr] = panGains(m.pan)
    const x = chans[i]
    for (let k = 0; k < n; k++) {
      L[k] += x[k] * g * gl
      R[k] += x[k] * g * gr
    }
  })
  return [L, R]
}

export function peakOf(channels) {
  let p = 0
  for (const c of channels) for (let i = 0; i < c.length; i++) {
    const a = Math.abs(c[i])
    if (a > p) p = a
  }
  return p
}

/**
 * Trim leading silence (keeps ~1 ms of pre-roll), cut the tail where it drops below `floorDb` relative to the
 * sample's peak (or at maxLen seconds), and fade out. Returns new channel arrays.
 */
export function trim(channels, sampleRate, { maxLen = 4, floorDb = -62, onsetDb = -36, fadeMs = 25 } = {}) {
  const n = channels[0].length
  const peak = peakOf(channels) || 1
  const onT = peak * dbToGain(onsetDb)
  let on = 0
  outer: for (; on < n; on++) for (const c of channels) if (Math.abs(c[on]) > onT) break outer
  if (on >= n) on = 0
  const pre = Math.round(sampleRate * 0.001)
  const start = Math.max(0, on - pre)
  // tail: last 5 ms window above the floor
  const w = Math.round(sampleRate * 0.005)
  const floor = peak * dbToGain(floorDb)
  let end = n
  for (let s = n - w; s > start; s -= w) {
    let m = 0
    for (const c of channels) for (let i = Math.max(s, 0); i < s + w && i < n; i++) m = Math.max(m, Math.abs(c[i]))
    if (m > floor) {
      end = Math.min(n, s + w)
      break
    }
  }
  const maxN = Math.round(maxLen * sampleRate)
  const cut = end - start > maxN
  if (cut) end = start + maxN
  const len = Math.max(1, end - start)
  // longer fade when we truncate a ringing tail (cymbals): last 30% of the sample, else fadeMs
  const fadeN = Math.min(len, cut ? Math.round(len * 0.3) : Math.round((fadeMs / 1000) * sampleRate))
  return channels.map((c) => {
    const o = c.slice(start, start + len)
    for (let i = 0; i < pre && i < len; i++) o[i] *= i / pre
    for (let i = 0; i < fadeN; i++) {
      const t = i / fadeN
      o[len - fadeN + i] *= 0.5 + 0.5 * Math.cos(Math.PI * t)
    }
    return o
  })
}

/**
 * "Attack loudness": RMS over the first 60 ms, as heard at the plugin output — channel powers are summed
 * because the DSP plays mono samples at -3 dB per side and stereo samples as they are.
 */
export function attackLoudness(channels, sampleRate) {
  const n = Math.min(channels[0].length, Math.round(sampleRate * 0.06))
  let s = 0
  for (const c of channels) for (let i = 0; i < n; i++) s += c[i] * c[i]
  return Math.sqrt(s / Math.max(1, n))
}

export function applyGain(channels, g) {
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= g
}

/** Average all channels to mono. */
export function toMono(channels) {
  if (channels.length === 1) return channels
  const n = channels[0].length
  const m = new Float32Array(n)
  for (const c of channels) for (let i = 0; i < n; i++) m[i] += c[i] / channels.length
  return [m]
}

let tmpRoot = null
let tmpCounter = 0
function tmpFile() {
  if (!tmpRoot) {
    tmpRoot = mkdtempSync(join(tmpdir(), 'arkane-drumkits-'))
    process.on('exit', () => rmSync(tmpRoot, { recursive: true, force: true }))
  }
  return join(tmpRoot, `s${tmpCounter++}.wav`)
}

export function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err}`))))
  })
}

/** Encode to 48 kHz / 16-bit FLAC. */
export async function encodeFlac(ffmpeg, channels, sampleRate, outPath) {
  const tmp = tmpFile()
  writeFileSync(tmp, encodeWavF32(channels, sampleRate))
  await run(ffmpeg, [
    '-y', '-v', 'error', '-i', tmp,
    '-af', 'aresample=48000:resampler=soxr:precision=28:osf=s16:dither_method=triangular',
    '-c:a', 'flac', '-compression_level', '12', '-map_metadata', '-1', outPath
  ])
  rmSync(tmp, { force: true })
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
