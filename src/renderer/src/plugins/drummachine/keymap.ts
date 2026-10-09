// Drum Machine key map (General MIDI percussion layout). Pure data: safe to import from the UI,
// the piano roll (for key labels) and the AudioWorklet.

export type Role =
  | 'kick2' | 'kick' | 'rim' | 'snare' | 'clap' | 'snare2'
  | 'tomFloor' | 'chh' | 'tomLo' | 'phh' | 'tomMid' | 'ohh' | 'tomMid2' | 'tomHi' | 'crash' | 'tomHi2'
  | 'ride' | 'rideBell' | 'tamb' | 'cowbell' | 'crash2' | 'ride2'
  | 'congaMute' | 'congaHi' | 'congaLo' | 'maracas' | 'claves' | 'woodHi' | 'woodLo'

export interface RoleDef {
  key: number
  role: Role
  name: string
  /** 3-4 letter pad label */
  short: string
}

export const ROLES: RoleDef[] = [
  { key: 35, role: 'kick2', name: 'Kick 2', short: 'BD2' },
  { key: 36, role: 'kick', name: 'Kick', short: 'BD' },
  { key: 37, role: 'rim', name: 'Rim Shot', short: 'RS' },
  { key: 38, role: 'snare', name: 'Snare', short: 'SD' },
  { key: 39, role: 'clap', name: 'Clap', short: 'CP' },
  { key: 40, role: 'snare2', name: 'Snare 2', short: 'SD2' },
  { key: 41, role: 'tomFloor', name: 'Floor Tom', short: 'FT' },
  { key: 42, role: 'chh', name: 'Closed Hat', short: 'CH' },
  { key: 43, role: 'tomLo', name: 'Low Tom', short: 'LT' },
  { key: 44, role: 'phh', name: 'Pedal Hat', short: 'PH' },
  { key: 45, role: 'tomMid', name: 'Mid Tom', short: 'MT' },
  { key: 46, role: 'ohh', name: 'Open Hat', short: 'OH' },
  { key: 47, role: 'tomMid2', name: 'Mid Tom 2', short: 'MT2' },
  { key: 48, role: 'tomHi', name: 'High Tom', short: 'HT' },
  { key: 49, role: 'crash', name: 'Crash', short: 'CY' },
  { key: 50, role: 'tomHi2', name: 'High Tom 2', short: 'HT2' },
  { key: 51, role: 'ride', name: 'Ride', short: 'RD' },
  { key: 53, role: 'rideBell', name: 'Ride Bell', short: 'BL' },
  { key: 54, role: 'tamb', name: 'Tambourine', short: 'TB' },
  { key: 56, role: 'cowbell', name: 'Cowbell', short: 'CB' },
  { key: 57, role: 'crash2', name: 'Crash 2', short: 'CY2' },
  { key: 59, role: 'ride2', name: 'Ride 2', short: 'RD2' },
  { key: 62, role: 'congaMute', name: 'Mute Hi Conga', short: 'MC' },
  { key: 63, role: 'congaHi', name: 'Hi Conga', short: 'HC' },
  { key: 64, role: 'congaLo', name: 'Low Conga', short: 'LC' },
  { key: 70, role: 'maracas', name: 'Maracas', short: 'MA' },
  { key: 75, role: 'claves', name: 'Claves', short: 'CL' },
  { key: 76, role: 'woodHi', name: 'Hi Wood Block', short: 'WB' },
  { key: 77, role: 'woodLo', name: 'Low Wood Block', short: 'WB2' }
]

export const ROLE_BY_KEY: Record<number, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.key, r]))
export const KEY_BY_ROLE = Object.fromEntries(ROLES.map((r) => [r.role, r.key])) as Record<Role, number>

/** Named keys, e.g. for templates and piano-roll labels. */
export const DRUM_KEYS = {
  kick2: 35,
  kick: 36,
  rim: 37,
  snare: 38,
  clap: 39,
  snare2: 40,
  floorTom: 41,
  closedHat: 42,
  lowTom: 43,
  pedalHat: 44,
  midTom: 45,
  openHat: 46,
  midTom2: 47,
  highTom: 48,
  crash: 49,
  highTom2: 50,
  ride: 51,
  rideBell: 53,
  tambourine: 54,
  cowbell: 56,
  crash2: 57,
  ride2: 59,
  muteHiConga: 62,
  hiConga: 63,
  lowConga: 64,
  maracas: 70,
  claves: 75,
  hiWoodBlock: 76,
  lowWoodBlock: 77
} as const

/**
 * GM keys that are not their own pad but play a related pad, re-pitched:
 * key -> [source key, semitones].
 */
export const EXTRA_KEYS: Record<number, [number, number]> = {
  52: [49, -3], // Chinese cymbal -> crash, lower
  55: [49, 5], // splash -> crash, higher
  58: [56, -5], // vibraslap -> cowbell
  60: [63, 7], // hi bongo -> hi conga up
  61: [63, 3], // low bongo
  65: [48, 9], // high timbale -> high tom up
  66: [48, 5], // low timbale
  67: [56, 7], // high agogo -> cowbell
  68: [56, 2], // low agogo
  69: [70, -3], // cabasa -> maracas
  71: [75, 7], // short whistle -> claves (no whistle)
  72: [75, 3],
  73: [70, 5], // short guiro -> maracas
  74: [70, 2],
  78: [77, 1], // mute cuica -> wood block
  79: [77, -2],
  80: [53, 12], // mute triangle -> ride bell up
  81: [53, 12], // open triangle
  82: [70, 4] // shaker
}

/** Resolve any MIDI key to [pad key, semitone offset] or null (silent). */
export function resolveKey(key: number): [number, number] | null {
  if (ROLE_BY_KEY[key]) return [key, 0]
  const x = EXTRA_KEYS[key]
  if (x) return x
  if (key < 35 && key >= 24) return [36, key - 36] // below the map: kick, pitched down
  for (let d = 1; d <= 2; d++) {
    if (ROLE_BY_KEY[key - d]) return [key - d, d]
    if (ROLE_BY_KEY[key + d]) return [key + d, -d]
  }
  return null
}

/** Pad label for every key the drum machine responds to (piano-roll key names). */
export const PAD_NAMES: Record<number, string> = (() => {
  const out: Record<number, string> = {}
  for (const r of ROLES) out[r.key] = r.name
  const extraNames: Record<number, string> = {
    52: 'China', 55: 'Splash', 58: 'Vibraslap', 60: 'Hi Bongo', 61: 'Low Bongo', 65: 'Hi Timbale', 66: 'Low Timbale',
    67: 'Hi Agogo', 68: 'Low Agogo', 69: 'Cabasa', 71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro', 74: 'Long Guiro',
    78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle', 82: 'Shaker'
  }
  Object.assign(out, extraNames)
  return out
})()

/** Pad grid layout for the editor: bank A (4x5) and bank B. */
export const BANK_A: number[] = [36, 38, 39, 37, 42, 46, 44, 49, 51, 56, 41, 43, 45, 48, 75, 62, 63, 64, 70, 54]
export const BANK_B: number[] = [35, 40, 47, 50, 53, 57, 59, 76, 77]

/** Default choke (cut) groups: the hats cut each other like the real machines. */
export const DEFAULT_CHOKE: Record<number, number> = { 42: 1, 44: 1, 46: 1, 62: 2, 63: 2 }

/** Piano-roll grouping of each pad role. */
export const ROLE_GROUP: Record<Role, string> = {
  kick2: 'Kick', kick: 'Kick',
  snare: 'Snare', snare2: 'Snare', rim: 'Snare', clap: 'Clap',
  tomFloor: 'Toms', tomLo: 'Toms', tomMid: 'Toms', tomMid2: 'Toms', tomHi: 'Toms', tomHi2: 'Toms',
  chh: 'Hats', phh: 'Hats', ohh: 'Hats',
  crash: 'Cymbals', crash2: 'Cymbals', ride: 'Cymbals', ride2: 'Cymbals', rideBell: 'Cymbals',
  tamb: 'Perc', cowbell: 'Perc', congaMute: 'Perc', congaHi: 'Perc', congaLo: 'Perc', maracas: 'Perc', claves: 'Perc', woodHi: 'Perc', woodLo: 'Perc'
}
