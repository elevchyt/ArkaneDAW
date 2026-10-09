// DX7 system-exclusive formats.
//  • 32-voice bulk dump: F0 43 0n 09 20 00 <32 × 128-byte packed VMEM> <checksum> F7   (4104 bytes)
//  • single-voice dump:  F0 43 0n 00 01 1B <155-byte unpacked VCED>   <checksum> F7   (163 bytes)
// Raw 4096-byte VMEM banks and raw 155-byte VCED voices (no header) are accepted too.
import { NAME_OFF, OP_SIZE, VOICE_SIZE, initVoice, sanitizeVoice, voiceName } from './voice'

export const PACKED_SIZE = 128
export const BULK_DATA = 4096
export const BULK_SIZE = 4104
export const SINGLE_SIZE = 163

/** Yamaha checksum: two's complement of the 7-bit sum. */
export function checksum(data: ArrayLike<number>, start = 0, end = data.length): number {
  let s = 0
  for (let i = start; i < end; i++) s += data[i]
  return (128 - (s & 0x7f)) & 0x7f
}

/** VCED (155) -> VMEM packed (128). */
export function packVoice(v: ArrayLike<number>): Uint8Array {
  const p = new Uint8Array(PACKED_SIZE)
  for (let op = 0; op < 6; op++) {
    const s = op * OP_SIZE
    const d = op * 17
    for (let i = 0; i < 11; i++) p[d + i] = v[s + i] & 0x7f
    p[d + 11] = (v[s + 11] & 3) | ((v[s + 12] & 3) << 2)
    p[d + 12] = (v[s + 13] & 7) | ((v[s + 20] & 15) << 3)
    p[d + 13] = (v[s + 14] & 3) | ((v[s + 15] & 7) << 2)
    p[d + 14] = v[s + 16] & 0x7f
    p[d + 15] = (v[s + 17] & 1) | ((v[s + 18] & 31) << 1)
    p[d + 16] = v[s + 19] & 0x7f
  }
  for (let i = 0; i < 8; i++) p[102 + i] = v[126 + i] & 0x7f
  p[110] = v[134] & 31
  p[111] = (v[135] & 7) | ((v[136] & 1) << 3)
  p[112] = v[137] & 0x7f
  p[113] = v[138] & 0x7f
  p[114] = v[139] & 0x7f
  p[115] = v[140] & 0x7f
  p[116] = (v[141] & 1) | ((v[142] & 7) << 1) | ((v[143] & 7) << 4)
  p[117] = v[144] & 0x7f
  for (let i = 0; i < 10; i++) p[118 + i] = v[NAME_OFF + i] & 0x7f
  return p
}

/** VMEM packed (128) -> VCED (155), sanitized to legal ranges. */
export function unpackVoice(p: ArrayLike<number>, offset = 0): Uint8Array {
  const v = new Uint8Array(VOICE_SIZE)
  const b = (i: number): number => p[offset + i] & 0x7f
  for (let op = 0; op < 6; op++) {
    const s = op * 17
    const d = op * OP_SIZE
    for (let i = 0; i < 11; i++) v[d + i] = b(s + i)
    v[d + 11] = b(s + 11) & 3
    v[d + 12] = (b(s + 11) >> 2) & 3
    v[d + 13] = b(s + 12) & 7
    v[d + 20] = (b(s + 12) >> 3) & 15
    v[d + 14] = b(s + 13) & 3
    v[d + 15] = (b(s + 13) >> 2) & 7
    v[d + 16] = b(s + 14)
    v[d + 17] = b(s + 15) & 1
    v[d + 18] = (b(s + 15) >> 1) & 31
    v[d + 19] = b(s + 16)
  }
  for (let i = 0; i < 8; i++) v[126 + i] = b(102 + i)
  v[134] = b(110) & 31
  v[135] = b(111) & 7
  v[136] = (b(111) >> 3) & 1
  v[137] = b(112)
  v[138] = b(113)
  v[139] = b(114)
  v[140] = b(115)
  v[141] = b(116) & 1
  v[142] = (b(116) >> 1) & 7
  v[143] = (b(116) >> 4) & 7
  v[144] = b(117)
  for (let i = 0; i < 10; i++) v[NAME_OFF + i] = b(118 + i)
  return sanitizeVoice(v)
}

/** Build a 32-voice bulk dump. Fewer than 32 voices are padded with INIT VOICE. */
export function buildBulk(voices: ArrayLike<number>[], channel = 0): Uint8Array {
  const out = new Uint8Array(BULK_SIZE)
  out.set([0xf0, 0x43, channel & 15, 0x09, 0x20, 0x00], 0)
  for (let i = 0; i < 32; i++) out.set(packVoice(voices[i] ?? initVoice()), 6 + i * PACKED_SIZE)
  out[6 + BULK_DATA] = checksum(out, 6, 6 + BULK_DATA)
  out[BULK_SIZE - 1] = 0xf7
  return out
}

/** Build a single-voice (VCED) dump. */
export function buildSingle(voice: ArrayLike<number>, channel = 0): Uint8Array {
  const out = new Uint8Array(SINGLE_SIZE)
  out.set([0xf0, 0x43, channel & 15, 0x00, 0x01, 0x1b], 0)
  for (let i = 0; i < VOICE_SIZE; i++) out[6 + i] = voice[i] & 0x7f
  out[6 + VOICE_SIZE] = checksum(out, 6, 6 + VOICE_SIZE)
  out[SINGLE_SIZE - 1] = 0xf7
  return out
}

export type ParsedSysex =
  | { kind: 'bulk'; voices: Uint8Array[]; names: string[]; checksumOk: boolean }
  | { kind: 'single'; voice: Uint8Array; name: string; checksumOk: boolean }

/** Parse a .syx file. Throws on unrecognised data; a bad checksum is reported, not fatal (many old banks have one). */
export function parseSysex(data: ArrayLike<number>): ParsedSysex {
  const n = data.length
  for (let i = 0; i + 5 < n; i++) {
    if (data[i] !== 0xf0 || data[i + 1] !== 0x43) continue
    const fmt = data[i + 3]
    const hi = data[i + 4]
    const lo = data[i + 5]
    const count = (hi << 7) | lo
    const start = i + 6
    if (fmt === 0x09 && count === BULK_DATA && start + BULK_DATA <= n) {
      const voices: Uint8Array[] = []
      for (let k = 0; k < 32; k++) voices.push(unpackVoice(data, start + k * PACKED_SIZE))
      const cs = start + BULK_DATA < n ? data[start + BULK_DATA] : -1
      return { kind: 'bulk', voices, names: voices.map(voiceName), checksumOk: cs === checksum(data, start, start + BULK_DATA) }
    }
    if (fmt === 0x00 && count === VOICE_SIZE && start + VOICE_SIZE <= n) {
      const raw = Array.from({ length: VOICE_SIZE }, (_, k) => data[start + k] & 0x7f)
      const voice = sanitizeVoice(raw)
      const cs = start + VOICE_SIZE < n ? data[start + VOICE_SIZE] : -1
      return { kind: 'single', voice, name: voiceName(voice), checksumOk: cs === checksum(data, start, start + VOICE_SIZE) }
    }
  }
  if (n === BULK_DATA) {
    const voices: Uint8Array[] = []
    for (let k = 0; k < 32; k++) voices.push(unpackVoice(data, k * PACKED_SIZE))
    return { kind: 'bulk', voices, names: voices.map(voiceName), checksumOk: true }
  }
  if (n === VOICE_SIZE) {
    const voice = sanitizeVoice(data)
    return { kind: 'single', voice, name: voiceName(voice), checksumOk: true }
  }
  throw new Error('Not a DX7 voice or 32-voice cartridge sysex file')
}

// ─── Compact storage for plugin data (base64 of the packed 4096-byte bank) ────

export function bytesToBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeBank(voices: ArrayLike<number>[]): string {
  const bank = new Uint8Array(BULK_DATA)
  for (let i = 0; i < 32; i++) bank.set(packVoice(voices[i] ?? initVoice()), i * PACKED_SIZE)
  return bytesToBase64(bank)
}

export function decodeBank(s: string): Uint8Array[] {
  const bank = base64ToBytes(s)
  const voices: Uint8Array[] = []
  for (let i = 0; i < 32; i++) voices.push(bank.length >= (i + 1) * PACKED_SIZE ? unpackVoice(bank, i * PACKED_SIZE) : initVoice())
  return voices
}
