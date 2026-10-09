import type { ParamDef, PluginManifest, Preset } from '../sdk/types'
import { BUSES, BUS_NAMES, STRIPS, STRIP_NAMES, type BusId, type StudioDrumsData } from './types'

export const DEFAULT_KIT = 'studio'

const BUS_ROOM_DEFAULT: Record<BusId, number> = { kick: 12, snare: 60, toms: 50, hats: 25, cymbals: 35, perc: 40 }

const params: ParamDef[] = [
  { id: 'master', name: 'Master', min: -24, max: 12, default: 0, unit: 'dB' },
  { id: 'dyn', name: 'Dynamics', min: 0, max: 150, default: 100, unit: '%', step: 1 },
  { id: 'humVel', name: 'Human Vel', min: 0, max: 100, default: 0, unit: '%', step: 1 },
  { id: 'humTime', name: 'Human Time', min: 0, max: 20, default: 0, unit: 'ms' },
  { id: 'room', name: 'Room', min: 0, max: 100, default: 20, unit: '%', step: 1 },
  { id: 'roomSize', name: 'Room Size', min: 0, max: 100, default: 40, unit: '%', step: 1 },
  { id: 'tempo', name: 'Groove Tempo', min: 40, max: 250, default: 100, unit: 'BPM', step: 1 }
]

for (const s of STRIPS) {
  const n = STRIP_NAMES[s]
  params.push(
    { id: `${s}.level`, name: `${n} Level`, min: -40, max: 12, default: 0, unit: 'dB' },
    { id: `${s}.pan`, name: `${n} Pan`, min: -1, max: 1, default: 0 },
    { id: `${s}.tune`, name: `${n} Tune`, min: -12, max: 12, default: 0, unit: 'st', step: 0.1 },
    { id: `${s}.decay`, name: `${n} Decay`, min: 5, max: 100, default: 100, unit: '%', step: 1 },
    { id: `${s}.mute`, name: `${n} Mute`, min: 0, max: 1, default: 0, options: ['Off', 'On'] }
  )
}

for (const b of BUSES) {
  const n = BUS_NAMES[b]
  params.push(
    { id: `bus.${b}.low`, name: `${n} Low`, min: -12, max: 12, default: 0, unit: 'dB' },
    { id: `bus.${b}.high`, name: `${n} High`, min: -12, max: 12, default: 0, unit: 'dB' },
    { id: `bus.${b}.punch`, name: `${n} Punch`, min: 0, max: 100, default: 0, unit: '%', step: 1 },
    { id: `bus.${b}.room`, name: `${n} Room Send`, min: 0, max: 100, default: BUS_ROOM_DEFAULT[b], unit: '%', step: 1 }
  )
}

const kit = (k: string): StudioDrumsData => ({ kit: k })

const presets: Preset[] = [
  { name: 'Studio Rock', category: 'Rock', params: {}, data: kit('studio') },
  { name: 'Rock Room', category: 'Rock', params: { room: 55, roomSize: 70, 'bus.kick.punch': 35, 'bus.snare.punch': 40, 'bus.toms.punch': 25 }, data: kit('studio') },
  { name: 'Dry Studio', category: 'Rock', params: { room: 0, 'bus.kick.punch': 25, 'bus.snare.punch': 20, 'bus.cymbals.high': 1.5, 'kick.decay': 70 }, data: kit('studio') },
  { name: 'Metal Tight', category: 'Metal', params: { room: 10, 'bus.kick.low': 2, 'bus.kick.high': 5, 'bus.kick.punch': 70, 'bus.snare.punch': 55, 'bus.snare.high': 2, 'bus.toms.punch': 45, 'kick.decay': 50, 'crash.level': -1 }, data: kit('metal') },
  { name: 'Metal Live', category: 'Metal', params: { room: 45, roomSize: 75, 'bus.kick.punch': 40, 'bus.snare.punch': 35 }, data: kit('metal') },
  { name: 'Funk Vintage', category: 'Funk', params: { room: 15, roomSize: 25, 'kick.decay': 55, 'bus.snare.high': 2, 'bus.snare.punch': 30, 'bus.kick.punch': 30, 'hihat.level': -2 }, data: kit('vintage') },
  { name: 'Classic Rock Big', category: 'Rock', params: { room: 60, roomSize: 85, 'bus.toms.punch': 30, 'bus.snare.punch': 25 }, data: kit('vintage') },
  { name: 'Pop Pearl', category: 'Pop', params: { room: 20, 'bus.kick.punch': 35, 'bus.snare.punch': 30, 'bus.hats.high': 2, 'bus.cymbals.high': 1.5 }, data: kit('pearl') },
  { name: 'Hip-Hop Dusty', category: 'Hip-Hop', params: { room: 10, roomSize: 20, 'bus.kick.punch': 60, 'bus.snare.punch': 55, 'bus.kick.high': -4, 'bus.snare.high': -4, 'bus.hats.high': -5, 'bus.cymbals.high': -5, 'snare.decay': 60, 'kick.level': 2 }, data: kit('vintage') },
  { name: 'Reggae One Drop', category: 'Reggae', params: { room: 35, 'snare.tune': 2, 'side.tune': 1, 'bus.snare.high': 2, 'kick.decay': 70 }, data: kit('pearl') },
  { name: 'Jazz Bop', category: 'Jazz', params: { room: 30, roomSize: 45, 'kick.level': -3 }, data: kit('bop') },
  { name: 'Jazz Brushes', category: 'Jazz', params: { room: 35, roomSize: 50, 'kick.level': -5 }, data: kit('brushes') },
  { name: 'Hot Rods Bossa', category: 'Latin', params: { room: 25, 'kick.level': -3, 'side.level': 2 }, data: kit('rods') },
  { name: 'Latin Percussion', category: 'Latin', params: { room: 30, roomSize: 45 }, data: kit('latin') }
]

export const manifest: PluginManifest = {
  id: 'studiodrums',
  name: 'Studio Drums',
  kind: 'instrument',
  category: 'Drums',
  description: 'Sampled acoustic drum kits (multi-velocity, round robins), per-piece mixer, Latin percussion and a genre groove library.',
  color: '#e0a35a',
  params,
  presets,
  defaultData: kit(DEFAULT_KIT) satisfies StudioDrumsData
}
