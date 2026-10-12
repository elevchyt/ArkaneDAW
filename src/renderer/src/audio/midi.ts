// Web MIDI input: plays the selected channel (or the Nth rack channel for MIDI channel N), with
// velocity, pitch bend (±range), sustain pedal (CC64 defers note-offs), mod wheel (CC1 → Mod X of
// new notes) and live note recording.
import { create } from 'zustand'
import { useUI } from '../store/ui'
import { getProject } from '../store/project'
import { useTransport } from '../store/transport'
import { liveChannelId } from '../store/actions'
import { getEngine, initAudio, transport } from './transport'
import { recordLiveNote } from './recording'
import { bendSemitones, parseMidi, SustainTracker, velocityCurve } from './midi-core'
import { getAudioSettings, useAudioSettings } from '../windows/settings/settings-store'

export interface MidiInputInfo {
  id: string
  name: string
  manufacturer: string
  state: 'connected' | 'disconnected'
}

export type MidiStatus = 'idle' | 'pending' | 'ok' | 'denied' | 'unsupported'

interface MidiState {
  status: MidiStatus
  error: string | null
  inputs: MidiInputInfo[]
  /** Last received event (shown in the settings window, FL-style "last tweaked" readout). */
  lastEvent: string
  activity: number // increments on each message (activity LED)
}

export const useMidi = create<MidiState>(() => ({ status: 'idle', error: null, inputs: [], lastEvent: '', activity: 0 }))

interface Voice {
  channelId: string
  id: number
  key: number
}

let access: MIDIAccess | null = null
const tracker = new SustainTracker<Voice>()
let modX = 0.5

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (k: number): string => `${NOTE_NAMES[k % 12]}${Math.floor(k / 12)}` // FL naming (60 = C5)

/**
 * Target channel for a MIDI message. Omni → the first selected channel; per-channel → Nth rack channel —
 * except while recording with "MIDI into channel" on, where everything plays the channel being recorded.
 */
function targetChannel(midiCh: number): string | null {
  const t = useTransport.getState()
  if (getAudioSettings().midiChannelMode === 'perChannel' && !(t.recording && t.recordMidi)) return getProject().channels[midiCh]?.id ?? null
  return liveChannelId()
}

function release(voices: Voice[]): void {
  const e = getEngine()
  for (const v of voices) {
    e?.noteOff(v.channelId, v.id, v.key)
    recordLiveNote(v.channelId, v.key, 0, false, v.id)
  }
}

function enabled(id: string): boolean {
  return getAudioSettings().midiEnabled[id] !== false
}

function onMessage(input: MIDIInput, ev: MIDIMessageEvent): void {
  if (!enabled(input.id) || !ev.data) return
  const m = parseMidi(ev.data)
  if (m.type === 'other') return
  useMidi.setState((s) => ({ activity: s.activity + 1 }))
  const s = getAudioSettings()
  switch (m.type) {
    case 'on': {
      const channelId = targetChannel(m.ch)
      useMidi.setState({ lastEvent: `Note on ${noteName(m.key)} vel ${Math.round(m.vel * 127)} (ch ${m.ch + 1})` })
      if (!channelId) return
      const vel = velocityCurve(m.vel, s.midiVelocityCurve)
      const key = `${input.id}:${m.ch}:${m.key}`
      void initAudio().then((engine) => {
        const id = engine.noteOn(channelId, m.key, vel, s.midiModWheelToModX ? { modX } : {})
        release(tracker.press(key, { channelId, id, key: m.key }))
        recordLiveNote(channelId, m.key, vel, true, id)
      })
      return
    }
    case 'off': {
      useMidi.setState({ lastEvent: `Note off ${noteName(m.key)} (ch ${m.ch + 1})` })
      const key = `${input.id}:${m.ch}:${m.key}`
      // Note-on is async (audio boot); defer the off behind it so they stay ordered.
      void initAudio().then(() => release(tracker.release(key)))
      return
    }
    case 'cc': {
      useMidi.setState({ lastEvent: `CC${m.cc} = ${m.value} (ch ${m.ch + 1})` })
      if (m.cc === 64 && s.midiSustain) release(tracker.setPedal(m.value >= 64))
      else if (m.cc === 1) {
        modX = 0.5 + (m.value / 127) * 0.5
        useUI.getState().setHint(`Mod wheel: ${m.value}`)
      } else if (m.cc === 123 || m.cc === 120) {
        release(tracker.releaseAll())
        if (m.cc === 120) transport.panic()
      }
      return
    }
    case 'bend': {
      const channelId = targetChannel(m.ch)
      const st = bendSemitones(m.value, s.midiBendRange)
      useMidi.setState({ lastEvent: `Pitch bend ${st >= 0 ? '+' : ''}${st.toFixed(2)} st (ch ${m.ch + 1})` })
      if (!channelId) return
      const ch = getProject().channels.find((c) => c.id === channelId)
      // Channel pitch knob is a static bend on the same input; add to it so it isn't lost.
      getEngine()?.channels.get(channelId)?.instrument?.schedule([{ kind: 'bend', time: 0, semitones: st + (ch?.pitch ?? 0) / 100 }])
      return
    }
    case 'pressure':
      return
  }
}

function refreshInputs(): void {
  if (!access) return
  const list: MidiInputInfo[] = []
  access.inputs.forEach((inp) => {
    list.push({ id: inp.id, name: inp.name ?? 'MIDI input', manufacturer: inp.manufacturer ?? '', state: inp.state })
    inp.onmidimessage = (ev) => onMessage(inp, ev)
  })
  useMidi.setState({ inputs: list })
}

/** Request Web MIDI access and listen to every input (idempotent; safe if MIDI is unavailable). */
export async function initMidi(): Promise<void> {
  if (access || useMidi.getState().status === 'pending') return
  const nav = navigator as Navigator & { requestMIDIAccess?: (o?: MIDIOptions) => Promise<MIDIAccess> }
  if (typeof nav.requestMIDIAccess !== 'function') {
    useMidi.setState({ status: 'unsupported', error: 'Web MIDI is not available' })
    return
  }
  useMidi.setState({ status: 'pending', error: null })
  try {
    access = await nav.requestMIDIAccess({ sysex: false })
    access.onstatechange = (e) => {
      const port = (e as MIDIConnectionEvent).port
      if (port?.type === 'input' && port.state === 'disconnected') release(tracker.releaseAll())
      refreshInputs()
    }
    useMidi.setState({ status: 'ok' })
    refreshInputs()
  } catch (e) {
    useMidi.setState({ status: 'denied', error: String((e as Error)?.message ?? e) })
  }
}

/** Rescan devices (or connect if MIDI hasn't been initialized yet). */
export function rescanMidi(): void {
  if (access) refreshInputs()
  else {
    if (useMidi.getState().status !== 'pending') useMidi.setState({ status: 'idle' })
    void initMidi()
  }
}

/** Enable/disable an input (FL "Enable" in MIDI settings). Disabling releases its notes. */
export function setMidiInputEnabled(id: string, on: boolean): void {
  useAudioSettings.getState().update({ midiEnabled: { ...getAudioSettings().midiEnabled, [id]: on } })
  if (!on) release(tracker.releaseAll())
}

export function midiPanic(): void {
  release(tracker.releaseAll())
  tracker.setPedal(false)
}
