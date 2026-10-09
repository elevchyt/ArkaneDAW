import { D, genre, pat } from './dsl'

const { K, K2, SN, XS, FLAM, HH, OH, HO, T0, T1, T2, FT, FT2, CR, CR2, CRC, RD, BL, CH, SP } = D

export const rock = genre({
  id: 'rock',
  name: 'Rock',
  tempo: 112,
  kit: 'studio',
  description: 'Straight 8ths rock: verse on the hats, chorus on the ride, tom fills.',
  grooves: [
    pat('Floor Tom Intro', {
      part: 'Intro',
      lines: {
        [CR]: 'X---|----|----|----',
        [FT2]: 'x-o-|x-o-|x-o-|x-o-',
        [K]: 'x---|----|x-x-|----',
        [SN]: '----|----|----|x-xx'
      }
    }),
    pat('Verse (Hats)', {
      part: 'Groove A',
      lines: {
        [HH]: 'x-o-|x-o-|x-o-|x-o-',
        [K]: 'x---|----|x-x-|----',
        [SN]: '----|x---|----|x---'
      }
    }),
    pat('Chorus (Ride)', {
      part: 'Groove B',
      lines: {
        [CR]: 'X---|----|----|----',
        [RD]: '--o-|x-o-|x-o-|x-o-',
        [K]: 'x---|--x-|x-x-|----',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('16th Hats Groove', {
      part: 'Groove C',
      bars: 2,
      lines: {
        [HH]: 'xgmg|xgmg|xgmg|xgmg|xgmg|xgmg|xgmg|xg--',
        [OH]: '----|----|----|----|----|----|----|--o-',
        [K]: 'x---|---x|x-x-|----|x---|---x|x-x-|--x-',
        [SN]: '----|x---|----|x---|----|x---|----|x---'
      }
    }),
    pat('Fill 1 (Beat 3–4)', {
      part: 'Fill 1',
      lines: {
        [HH]: 'x-o-|x-o-|----|----',
        [K]: 'x---|----|x---|x---',
        [SN]: '----|x---|oxxx|----',
        [T1]: '----|----|----|xx--',
        [FT]: '----|----|----|--xx'
      }
    }),
    pat('Fill 2 (Around the Kit)', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [SN]: 'oxxx|----|----|----',
        [T1]: '----|xxxx|----|----',
        [T2]: '----|----|xxxx|----',
        [FT]: '----|----|----|xxXX'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      bars: 2,
      lines: {
        [SN]: 'x-x-|x-x-|xxxx|xxXX|----|----|----|----',
        [K]: 'x---|x---|x---|x-x-|x---|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----',
        [CR2]: '----|----|----|----|X---|----|----|----'
      }
    })
  ]
})

export const hardRock = genre({
  id: 'hardrock',
  name: 'Hard Rock',
  tempo: 124,
  kit: 'vintage',
  description: 'Heavy backbeat, washy crash-ride choruses, half-time breakdown, flam fills.',
  grooves: [
    pat('Crash Hits Intro', {
      part: 'Intro',
      lines: {
        [CR]: 'X---|----|--X-|----',
        [K]: 'x---|----|--x-|----',
        [SN]: '----|----|--x-|xxxx'
      }
    }),
    pat('Verse (Driving 8ths)', {
      part: 'Groove A',
      lines: {
        [HH]: 'X-x-|X-x-|X-x-|X-x-',
        [K]: 'x---|---x|x-x-|----',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('Chorus (Crash-Ride)', {
      part: 'Groove B',
      lines: {
        [CR]: 'X-x-|x-x-|x-x-|x-x-',
        [K]: 'x---|--x-|x-x-|--x-',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('Bell Groove', {
      part: 'Groove C',
      lines: {
        [BL]: 'x-o-|x-o-|x-o-|x-o-',
        [K]: 'x-x-|----|x-xx|----',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('Half-Time Breakdown', {
      part: 'Groove D',
      lines: {
        [HO]: 'x-x-|x-x-|x-x-|x-x-',
        [K]: 'x---|----|--x-|---x',
        [SN]: '----|----|X---|----'
      }
    }),
    pat('Flam Fill', {
      part: 'Fill 1',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [FLAM]: 'x---|----|x---|----',
        [SN]: '--xx|----|--xx|----',
        [T1]: '----|xx--|----|----',
        [FT]: '----|--xx|----|xxxx'
      }
    }),
    pat('16th Tom Run', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [SN]: 'xxxx|----|----|----',
        [T0]: '----|xx--|----|----',
        [T1]: '----|--xx|----|----',
        [FT]: '----|----|xxxx|----',
        [FT2]: '----|----|----|xxXX'
      }
    }),
    pat('Big Ending + Choke', {
      part: 'Ending',
      bars: 2,
      lines: {
        [SN]: 'x-x-|xxx-|x-x-|xxxx|----|----|----|----',
        [K]: 'x---|x---|x---|x---|x---|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----',
        [CRC]: '----|----|----|----|----|----|--x-|----'
      }
    })
  ]
})

export const metal = genre({
  id: 'metal',
  name: 'Metal',
  tempo: 160,
  kit: 'metal',
  description: 'Double-kick 16ths, gallops, blast beats, china breakdowns.',
  grooves: [
    pat('China Intro', {
      part: 'Intro',
      lines: {
        [CH]: 'X---|X---|X---|X---',
        [K]: 'x-x-|x-x-|x-x-|x-x-',
        [K2]: '-x-x|-x-x|-x-x|-x-x',
        [SN]: '----|----|----|XXXX'
      }
    }),
    pat('Double Kick 16ths', {
      part: 'Groove A',
      lines: {
        [RD]: 'x-o-|x-o-|x-o-|x-o-',
        [K]: 'x-x-|x-x-|x-x-|x-x-',
        [K2]: '-x-x|-x-x|-x-x|-x-x',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('Thrash Skank', {
      part: 'Groove B',
      lines: {
        [CR]: 'x-x-|x-x-|x-x-|x-x-',
        [K]: 'x---|x---|x---|x---',
        [SN]: '--X-|--X-|--X-|--X-'
      }
    }),
    pat('Gallop', {
      part: 'Groove C',
      lines: {
        [CR2]: 'x---|x---|x---|x---',
        [K]: 'x--x|x--x|x--x|x--x',
        [K2]: '--x-|--x-|--x-|--x-',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('Blast Beat', {
      part: 'Groove D',
      lines: {
        [RD]: 'x-x-|x-x-|x-x-|x-x-',
        [K]: 'x-x-|x-x-|x-x-|x-x-',
        [SN]: '-x-x|-x-x|-x-x|-x-x'
      }
    }),
    pat('Breakdown (Half-Time China)', {
      part: 'Groove D',
      lines: {
        [CH]: 'x---|x---|x---|x---',
        [K]: 'x--x|--x-|-x--|x-x-',
        [SN]: '----|----|X---|----'
      }
    }),
    pat('Tom Run + Double Kick', {
      part: 'Fill 1',
      lines: {
        [K]: 'x-x-|x-x-|x-x-|x-x-',
        [K2]: '-x-x|-x-x|-x-x|-x-x',
        [SN]: 'xxxx|----|----|----',
        [T1]: '----|xxxx|----|----',
        [T2]: '----|----|xxxx|----',
        [FT2]: '----|----|----|xxXX'
      }
    }),
    pat('Snare Crescendo', {
      part: 'Fill 2',
      lines: {
        [SN]: 'hhhh|mmmm|oooo|xxXX',
        [K]: 'x-x-|x-x-|x-x-|x-x-',
        [K2]: '-x-x|-x-x|-x-x|-x-x'
      }
    }),
    pat('Ending (Hits & Choke)', {
      part: 'Ending',
      bars: 2,
      lines: {
        [CR]: 'X---|--X-|----|X---|X---|----|----|----',
        [CH]: '----|----|----|----|X---|----|----|----',
        [K]: 'x---|--x-|----|x---|x-x-|x-x-|----|----',
        [K2]: '----|----|----|----|-x-x|-x-x|----|----',
        [SN]: '----|----|xxxx|X---|X---|----|----|----',
        [CRC]: '----|----|----|----|----|----|--x-|----'
      }
    })
  ]
})

export const punk = genre({
  id: 'punk',
  name: 'Punk',
  tempo: 180,
  kit: 'studio',
  description: 'Fast skank beats, open-hat 8ths, d-beat, snare-roll fills.',
  grooves: [
    pat('Count-In + Hit', {
      part: 'Intro',
      lines: {
        [XS]: 'x---|x---|x---|x---',
        [SN]: '----|----|----|xxxx'
      }
    }),
    pat('Skank Beat', {
      part: 'Groove A',
      lines: {
        [HH]: 'x-x-|x-x-|x-x-|x-x-',
        [K]: 'x---|x---|x---|x---',
        [SN]: '--x-|--x-|--x-|--x-'
      }
    }),
    pat('Open-Hat 8ths', {
      part: 'Groove B',
      lines: {
        [HO]: 'X-x-|X-x-|X-x-|X-x-',
        [K]: 'x-x-|----|x-x-|----',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('D-Beat', {
      part: 'Groove C',
      lines: {
        [CR]: 'x-x-|x-x-|x-x-|x-x-',
        [K]: 'x---|--x-|x---|--x-',
        [SN]: '----|X---|----|X---'
      }
    }),
    pat('Snare Roll Fill', {
      part: 'Fill 1',
      lines: {
        [SN]: '----|----|xxxx|xxXX',
        [HH]: 'x-x-|x-x-|----|----',
        [K]: 'x---|x---|x---|x---'
      }
    }),
    pat('Tom Fill', {
      part: 'Fill 2',
      lines: {
        [SN]: 'x-x-|----|----|----',
        [T1]: '----|x-x-|----|----',
        [FT]: '----|----|x-x-|x-X-',
        [K]: 'x---|x---|x---|x---'
      }
    }),
    pat('Ending (Roll + Hit)', {
      part: 'Ending',
      bars: 2,
      lines: {
        [SN]: 'mmmm|oooo|xxxx|xxXX|X---|----|----|----',
        [K]: 'x---|x---|x---|x---|x---|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----',
        [SP]: '----|----|----|----|x---|----|----|----'
      }
    })
  ]
})
