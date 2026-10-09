// Audio / MIDI / recording preferences (FL "Settings – Audio / MIDI"). Machine-level settings, so
// they live in localStorage rather than in the project file.
import { create } from 'zustand'

export type MidiChannelMode = 'omni' | 'perChannel'

export interface AudioSettings {
  /** '' = system default output. */
  outputDeviceId: string
  /** Default input when a mixer track has no explicit input device. '' = system default. */
  inputDeviceId: string
  /** Browser input processing (echo cancellation, noise suppression, AGC). Off for music. */
  inputProcessing: boolean
  inputChannels: 1 | 2
  /** Automatic latency compensation of recorded audio (device latencies or calibration). */
  autoLatencyComp: boolean
  /** Extra user offset in ms (positive = move recordings earlier). */
  latencyOffsetMs: number
  /** Measured loopback round-trip latency, ms (null = not calibrated). */
  calibratedLatencyMs: number | null
  /** Pattern mode: also drop recorded audio clips at the song start in the playlist. */
  patternAudioToPlaylist: boolean
  /** Input monitoring disabled per mixer track (default: monitor while armed). */
  monitorOff: Record<number, boolean>
  metronomeVolume: number // 0..1
  precountBars: number // 1..4
  quantizeStart: boolean
  quantizeEnd: boolean
  // MIDI
  midiEnabled: Record<string, boolean> // by input id (default true)
  midiControllerType: Record<string, string> // 'generic'
  midiChannelMode: MidiChannelMode
  midiSustain: boolean // foot pedal controls note off
  midiBendRange: number // semitones
  midiModWheelToModX: boolean
  midiVelocityCurve: number // -1..1
}

export const DEFAULT_SETTINGS: AudioSettings = {
  outputDeviceId: '',
  inputDeviceId: '',
  inputProcessing: false,
  inputChannels: 2,
  autoLatencyComp: true,
  latencyOffsetMs: 0,
  calibratedLatencyMs: null,
  patternAudioToPlaylist: true,
  monitorOff: {},
  metronomeVolume: 0.7,
  precountBars: 1,
  quantizeStart: true,
  quantizeEnd: false,
  midiEnabled: {},
  midiControllerType: {},
  midiChannelMode: 'omni',
  midiSustain: true,
  midiBendRange: 2,
  midiModWheelToModX: true,
  midiVelocityCurve: 0
}

const KEY = 'arkane.audioSettings.v1'

function load(): AudioSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AudioSettings>) }
  } catch {
    /* storage unavailable or corrupt */
  }
  return { ...DEFAULT_SETTINGS }
}

interface SettingsState extends AudioSettings {
  update: (patch: Partial<AudioSettings>) => void
  reset: () => void
}

export const useAudioSettings = create<SettingsState>((set, get) => ({
  ...load(),
  update(patch) {
    set(patch)
    save(get())
  },
  reset() {
    set({ ...DEFAULT_SETTINGS })
    save(get())
  }
}))

function save(s: SettingsState): void {
  try {
    const out: Partial<AudioSettings> = {}
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof AudioSettings)[]) (out as Record<string, unknown>)[k] = s[k]
    globalThis.localStorage?.setItem(KEY, JSON.stringify(out))
  } catch {
    /* ignore */
  }
}

/** Non-React accessor (also intended for the transport's metronome volume). */
export const getAudioSettings = (): AudioSettings => useAudioSettings.getState()
