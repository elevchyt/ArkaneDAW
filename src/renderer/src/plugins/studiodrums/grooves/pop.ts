import { D, genre, pat } from './dsl'

const { K, SN, XS, FLAM, HH, PH, OH, T1, T2, FT, CR, CR2, CLAP, TAMB, SHK, CB } = D

export const pop = genre({
  id: 'pop',
  name: 'Pop',
  tempo: 100,
  kit: 'pearl',
  description: 'Soft 16th-hat verses with cross-stick, clap/tambourine choruses, four-on-the-floor lift, 6/8 ballad.',
  grooves: [
    pat('Soft Intro', {
      part: 'Intro',
      lines: {
        [HH]: 'mggg|mggg|mggg|mggg',
        [K]: 'x---|----|x---|----'
      }
    }),
    pat('Verse (Cross-Stick)', {
      part: 'Groove A',
      lines: {
        [HH]: 'ohmh|ohmh|ohmh|ohmh',
        [K]: 'x---|----|x-x-|----',
        [XS]: '----|x---|----|x---'
      }
    }),
    pat('Chorus (Clap & Tambourine)', {
      part: 'Groove B',
      lines: {
        [HH]: 'x-o-|x-o-|x-o-|x-o-',
        [K]: 'x---|--x-|x-x-|----',
        [SN]: '----|x---|----|x---',
        [CLAP]: '----|x---|----|x---',
        [TAMB]: '--o-|--o-|--o-|--o-'
      }
    }),
    pat('Four on the Floor Lift', {
      part: 'Groove C',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [SN]: '----|x---|----|x---',
        [OH]: '--o-|--o-|--o-|--o-',
        [PH]: 'x---|x---|x---|x---',
        [SHK]: 'mgmg|mgmg|mgmg|mgmg'
      }
    }),
    pat('6/8 Ballad', {
      part: 'Groove D',
      sig: [6, 8],
      lines: {
        [HH]: 'x-m-m-|o-m-m-',
        [K]: 'x-----|----x-',
        [XS]: '------|x-----'
      }
    }),
    pat('Snare Build Fill', {
      part: 'Fill 1',
      lines: {
        [HH]: 'x-o-|x-o-|----|----',
        [K]: 'x---|----|x---|x---',
        [SN]: '----|x---|mmoo|xxxX'
      }
    }),
    pat('Tom Fill', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|----|x---|----',
        [SN]: 'x-x-|----|----|----',
        [T1]: '----|x-x-|----|----',
        [T2]: '----|----|x-x-|----',
        [FT]: '----|----|----|x-x-'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      bars: 2,
      lines: {
        [HH]: 'x-o-|x-o-|x-o-|----|----|----|----|----',
        [K]: 'x---|--x-|x---|x---|x---|----|----|----',
        [SN]: '----|x---|----|xxXX|----|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----'
      }
    })
  ]
})

export const funk = genre({
  id: 'funk',
  name: 'Funk',
  tempo: 98,
  kit: 'vintage',
  description: 'Syncopated kicks, ghost notes, 16th hats with open-hat lifts, linear and shuffled funk.',
  grooves: [
    pat('Hat Pickup Intro', {
      part: 'Intro',
      lines: {
        [HH]: 'xgxg|xgxg|xgxg|xg--',
        [OH]: '----|----|----|--o-',
        [SN]: '----|----|----|---x'
      }
    }),
    pat('Ghost-Note Groove', {
      part: 'Groove A',
      lines: {
        [HH]: 'xmxm|xmxm|xmxm|xmx-',
        [OH]: '----|----|----|---o',
        [K]: 'x--x|--x-|--x-|----',
        [SN]: '----|X--g|-g--|X--g'
      }
    }),
    pat('Syncopated Kick Groove', {
      part: 'Groove B',
      lines: {
        [HH]: 'x-x-|x-x-|x-x-|x-x-',
        [K]: 'x-x-|---x|--x-|-x--',
        [SN]: '-g--|X-g-|-g-g|X-g-'
      }
    }),
    pat('Linear Funk', {
      part: 'Groove C',
      lines: {
        [HH]: '-x-x|--x-|x-x-|--x-',
        [K]: 'x---|-x--|-x--|x---',
        [SN]: '--g-|X--g|---g|-X-g'
      }
    }),
    pat('Shuffle Funk (Half-Time)', {
      part: 'Groove D',
      swing: 0.6,
      lines: {
        [HH]: 'x-x-|x-x-|x-x-|x-x-',
        [K]: 'x---|---x|--x-|----',
        [SN]: '-g-g|-g-g|X--g|-g-g'
      }
    }),
    pat('Flam Fill', {
      part: 'Fill 1',
      lines: {
        [HH]: 'xmxm|xmxm|----|----',
        [K]: 'x--x|--x-|x---|x---',
        [SN]: '----|X--g|-xx-|----',
        [FLAM]: '----|----|x---|x-x-',
        [FT]: '----|----|---x|-x-x'
      }
    }),
    pat('16th Snare/Tom Fill', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [SN]: 'xgxg|----|xgxg|----',
        [T1]: '----|xx--|----|----',
        [FT]: '----|--xx|----|xxXX'
      }
    }),
    pat('Ending (Stabs)', {
      part: 'Ending',
      bars: 2,
      lines: {
        [K]: 'x--x|--x-|-x--|x---|x---|----|----|----',
        [SN]: '----|X---|---X|----|----|----|----|----',
        [OH]: '----|----|----|x---|----|----|----|----',
        [CR]: 'X---|----|----|----|X---|----|----|----',
        [CR2]: '----|----|---X|----|----|----|----|----'
      }
    })
  ]
})

export const disco = genre({
  id: 'disco',
  name: 'Disco',
  tempo: 120,
  kit: 'pearl',
  description: 'Four on the floor, open hats on the offbeat, 16th hats, tambourine & clap.',
  grooves: [
    pat('Kick & Hat Intro', {
      part: 'Intro',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [OH]: '--x-|--x-|--x-|--x-'
      }
    }),
    pat('Classic Disco', {
      part: 'Groove A',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [PH]: 'x---|x---|x---|x---',
        [OH]: '--x-|--x-|--x-|--x-',
        [SN]: '----|x---|----|x---'
      }
    }),
    pat('16th Hats + Tambourine', {
      part: 'Groove B',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [HH]: 'xm-m|xm-m|xm-m|xm-m',
        [OH]: '--x-|--x-|--x-|--x-',
        [SN]: '----|x---|----|x---',
        [CLAP]: '----|x---|----|x---',
        [TAMB]: 'mgmg|mgmg|mgmg|mgmg'
      }
    }),
    pat('Cowbell Breakdown', {
      part: 'Groove C',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [CB]: 'x-o-|x-o-|x-ox|-xo-',
        [CLAP]: '----|x---|----|x---'
      }
    }),
    pat('Snare 16ths Build', {
      part: 'Fill 1',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [SN]: 'mmmm|oooo|xxxx|XXXX'
      }
    }),
    pat('Tom Fill', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [OH]: '--x-|--x-|----|----',
        [SN]: '----|x---|----|----',
        [T1]: '----|----|xx--|----',
        [T2]: '----|----|--xx|----',
        [FT]: '----|----|----|xxxx'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      lines: {
        [K]: 'x---|----|----|----',
        [CR]: 'X---|----|----|----',
        [CLAP]: 'x---|----|----|----'
      }
    })
  ]
})

export const hiphop = genre({
  id: 'hiphop',
  name: 'Hip-Hop',
  tempo: 90,
  kit: 'vintage',
  description: 'Boom-bap with MPC-style 16th swing and a laid-back snare.',
  grooves: [
    pat('Kick & Hat Intro', {
      part: 'Intro',
      swing: 0.45,
      lines: {
        [HH]: 'x-m-|x-m-|x-m-|x-mm',
        [K]: 'x---|----|--x-|----'
      }
    }),
    pat('Boom Bap', {
      part: 'Groove A',
      swing: 0.45,
      push: { [SN]: 5 },
      lines: {
        [HH]: 'x-m-|x-m-|x-m-|x-m-',
        [K]: 'x---|---x|--x-|----',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('Boom Bap B (Ghost Kicks)', {
      part: 'Groove B',
      swing: 0.45,
      push: { [SN]: 5 },
      lines: {
        [HH]: 'x-m-|x-m-|x-mm|x-m-',
        [K]: 'x-h-|---x|-x--|--h-',
        [SN]: '----|X---|----|X--g'
      }
    }),
    pat('Laid-Back Rim', {
      part: 'Groove C',
      swing: 0.5,
      push: { [XS]: 7 },
      lines: {
        [HH]: 'xgmg|xgmg|xgmg|xgmg',
        [K]: 'x--x|----|x-x-|---h',
        [XS]: '----|x---|----|x---',
      }
    }),
    pat('Snare Stutter Fill', {
      part: 'Fill 1',
      swing: 0.45,
      push: { [SN]: 5 },
      lines: {
        [HH]: 'x-m-|x-m-|----|----',
        [K]: 'x---|---x|--x-|----',
        [SN]: '----|X---|--gm|oxX-'
      }
    }),
    pat('Drop Fill', {
      part: 'Fill 2',
      swing: 0.45,
      lines: {
        [HH]: 'x-m-|x-m-|x-m-|----',
        [K]: 'x---|---x|--x-|----',
        [SN]: '----|X---|----|----'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      lines: {
        [K]: 'x---|----|----|----',
        [CR]: 'x---|----|----|----',
      }
    })
  ]
})
