// Piano patches. Pure data — imported by the DSP (worklet), the manifest and the editor.
//
// A patch = a sound model (which engine + its fixed voicing + tone shaping) and the default values
// of the user-facing knobs. The `patch` param selects the model; the presets (= patches) set
// `patch` plus the knob defaults, so a patch can be tweaked with the knobs and saved like any preset.

export type PatchEngine = 'acoustic' | 'ep' | 'toy'
export const CATEGORIES = ['Grand', 'Upright', 'Electric', 'Character', 'Ambient'] as const
export type PatchCategory = (typeof CATEGORIES)[number]

export interface PatchModel {
  name: string
  category: PatchCategory
  description: string
  engine: PatchEngine
  /** engine variant: acoustic 0 Grand / 1 Bright / 2 Upright / 3 Honky; ep 0 Tine / 1 Reed / 2 FM; toy = unused */
  variant: number
  /** acoustic: hammer hardness base, ep: bark base, toy: hammer hardness */
  hard: number
  /** sustain multiplier */
  decay: number
  /** acoustic strike position (fraction of string) */
  strike: number
  /** Railsback stretch amount */
  stretch: number
  /** hammer / damper noise base (scaled by the Mechanical knob) */
  noise: number
  damper: number
  /** ep: tine level & amp drive */
  tine: number
  drive: number
  /** soundboard / cabinet model (Mosaic PianoBody variant 0..3), -1 = none (EPs) */
  bodyType: number
  /** tone shaping */
  hp: number
  lp: number
  lowShelf: number
  midF: number
  midG: number
  highShelf: number
  /** output saturation 0..1 */
  sat: number
  /** EP amp modulation: 0 tremolo, 1 auto-pan */
  tremMode: number
  chorusRate: number
  chorusDepth: number
  revDamp: number
  revPre: number
  /** ambient delay send 0..1 */
  delay: number
  /** how much velocity changes timbre (1 = fully; lower = mellow: velocity mostly changes loudness) */
  velTimbre: number
  /** loudness trim (linear) */
  gain: number
  /** knob defaults for this patch (see manifest params) */
  knobs: Record<string, number>
}

const base: Omit<PatchModel, 'name' | 'category' | 'description' | 'engine' | 'variant' | 'knobs'> = {
  hard: 0.5,
  decay: 1,
  strike: 0.12,
  stretch: 0.6,
  noise: 0.4,
  damper: 0.4,
  tine: 0.5,
  drive: 0.15,
  bodyType: 0,
  hp: 28,
  lp: 20000,
  lowShelf: 0,
  midF: 1000,
  midG: 0,
  highShelf: 0,
  sat: 0,
  tremMode: 0,
  chorusRate: 0.7,
  chorusDepth: 0.5,
  revDamp: 0.45,
  revPre: 15,
  delay: 0,
  velTimbre: 1,
  gain: 1
}

type Def = Partial<PatchModel> & Pick<PatchModel, 'name' | 'category' | 'description' | 'engine' | 'variant'>
const patch = (d: Def): PatchModel => ({ ...base, knobs: {}, ...d })

export const PATCHES: PatchModel[] = [
  // ─── Grand ───
  patch({
    name: 'Concert Grand', category: 'Grand', engine: 'acoustic', variant: 0,
    description: 'Nine-foot concert grand: full bass, singing sustain, open lid, hall ambience.',
    hard: 0.5, decay: 1.05, revDamp: 0.42, revPre: 18,
    gain: 0.88,
    knobs: { bright: 0.5, body: 0.55, lid: 0.85, width: 0.7, rev: 0.22, revSize: 0.62, detune: 0.2 }
  }),
  patch({
    name: 'Bright Grand', category: 'Grand', engine: 'acoustic', variant: 1,
    description: 'Voiced-up pop/rock grand that cuts through a mix.',
    hard: 0.66, decay: 0.95, strike: 0.11, lowShelf: -1, midF: 2600, midG: 1.5, highShelf: 1.5,
    gain: 1.06,
    knobs: { bright: 0.62, body: 0.45, lid: 0.95, width: 0.75, rev: 0.15, revSize: 0.45, detune: 0.2 }
  }),
  patch({
    name: 'Studio Grand', category: 'Grand', engine: 'acoustic', variant: 0,
    description: 'Close-miked grand in a tight studio room: detailed, wide, dry.',
    hard: 0.56, midF: 320, midG: -1.5, highShelf: 0.5, revPre: 8,
    gain: 1.10,
    knobs: { bright: 0.52, body: 0.5, lid: 1, width: 0.88, rev: 0.12, revSize: 0.32, mech: 0.45, detune: 0.18 }
  }),
  patch({
    name: 'Jazz Grand', category: 'Grand', engine: 'acoustic', variant: 0,
    description: 'Warm, round, mellow hammers — trio-club grand with lots of dynamic range.',
    hard: 0.3, decay: 1.1, strike: 0.13, lowShelf: 1.5, midF: 850, midG: 1, highShelf: -2.5, revDamp: 0.6,
    gain: 0.90,
    knobs: { bright: 0.42, dyn: 0.62, body: 0.65, lid: 0.6, width: 0.65, rev: 0.18, revSize: 0.4, detune: 0.22 }
  }),
  // ─── Upright ───
  patch({
    name: 'Upright', category: 'Upright', engine: 'acoustic', variant: 2,
    description: 'Parlour upright: boxy mids, shorter sustain, honest and intimate.',
    hard: 0.5, stretch: 0.5, bodyType: 2, midF: 600, midG: 1.5,
    knobs: { bright: 0.5, body: 0.6, lid: 0.7, width: 0.55, rev: 0.16, revSize: 0.3, detune: 0.3 }
  }),
  patch({
    name: 'Felt Piano', category: 'Upright', engine: 'acoustic', variant: 2,
    description: 'Felt strip between hammers and strings: soft, hushed, close, lots of mechanism.',
    hard: 0, decay: 0.85, strike: 0.14, noise: 0.85, damper: 0.9, bodyType: 2, lp: 5200, lowShelf: 2, highShelf: -6, revDamp: 0.65,
    knobs: { bright: 0.35, dyn: 0.4, mech: 0.75, body: 0.7, lid: 0.6, width: 0.6, rev: 0.25, revSize: 0.45, detune: 0.25 }
  }),
  patch({
    name: 'Honky-Tonk', category: 'Upright', engine: 'acoustic', variant: 3,
    description: 'Saloon upright with badly detuned unisons — the ragtime chorus.',
    hard: 0.62, decay: 0.85, bodyType: 3, lowShelf: -1.5, midF: 1800, midG: 2,
    gain: 1.32,
    knobs: { bright: 0.58, body: 0.5, lid: 0.8, width: 0.6, rev: 0.14, revSize: 0.3, detune: 0.75 }
  }),
  patch({
    name: 'Vintage Upright', category: 'Upright', engine: 'acoustic', variant: 2,
    description: 'Old, tired upright: out-of-tune strings, worn hammers, recorded on tape.',
    hard: 0.45, decay: 0.7, bodyType: 2, hp: 70, lp: 6500, midF: 1200, midG: 2.5, highShelf: -3, sat: 0.25, revDamp: 0.6,
    gain: 1.27,
    knobs: { bright: 0.5, mech: 0.6, body: 0.6, lid: 0.65, width: 0.5, rev: 0.2, revSize: 0.35, detune: 0.62, tape: 0.25 }
  }),
  // ─── Electric ───
  patch({
    name: 'Electric Grand', category: 'Electric', engine: 'acoustic', variant: 2,
    description: 'CP-70 style electro-acoustic grand: short strings, piezo pickups, chorused.',
    hard: 0.78, decay: 0.6, strike: 0.1, noise: 0.25, damper: 0.3, bodyType: 1, hp: 70, lowShelf: -2, midF: 1000, midG: 3, highShelf: 3, sat: 0.15, chorusRate: 0.8, chorusDepth: 0.45,
    gain: 1.78,
    knobs: { bright: 0.62, body: 0.12, lid: 0.9, width: 0.8, rev: 0.14, revSize: 0.35, detune: 0.35, mech: 0.3, chorus: 0.35 }
  }),
  patch({
    name: 'Tine EP', category: 'Electric', engine: 'ep', variant: 0,
    description: 'Rhodes-style tine piano: bell attack, warm body, barks when played hard, stereo auto-pan.',
    hard: 0.45, tine: 0.5, drive: 0.15, bodyType: -1, hp: 40, lowShelf: 1, highShelf: -1, tremMode: 1,
    gain: 0.83,
    knobs: { bright: 0.5, body: 0.4, lid: 0.8, width: 0.7, rev: 0.16, revSize: 0.4, detune: 0.15, mech: 0.25, trem: 0.35, tremRate: 4.2 }
  }),
  patch({
    name: 'Reed EP', category: 'Electric', engine: 'ep', variant: 1,
    description: 'Wurly-style reed piano: nasal, gritty bite, amp tremolo.',
    hard: 0.5, tine: 0.4, drive: 0.3, bodyType: -1, hp: 60, midF: 1100, midG: 2, tremMode: 0,
    gain: 0.86,
    knobs: { bright: 0.52, body: 0.35, lid: 0.8, width: 0.55, rev: 0.14, revSize: 0.3, detune: 0.15, mech: 0.25, trem: 0.3, tremRate: 5.5 }
  }),
  patch({
    name: 'FM EP', category: 'Electric', engine: 'ep', variant: 2,
    description: 'DX-style FM electric piano: glassy tine, clean body, chorus.',
    hard: 0.5, tine: 0.55, drive: 0.1, bodyType: -1, hp: 40, chorusRate: 0.6, chorusDepth: 0.4,
    gain: 0.92,
    knobs: { bright: 0.5, body: 0.2, lid: 0.85, width: 0.75, rev: 0.2, revSize: 0.5, detune: 0.1, mech: 0.1, chorus: 0.35 }
  }),
  // ─── Character ───
  patch({
    name: 'Toy Piano', category: 'Character', engine: 'toy', variant: 0,
    description: 'Struck metal rods in a little wooden box: plinky, inharmonic, charming.',
    hard: 0.65, decay: 0.8, noise: 0.6, bodyType: 2, hp: 120, lp: 12000, midF: 2200, midG: 3,
    gain: 1.19,
    knobs: { bright: 0.55, body: 0.5, lid: 0.85, width: 0.5, rev: 0.16, revSize: 0.25, detune: 0.35, mech: 0.6 }
  }),
  patch({
    name: 'Lo-fi Piano', category: 'Character', engine: 'acoustic', variant: 2,
    description: 'Upright through a worn cassette: wow & flutter, saturation, rolled-off highs.',
    hard: 0.4, decay: 0.8, bodyType: 2, hp: 110, lp: 5000, midF: 900, midG: 1.5, highShelf: -4, sat: 0.3, revDamp: 0.7,
    gain: 1.11,
    knobs: { bright: 0.48, mech: 0.5, body: 0.55, lid: 0.7, width: 0.5, rev: 0.22, revSize: 0.45, detune: 0.45, tape: 0.7 }
  }),
  patch({
    name: 'Dusty Tines', category: 'Character', engine: 'ep', variant: 0,
    description: 'Tine EP sampled off an old tape: wobbly, warm, soft tremolo.',
    hard: 0.35, tine: 0.4, drive: 0.2, bodyType: -1, hp: 90, lp: 5500, highShelf: -2, sat: 0.25, tremMode: 0, revDamp: 0.7,
    gain: 0.84,
    knobs: { bright: 0.45, body: 0.45, lid: 0.7, width: 0.6, rev: 0.25, revSize: 0.45, detune: 0.3, mech: 0.2, trem: 0.25, tremRate: 3.2, chorus: 0.2, tape: 0.6 }
  }),
  // ─── Ambient ───
  patch({
    name: 'Piano + Pad', category: 'Ambient', engine: 'acoustic', variant: 0,
    description: 'Grand layered with a soft analog string pad that swells behind the notes.',
    hard: 0.45, decay: 1.05, revDamp: 0.5, revPre: 25,
    gain: 0.97,
    knobs: { bright: 0.48, body: 0.5, lid: 0.8, width: 0.85, rev: 0.3, revSize: 0.7, chorus: 0.15, pad: 0.45, detune: 0.2 }
  }),
  patch({
    name: 'Ambient Piano', category: 'Ambient', engine: 'acoustic', variant: 0,
    description: 'Soft grand drowned in a huge, dark hall with echoes — long, cinematic tails.',
    hard: 0.38, decay: 1.35, highShelf: -1.5, revDamp: 0.55, revPre: 35, delay: 0.18,
    gain: 0.84,
    knobs: { bright: 0.42, body: 0.5, lid: 0.7, width: 0.95, rev: 0.5, revSize: 0.95, chorus: 0.1, detune: 0.2 }
  }),
  patch({
    name: 'Dream Felt', category: 'Ambient', engine: 'acoustic', variant: 2,
    description: 'Felt piano with a whisper of pad and tape, floating in a long reverb.',
    hard: 0, decay: 1.1, strike: 0.14, noise: 0.8, damper: 0.85, bodyType: 2, lp: 4500, lowShelf: 2, highShelf: -6, revDamp: 0.7, revPre: 30, delay: 0.12,
    knobs: { bright: 0.35, dyn: 0.4, mech: 0.6, body: 0.65, lid: 0.6, width: 0.85, rev: 0.45, revSize: 0.9, chorus: 0.15, pad: 0.2, tape: 0.15, detune: 0.25 }
  }),
  // ─── appended (keeps existing patch indices stable) ───
  patch({
    name: 'Soul Rhodes', category: 'Electric', engine: 'ep', variant: 0,
    description: 'Deep, smooth tine EP of old soul records and 90s boom-bap samples: soft hammers, warm fundamental, slow stereo trem, tape warmth.',
    hard: 0.25, tine: 0.18, drive: 0.04, decay: 1.35, velTimbre: 0.5, bodyType: -1,
    hp: 38, lp: 6000, lowShelf: 3, midF: 260, midG: 2, highShelf: -4, sat: 0.18,
    tremMode: 1, chorusRate: 0.45, chorusDepth: 0.4, revDamp: 0.78, revPre: 10, gain: 0.56,
    knobs: { bright: 0.35, dyn: 0.55, body: 0.6, lid: 0.85, width: 0.75, rev: 0.17, revSize: 0.3, detune: 0.12, mech: 0.15, trem: 0.22, tremRate: 3.5, chorus: 0.2, tape: 0.2 }
  })
]

export const PATCH_NAMES = PATCHES.map((p) => p.name)
