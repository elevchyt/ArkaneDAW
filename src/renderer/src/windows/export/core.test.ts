import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  applyTail,
  buildFfmpegArgs,
  dbToGain,
  ditherApplies,
  encodeWavPcm,
  estimateBytes,
  findTailEnd,
  finishSamples,
  formatDuration,
  mulberry32,
  normalize,
  outputSampleRate,
  overallProgress,
  parseEncoders,
  peak,
  quantize,
  sanitizeFileName,
  sanitizeSettings,
  splitOutputPaths,
  suspendTimes,
  toMono,
  trimSilence,
  withExtension,
  wrapTail,
  type ExportSettings
} from './core'

const SR = 1000
const S = (patch: Partial<ExportSettings> = {}): ExportSettings => ({ ...DEFAULT_SETTINGS, ...patch })
const filled = (n: number, f: (i: number) => number) => Float32Array.from({ length: n }, (_, i) => f(i))

describe('tail handling', () => {
  // 2 s song of a constant 0.5 tone, then a decaying tail that falls below -90 dB at frame 2300, then silence.
  const tailBuf = () => {
    const c = filled(5000, (i) => (i < 2000 ? 0.5 : i < 2300 ? 0.5 * Math.pow(0.97, i - 2000) : 0))
    return [c, c.slice()]
  }

  it('leave: cuts once the tail stays below -90 dB for 1 s', () => {
    const ch = tailBuf()
    const end = findTailEnd(ch, SR, 2000)
    // last sample above -90 dB (3.16e-5): 0.5*0.97^k > 3.16e-5 → k < ~317.6, but the buffer is zero from 2300
    expect(end).toBe(2300)
    const out = applyTail(ch, SR, 2000, 'leave')
    expect(out[0].length).toBe(2300)
    expect(out).toHaveLength(2)
  })

  it('leave: never shorter than the song even if the song ends in silence', () => {
    const c = filled(4000, (i) => (i < 500 ? 0.3 : 0))
    expect(findTailEnd([c], SR, 2000)).toBe(2000)
  })

  it('leave: keeps going while the tail is still loud and stops at the buffer end', () => {
    const c = filled(3000, () => 0.1)
    expect(findTailEnd([c], SR, 2000)).toBe(3000)
  })

  it('leave: a short gap (< hold) does not end the tail', () => {
    const c = filled(6000, (i) => (i < 2000 ? 0.5 : i >= 2500 && i < 2600 ? 0.2 : 0))
    expect(findTailEnd([c], SR, 2000)).toBe(2600)
  })

  it('cut: hard stop at song end', () => {
    const out = applyTail(tailBuf(), SR, 2000, 'cut')
    expect(out[0].length).toBe(2000)
  })

  it('wrap: tail is mixed back into the start', () => {
    const song = filled(10, () => 0)
    const c = new Float32Array(14)
    c.set(song)
    c.set([1, 2, 3, 4], 10)
    const [o] = wrapTail([c], 10)
    expect(o.length).toBe(10)
    expect(Array.from(o.slice(0, 5))).toEqual([1, 2, 3, 4, 0])
  })

  it('wrap: a tail longer than the song wraps around repeatedly', () => {
    const c = Float32Array.from([0, 0, 0, 1, 1, 1, 1, 1])
    const [o] = wrapTail([c], 3)
    expect(Array.from(o)).toEqual([2, 2, 1])
  })

  it('wrap via applyTail only includes the audible tail', () => {
    const c = filled(5000, (i) => (i < 2000 ? 0 : i < 2010 ? 0.25 : 0))
    const [o] = applyTail([c], SR, 2000, 'wrap')
    expect(o.length).toBe(2000)
    expect(o[0]).toBeCloseTo(0.25)
    expect(o[9]).toBeCloseTo(0.25)
    expect(o[10]).toBe(0)
  })
})

describe('levels', () => {
  it('normalize to -0.1 dBFS', () => {
    const out = normalize([Float32Array.from([0.1, -0.25, 0.2])])
    expect(peak(out)).toBeCloseTo(dbToGain(-0.1), 5)
  })
  it('normalize leaves silence alone', () => {
    const z = [new Float32Array(4)]
    expect(normalize(z)).toBe(z)
  })
  it('mono downmix averages channels', () => {
    const [m] = toMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])])
    expect(Array.from(m)).toEqual([0.5, 0.5])
  })
  it('trims leading and trailing silence', () => {
    const [o] = trimSilence([Float32Array.from([0, 0, 0.5, 0, 0.5, 0])])
    expect(Array.from(o)).toEqual([0.5, 0, 0.5])
  })
})

describe('dither / quantization', () => {
  it('quantizes to the 16-bit grid', () => {
    const [o] = quantize([Float32Array.from([0.123456, -1, 1, 2])], 16, false)
    for (const v of o) expect(Number.isInteger(v * 32768)).toBe(true)
    expect(o[1]).toBe(-1)
    expect(o[2]).toBe(32767 / 32768)
    expect(o[3]).toBe(32767 / 32768)
  })

  it('TPDF dither stays within ±1 LSB and averages out', () => {
    const x = 0.3 / 32768 // 0.3 LSB: without dither always rounds to 0
    const input = filled(20000, () => x)
    const [plain] = quantize([input], 16, false)
    expect(peak([plain])).toBe(0)
    const [d] = quantize([input], 16, true, mulberry32(1))
    let sum = 0
    let worst = 0
    for (const v of d) {
      const lsb = v * 32768
      worst = Math.max(worst, Math.abs(lsb - 0.3))
      sum += lsb
    }
    expect(worst).toBeLessThanOrEqual(1.5)
    expect(sum / d.length).toBeCloseTo(0.3, 1) // unbiased
  })

  it('dither only applies to 16-bit targets', () => {
    expect(ditherApplies(S({ format: 'wav', wavBits: 16 }))).toBe(true)
    expect(ditherApplies(S({ format: 'wav', wavBits: 24 }))).toBe(false)
    expect(ditherApplies(S({ format: 'wav', wavBits: 32 }))).toBe(false)
    expect(ditherApplies(S({ format: 'flac', flacBits: 16 }))).toBe(true)
    expect(ditherApplies(S({ format: 'mp3' }))).toBe(false)
  })

  it('finishSamples: mono downmix happens before normalizing', () => {
    const out = finishSamples([Float32Array.from([0.5, 0]), Float32Array.from([-0.5, 0.2])], S({ normalize: true, channels: 1, format: 'wav', wavBits: 32 }))
    expect(peak(out)).toBeCloseTo(dbToGain(-0.1), 5)
  })

  it('finishSamples: normalize + mono + quantize', () => {
    const out = finishSamples([Float32Array.from([0.25, 0]), Float32Array.from([0.25, 0])], S({ normalize: true, channels: 1, format: 'wav', wavBits: 16, dither: false }))
    expect(out).toHaveLength(1)
    expect(out[0][0]).toBeCloseTo(dbToGain(-0.1), 3)
    expect(Number.isInteger(out[0][0] * 32768)).toBe(true)
  })
})

describe('WAV encoding', () => {
  const read = (ab: ArrayBuffer) => new DataView(ab)
  it('16-bit PCM header + samples', () => {
    const ab = encodeWavPcm([Float32Array.from([0, 0.5, -1]), Float32Array.from([1, -0.5, 0])], 48000, 16)
    const v = read(ab)
    expect(String.fromCharCode(...new Uint8Array(ab, 0, 4))).toBe('RIFF')
    expect(v.getUint16(20, true)).toBe(1)
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(48000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(3 * 2 * 2)
    expect(ab.byteLength).toBe(44 + 12)
    expect(v.getInt16(44, true)).toBe(0)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(16384)
    expect(v.getInt16(52, true)).toBe(-32768)
  })
  it('24-bit and float', () => {
    const v24 = read(encodeWavPcm([Float32Array.from([-0.5])], 44100, 24))
    const x = v24.getUint8(44) | (v24.getUint8(45) << 8) | (v24.getInt8(46) << 16)
    expect(x).toBe(-0x400000)
    const vf = read(encodeWavPcm([Float32Array.from([0.25])], 44100, 32))
    expect(vf.getUint16(20, true)).toBe(3)
    expect(vf.getFloat32(44, true)).toBe(0.25)
  })
})

describe('ffmpeg args', () => {
  const out = '/tmp/x.out'
  it('mp3', () => {
    const a = buildFfmpegArgs(S({ format: 'mp3', mp3Kbps: 192 }), out)
    expect(a.slice(a.indexOf('-i'), a.indexOf('-i') + 2)).toEqual(['-i', 'pipe:0'])
    expect(a.join(' ')).toContain('-c:a libmp3lame -b:a 192k -f mp3')
    expect(a.at(-1)).toBe(out)
  })
  it('mp3 caps the sample rate at 48 kHz', () => {
    const a = buildFfmpegArgs(S({ format: 'mp3', sampleRate: 96000 }), out)
    expect(a[a.indexOf('-ar') + 1]).toBe('48000')
  })
  it('ogg vorbis quality', () => {
    expect(buildFfmpegArgs(S({ format: 'ogg', oggCodec: 'vorbis', vorbisQuality: 7 }), out).join(' ')).toContain('-c:a libvorbis -q:a 7 -f ogg')
  })
  it('ogg opus is resampled to 48 kHz', () => {
    const a = buildFfmpegArgs(S({ format: 'ogg', oggCodec: 'opus', opusKbps: 128, sampleRate: 44100 }), out)
    expect(a.join(' ')).toContain('-c:a libopus -b:a 128k -f ogg')
    expect(a[a.indexOf('-ar') + 1]).toBe('48000')
    expect(outputSampleRate(S({ format: 'ogg', oggCodec: 'opus', sampleRate: 96000 }))).toBe(48000)
  })
  it('flac bit depth and level', () => {
    expect(buildFfmpegArgs(S({ format: 'flac', flacBits: 16, flacLevel: 8 }), out).join(' ')).toContain('-c:a flac -compression_level 8 -sample_fmt s16 -f flac')
    expect(buildFfmpegArgs(S({ format: 'flac', flacBits: 24, flacLevel: 0 }), out).join(' ')).toContain('-sample_fmt s32 -bits_per_raw_sample 24')
  })
  it('mono', () => {
    const a = buildFfmpegArgs(S({ format: 'flac', channels: 1 }), out)
    expect(a[a.indexOf('-ac') + 1]).toBe('1')
  })
  it('wav is not an ffmpeg format', () => {
    expect(() => buildFfmpegArgs(S({ format: 'wav' }), out)).toThrow()
  })
  it('parses the encoder list', () => {
    const enc = parseEncoders(' A....D flac                 FLAC (Free Lossless Audio Codec)\n A....D libmp3lame           libmp3lame MP3\n V....D libx264  H.264\n ------\n')
    expect([...enc]).toEqual(['flac', 'libmp3lame', 'libx264'])
  })
})

describe('file naming for splits', () => {
  it('folder named after the file, <name>_<track>.<ext>', () => {
    const r = splitOutputPaths('/home/me/Music/My song.wav', ['Kick', 'Bass'], 'wav')
    expect(r.folder).toBe('/home/me/Music/My song')
    expect(r.files).toEqual(['/home/me/Music/My song/My song_Kick.wav', '/home/me/Music/My song/My song_Bass.wav'])
  })
  it('sanitizes and de-duplicates track names', () => {
    const r = splitOutputPaths('C:\\out\\mix.flac', ['Vox: lead/dbl', 'Kick', 'kick', 'Kick'], 'flac')
    expect(r.folder).toBe('C:\\out\\mix')
    expect(r.files).toEqual(['C:\\out\\mix\\mix_Vox_ lead_dbl.flac', 'C:\\out\\mix\\mix_Kick.flac', 'C:\\out\\mix\\mix_kick (2).flac', 'C:\\out\\mix\\mix_Kick (3).flac'])
  })
  it('sanitizeFileName', () => {
    expect(sanitizeFileName('  a*b?  ')).toBe('a_b_')
    expect(sanitizeFileName('...')).toBe('untitled')
    expect(sanitizeFileName('')).toBe('untitled')
  })
  it('withExtension', () => {
    expect(withExtension('/a/b/song.wav', 'mp3')).toBe('/a/b/song.mp3')
    expect(withExtension('song', 'ogg')).toBe('song.ogg')
    expect(withExtension('/a.b/song', 'flac')).toBe('/a.b/song.flac')
  })
})

describe('progress math', () => {
  it('suspend times are quantum-aligned, unique, ascending and inside the render', () => {
    const t = suspendTimes(3.2, 48000, 0.5)
    expect(t.length).toBe(6)
    let last = 0
    for (const x of t) {
      expect(Math.round(x * 48000) % 128).toBe(0)
      expect(x).toBeGreaterThan(last)
      expect(x).toBeLessThan(3.2)
      last = x
    }
    expect(suspendTimes(0.4, 48000)).toEqual([])
    // tiny steps collapse onto distinct quanta only
    const tiny = suspendTimes(0.02, 48000, 0.001)
    expect(new Set(tiny).size).toBe(tiny.length)
  })
  it('overall progress across files', () => {
    expect(overallProgress(0, 4, 0)).toBe(0)
    expect(overallProgress(0, 4, 1, 1)).toBeCloseTo(0.25)
    expect(overallProgress(1, 4, 0.5, 0)).toBeCloseTo((1 + 0.45) / 4)
    expect(overallProgress(3, 4, 1, 1)).toBe(1)
    expect(overallProgress(0, 0, 1)).toBe(0)
    expect(overallProgress(5, 4, 2, 2)).toBe(1)
  })
  it('durations and sizes', () => {
    expect(formatDuration(0)).toBe("0'00''")
    expect(formatDuration(125.4)).toBe("2'05''")
    expect(formatDuration(3725)).toBe("1:02'05''")
    expect(estimateBytes(S({ format: 'wav', wavBits: 16, sampleRate: 44100, channels: 2 }), 1)).toBe(44 + 176400)
    expect(estimateBytes(S({ format: 'mp3', mp3Kbps: 320 }), 10)).toBe(400000)
  })
})

describe('settings', () => {
  it('sanitizes persisted settings', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    const s = sanitizeSettings({ format: 'mp3', mp3Kbps: 999, split: 'mixer', dither: false, sampleRate: 22050 })
    expect(s.format).toBe('mp3')
    expect(s.mp3Kbps).toBe(DEFAULT_SETTINGS.mp3Kbps)
    expect(s.split).toBe('mixer')
    expect(s.dither).toBe(false)
    expect(s.sampleRate).toBe(DEFAULT_SETTINGS.sampleRate)
  })
})
