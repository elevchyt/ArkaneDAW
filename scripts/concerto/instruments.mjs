// Concerto instrument definitions: which upstream samples make up each instrument / articulation and how
// they are processed. Consumed by build.mjs.
//
// Source specs:
//   vsco(sfz)                  — VSCO 2 CE SFZ mapping (root keys / velocity splits / round robins from the SFZ)
//   vcsl(dir, regex)           — VCSL folder; regex named groups: note (e.g. "A#3"), vel (number or dynamic
//                                word), rr. Root keys come from the note name; the octave convention is verified
//                                (and corrected) by pitch detection. Unpitched files (no note name): option
//                                `root` gives the zone's root key instead.
//   sf2(program)               — FluidR3_GM preset (bank 0); loops are unrolled and re-looped at 48 kHz.
//   ref(instrument, art, opts) — reuse another instrument's built zones (ensembles); opts: lo, hi, pan, gainDb
//
// Articulation kinds:
//   sustain — looped (baked crossfade); note-off → release envelope
//   decay   — one-shot that is damped on note-off (harpsichord, piano, guitar), optional release samples
//   ring    — one-shot that ignores note-off (staccato, pizzicato, harp, timpani, glockenspiel)
//
// Options: layers (indices of the source's velocity layers to keep, soft → loud), rr (max round robins),
//          every (keep every n-th root), keys [lo, hi] (root filter), maxLen (s), gainDb, mono (downmix),
//          releaseMaxLen (s, release samples of decay articulations; default 1.2)
//          unpitched — percussion without a pitch (cymbals, gongs): no pitch detection, velocity layers ordered by
//                      their dynamic marking, and the DSP plays the samples at their recorded rate on every key of
//                      the zone (the zone's key range is the instrument range; several roots = several sounds
//                      side by side on the keyboard)
//          releaseTail — release samples continue the note (cymbal roll endings): one per velocity layer, matched by
//                      dynamic, at the note's level; works for sustain articulations too
//          trimDb (onset threshold re peak), peakLabels (swells: label each zone with its time to peak),
//          afterPeak (s of ring kept after a swell's peak), skip (source option: seconds to skip at the start)

const vsco = (sfz, o = {}) => ({ type: 'vsco', sfz, ...o })
const vcsl = (dir, re, o = {}) => ({ type: 'vcsl', dir, re, ...o })
const sf2 = (program, o = {}) => ({ type: 'sf2', program, ...o })
const ref = (inst, art, o = {}) => ({ type: 'ref', inst, art, ...o })

const S = (id, name, src, o = {}) => ({ id, name, kind: 'sustain', src, ...o })
const R = (id, name, src, o = {}) => ({ id, name, kind: 'ring', src, ...o })
const D = (id, name, src, o = {}) => ({ id, name, kind: 'decay', src, ...o })

const NOTE = '(?<note>[A-G]#?-?\\d)'
const VCSL_PERC = 'Idiophones/Struck Idiophones/'
/** unpitched percussion: the root identifying the (single) zone */
const PERC_ROOT = 60
const VCSL_REC = 'Aerophones/Edge-blown Aerophones/'
const VCSL_ORG = 'Aerophones/Edge-blown Aerophones/'

/** Sections shown in the browser, in order. */
export const SECTIONS = ['Strings', 'Woodwinds', 'Brass', 'Keys', 'Choir', 'Percussion', 'Plucked']

/**
 * Instruments. stage: default seat (pan -1..1, audience view; width 0..1 of the stereo image).
 * solo: monophonic instrument (presets enable legato). range: playable key range (MIDI, C4 = 60).
 */
export const INSTRUMENTS = [
  // ───────── Strings ─────────
  {
    id: 'violin', name: 'Solo Violin', section: 'Strings', solo: true, range: [55, 100], stage: { pan: -0.3, width: 0.45 },
    description: 'Solo violin (VSCO 2 CE): vibrato sustain, spiccato, pizzicato, tremolo.',
    arts: [
      S('sustain', 'Sustain', vsco('SViolinVib.sfz')),
      R('staccato', 'Spiccato', vsco('SViolinSpic.sfz'), { maxLen: 1.0 }),
      R('pizzicato', 'Pizzicato', vsco('SViolinPizz.sfz'), { maxLen: 1.4 }),
      S('tremolo', 'Tremolo', vsco('SViolinTrem.sfz'))
    ]
  },
  {
    id: 'violins', name: 'Violins', section: 'Strings', range: [55, 98], stage: { pan: -0.55, width: 0.6 },
    description: 'Violin section (VSCO 2 CE): vibrato sustain, spiccato, pizzicato, tremolo.',
    arts: [
      S('sustain', 'Sustain', vsco('ViolinEnsSusVib.sfz')),
      R('staccato', 'Spiccato', vsco('ViolinEnsSpic.sfz'), { maxLen: 1.0 }),
      R('pizzicato', 'Pizzicato', vsco('ViolinEnsPizz.sfz'), { maxLen: 1.4 }),
      S('tremolo', 'Tremolo', vsco('ViolinEnsTrem.sfz'))
    ]
  },
  {
    id: 'violas', name: 'Violas', section: 'Strings', range: [48, 88], stage: { pan: 0.15, width: 0.55 },
    description: 'Viola section (VSCO 2 CE): vibrato sustain, spiccato, pizzicato, tremolo.',
    arts: [
      S('sustain', 'Sustain', vsco('ViolaEnsSusVib.sfz')),
      R('staccato', 'Spiccato', vsco('ViolaEnsSpic.sfz'), { maxLen: 1.0 }),
      R('pizzicato', 'Pizzicato', vsco('ViolaEnsPizz.sfz'), { maxLen: 1.5 }),
      S('tremolo', 'Tremolo', vsco('ViolaEnsTrem.sfz'))
    ]
  },
  {
    id: 'cello', name: 'Solo Cello', section: 'Strings', solo: true, range: [36, 84], stage: { pan: 0.3, width: 0.4 },
    description: 'Solo cello (FluidR3 GM, re-looped). Lighter than the VSCO strings.',
    arts: [S('sustain', 'Sustain', sf2(42, { keys: [0, 90] }), { minLoop: 0.25, maxLoop: 0.9 })]
  },
  {
    id: 'cellos', name: 'Cellos', section: 'Strings', range: [36, 79], stage: { pan: 0.45, width: 0.55 },
    description: 'Cello section (VSCO 2 CE): vibrato sustain, spiccato, pizzicato, tremolo.',
    arts: [
      S('sustain', 'Sustain', vsco('CelloEnsSusVib.sfz', { layers: [0, 2] })),
      R('staccato', 'Spiccato', vsco('CelloEnsSpic.sfz'), { maxLen: 1.1 }),
      R('pizzicato', 'Pizzicato', vsco('CelloEnsPizz.sfz'), { maxLen: 1.8 }),
      S('tremolo', 'Tremolo', vsco('CelloEnsTrem.sfz'))
    ]
  },
  {
    id: 'bass', name: 'Double Bass', section: 'Strings', range: [28, 62], stage: { pan: 0.7, width: 0.4 },
    description: 'Double bass (VSCO 2 CE solo contrabass): vibrato sustain, spiccato, pizzicato, tremolo.',
    arts: [
      S('sustain', 'Sustain', vsco('ContrabassSusVB.sfz')),
      R('staccato', 'Spiccato', vsco('ContrabassSpic.sfz'), { maxLen: 1.2 }),
      R('pizzicato', 'Pizzicato', vsco('ContrabassPizz.sfz'), { maxLen: 2.2 }),
      S('tremolo', 'Tremolo', vsco('ContrabassTrem.sfz'))
    ]
  },
  {
    // Sections layered by register; each zone keeps its section's seat.
    id: 'strings', name: 'String Ensemble', section: 'Strings', range: [28, 98], stage: { pan: 0, width: 1 },
    description: 'Full string section: basses, cellos, violas and violins layered across the keyboard, each in its seat.',
    arts: ['sustain', 'staccato', 'pizzicato', 'tremolo'].map((a) => ({
      id: a,
      name: { sustain: 'Sustain', staccato: 'Spiccato', pizzicato: 'Pizzicato', tremolo: 'Tremolo' }[a],
      kind: a === 'sustain' || a === 'tremolo' ? 'sustain' : 'ring',
      src: [
        ref('bass', a, { lo: 28, hi: 50, pan: 0.65, gainDb: -2 }),
        ref('cellos', a, { lo: 36, hi: 67, pan: 0.42, gainDb: -2.5 }),
        ref('violas', a, { lo: 48, hi: 77, pan: 0.12, gainDb: -3 }),
        ref('violins', a, { lo: 55, hi: 98, pan: -0.5, gainDb: -2.5 })
      ]
    }))
  },

  // ───────── Woodwinds ─────────
  {
    id: 'flute', name: 'Flute', section: 'Woodwinds', solo: true, range: [60, 98], stage: { pan: -0.15, width: 0.35 },
    description: 'Flute (VSCO 2 CE): vibrato sustain, staccato, non-vibrato sustain.',
    arts: [
      S('sustain', 'Vibrato', vsco('FluteSusVib.sfz')),
      R('staccato', 'Staccato', vsco('FluteStac.sfz', { layers: [0, -1], rr: 1 }), { maxLen: 0.9 }),
      S('nonvib', 'Non-vib', vsco('FluteSusNV.sfz'))
    ]
  },
  {
    id: 'recorder', name: 'Recorder', section: 'Woodwinds', solo: true, range: [62, 98], stage: { pan: -0.25, width: 0.3 },
    description: 'Baroque alto + soprano recorders (VCSL): sustain and staccato.',
    arts: [
      S('sustain', 'Sustain', [
        vcsl(`${VCSL_REC}Baroque Alto Recorder/Sustain`, `^AltRecorder_Sus_${NOTE}_rr(?<rr>\\d)_Main\\.wav$`, { octave: 1, keys: [0, 79] }),
        vcsl(`${VCSL_REC}Baroque Soprano Recorder/Sustain`, `^SopRecorder_Sus_${NOTE}_rr(?<rr>\\d)_Main\\.wav$`, { octave: 1, keys: [80, 127] })
      ]),
      R('staccato', 'Staccato', [
        vcsl(`${VCSL_REC}Baroque Alto Recorder/Staccato`, `^AltRecorder_Stac_${NOTE}_rr(?<rr>\\d)_Main\\.wav$`, { octave: 1, keys: [0, 79] }),
        vcsl(`${VCSL_REC}Baroque Soprano Recorder/Staccato`, `^SopRecorder_Stac_${NOTE}_rr(?<rr>\\d)_Main\\.wav$`, { octave: 1, keys: [80, 127] })
      ], { maxLen: 0.8 })
    ]
  },
  {
    id: 'oboe', name: 'Oboe', section: 'Woodwinds', solo: true, range: [58, 91], stage: { pan: 0.05, width: 0.35 },
    description: 'Oboe (VSCO 2 CE): vibrato sustain, staccato, non-vibrato sustain.',
    arts: [
      S('sustain', 'Vibrato', vsco('OboeSusVib.sfz')),
      R('staccato', 'Staccato', vsco('OboeStac.sfz', { layers: [0, -1], rr: 1 }), { maxLen: 0.9 }),
      S('nonvib', 'Non-vib', vsco('OboeSusNV.sfz'))
    ]
  },
  {
    id: 'clarinet', name: 'Clarinet', section: 'Woodwinds', solo: true, range: [50, 91], stage: { pan: -0.08, width: 0.35 },
    description: 'Clarinet (VSCO 2 CE): sustain and staccato.',
    arts: [
      S('sustain', 'Sustain', vsco('ClarinetSus.sfz', { layers: [0, -1] })),
      R('staccato', 'Staccato', vsco('ClarinetStac.sfz', { layers: [0, -1], rr: 1 }), { maxLen: 0.9 })
    ]
  },
  {
    id: 'bassoon', name: 'Bassoon', section: 'Woodwinds', solo: true, range: [34, 75], stage: { pan: 0.15, width: 0.35 },
    description: 'Bassoon (VSCO 2 CE): sustain and staccato.',
    arts: [
      S('sustain', 'Sustain', vsco('BassoonSus.sfz')),
      R('staccato', 'Staccato', vsco('BassoonStac.sfz', { rr: 1 }), { maxLen: 0.9 })
    ]
  },

  // ───────── Brass ─────────
  {
    id: 'horn', name: 'French Horn', section: 'Brass', solo: true, range: [34, 77], stage: { pan: -0.4, width: 0.45 },
    description: 'French horn (VSCO 2 CE): sustain (3 dynamics) and staccato.',
    arts: [
      S('sustain', 'Sustain', vsco('FHornSus.sfz', { layers: [0, 1, -1] })),
      R('staccato', 'Staccato', vsco('FHornStac.sfz', { layers: [0, -1], rr: 1 }), { maxLen: 1.0 })
    ]
  },
  {
    id: 'trumpet', name: 'Baroque Trumpet', section: 'Brass', solo: true, range: [55, 86], stage: { pan: 0.3, width: 0.35 },
    description: 'Trumpet (VSCO 2 CE), played straight like a natural trumpet: sustain and staccato.',
    arts: [
      S('sustain', 'Sustain', vsco('TrumpetSus.sfz')),
      R('staccato', 'Staccato', vsco('TrumpetStac.sfz', { layers: [0, -1], rr: 1 }), { maxLen: 0.9 })
    ]
  },
  {
    id: 'trombone', name: 'Trombone', section: 'Brass', solo: true, range: [34, 70], stage: { pan: 0.5, width: 0.4 },
    description: 'Tenor trombone / sackbut stand-in (VSCO 2 CE): sustain and staccato.',
    arts: [
      S('sustain', 'Sustain', vsco('TromboneSus.sfz', { layers: [0, -1] })),
      R('staccato', 'Staccato', vsco('TromboneStac.sfz', { layers: [0, -1], rr: 1 }), { maxLen: 1.0 })
    ]
  },

  // ───────── Keys ─────────
  {
    id: 'harpsichord', name: 'Harpsichord', section: 'Keys', range: [29, 89], stage: { pan: 0, width: 0.7 },
    description: 'Flemish harpsichord, far-miked (VCSL) for the 8′ stop and an English (Zuckermann) lute stop, with release (jack) samples.',
    arts: [
      // The close-miked English 8′ samples had a loud jack/plectrum click on every note: the Flemish far-mic
      // recordings keep the pluck but at about a third of the transient level.
      D('normal', '8′ Stop', vcsl('Chordophones/Zithers/Harpsichord, Flemish/Sustains/Low', `^HarpsiRH_Low_Far_${NOTE}_rr(?<rr>\\d)\\.wav$`), {
        // far-mic releases carry ~1 s of room / string ring: keep just the damper thunk
        maxLen: 4.5, damp: 0.12, releaseMaxLen: 0.35,
        release: vcsl('Chordophones/Zithers/Harpsichord, Flemish/Releases/Low', `^HarpsiRH_LowRel_Far_${NOTE}_rr(?<rr>\\d)\\.wav$`)
      }),
      D('lute', 'Lute Stop', vcsl('Chordophones/Zithers/Harpsichord, English/Sustains/Lute', `^ZuckermannKitHarpsi_Lute_Sus_${NOTE}_rr(?<rr>\\d)\\.wav$`, { octave: 1 }), {
        maxLen: 3.0, damp: 0.1,
        release: vcsl('Chordophones/Zithers/Harpsichord, English/Releases/Lute', `^ZuckermannKitHarpsi_Lute_Rel_${NOTE}_rr(?<rr>\\d)\\.wav$`)
      })
    ]
  },
  {
    id: 'organ', name: 'Pipe Organ', section: 'Keys', range: [24, 96], stage: { pan: 0, width: 1 },
    description: 'Church pipe organ (VCSL): full (principal chorus) and soft registrations, with pedal division.',
    arts: [
      S('full', 'Full', [
        vcsl(`${VCSL_ORG}Pipe Organ/Loud Pedal`, `^Rode_Pedal_${NOTE}\\.wav$`, { octave: 0, keys: [0, 35] }),
        vcsl(`${VCSL_ORG}Pipe Organ/Loud`, `^Rode_Man3Open_${NOTE}\\.wav$`, { octave: 1, keys: [36, 127] })
      ], { maxLen: 3.2 }),
      S('soft', 'Soft', [
        // the quiet pedal stop sounds in the manual's octave, so the soft registration borrows the 16′ pedal
        vcsl(`${VCSL_ORG}Pipe Organ/Loud Pedal`, `^Rode_Pedal_${NOTE}\\.wav$`, { octave: 0, keys: [0, 35] }),
        vcsl(`${VCSL_ORG}Pipe Organ/Quiet`, `^NT5_Man3Quiet_${NOTE}_rr(?<rr>\\d)\\.wav$`, { octave: 1, keys: [36, 127] })
      ], { maxLen: 3.2 })
    ]
  },
  {
    id: 'chamberorgan', name: 'Chamber Organ', section: 'Keys', range: [36, 88], stage: { pan: 0, width: 0.8 },
    description: 'Renaissance positive organ (VCSL): 8′ flute stop and full registration.',
    arts: [
      S('8ft', '8′ Flute', vcsl(`${VCSL_ORG}Renaissance Organ/8'`, `^RenOrgan_8foot_Room_${NOTE}_rr(?<rr>\\d)\\.wav$`, { octave: 1 }), { maxLen: 3.0 }),
      S('full', 'Full', vcsl(`${VCSL_ORG}Renaissance Organ/Full`, `^RenOrgan_Full_Room_${NOTE}_rr(?<rr>\\d)\\.wav$`, { octave: 1 }), { maxLen: 3.0 })
    ]
  },
  {
    id: 'fortepiano', name: 'Fortepiano', section: 'Keys', range: [29, 89], stage: { pan: 0, width: 0.7 }, tone: 0.72,
    description: 'Early-piano voicing of a small upright (VCSL Knight): lighter tone, shorter sustain, release samples.',
    arts: [
      D('normal', 'Normal', vcsl('Chordophones/Zithers/Upright Piano, Knight/Sustains', `^Player_vl(?<vel>\\d)_rr(?<rr>\\d)_${NOTE}\\.wav$`, { octave: 1, every: 3, keys: [28, 91] }), {
        maxLen: 4.0, damp: 0.2,
        release: vcsl('Chordophones/Zithers/Upright Piano, Knight/Releases', `^Player_rel_rr(?<rr>\\d)_${NOTE}\\.wav$`, { octave: 1, every: 3, keys: [28, 91] })
      })
    ]
  },
  {
    id: 'celesta', name: 'Celesta & Glockenspiel', section: 'Keys', range: [60, 108], stage: { pan: -0.1, width: 0.5 },
    description: 'Celesta (FluidR3 GM) and orchestral glockenspiel (VCSL, 3 dynamics).',
    arts: [
      R('celesta', 'Celesta', sf2(8, { decay: 1.6 }), { maxLen: 3.0, noPitchCheck: true }),
      R('glock', 'Glockenspiel', vcsl('Idiophones/Struck Idiophones/Glockenspiel', `^glock_(?<vel>soft|medium|loud)_${NOTE}_(?<rr>\\d+)\\.wav$`, { rr: 1, octave: 0 }), { maxLen: 3.0, noPitchCheck: true })
    ]
  },

  // ───────── Choir ─────────
  {
    id: 'choir', name: 'Choir', section: 'Choir', range: [36, 84], stage: { pan: 0, width: 1 },
    description: 'Mixed choir (FluidR3 GM): "aah" and "ooh" vowels.',
    arts: [S('aah', 'Aahs', sf2(52)), S('ooh', 'Oohs', sf2(53))]
  },

  // ───────── Percussion ─────────
  {
    id: 'timpani', name: 'Timpani', section: 'Percussion', range: [36, 60], stage: { pan: 0.1, width: 0.6 },
    description: 'Timpani (VSCO 2 CE): hits (3 dynamics, round robins) and rolls.',
    arts: [
      R('hit', 'Hits', vsco('Timpani.sfz'), { maxLen: 4.0, noPitchCheck: true }),
      S('roll', 'Roll', vsco('TimpaniRolls.sfz'), { maxLen: 3.2, noPitchCheck: true })
    ]
  },
  // Unpitched: every key of the range plays the same sound (velocity layers + round robins), un-transposed.
  {
    id: 'cymbals', name: 'Clash Cymbals', section: 'Percussion', range: [48, 72], stage: { pan: 0.3, width: 0.5 },
    description: 'Orchestral clash cymbals (VCSL), two pairs: crashes in 4 and 3 dynamics with round robins, and choked crashes. Unpitched: every key plays.',
    arts: [
      R('crash', 'Crash', vcsl(`${VCSL_PERC}Clash Cymbals 1`, '^cymbal_crash1_(?<vel>pp|mp|mf|ff)(?<rr>\\d)\\.wav$', { root: PERC_ROOT, rr: 2 }), { maxLen: 8.0, unpitched: true }),
      R('crash2', 'Crash II', vcsl(`${VCSL_PERC}Clash Cymbals 2`, '^cymbal_crash2_(?<vel>mp|f|fff)(?<rr>\\d)\\.wav$', { root: PERC_ROOT, rr: 2 }), { maxLen: 8.0, unpitched: true }),
      R('choke', 'Choke', vcsl(`${VCSL_PERC}Clash Cymbals 1`, '^cymbal_crash1_short(?<rr>\\d)\\.wav$', { root: PERC_ROOT }), { maxLen: 2.0, unpitched: true })
    ]
  },
  {
    id: 'suscymbal', name: 'Suspended Cymbal', section: 'Percussion', range: [48, 72], stage: { pan: 0.4, width: 0.45 },
    description: 'Suspended cymbal (VCSL): soft-mallet hits (5 dynamics), stick hits, bell, a looped roll (3 dynamics) with its natural ending on release, and swells of 4 lengths across the keys (labelled with the time to peak). Unpitched.',
    arts: [
      R('mallet', 'Mallet', vcsl(`${VCSL_PERC}Suspended Cymbal 2`, '^susCymb2_hit_(?<vel>pp|mp|mf|f|fff)1\\.wav$', { root: PERC_ROOT }), { maxLen: 8.0, unpitched: true }),
      R('stick', 'Stick', vcsl(`${VCSL_PERC}Suspended Cymbal 2`, '^susCymb2_hit_stick_(?<vel>pp|mp|mf)1\\.wav$', { root: PERC_ROOT }), { maxLen: 5.0, unpitched: true }),
      R('bell', 'Bell', vcsl(`${VCSL_PERC}Suspended Cymbal 1`, '^susCymb1_hit_bell_(?<vel>pp|mf|fff)1\\.wav$', { root: PERC_ROOT }), { maxLen: 3.5, unpitched: true }),
      S('roll', 'Roll', [
        vcsl(`${VCSL_PERC}Suspended Cymbal 1`, '^susCymb1_roll_(?<vel>mp|f)\\d_nloop\\.wav$', { root: PERC_ROOT }),
        // the ff take builds up for ~2 s: start it 1.6 s in so an ff roll is ff right away
        vcsl(`${VCSL_PERC}Suspended Cymbal 1`, '^susCymb1_roll_(?<vel>ff)\\d_nloop\\.wav$', { root: PERC_ROOT, skip: 1.6 })
      ], {
        maxLen: 6.0, minLoop: 2.0, maxLoop: 3.5, unpitched: true, releaseTail: true, releaseMaxLen: 5.0,
        release: vcsl(`${VCSL_PERC}Suspended Cymbal 1`, '^susCymb1_roll_(?<vel>mp|f|ff)\\d_rel\\.wav$', { root: PERC_ROOT })
      }),
      R('swell', 'Swell', [
        vcsl(`${VCSL_PERC}Suspended Cymbal 1`, '^susCymb1_cresc_1\\.5s\\.wav$', { root: 50 }),
        vcsl(`${VCSL_PERC}Suspended Cymbal 2`, '^susCymb2_cresc_2\\.5s2\\.wav$', { root: 56 }),
        vcsl(`${VCSL_PERC}Suspended Cymbal 2`, '^susCymb2_cresc_4s\\.wav$', { root: 62 }),
        vcsl(`${VCSL_PERC}Suspended Cymbal 2`, '^susCymb2_cresc_7s\\.wav$', { root: 68 })
      ], { maxLen: 12.0, afterPeak: 5.0, unpitched: true, trimDb: -54, peakLabels: true })
    ]
  },
  {
    id: 'gong', name: 'Gong / Tam-tam', section: 'Percussion', range: [48, 72], stage: { pan: 0.5, width: 0.5 },
    description: 'Large orchestral gong / tam-tam (VCSL): hits in 4 dynamics with a long ring, and a scrape. Unpitched.',
    arts: [
      R('hit', 'Hit', vcsl(`${VCSL_PERC}Gong 1`, '^gong_(?<vel>p|mf|f|fff)\\.wav$', { root: PERC_ROOT }), { maxLen: 14.0, unpitched: true }),
      R('scrape', 'Scrape', vcsl(`${VCSL_PERC}Gong 1`, '^gong_scrape_mf\\.wav$', { root: PERC_ROOT }), { maxLen: 10.0, unpitched: true })
    ]
  },

  // ───────── Plucked ─────────
  {
    id: 'harp', name: 'Harp', section: 'Plucked', range: [24, 103], stage: { pan: -0.65, width: 0.5 },
    description: 'Concert harp (VCSL): two dynamics.',
    arts: [R('normal', 'Normal', vcsl('Chordophones/Composite Chordophones/Concert Harp', `^KSHarp_${NOTE}_(?<vel>p|mp|mf|f)(?<rr>\\d)\\.wav$`, { rr: 1, octave: 0 }), { maxLen: 4.5 })]
  },
  {
    id: 'lute', name: 'Lute / Guitar', section: 'Plucked', range: [40, 88], stage: { pan: -0.2, width: 0.4 },
    description: 'Gut-string classical guitar (FluidR3 GM) standing in for the Baroque lute.',
    arts: [D('normal', 'Normal', sf2(24, { keys: [0, 83] }), { maxLen: 4.0, damp: 0.3 })]
  }
]

/** Ensemble presets (2–3 layers). gain dB, lo/hi key split, art = articulation id preferred for that layer. */
export const ENSEMBLES = [
  {
    name: 'Baroque Strings',
    description: 'Violins, cellos and a quiet harpsichord continuo.',
    layers: [
      { inst: 'violins', lo: 55, hi: 108, gain: 0 },
      { inst: 'cellos', lo: 24, hi: 66, gain: -1 },
      { inst: 'harpsichord', lo: 29, hi: 89, gain: -9 }
    ]
  },
  {
    name: 'Chamber Orchestra',
    description: 'String ensemble with oboe on top and horn in the middle register.',
    layers: [
      { inst: 'strings', lo: 0, hi: 127, gain: 0 },
      { inst: 'oboe', lo: 62, hi: 127, gain: -7 },
      { inst: 'horn', lo: 41, hi: 72, gain: -8 }
    ]
  },
  {
    name: 'Choir + Organ',
    description: 'Mixed choir doubled by the soft pipe organ.',
    layers: [
      { inst: 'choir', lo: 36, hi: 127, gain: 0 },
      { inst: 'organ', lo: 0, hi: 127, gain: -8, art: 'soft' }
    ]
  },
  {
    name: 'Strings + Choir',
    description: 'String ensemble pad with choir aahs.',
    layers: [
      { inst: 'strings', lo: 0, hi: 127, gain: 0 },
      { inst: 'choir', lo: 40, hi: 127, gain: -5 }
    ]
  },
  {
    name: 'Continuo',
    description: 'Harpsichord with cellos and double bass doubling the bass line.',
    layers: [
      { inst: 'harpsichord', lo: 29, hi: 89, gain: 0 },
      { inst: 'cellos', lo: 36, hi: 59, gain: -6 },
      { inst: 'bass', lo: 28, hi: 52, gain: -8 }
    ]
  },
  {
    name: 'Woodwind Choir',
    description: 'Flute over oboe over bassoon.',
    layers: [
      { inst: 'flute', lo: 72, hi: 127, gain: 0 },
      { inst: 'oboe', lo: 58, hi: 71, gain: -1 },
      { inst: 'bassoon', lo: 0, hi: 57, gain: -1 }
    ]
  },
  {
    name: 'Harp & Flute',
    description: 'Harp doubled by a soft flute an octave up.',
    layers: [
      { inst: 'harp', lo: 0, hi: 127, gain: 0 },
      { inst: 'flute', lo: 48, hi: 86, gain: -9, transpose: 12 }
    ]
  }
]
