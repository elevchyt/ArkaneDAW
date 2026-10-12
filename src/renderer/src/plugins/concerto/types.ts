// Shared types for Concerto (UI, loader, DSP and tests). Pure types + tiny helpers: safe to import anywhere.

// ─── instrument.json (resources/concerto/<instrument>/instrument.json) ───

export interface SampleFile {
  /** path relative to resources/concerto/ */
  f: string
  /** sustain loop [start, end) in frames at `sampleRate` (crossfade baked into the file; jump end → start) */
  loop?: [number, number]
  /** legato start offset (frames): end of the attack */
  ofs?: number
}

export interface VelLayer {
  /** centre velocity (1..127): where the layer plays at its natural level */
  vel: number
  lo: number
  hi: number
  /** natural loudness relative to the loudest layer of this zone */
  amp: number
  /** round robins */
  files: SampleFile[]
}

export interface Zone {
  root: number
  lo: number
  hi: number
  /** cents added at playback */
  tune?: number
  /** ensembles: pan of this zone's section (-1..1), gain dB and source instrument */
  pan?: number
  gain?: number
  part?: string
  /** what this key range plays when it differs from the rest (e.g. swells: "Swell 2.3 s") — piano-roll key names */
  label?: string
  layers: VelLayer[]
}

export type ArtKind = 'sustain' | 'decay' | 'ring'

export interface ArticulationJson {
  id: string
  name: string
  kind: ArtKind
  /**
   * unpitched percussion (cymbals, gongs): every key of a zone plays its samples at the recorded rate — no
   * transposition, tuning standard, vibrato or glide; velocity layers / round robins work as usual
   */
  unpitched?: boolean
  /** decay kinds: damper time on note-off (s) */
  damp?: number
  zones: Zone[]
  /** release (jack / damper) samples, one-shot, triggered on note-off */
  release?: Zone[]
  /**
   * the release samples are the note's own ending (e.g. a cymbal roll's last strokes and ring): one per velocity
   * layer (same order as the zone's layers), played at the note's level while the note crossfades out
   */
  releaseTail?: boolean
}

export interface InstrumentJson {
  format: 1
  id: string
  name: string
  section: string
  description: string
  sampleRate: number
  velocityExponent: number
  range: [number, number]
  solo: boolean
  stage: { pan: number; width: number }
  /** maximum brightness (0..1), e.g. the fortepiano's darker voicing */
  tone?: number
  keyswitchBase: number
  articulations: ArticulationJson[]
}

/** UI metadata generated into instruments.gen.ts (no sample lists). */
export interface InstrumentMeta {
  id: string
  name: string
  section: string
  description: string
  range: [number, number]
  solo: boolean
  stage: { pan: number; width: number }
  arts: { id: string; name: string; kind: ArtKind; unpitched?: boolean; keys?: { lo: number; hi: number; name: string }[] }[]
  files: number
}

export interface EnsembleLayerDef {
  inst: string
  lo: number
  hi: number
  /** dB */
  gain: number
  transpose?: number
  /** preferred articulation id for this layer */
  art?: string
}

export interface EnsembleDef {
  name: string
  description: string
  layers: EnsembleLayerDef[]
}

// ─── plugin data ───

export interface LayerData {
  inst: string
  lo: number
  hi: number
  /** dB */
  gain: number
  transpose: number
  art?: string
}

/** Persisted instance data: 1–3 instrument layers. */
export interface ConcertoData {
  layers: LayerData[]
}

export const MAX_LAYERS = 3
export const DEFAULT_INSTRUMENT = 'strings'

export function layer(inst: string, o: Partial<LayerData> = {}): LayerData {
  return { inst, lo: 0, hi: 127, gain: 0, transpose: 0, ...o }
}

/** Normalise unknown persisted data. */
export function readData(d: unknown): ConcertoData {
  const o = (d && typeof d === 'object' ? d : {}) as Partial<ConcertoData>
  const layers = Array.isArray(o.layers)
    ? o.layers
        .filter((l): l is LayerData => !!l && typeof l === 'object' && typeof (l as LayerData).inst === 'string')
        .slice(0, MAX_LAYERS)
        .map((l) => ({
          inst: l.inst,
          lo: Number.isFinite(l.lo) ? l.lo : 0,
          hi: Number.isFinite(l.hi) ? l.hi : 127,
          gain: Number.isFinite(l.gain) ? l.gain : 0,
          transpose: Number.isFinite(l.transpose) ? l.transpose : 0,
          ...(typeof l.art === 'string' ? { art: l.art } : {})
        }))
    : []
  return { layers: layers.length ? layers : [layer(DEFAULT_INSTRUMENT)] }
}

/** What the DSP receives after resolveData(). */
export interface ResolvedConcertoData extends ConcertoData {
  /** instrument definitions for the layers (missing ones = unavailable) */
  defs?: Record<string, InstrumentJson>
  /** decoded PCM (16-bit, at the context's sample rate) keyed by file; only files not yet shipped to this context */
  pcm?: Record<string, Int16Array[]>
  error?: string
}

// ─── DSP → editor ───
export type ConcertoStatus = { type: 'status'; art: number; voices: number; ready: boolean; missing: number }
