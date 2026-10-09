// End-to-end: encode a generated buffer through the system ffmpeg for every format and verify with ffprobe.
// Skipped when ffmpeg/ffprobe aren't installed.
import * as cp from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, buildFfmpegArgs, encodeWavPcm, fileExtension, finishSamples, outputSampleRate, type ExportSettings } from './core'
import { CancelledError, detectFfmpeg, ffmpegEncode, runProcess, type ChildProcessApi } from './ffmpeg'

const api = cp as unknown as ChildProcessApi
const has = (bin: string) => cp.spawnSync(bin, ['-version']).status === 0
const available = has('ffmpeg') && has('ffprobe')
const dir = available ? mkdtempSync(join(tmpdir(), 'arkane-export-')) : ''
afterAll(() => dir && rmSync(dir, { recursive: true, force: true }))

function tone(sr: number, seconds: number): Float32Array[] {
  const n = Math.round(sr * seconds)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    l[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr)
    r[i] = 0.5 * Math.sin((2 * Math.PI * 660 * i) / sr)
  }
  return [l, r]
}

const cases: [string, Partial<ExportSettings>, string, (s: Record<string, string>) => void][] = [
  ['mp3 320', { format: 'mp3', mp3Kbps: 320 }, 'mp3', () => {}],
  ['mp3 128 mono 96k→48k', { format: 'mp3', mp3Kbps: 128, channels: 1, sampleRate: 96000 }, 'mp3', () => {}],
  ['ogg vorbis q6', { format: 'ogg', oggCodec: 'vorbis', vorbisQuality: 6 }, 'vorbis', () => {}],
  ['ogg opus 160k from 44.1k', { format: 'ogg', oggCodec: 'opus', opusKbps: 160, sampleRate: 44100 }, 'opus', () => {}],
  ['flac 16 dithered', { format: 'flac', flacBits: 16, flacLevel: 8, dither: true }, 'flac', (s) => expect(s.sample_fmt).toBe('s16')],
  ['flac 24', { format: 'flac', flacBits: 24, flacLevel: 0 }, 'flac', (s) => expect(s.bits_per_raw_sample).toBe('24')]
]

describe.skipIf(!available)('ffmpeg encoding', () => {
  it('detects ffmpeg and its encoders', async () => {
    const info = await detectFfmpeg(api)
    expect(info).not.toBeNull()
    for (const e of ['libmp3lame', 'libvorbis', 'libopus', 'flac']) expect(info!.encoders.has(e)).toBe(true)
  })

  for (const [name, patch, codec, extra] of cases) {
    it(`encodes ${name} and ffprobe decodes it`, async () => {
      const s: ExportSettings = { ...DEFAULT_SETTINGS, ...patch }
      const out = join(dir, `${name.replace(/\W+/g, '_')}.${fileExtension(s.format)}`)
      const ch = finishSamples(tone(s.sampleRate, 1.5), s)
      const wav = new Uint8Array(encodeWavPcm(ch, s.sampleRate, 32))
      await ffmpegEncode(api, 'ffmpeg', buildFfmpegArgs(s, out), wav)
      expect(statSync(out).size).toBeGreaterThan(1000)
      const probe = await runProcess(api, 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out])
      expect(probe.code).toBe(0)
      const j = JSON.parse(probe.stdout) as { streams: Record<string, string | number>[]; format: { duration: string } }
      const st = Object.fromEntries(Object.entries(j.streams[0]).map(([k, v]) => [k, String(v)]))
      expect(st.codec_name).toBe(codec)
      expect(Number(st.channels)).toBe(s.channels)
      expect(Number(st.sample_rate)).toBe(outputSampleRate(s))
      expect(Number(j.format.duration)).toBeGreaterThan(1.4)
      expect(Number(j.format.duration)).toBeLessThan(1.7)
      extra(st)
      // Full decode must succeed without errors.
      const dec = await runProcess(api, 'ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'])
      expect(dec.code).toBe(0)
      expect(dec.stderr.trim()).toBe('')
    })
  }

  it('16-bit FLAC is bit-exact with the dithered samples', async () => {
    const s: ExportSettings = { ...DEFAULT_SETTINGS, format: 'flac', flacBits: 16, dither: true, sampleRate: 48000 }
    const ch = finishSamples(tone(48000, 0.2), s)
    const out = join(dir, 'exact.flac')
    await ffmpegEncode(api, 'ffmpeg', buildFfmpegArgs(s, out), new Uint8Array(encodeWavPcm(ch, 48000, 32)))
    const pcm = cp.spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 's16le', '-']).stdout as Buffer
    const got = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2)
    expect(got.length).toBe(ch[0].length * 2)
    for (let i = 0; i < ch[0].length; i += 97) {
      expect(got[i * 2]).toBe(Math.round(ch[0][i] * 32768) | 0)
      expect(got[i * 2 + 1]).toBe(Math.round(ch[1][i] * 32768) | 0)
    }
  })

  it('reports ffmpeg errors and supports cancel', async () => {
    await expect(ffmpegEncode(api, 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', join(dir, 'x.mp3')], new Uint8Array([1, 2, 3]))).rejects.toThrow(/ffmpeg failed/)
    const ac = new AbortController()
    const p = runProcess(api, 'ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'anullsrc', '-t', '600', '-f', 'null', '-'], undefined, ac.signal)
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toBeInstanceOf(CancelledError)
  })
})
