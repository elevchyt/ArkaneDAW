// Pure helpers for the export wizard: settings model, tail handling, dither, WAV encoding,
// ffmpeg argument building, split file naming, progress math and size estimates.
// No DOM / Web Audio / Node imports here so everything is unit-testable under vitest (node).

export type ExportFormat = 'wav' | 'mp3' | 'ogg' | 'flac'
export type OggCodec = 'vorbis' | 'opus'
export type TailMode = 'leave' | 'cut' | 'wrap'
export type SplitMode = 'none' | 'playlist' | 'mixer'
export type RenderMode = 'song' | 'pattern'
export type WavBits = 16 | 24 | 32

export interface ExportSettings {
  mode: RenderMode
  tail: TailMode
  format: ExportFormat
  wavBits: WavBits
  mp3Kbps: number
  oggCodec: OggCodec
  vorbisQuality: number // 0..10
  opusKbps: number
  flacBits: 16 | 24
  flacLevel: number // 0..8
  sampleRate: 44100 | 48000 | 96000
  channels: 1 | 2
  dither: boolean
  normalize: boolean
  split: SplitMode
  masterFx: boolean
  trimSilence: boolean
}

export const DEFAULT_SETTINGS: ExportSettings = {
  mode: 'song',
  tail: 'leave',
  format: 'wav',
  wavBits: 24,
  mp3Kbps: 320,
  oggCodec: 'vorbis',
  vorbisQuality: 6,
  opusKbps: 160,
  flacBits: 24,
  flacLevel: 5,
  sampleRate: 48000,
  channels: 2,
  dither: true,
  normalize: false,
  split: 'none',
  masterFx: true,
  trimSilence: false
}

export const MP3_BITRATES = [128, 160, 192, 224, 256, 320]
export const OPUS_BITRATES = [64, 96, 128, 160, 192, 256]
export const SAMPLE_RATES = [44100, 48000, 96000] as const

/** Merge persisted (possibly stale/partial) settings over the defaults, dropping invalid values. */
export function sanitizeSettings(raw: unknown): ExportSettings {
  const s = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return s
  const r = raw as Record<string, unknown>
  const pick = <K extends keyof ExportSettings>(k: K, ok: readonly ExportSettings[K][]) => {
    if (ok.includes(r[k] as ExportSettings[K])) s[k] = r[k] as ExportSettings[K]
  }
  pick('mode', ['song', 'pattern'])
  pick('tail', ['leave', 'cut', 'wrap'])
  pick('format', ['wav', 'mp3', 'ogg', 'flac'])
  pick('wavBits', [16, 24, 32])
  pick('mp3Kbps', MP3_BITRATES)
  pick('oggCodec', ['vorbis', 'opus'])
  pick('vorbisQuality', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  pick('opusKbps', OPUS_BITRATES)
  pick('flacBits', [16, 24])
  pick('flacLevel', [0, 1, 2, 3, 4, 5, 6, 7, 8])
  pick('sampleRate', SAMPLE_RATES)
  pick('channels', [1, 2])
  pick('split', ['none', 'playlist', 'mixer'])
  for (const k of ['dither', 'normalize', 'masterFx', 'trimSilence'] as const) if (typeof r[k] === 'boolean') s[k] = r[k] as boolean
  return s
}

export function fileExtension(format: ExportFormat): string {
  return format === 'mp3' ? 'mp3' : format === 'ogg' ? 'ogg' : format === 'flac' ? 'flac' : 'wav'
}

export function formatLabel(s: Pick<ExportSettings, 'format' | 'oggCodec'>): string {
  if (s.format === 'ogg') return s.oggCodec === 'opus' ? 'OGG (Opus)' : 'OGG (Vorbis)'
  return s.format.toUpperCase()
}

/** Integer bit depth the output is quantized to (null for lossy / float). */
export function targetBits(s: Pick<ExportSettings, 'format' | 'wavBits' | 'flacBits'>): 16 | 24 | null {
  if (s.format === 'wav') return s.wavBits === 32 ? null : s.wavBits
  if (s.format === 'flac') return s.flacBits
  return null
}

/** Dithering only makes sense when reducing to 16-bit integer. */
export function ditherApplies(s: Pick<ExportSettings, 'format' | 'wavBits' | 'flacBits'>): boolean {
  return targetBits(s) === 16
}

export const needsFfmpeg = (f: ExportFormat): boolean => f !== 'wav'

// ── levels ───────────────────────────────────────────────────────────────────

export const dbToGain = (db: number): number => Math.pow(10, db / 20)

export function peak(channels: Float32Array[]): number {
  let p = 0
  for (const c of channels) for (let i = 0; i < c.length; i++) {
    const a = Math.abs(c[i])
    if (a > p) p = a
  }
  return p
}

/** Scale so the peak hits `targetDb` (default -0.1 dBFS). Silent input is returned untouched. */
export function normalize(channels: Float32Array[], targetDb = -0.1): Float32Array[] {
  const p = peak(channels)
  if (p < dbToGain(-120)) return channels
  const g = dbToGain(targetDb) / p
  return channels.map((c) => {
    const o = new Float32Array(c.length)
    for (let i = 0; i < c.length; i++) o[i] = c[i] * g
    return o
  })
}

export function toMono(channels: Float32Array[]): Float32Array[] {
  if (channels.length < 2) return channels
  const n = channels[0].length
  const o = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const c of channels) s += c[i]
    o[i] = s / channels.length
  }
  return [o]
}

// ── tail handling ────────────────────────────────────────────────────────────

export interface TailOptions {
  thresholdDb?: number // default -90
  holdSec?: number // default 1
}

/**
 * "Leave remainder": the frame where the tail has decayed. Starting at `songEnd`, returns the end of the
 * last loud sample once the signal has stayed below the threshold for `holdSec` (or the buffer ends).
 * Never returns less than songEnd.
 */
export function findTailEnd(channels: Float32Array[], sampleRate: number, songEnd: number, o: TailOptions = {}): number {
  const thr = dbToGain(o.thresholdDb ?? -90)
  const hold = Math.max(1, Math.round((o.holdSec ?? 1) * sampleRate))
  const len = channels[0]?.length ?? 0
  if (songEnd >= len) return len
  let lastLoud = songEnd - 1
  for (let i = songEnd; i < len; i++) {
    let loud = false
    for (const c of channels) if (Math.abs(c[i]) > thr) {
      loud = true
      break
    }
    if (loud) lastLoud = i
    else if (i - lastLoud >= hold) return lastLoud + 1
  }
  return Math.max(songEnd, lastLoud + 1)
}

/** "Wrap remainder": cut at songEnd and mix everything after it back into the start (repeatedly if the tail is longer than the song). */
export function wrapTail(channels: Float32Array[], songEnd: number, tailEnd = channels[0]?.length ?? 0): Float32Array[] {
  if (songEnd <= 0) return channels.map(() => new Float32Array(0))
  return channels.map((c) => {
    const o = c.slice(0, songEnd)
    const end = Math.min(tailEnd, c.length)
    for (let i = songEnd; i < end; i++) o[(i - songEnd) % songEnd] += c[i]
    return o
  })
}

/** Apply the tail mode. `songEnd` is the frame where the arrangement ends (render lead already removed). */
export function applyTail(channels: Float32Array[], sampleRate: number, songEnd: number, mode: TailMode, o?: TailOptions): Float32Array[] {
  const len = channels[0]?.length ?? 0
  const end = Math.min(songEnd, len)
  if (mode === 'cut') return channels.map((c) => c.slice(0, end))
  const tailEnd = findTailEnd(channels, sampleRate, end, o)
  if (mode === 'wrap') return wrapTail(channels, end, tailEnd)
  return channels.map((c) => c.slice(0, tailEnd))
}

/** Strip leading and trailing silence (below thresholdDb). */
export function trimSilence(channels: Float32Array[], thresholdDb = -90): Float32Array[] {
  const thr = dbToGain(thresholdDb)
  const len = channels[0]?.length ?? 0
  const loud = (i: number) => channels.some((c) => Math.abs(c[i]) > thr)
  let a = 0
  while (a < len && !loud(a)) a++
  let b = len
  while (b > a && !loud(b - 1)) b--
  return channels.map((c) => c.slice(a, b))
}

export function isSilent(channels: Float32Array[], thresholdDb = -90): boolean {
  return peak(channels) <= dbToGain(thresholdDb)
}

// ── dither / quantization ────────────────────────────────────────────────────

/** Small deterministic PRNG (mulberry32) so dithering is reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Quantize float samples to the integer grid of `bits` (values stay floats: k / 2^(bits-1)), adding TPDF
 * dither of ±1 LSB peak when `dither` is set. The result converts losslessly to intN later (WAV writer, ffmpeg).
 */
export function quantize(channels: Float32Array[], bits: 16 | 24, dither: boolean, rand: () => number = Math.random): Float32Array[] {
  const scale = Math.pow(2, bits - 1)
  const max = scale - 1
  return channels.map((c) => {
    const o = new Float32Array(c.length)
    for (let i = 0; i < c.length; i++) {
      let x = c[i] * scale
      if (dither) x += rand() - rand() // triangular PDF in [-1, 1] LSB
      let q = Math.round(x)
      if (q > max) q = max
      else if (q < -scale) q = -scale
      o[i] = q / scale
    }
    return o
  })
}

/** Interleaved RIFF/WAVE (PCM 16/24 int or 32-bit IEEE float). Expects samples already quantized for int formats (or clamps/rounds them). */
export function encodeWavPcm(channels: Float32Array[], sampleRate: number, bits: WavBits): ArrayBuffer {
  const ch = channels.length
  const len = channels[0]?.length ?? 0
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
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * ch * bps, true)
  v.setUint16(32, ch * bps, true)
  v.setUint16(34, bits, true)
  w(36, 'data')
  v.setUint32(40, dataSize, true)
  const scale = bits === 16 ? 0x8000 : 0x800000
  const max = scale - 1
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = channels[c][i]
      if (bits === 32) v.setFloat32(o, s, true)
      else {
        let x = Math.round(s * scale)
        if (x > max) x = max
        else if (x < -scale) x = -scale
        if (bits === 16) v.setInt16(o, x, true)
        else {
          v.setUint8(o, x & 0xff)
          v.setUint8(o + 1, (x >> 8) & 0xff)
          v.setUint8(o + 2, (x >> 16) & 0xff)
        }
      }
      o += bps
    }
  }
  return ab
}

/** Final sample processing shared by all formats: mono → normalize → quantize/dither (int targets). */
export function finishSamples(channels: Float32Array[], s: ExportSettings, rand?: () => number): Float32Array[] {
  let out = channels
  if (s.channels === 1) out = toMono(out)
  if (s.normalize) out = normalize(out)
  const bits = targetBits(s)
  if (bits) out = quantize(out, bits, bits === 16 && s.dither, rand)
  return out
}

// ── ffmpeg ───────────────────────────────────────────────────────────────────

/** Encoders we need, per format/codec. */
export const FFMPEG_ENCODER: Record<'mp3' | 'vorbis' | 'opus' | 'flac', string> = { mp3: 'libmp3lame', vorbis: 'libvorbis', opus: 'libopus', flac: 'flac' }

export function encoderKey(s: Pick<ExportSettings, 'format' | 'oggCodec'>): keyof typeof FFMPEG_ENCODER | null {
  if (s.format === 'mp3') return 'mp3'
  if (s.format === 'flac') return 'flac'
  if (s.format === 'ogg') return s.oggCodec
  return null
}

/** Parse `ffmpeg -encoders` output into the set of encoder names present. */
export function parseEncoders(text: string): Set<string> {
  const out = new Set<string>()
  for (const line of text.split('\n')) {
    const m = /^\s*[AVS][.A-Z]{5}\s+(\S+)/.exec(line)
    if (m) out.add(m[1])
  }
  return out
}

/** Output sample rate actually written for a format (MP3 tops out at 48 kHz, Opus is always 48 kHz). */
export function outputSampleRate(s: Pick<ExportSettings, 'format' | 'oggCodec' | 'sampleRate'>): number {
  if (s.format === 'ogg' && s.oggCodec === 'opus') return 48000
  if (s.format === 'mp3') return Math.min(48000, s.sampleRate)
  return s.sampleRate
}

/** Args for `ffmpeg` reading a WAV on stdin and writing `outPath`. */
export function buildFfmpegArgs(s: ExportSettings, outPath: string): string[] {
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'wav', '-i', 'pipe:0', '-map_metadata', '-1']
  const sr = outputSampleRate(s)
  switch (s.format) {
    case 'mp3':
      args.push('-c:a', 'libmp3lame', '-b:a', `${s.mp3Kbps}k`, '-f', 'mp3')
      break
    case 'ogg':
      if (s.oggCodec === 'opus') args.push('-c:a', 'libopus', '-b:a', `${s.opusKbps}k`, '-f', 'ogg')
      else args.push('-c:a', 'libvorbis', '-q:a', String(s.vorbisQuality), '-f', 'ogg')
      break
    case 'flac':
      args.push('-c:a', 'flac', '-compression_level', String(s.flacLevel))
      if (s.flacBits === 16) args.push('-sample_fmt', 's16')
      else args.push('-sample_fmt', 's32', '-bits_per_raw_sample', '24')
      args.push('-f', 'flac')
      break
    default:
      throw new Error(`ffmpeg not used for ${s.format}`)
  }
  args.push('-ar', String(sr), '-ac', String(s.channels), outPath)
  return args
}

// ── split file naming ────────────────────────────────────────────────────────

/** Make a string safe as a file-name component on Windows/macOS/Linux. */
export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return s || 'untitled'
}

/** Split a path into dir / base name (no extension), separator-agnostic. */
export function splitPath(filePath: string): { dir: string; base: string; sep: string } {
  const i = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const sep = i >= 0 ? filePath[i] : '/'
  const dir = i >= 0 ? filePath.slice(0, i) : ''
  const file = i >= 0 ? filePath.slice(i + 1) : filePath
  const dot = file.lastIndexOf('.')
  return { dir, base: dot > 0 ? file.slice(0, dot) : file, sep }
}

/** Replace (or add) the extension of a path. */
export function withExtension(filePath: string, ext: string): string {
  const { dir, base, sep } = splitPath(filePath)
  return `${dir ? dir + sep : ''}${base}.${ext}`
}

/**
 * Paths for a split export: `<dir>/<base>/<base>_<track>.<ext>`. Track names are sanitized and made
 * unique (case-insensitive) with " (2)", " (3)", ...
 */
export function splitOutputPaths(filePath: string, trackNames: string[], ext: string): { folder: string; files: string[] } {
  const { dir, base, sep } = splitPath(filePath)
  const b = sanitizeFileName(base)
  const folder = `${dir ? dir + sep : ''}${b}`
  const used = new Set<string>()
  const files = trackNames.map((n) => {
    const clean = sanitizeFileName(n)
    let name = clean
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${clean} (${k})`
    used.add(name.toLowerCase())
    return `${folder}${sep}${b}_${name}.${ext}`
  })
  return { folder, files }
}

// ── progress / timing ────────────────────────────────────────────────────────

export const RENDER_QUANTUM = 128

/**
 * Times (seconds) at which to suspend an OfflineAudioContext for progress updates: every `step` seconds,
 * snapped to render-quantum boundaries, strictly inside (0, totalSec), unique and ascending.
 */
export function suspendTimes(totalSec: number, sampleRate: number, step = 0.5): number[] {
  const out: number[] = []
  const totalFrames = Math.floor(totalSec * sampleRate)
  let last = 0
  for (let t = step; t < totalSec; t += step) {
    const frame = Math.round((t * sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM
    if (frame <= last || frame >= totalFrames) continue
    last = frame
    out.push(frame / sampleRate)
  }
  return out
}

/** Weight of the offline render vs. encoding+writing within one file's progress. */
export const RENDER_WEIGHT = 0.9

/** Overall 0..1 progress for file `index` (0-based) of `count`, given the render fraction and whether encoding is done. */
export function overallProgress(index: number, count: number, renderFrac: number, encodeFrac = 0): number {
  if (count <= 0) return 0
  const clamp = (x: number) => Math.min(1, Math.max(0, x))
  const file = clamp(renderFrac) * RENDER_WEIGHT + clamp(encodeFrac) * (1 - RENDER_WEIGHT)
  return clamp((index + file) / count)
}

/** FL-style duration read-out: 3'05'' (or 1:02'05'' over an hour). */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}'${r}''` : `${m}'${r}''`
}

const VORBIS_KBPS = [64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 500]

/** Rough output size in bytes for `seconds` of audio per file. */
export function estimateBytes(s: ExportSettings, seconds: number): number {
  const ch = s.channels
  switch (s.format) {
    case 'wav':
      return 44 + seconds * s.sampleRate * ch * (s.wavBits / 8)
    case 'mp3':
      return (seconds * s.mp3Kbps * 1000) / 8
    case 'ogg': {
      const kbps = s.oggCodec === 'opus' ? s.opusKbps : VORBIS_KBPS[s.vorbisQuality] ?? 160
      return (seconds * kbps * 1000 * (ch === 1 ? 0.6 : 1)) / 8
    }
    case 'flac':
      return seconds * s.sampleRate * ch * (s.flacBits / 8) * 0.6
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
