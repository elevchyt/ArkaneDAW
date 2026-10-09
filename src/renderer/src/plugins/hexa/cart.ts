// UI-side cartridge handling: plugin `data` shape, file import, .syx export.
import { buildBulk, buildSingle, decodeBank, encodeBank, parseSysex, type ParsedSysex } from './sysex'
import { MASTER_IDS, paramsToVoice, voiceName, voiceToParams } from './voice'
import type { Preset } from '../sdk/types'

export interface HexaData {
  /** Currently selected slot in the loaded cartridge (0..31). */
  cartIndex: number
  /** Loaded cartridge, stored as base64 of the 4096-byte packed bank so it saves with the project. */
  cart?: { name: string; bank: string }
}

export function readData(d: unknown): HexaData {
  const x = (d ?? {}) as Partial<HexaData>
  return { cartIndex: Math.min(31, Math.max(0, x.cartIndex ?? 0)), cart: x.cart && typeof x.cart.bank === 'string' ? x.cart : undefined }
}

const bankCache = new Map<string, Uint8Array[]>()
export function cartVoices(data: HexaData): Uint8Array[] | null {
  if (!data.cart) return null
  let v = bankCache.get(data.cart.bank)
  if (!v) {
    v = decodeBank(data.cart.bank)
    bankCache.set(data.cart.bank, v)
  }
  return v
}

export function newCart(name: string, voices: Uint8Array[]): HexaData['cart'] {
  return { name, bank: encodeBank(voices) }
}

/** Preset that loads `voice` while keeping the instance's performance params (volume, mono, wheel...). */
export function voicePreset(voice: Uint8Array, current: Record<string, number>, data?: HexaData): Preset {
  const keep: Record<string, number> = {}
  for (const id of MASTER_IDS) if (current[id] !== undefined) keep[id] = current[id]
  return { name: voiceName(voice) || 'NO NAME', params: { ...voiceToParams(voice), ...keep }, data }
}

export async function readSysexFile(file: File): Promise<ParsedSysex> {
  const buf = new Uint8Array(await file.arrayBuffer())
  return parseSysex(buf)
}

export function currentVoice(params: Record<string, number>, name: string): Uint8Array {
  return paramsToVoice(params, name)
}

function download(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safe = (s: string): string => s.trim().replace(/[^a-z0-9._-]+/gi, '_') || 'hexa'

export function exportVoice(voice: Uint8Array): void {
  download(buildSingle(voice), `${safe(voiceName(voice))}.syx`)
}

export function exportCart(voices: Uint8Array[], name: string): void {
  download(buildBulk(voices), `${safe(name)}.syx`)
}
