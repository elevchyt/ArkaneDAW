import { nanoid } from 'nanoid'
import {
  DEFAULT_NOTE_KEY,
  FX_SLOTS,
  MIXER_INSERTS,
  PLAYLIST_TRACKS,
  TICKS_PER_STEP,
  type Channel,
  type MixerTrack,
  type Note,
  type Pattern,
  type PlaylistTrack,
  type Project,
  type PluginInstanceState
} from './types'

export const uid = (): string => nanoid(10)

// FL-ish default pattern palette
export const PATTERN_COLORS = [
  '#6b8496', '#7d6e9c', '#9c6e8b', '#9c7a6e', '#8e9c6e', '#6e9c7d', '#6e8e9c', '#a37a52',
  '#5f86b3', '#b35f86', '#86b35f', '#b3a05f', '#5fb3a6', '#a65fb3', '#b36a5f', '#7f8f98'
]

export const CHANNEL_COLORS = [
  '#5f7381', '#5f8171', '#81775f', '#815f6f', '#6f5f81', '#5f7f81', '#7f815f', '#815f5f'
]

export function defaultNote(partial: Partial<Note> = {}): Note {
  return {
    id: uid(),
    key: DEFAULT_NOTE_KEY,
    pos: 0,
    len: TICKS_PER_STEP,
    vel: 100 / 128,
    pan: 0,
    rel: 0.5,
    fine: 0,
    modX: 0.5,
    modY: 0.5,
    color: 0,
    slide: false,
    porta: false,
    muted: false,
    ...partial
  }
}

export function makePattern(n: number): Pattern {
  return { id: uid(), name: `Pattern ${n}`, color: PATTERN_COLORS[(n - 1) % PATTERN_COLORS.length], notes: {}, length: 0 }
}

export function makeChannel(name: string, plugin: PluginInstanceState | null, extra: Partial<Channel> = {}): Channel {
  return {
    id: uid(),
    name,
    color: CHANNEL_COLORS[0],
    kind: 'instrument',
    plugin,
    volume: 0.78,
    pan: 0,
    pitch: 0,
    mixerTrack: 0,
    muted: false,
    filterGroup: 'Unsorted',
    ...extra
  }
}

export function makeMixerTrack(index: number): MixerTrack {
  return {
    id: uid(),
    index,
    name: index === 0 ? 'Master' : `Insert ${index}`,
    color: '#5c676d',
    volume: 0.8,
    pan: 0,
    stereoSep: 0,
    muted: false,
    solo: false,
    armed: false,
    inputDevice: null,
    inputChannel: 'stereo',
    phaseInvert: false,
    swapLR: false,
    slots: Array.from({ length: FX_SLOTS }, () => null),
    sends: index === 0 ? [] : [{ target: 0, level: 1 }],
    eq: { lowGain: 0, midGain: 0, highGain: 0, lowFreq: 90, midFreq: 1400, highFreq: 9000 },
    fxEnabled: true,
    latencyComp: 0
  }
}

export function makePlaylistTrack(i: number): PlaylistTrack {
  return { id: uid(), name: `Track ${i + 1}`, color: '#5f6e77', height: 52, muted: false, locked: false }
}

/** A blank project shaped like FL Studio's default "Basic with limiter" template. */
export function makeEmptyProject(): Project {
  const pattern = makePattern(1)
  const mixer = Array.from({ length: MIXER_INSERTS + 1 }, (_, i) => makeMixerTrack(i))
  return {
    version: 1,
    name: 'Untitled',
    author: '',
    genre: '',
    info: '',
    tempo: 130,
    timeSig: [4, 4],
    swing: 0,
    masterPitch: 0,
    masterVolume: 0.8,
    patterns: [pattern],
    channels: [],
    playlist: { tracks: Array.from({ length: PLAYLIST_TRACKS }, (_, i) => makePlaylistTrack(i)), clips: [] },
    markers: [],
    mixer,
    automations: [],
    samples: [],
    filterGroups: ['Unsorted']
  }
}
