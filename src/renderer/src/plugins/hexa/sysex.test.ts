import { describe, expect, it } from 'vitest'
import { BULK_SIZE, SINGLE_SIZE, buildBulk, buildSingle, checksum, decodeBank, encodeBank, packVoice, parseSysex, unpackVoice } from './sysex'
import { VCED_MAX, VOICE_SIZE, initVoice, paramsToVoice, setVoiceName, voiceName, voiceToParams } from './voice'
import { FACTORY } from './factory'

/** Deterministic pseudo-random legal voice. */
function randomVoice(seed: number): Uint8Array {
  let s = seed * 2654435761
  const rnd = () => {
    s = (s * 1103515245 + 12345) >>> 0
    return s / 4294967296
  }
  const v = new Uint8Array(VOICE_SIZE)
  for (let i = 0; i < VOICE_SIZE; i++) v[i] = Math.floor(rnd() * (VCED_MAX[i] + 1))
  setVoiceName(v, `RND ${seed}`.padEnd(10, '#'))
  return v
}

describe('hexa sysex', () => {
  it('packs and unpacks every field losslessly', () => {
    for (let k = 0; k < 200; k++) {
      const v = randomVoice(k + 1)
      const p = packVoice(v)
      expect(p.length).toBe(128)
      for (const b of p) expect(b).toBeLessThan(128)
      expect(Array.from(unpackVoice(p))).toEqual(Array.from(v))
    }
  })

  it('round-trips a generated 32-voice cartridge through a bulk dump', () => {
    const voices = Array.from({ length: 32 }, (_, i) => randomVoice(i + 100))
    const syx = buildBulk(voices)
    expect(syx.length).toBe(BULK_SIZE)
    expect(Array.from(syx.subarray(0, 6))).toEqual([0xf0, 0x43, 0x00, 0x09, 0x20, 0x00])
    expect(syx[BULK_SIZE - 1]).toBe(0xf7)
    const parsed = parseSysex(syx)
    expect(parsed.kind).toBe('bulk')
    if (parsed.kind !== 'bulk') return
    expect(parsed.checksumOk).toBe(true)
    expect(parsed.voices.length).toBe(32)
    for (let i = 0; i < 32; i++) expect(Array.from(parsed.voices[i])).toEqual(Array.from(voices[i]))
    expect(parsed.names[0]).toBe('RND 100###')
  })

  it('validates the checksum', () => {
    const syx = buildBulk(FACTORY.map((f) => f.voice))
    // sum of data + checksum must be 0 mod 128
    expect((checksum(syx, 6, 6 + 4096) + syx.subarray(6, 6 + 4096).reduce((a, b) => a + b, 0)) & 0x7f).toBe(0)
    const bad = syx.slice()
    bad[100] = (bad[100] + 1) & 0x7f
    const parsed = parseSysex(bad)
    expect(parsed.checksumOk).toBe(false)
  })

  it('round-trips a single-voice (VCED) dump and raw formats', () => {
    const v = randomVoice(7)
    const syx = buildSingle(v, 3)
    expect(syx.length).toBe(SINGLE_SIZE)
    const p = parseSysex(syx)
    expect(p.kind).toBe('single')
    if (p.kind === 'single') {
      expect(p.checksumOk).toBe(true)
      expect(Array.from(p.voice)).toEqual(Array.from(v))
    }
    const raw = parseSysex(v)
    expect(raw.kind).toBe('single')
    const bank = parseSysex(buildBulk([v]).subarray(6, 6 + 4096))
    expect(bank.kind).toBe('bulk')
    // leading junk before F0 is tolerated
    const junk = new Uint8Array(10 + SINGLE_SIZE)
    junk.set(syx, 10)
    expect(parseSysex(junk).kind).toBe('single')
    expect(() => parseSysex(new Uint8Array([1, 2, 3]))).toThrow()
  })

  it('sanitizes out-of-range bytes from damaged cartridges', () => {
    const p = new Uint8Array(128).fill(0x7f)
    const v = unpackVoice(p)
    for (let i = 0; i < VOICE_SIZE; i++) expect(v[i]).toBeLessThanOrEqual(VCED_MAX[i])
  })

  it('maps voices to params and back', () => {
    for (const f of FACTORY) {
      const back = paramsToVoice(voiceToParams(f.voice), voiceName(f.voice))
      expect(Array.from(back)).toEqual(Array.from(f.voice))
    }
    expect(voiceName(initVoice())).toBe('INIT VOICE')
  })

  it('stores a bank compactly for plugin data', () => {
    const voices = FACTORY.slice(0, 32).map((f) => f.voice)
    const s = encodeBank(voices)
    expect(s.length).toBeLessThan(6000)
    const back = decodeBank(s)
    for (let i = 0; i < 32; i++) expect(Array.from(back[i])).toEqual(Array.from(voices[i]))
  })
})
