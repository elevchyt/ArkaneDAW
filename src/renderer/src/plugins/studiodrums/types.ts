// Shared types for Studio Drums (UI, loader, DSP and tests). Pure types: safe to import anywhere.

/** Mixer strips (one per kit area). Every kit key routes to one strip. */
export const STRIPS = ['kick', 'snare', 'side', 'tom1', 'tom2', 'tom3', 'tom4', 'hihat', 'ride', 'crash', 'fx', 'perc'] as const
export type StripId = (typeof STRIPS)[number]

/** Processing buses (EQ / Punch / room send) that the strips feed. */
export const BUSES = ['kick', 'snare', 'toms', 'hats', 'cymbals', 'perc'] as const
export type BusId = (typeof BUSES)[number]

export const STRIP_BUS: Record<StripId, BusId> = {
  kick: 'kick',
  snare: 'snare',
  side: 'snare',
  tom1: 'toms',
  tom2: 'toms',
  tom3: 'toms',
  tom4: 'toms',
  hihat: 'hats',
  ride: 'cymbals',
  crash: 'cymbals',
  fx: 'cymbals',
  perc: 'perc'
}

export const STRIP_NAMES: Record<StripId, string> = {
  kick: 'Kick',
  snare: 'Snare',
  side: 'X-Stick',
  tom1: 'Tom 1',
  tom2: 'Tom 2',
  tom3: 'Tom 3',
  tom4: 'Tom 4',
  hihat: 'Hi-Hat',
  ride: 'Ride',
  crash: 'Crash',
  fx: 'FX Cym',
  perc: 'Perc'
}

export const BUS_NAMES: Record<BusId, string> = { kick: 'Kick', snare: 'Snare', toms: 'Toms', hats: 'Hats', cymbals: 'Cymbals', perc: 'Perc' }

// ─── kit.json (resources/drumkits/<kit>/kit.json) ───

export interface KitLayer {
  /** centre velocity (1..127) of this layer: the velocity at which it plays at its natural level */
  vel: number
  lo: number
  hi: number
  /** natural loudness relative to the piece's loudest layer, = (vel/127)^velocityExponent */
  amp: number
  /** round-robin files, relative to resources/drumkits/ */
  files: string[]
}

export interface KitPiece {
  name: string
  cat: string
  channels: number
  /** pan of mono pieces (-1..1, drummer's view) */
  pan: number
  layers: KitLayer[]
}

export interface KitKey {
  piece: string
  name: string
  group: string
  ch: StripId
  /** semitones */
  tune?: number
  /** dB */
  gain?: number
  /** choke group this key's voices belong to */
  choke?: number
  /** choke groups silenced when this key is played */
  chokes?: number[]
  /** play as a flam (soft grace note ~25 ms before) */
  flam?: boolean
  /** velocity multiplier (ghost notes) */
  velScale?: number
}

export interface PadBank {
  name: string
  /** 16 keys, rows top → bottom */
  keys: number[]
}

export interface KitJson {
  format: 1
  id: string
  name: string
  description: string
  sampleRate: number
  velocityExponent: number
  pieces: Record<string, KitPiece>
  keys: Record<string, KitKey>
  pads: PadBank[]
}

/** UI metadata generated into kits.gen.ts (no sample lists). */
export interface KitMeta {
  id: string
  name: string
  description: string
  keys: Record<string, { name: string; group: string; ch: StripId; piece: string }>
  pads: PadBank[]
}

// ─── plugin data ───

/** Persisted instance data. */
export interface StudioDrumsData {
  kit: string
}

/** What the DSP receives after resolveData(). */
export interface ResolvedDrumsData extends StudioDrumsData {
  kitDef?: KitJson
  /** decoded PCM (16-bit, at the context's sample rate) keyed by file; only files not yet shipped to this context */
  pcm?: Record<string, Int16Array[]>
  error?: string
}

// ─── editor <-> DSP messages ───

export interface GrooveEvent {
  /** tick (PPQ 96) */
  t: number
  k: number
  /** 1..127 */
  v: number
}

export type DrumsMessage =
  | { type: 'groove'; events: GrooveEvent[]; lengthTicks: number; loops?: number }
  | { type: 'grooveStop' }

export type DrumsStatus = { type: 'groovePos'; tick: number; playing: boolean }
