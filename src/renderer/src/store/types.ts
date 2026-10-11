// Core project model. Everything here is plain JSON so it can be saved, diffed and undone.
//
// Time is measured in ticks. PPQ (ticks per quarter note) is 96 like FL Studio's default,
// so one step (1/16 note) is 24 ticks and one 4/4 bar is 384 ticks.

export type ID = string

export const PPQ = 96
export const TICKS_PER_STEP = PPQ / 4
export const MIXER_INSERTS = 125 // Master + 125 inserts, like FL Studio 20+
export const FX_SLOTS = 10
export const PLAYLIST_TRACKS = 200
export const DEFAULT_NOTE_KEY = 60 // C5 in FL Studio naming

/** A note in a pattern. Mirrors FL Studio's per-note properties. */
export interface Note {
  id: ID
  key: number // MIDI key 0..131 (FL range C0..B10)
  pos: number // ticks from pattern start
  len: number // ticks
  vel: number // 0..1 (FL default 100/128)
  pan: number // -1..1
  rel: number // release velocity 0..1
  fine: number // fine pitch in cents, -120..120
  modX: number // 0..1, default 0.5 (filter cutoff on native synths)
  modY: number // 0..1, default 0.5 (filter resonance on native synths)
  color: number // 0..15 color group / MIDI channel
  slide: boolean
  porta: boolean
  muted: boolean
}

export interface Pattern {
  id: ID
  name: string
  color: string
  /** Notes per channel. Step-sequencer steps are just short notes at DEFAULT_NOTE_KEY. */
  notes: Record<ID, Note[]>
  /** Explicit length in ticks; 0 = automatic (rounded up to whole bars of content, min 1 bar). */
  length: number
  timeSig?: [number, number]
}

export interface PluginInstanceState {
  pluginId: string // e.g. "workstation", "reverb", "vst:/path/to/plugin.so"
  params: Record<string, number>
  data?: unknown // plugin-specific opaque state (wavetables, sequences, VST chunk, ...)
  presetName?: string
}

export type ChannelKind = 'instrument' | 'sampler' | 'audio' | 'automation' | 'layer'

export interface SamplerSettings {
  sampleId: ID | null
  rootKey: number
  reverse: boolean
  loop: boolean
  attack: number // seconds
  decay: number
  sustain: number // 0..1
  release: number
  startOffset: number // 0..1 of sample
  oneShot: boolean // play to end ignoring note length (drum style)
  pitchToKey: boolean
}

export interface Channel {
  id: ID
  name: string
  color: string
  kind: ChannelKind
  plugin: PluginInstanceState | null // instrument channels
  sampler?: SamplerSettings // sampler/audio channels
  automationId?: ID // automation channels
  volume: number // 0..1.25 linear (FL default 0.78 = 100%)
  pan: number // -1..1
  pitch: number // cents, -1200..1200
  mixerTrack: number // 0 = master, 1..125 inserts, -1 none
  muted: boolean
  filterGroup: string // "All" + user groups (Channel rack filter)
  /** Number of steps shown in step sequencer for this channel (FL "steps" per pattern). */
  rootNote?: number
}

export type ClipKind = 'pattern' | 'audio' | 'automation'

export interface Clip {
  id: ID
  kind: ClipKind
  ref: ID // pattern id / sample id / automation id
  track: number // playlist track index
  start: number // ticks
  length: number // ticks
  offset: number // ticks into the source (slip edit)
  muted: boolean
  /** Audio clips: which channel (kind 'audio') owns playback settings. */
  channelId?: ID
  /** Audio clips: fade-in / fade-out length in ticks (overlapping clips get them as a crossfade). */
  fadeIn?: number
  fadeOut?: number
  /** Fade curve tension -1..1 (0 = linear, + = fast start, - = slow start). */
  fadeInTension?: number
  fadeOutTension?: number
  /**
   * Audio clips: time-stretch factor (2 = the sample plays over twice its length). `offset` and `length` are
   * in timeline ticks of the stretched audio. How the pitch reacts follows the channel's Sampler stretch mode.
   */
  stretch?: number
  /** Clips sharing a group id select, move and delete together (Shift+G / Alt+G). */
  group?: string
}

export interface PlaylistTrack {
  id: ID
  name: string
  color: string
  height: number // px at default zoom
  muted: boolean
  locked: boolean
}

export interface Marker {
  id: ID
  pos: number
  name: string
  kind: 'marker' | 'loopStart' | 'loopEnd' | 'timeSig'
  timeSig?: [number, number]
}

export interface FxSlot {
  id: ID
  plugin: PluginInstanceState
  enabled: boolean
  mix: number // 0..1 dry/wet
}

export interface MixerSend {
  target: number // mixer track index
  level: number // 0..1.25
}

export interface MixerTrack {
  id: ID
  index: number // 0 = master
  name: string
  color: string
  volume: number // 0..1.25 linear fader (0.8 = 0 dB like FL)
  pan: number // -1..1
  stereoSep: number // -1 (mono) .. 1 (wide)
  muted: boolean
  solo: boolean
  armed: boolean // armed for recording
  inputDevice: string | null // audio input device id for recording
  /** stereo (default) or mono (left + right summed); left / right only in older projects */
  inputChannel: 'mono' | 'stereo' | 'left' | 'right'
  phaseInvert: boolean
  swapLR: boolean
  slots: (FxSlot | null)[]
  sends: MixerSend[] // insert->insert routing; default [{target:0, level:1}]
  eq: { lowGain: number; midGain: number; highGain: number; lowFreq: number; midFreq: number; highFreq: number }
  fxEnabled: boolean
  latencyComp: number
}

export type AutomationTarget =
  | { kind: 'channel'; channelId: ID; param: 'volume' | 'pan' | 'pitch' }
  | { kind: 'channelPlugin'; channelId: ID; paramId: string }
  | { kind: 'mixer'; track: number; param: 'volume' | 'pan' | 'stereoSep' }
  | { kind: 'mixerFx'; track: number; slot: number; paramId: string }
  | { kind: 'mixerFxMix'; track: number; slot: number }
  | { kind: 'tempo' }
  | { kind: 'masterVolume' }
  | { kind: 'masterPitch' }

export interface AutomationPoint {
  t: number // ticks within clip
  v: number // normalized 0..1
  tension: number // -1..1 curve
  mode: 'single' | 'double' | 'hold' | 'stairs' | 'smooth' | 'pulse' | 'wave'
}

export interface Automation {
  id: ID
  name: string
  color: string
  target: AutomationTarget | null
  points: AutomationPoint[]
  length: number
}

export interface Sample {
  id: ID
  name: string
  path: string | null // absolute path on disk when known
  duration: number // seconds
  sampleRate: number
  channels: number
  /** Embedded in project folder (recordings) */
  embedded: boolean
}

export interface Project {
  version: 1
  name: string
  author: string
  genre: string
  info: string
  tempo: number // BPM
  timeSig: [number, number]
  swing: number // 0..1
  masterPitch: number // cents
  masterVolume: number // 0..1.25
  patterns: Pattern[]
  channels: Channel[]
  playlist: { tracks: PlaylistTrack[]; clips: Clip[] }
  markers: Marker[]
  mixer: MixerTrack[]
  automations: Automation[]
  samples: Sample[]
  filterGroups: string[]
}
