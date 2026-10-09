// Drum Machine plugin `data` (the opaque JSON stored with the channel) + kit catalogue metadata.
// Pure data: shared by the editor and the DSP.

export interface PadTweak {
  /** semitones, -24..24 */
  tune?: number
  /** decay multiplier, 0.1..3 */
  decay?: number
  /** dB, -40 (off)..+6 */
  level?: number
  /** -1..1 */
  pan?: number
  /** -1 (dark / less snappy) .. 1 (bright / more snappy) */
  tone?: number
  /** cut group 0 (none) .. 8; pads in the same group cut each other */
  choke?: number
}

export interface DrumData {
  /** Kit id, see KITS */
  kit: string
  /** Per-kit, per-key tweaks: pads[kitId][key] */
  pads: Record<string, Record<string, PadTweak>>
}

export const DEFAULT_DATA: DrumData = { kit: '808', pads: {} }

export interface KitMeta {
  id: string
  name: string
  title: string
  category: 'Analog' | 'Digital' | 'Modern'
  /** analog = real-time circuit synthesis; sampled = synthesized once into ROM-style buffers */
  mode: 'analog' | 'sampled'
}

export const KITS: KitMeta[] = [
  { id: '808', name: '808', title: 'TR-808 Rhythm Composer', category: 'Analog', mode: 'analog' },
  { id: '909', name: '909', title: 'TR-909 Rhythm Composer', category: 'Analog', mode: 'analog' },
  { id: '606', name: '606', title: 'TR-606 Drumatix', category: 'Analog', mode: 'analog' },
  { id: 'CR-78', name: 'CR-78', title: 'CompuRhythm CR-78', category: 'Analog', mode: 'analog' },
  { id: 'Simmons', name: 'Simmons', title: 'SDS-V Electronic Drums', category: 'Analog', mode: 'analog' },
  { id: 'Linn', name: 'Linn', title: 'LinnDrum LM-2', category: 'Digital', mode: 'sampled' },
  { id: 'LM-1', name: 'LM-1', title: 'LM-1 Drum Computer', category: 'Digital', mode: 'sampled' },
  { id: 'DMX', name: 'DMX', title: 'DMX Digital Drums', category: 'Digital', mode: 'sampled' },
  { id: 'Drumulator', name: 'Drumulator', title: 'Drumulator 8-bit', category: 'Digital', mode: 'sampled' },
  { id: '707', name: '707', title: 'TR-707 / 727 Rhythm Composer', category: 'Digital', mode: 'sampled' },
  { id: 'SP-12', name: 'SP-12', title: '12-bit Sampling Percussion', category: 'Digital', mode: 'sampled' },
  { id: 'Studio', name: 'Studio', title: 'Studio Acoustic Kit', category: 'Digital', mode: 'sampled' },
  { id: 'Trap', name: 'Trap', title: 'Trap 808', category: 'Modern', mode: 'analog' },
  { id: 'Lo-fi', name: 'Lo-fi', title: 'Dusty Lo-fi Kit', category: 'Modern', mode: 'sampled' },
  { id: 'Techno', name: 'Techno', title: 'Warehouse Techno', category: 'Modern', mode: 'analog' }
]

export const KIT_BY_ID: Record<string, KitMeta> = Object.fromEntries(KITS.map((k) => [k.id, k]))

/** Tolerant reader for whatever is stored in the channel. */
export function readData(d: unknown): DrumData {
  const o = (d && typeof d === 'object' ? d : {}) as Partial<DrumData>
  const kit = typeof o.kit === 'string' && KIT_BY_ID[o.kit] ? o.kit : DEFAULT_DATA.kit
  const pads = o.pads && typeof o.pads === 'object' ? o.pads : {}
  return { kit, pads }
}

export function getTweak(d: DrumData, kit: string, key: number): PadTweak {
  return d.pads[kit]?.[String(key)] ?? {}
}

/** Immutable update of one pad tweak. */
export function withTweak(d: DrumData, kit: string, key: number, patch: PadTweak): DrumData {
  const kitPads = { ...(d.pads[kit] ?? {}) }
  kitPads[String(key)] = { ...(kitPads[String(key)] ?? {}), ...patch }
  return { ...d, pads: { ...d.pads, [kit]: kitPads } }
}
