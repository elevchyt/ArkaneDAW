import { D, genre, pat } from './dsl'

const { K, SN, XS, FLAM, HH, PH, OH, T1, FT, CR, CR2, RD, SHK } = D

// Reggae is written on the 12-step triplet grid (shuffled 8ths).
export const reggae = genre({
  id: 'reggae',
  name: 'Reggae',
  tempo: 76,
  kit: 'pearl',
  description: 'One drop (kick + rim on 3), rockers, steppers, triplet tom fills.',
  grooves: [
    pat('Rim & Hat Intro', {
      part: 'Intro',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|x-m|x-m',
        [XS]: '---|---|X--|---'
      }
    }),
    pat('One Drop', {
      part: 'Groove A',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|x-m|x-m',
        [K]: '---|---|X--|---',
        [XS]: '---|---|X--|---'
      }
    }),
    pat('One Drop (Open Hat Lift)', {
      part: 'Groove B',
      steps: 12,
      lines: {
        [HH]: 'x--|x-m|x--|x-m',
        [OH]: '--x|---|--x|---',
        [K]: '---|---|X--|---',
        [SN]: '---|---|X--|---'
      }
    }),
    pat('Rockers', {
      part: 'Groove C',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|x-m|x-m',
        [K]: 'x--|---|x--|---',
        [XS]: '---|x--|---|x--'
      }
    }),
    pat('Steppers', {
      part: 'Groove D',
      steps: 12,
      lines: {
        [K]: 'x--|x--|x--|x--',
        [HH]: '--x|--x|--x|--x',
        [XS]: '---|---|X--|---',
        [SHK]: 'x-m|x-m|x-m|x-m'
      }
    }),
    pat('Triplet Tom Fill', {
      part: 'Fill 1',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|---|---',
        [SN]: '---|---|xxx|---',
        [T1]: '---|---|---|xx-',
        [FT]: '---|---|---|--x',
        [K]: '---|---|X--|---'
      }
    }),
    pat('Flam Pickup', {
      part: 'Fill 2',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|x-m|---',
        [K]: '---|---|X--|---',
        [XS]: '---|---|X--|---',
        [FLAM]: '---|---|---|x-x'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      steps: 12,
      lines: {
        [K]: 'X--|---|---|---',
        [XS]: 'X--|---|---|---',
        [CR]: 'x--|---|---|---'
      }
    })
  ]
})

export const country = genre({
  id: 'country',
  name: 'Country',
  tempo: 120,
  kit: 'studio',
  description: 'Two-beat, train beat (snare 16ths accented on 2 & 4), country shuffle.',
  grooves: [
    pat('Two-Beat Intro', {
      part: 'Intro',
      lines: {
        [K]: 'x---|----|x---|----',
        [XS]: '----|x---|----|x---'
      }
    }),
    pat('Two-Beat', {
      part: 'Groove A',
      lines: {
        [HH]: 'x-o-|x-o-|x-o-|x-o-',
        [K]: 'x---|----|x---|----',
        [XS]: '----|x---|----|x---'
      }
    }),
    pat('Train Beat', {
      part: 'Groove B',
      lines: {
        [SN]: 'gggg|Xggg|gggg|Xggg',
        [K]: 'x---|----|x---|----',
        [PH]: '----|x---|----|x---'
      }
    }),
    pat('Country Shuffle', {
      part: 'Groove C',
      steps: 12,
      lines: {
        [RD]: 'x-m|x-m|x-m|x-m',
        [K]: 'x--|---|x--|---',
        [SN]: '---|x--|---|x--'
      }
    }),
    pat('Train Fill', {
      part: 'Fill 1',
      lines: {
        [SN]: 'gggg|Xggg|mmoo|xxXX',
        [K]: 'x---|----|x---|x---'
      }
    }),
    pat('Tom Fill', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|----|x---|----',
        [SN]: 'x-x-|----|----|----',
        [T1]: '----|x-x-|----|----',
        [FT]: '----|----|x-x-|x-x-'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      bars: 2,
      lines: {
        [HH]: 'x-o-|x-o-|----|----|----|----|----|----',
        [SN]: '----|x---|x-x-|xxxX|----|----|----|----',
        [K]: 'x---|----|x---|x---|x---|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----'
      }
    })
  ]
})

export const march = genre({
  id: 'march',
  name: 'March',
  tempo: 116,
  kit: 'vintage',
  description: 'Snare cadences with flams and rolls, bass drum on 1 & 3, cymbal crashes.',
  grooves: [
    pat('Roll-Off', {
      part: 'Intro',
      bars: 2,
      lines: {
        [FLAM]: 'x---|x---|x---|----|x---|x---|x---|----',
        [SN]: '----|----|----|xxxx|----|----|----|xxxX',
        [K]: 'x---|x---|x---|----|x---|x---|x---|----'
      }
    }),
    pat('Cadence A', {
      part: 'Groove A',
      lines: {
        [FLAM]: 'x---|----|x---|----',
        [SN]: '---x|x-xx|---x|x-x-',
        [K]: 'x---|----|x---|----',
        [CR2]: '----|o---|----|o---'
      }
    }),
    pat('Cadence B (Flam Taps)', {
      part: 'Groove B',
      bars: 2,
      lines: {
        [FLAM]: 'x---|x---|x---|x---|x---|----|x---|----',
        [SN]: '-gx-|-gx-|-gx-|-gx-|-xxx|x-xx|-xxx|xxxx',
        [K]: 'x---|----|x---|----|x---|----|x---|----',
        [CR2]: '----|----|----|----|----|----|----|x---'
      }
    }),
    pat('Street Beat', {
      part: 'Groove C',
      lines: {
        [SN]: 'x-gx|g-x-|x-gx|xxx-',
        [K]: 'x---|x---|x---|x---',
        [CR2]: '----|x---|----|x---'
      }
    }),
    pat('Roll Fill', {
      part: 'Fill 1',
      lines: {
        [SN]: 'hhhh|mmmm|oooo|xxxX',
        [K]: 'x---|----|x---|----'
      }
    }),
    pat('Flam Accent Fill', {
      part: 'Fill 2',
      steps: 12,
      lines: {
        [FLAM]: 'x--|x--|x--|x--',
        [SN]: '-xx|-xx|-xx|-xx',
        [K]: 'x--|---|x--|---'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      bars: 2,
      lines: {
        [SN]: 'mmmm|oooo|xxxx|XXXX|----|----|----|----',
        [FLAM]: '----|----|----|----|X---|----|----|----',
        [K]: 'x---|x---|x---|x---|X---|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----'
      }
    })
  ]
})
