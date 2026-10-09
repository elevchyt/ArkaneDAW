// ─────────────────────────────────────────────────────────────────────────────
// ArkaneDAW plugin SDK
//
// Every built-in plugin lives in  src/renderer/src/plugins/<id>/  with:
//   manifest.ts  – pure data (ParamDefs, presets). Imported by BOTH the UI and the DSP.
//   dsp.ts       – `export default` a DSPFactory. Runs inside the AudioWorklet thread:
//                  no DOM, no fetch, no timers, no allocation inside process() please.
//   index.tsx    – `export default` a PluginModule (manifest + React editor).
//
// Both registries are built with import.meta.glob, so adding a folder is all it takes.
// ─────────────────────────────────────────────────────────────────────────────

export type PluginKind = 'instrument' | 'effect'

export interface ParamDef {
  id: string
  name: string
  min: number
  max: number
  default: number
  /** Display unit, e.g. 'dB', 'Hz', 'ms', '%', 'st' */
  unit?: string
  /** UI mapping between knob position and value. Default 'linear'. */
  curve?: 'linear' | 'exp' | 'log'
  /** Quantize to this step (e.g. 1 for integers). */
  step?: number
  /** Enumerated parameter: value is the index into options. */
  options?: string[]
  /** Hide from generic editors / automation lists. */
  hidden?: boolean
}

export interface Preset {
  name: string
  category?: string
  /** Missing params fall back to their defaults. */
  params: Record<string, number>
  data?: unknown
}

export interface PluginManifest {
  id: string
  name: string
  kind: PluginKind
  /** Picker/browser grouping, e.g. 'Synth', 'Drums', 'Dynamics', 'Reverb & Delay', 'Modulation', 'Filter', 'Distortion', 'Utility' */
  category: string
  description?: string
  params: ParamDef[]
  presets?: Preset[]
  /** Initial opaque data for new instances (sequences, kits...). */
  defaultData?: unknown
  /** Instruments: polyphonic by default. Mono plugins slide/porta between notes. */
  mono?: boolean
  /** Number of audio outputs (stereo pairs). Default 1. */
  outputs?: number
  /** Effects that need a side-chain input. */
  sidechain?: boolean
  /** Accent color for picker icons & title bar stripe */
  color?: string
}

// ─── DSP side (AudioWorklet) ──────────────────────────────────────────────────

export interface DSPContext {
  sampleRate: number
  /** Compiled WebAssembly module, if the plugin's UI module supplied `loadWasm`. */
  wasm?: WebAssembly.Module
  /** Send a message back to the plugin's editor (e.g. tuner readout, sequence position). Avoid >60/s. */
  post: (msg: unknown) => void
}

/** A note-on as seen by an instrument. All values pre-normalized. */
export interface NoteOn {
  id: number // unique per note instance; use it to match noteOff
  key: number // MIDI key (integer). Fine tuning arrives separately in `fine`.
  vel: number // 0..1
  pan: number // -1..1
  fine: number // cents
  rel: number // 0..1 release velocity
  modX: number // 0..1 (0.5 neutral)  -> map to filter cutoff offset when it makes sense
  modY: number // 0..1 (0.5 neutral)  -> map to resonance offset when it makes sense
  porta: boolean // glide from previous note
  slide: boolean // slide note: glides currently sounding notes to this pitch, doesn't trigger
  color: number // 0..15
  /** Scheduled length in seconds when known (useful for 8-bit style sequence tails), else 0. */
  length: number
}

export interface InstrumentDSP {
  setParam(id: string, value: number): void
  setData?(data: unknown): void
  noteOn(note: NoteOn): void
  noteOff(id: number, key: number, releaseVel: number): void
  /** hard=true: silence immediately (panic); false: release everything. */
  allNotesOff(hard: boolean): void
  /** Channel pitch bend in semitones. */
  pitchBend?(semitones: number): void
  /** Handle a message sent from the editor with port.post(). */
  onMessage?(msg: unknown): void
  /** ADD stereo output into outL/outR for frames [start, end). Buffers are pre-zeroed per block. */
  process(outL: Float32Array, outR: Float32Array, start: number, end: number): void
}

export interface EffectDSP {
  setParam(id: string, value: number): void
  setData?(data: unknown): void
  onMessage?(msg: unknown): void
  reset?(): void
  /**
   * WRITE processed audio for frames [start, end). in* and out* may alias.
   * scL/scR = side-chain input (silence when none connected).
   */
  process(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    start: number,
    end: number,
    scL?: Float32Array,
    scR?: Float32Array
  ): void
}

export interface DSPFactory {
  id: string
  kind: 'instrument' | 'effect'
  create(ctx: DSPContext): InstrumentDSP | EffectDSP
}

// ─── Host <-> worklet message protocol ────────────────────────────────────────

export type ScheduledEvent =
  | { kind: 'on'; time: number; note: NoteOn }
  | { kind: 'off'; time: number; id: number; key: number; rel: number }
  | { kind: 'param'; time: number; id: string; value: number }
  | { kind: 'bend'; time: number; semitones: number }

export type ToWorklet =
  | { type: 'param'; id: string; value: number }
  | { type: 'params'; values: Record<string, number> }
  | { type: 'data'; data: unknown }
  | { type: 'events'; events: ScheduledEvent[] }
  | { type: 'panic'; hard: boolean }
  | { type: 'clearScheduled' }
  | { type: 'reset' }
  | { type: 'message'; msg: unknown }
  | { type: 'bypass'; bypass: boolean }
  | { type: 'ping'; id: number }

export type FromWorklet = { type: 'ready' } | { type: 'error'; message: string } | { type: 'message'; msg: unknown } | { type: 'pong'; id: number }
