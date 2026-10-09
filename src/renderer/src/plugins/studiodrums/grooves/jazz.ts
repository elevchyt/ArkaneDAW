import { D, genre, pat } from './dsl'

// 4/4 swing grooves are written on a 12-step (8th-note triplet) grid: | 1 . let | 2 . let | …

const { K, SN, XS, HH, PH, T1, T2, FT, CR, CR2, RD, BL, SWEEP, RD2 } = D

export const jazz = genre({
  id: 'jazz',
  name: 'Jazz',
  tempo: 140,
  kit: 'bop',
  description: 'Swing ride with hats on 2 & 4, feathered kick, comping snare, two-feel, bombs, trading fills.',
  grooves: [
    pat('Hats & Ride Intro', {
      part: 'Intro',
      steps: 12,
      lines: {
        [RD]: 'o--|x--|o--|x--',
        [PH]: '---|x--|---|x--'
      }
    }),
    pat('Swing Ride (Comping)', {
      part: 'Groove A',
      steps: 12,
      bars: 2,
      lines: {
        [RD]: 'o--|x-m|o--|x-m|o--|x-m|o--|x-m',
        [PH]: '---|x--|---|x--|---|x--|---|x--',
        [K]: 'g--|g--|g--|g--|g--|g--|g--|g--',
        [SN]: '---|---|--g|---|---|--m|---|-g-'
      }
    }),
    pat('Two-Feel', {
      part: 'Groove B',
      steps: 12,
      lines: {
        [RD]: 'o--|x-m|o--|x-m',
        [PH]: '---|x--|---|x--',
        [K]: 'h--|---|h--|---',
        [XS]: '---|---|---|x--'
      }
    }),
    pat('Up-Tempo with Bombs', {
      part: 'Groove C',
      steps: 12,
      bars: 2,
      lines: {
        [RD]: 'o--|x-m|o--|x-m|o--|x-m|o--|x--',
        [PH]: '---|x--|---|x--|---|x--|---|x--',
        [K]: '---|---|---|---|---|---|---|--X',
        [SN]: '--g|---|-g-|--m|---|-g-|--m|---',
        [CR]: '---|---|---|---|---|---|---|--X'
      }
    }),
    pat('Bell Shout Chorus', {
      part: 'Groove D',
      steps: 12,
      lines: {
        [BL]: 'x--|x-o|x--|x-o',
        [PH]: '---|x--|---|x--',
        [K]: 'g--|g--|g--|g-x',
        [SN]: '---|--o|---|---'
      }
    }),
    pat('Triplet Fill', {
      part: 'Fill 1',
      steps: 12,
      lines: {
        [RD]: 'o--|x-m|---|---',
        [PH]: '---|x--|---|---',
        [SN]: '---|---|mox|---',
        [T1]: '---|---|---|xo-',
        [FT]: '---|---|---|--x'
      }
    }),
    pat('Trading Fours Fill', {
      part: 'Fill 2',
      steps: 12,
      bars: 2,
      lines: {
        [SN]: 'x-g|-x-|g-x|-gx|x--|-mx|---|---',
        [T1]: '---|---|---|---|--x|---|xx-|---',
        [T2]: '---|---|---|---|---|---|--x|x--',
        [FT]: '---|---|---|---|---|---|---|-xx',
        [K]: '---|--x|---|---|-x-|---|---|---',
        [PH]: '---|x--|---|x--|---|x--|---|x--'
      }
    }),
    pat('Ending (Ride → Kick/Crash)', {
      part: 'Ending',
      steps: 12,
      bars: 2,
      lines: {
        [RD]: 'o--|x-m|o--|---|---|---|---|---',
        [PH]: '---|x--|---|---|---|---|---|---',
        [SN]: '---|---|---|--X|---|---|---|---',
        [K]: '---|---|---|--X|X--|---|---|---',
        [CR]: '---|---|---|--X|X--|---|---|---'
      }
    })
  ]
})

export const brushes = genre({
  id: 'brushes',
  name: 'Jazz Brushes',
  tempo: 80,
  kit: 'brushes',
  description: 'Brush ballads: circular sweeps, taps in the ride rhythm, feathered kick.',
  grooves: [
    pat('Sweep Intro', {
      part: 'Intro',
      steps: 12,
      lines: {
        [SWEEP]: 'x--|---|x--|---',
        [PH]: '---|x--|---|x--'
      }
    }),
    pat('Brush Ballad', {
      part: 'Groove A',
      steps: 12,
      lines: {
        [SWEEP]: 'x--|---|x--|---',
        [SN]: 'h--|m-g|h--|m-g',
        [PH]: '---|x--|---|x--',
        [K]: 'g--|---|g--|---'
      }
    }),
    pat('Medium Swing (Brushed Ride)', {
      part: 'Groove B',
      steps: 12,
      lines: {
        [RD]: 'o--|x-m|o--|x-m',
        [SWEEP]: 'x--|---|x--|---',
        [PH]: '---|x--|---|x--',
        [K]: 'g--|g--|g--|g--'
      }
    }),
    pat('Brush Waltz', {
      part: 'Groove C',
      sig: [3, 4],
      steps: 9,
      lines: {
        [SWEEP]: 'x--|---|---',
        [SN]: 'h--|m-g|m-g',
        [PH]: '---|x--|x--',
        [K]: 'g--|---|---'
      }
    }),
    pat('Tap Fill', {
      part: 'Fill 1',
      steps: 12,
      lines: {
        [SWEEP]: 'x--|---|---|---',
        [SN]: '---|---|hmm|oox',
      }
    }),
    pat('Tom Brush Fill', {
      part: 'Fill 2',
      steps: 12,
      lines: {
        [SN]: 'm-m|m--|---|---',
        [T1]: '---|-m-|m--|---',
        [FT]: '---|---|--m|o-x',
        [K]: 'g--|g--|g--|g--'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      steps: 12,
      bars: 2,
      lines: {
        [SWEEP]: 'x--|---|---|---|---|---|---|---',
        [SN]: 'h--|m-g|---|--o|---|---|---|---',
        [CR]: '---|---|---|---|o--|---|---|---',
        [K]: '---|---|---|---|m--|---|---|---'
      }
    })
  ]
})

export const blues = genre({
  id: 'blues',
  name: 'Blues / Shuffle',
  tempo: 96,
  kit: 'vintage',
  description: 'Hi-hat shuffle, Texas double shuffle, 12/8 slow blues, triplet fills, blues ending.',
  grooves: [
    pat('Snare Pickup Intro', {
      part: 'Intro',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|x-m|---',
        [SN]: '---|---|---|x-x',
        [K]: 'x--|---|x--|---'
      }
    }),
    pat('Shuffle (Hats)', {
      part: 'Groove A',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|x-m|x-m',
        [K]: 'x--|---|x-g|---',
        [SN]: '---|X--|---|X--'
      }
    }),
    pat('Texas Double Shuffle', {
      part: 'Groove B',
      steps: 12,
      lines: {
        [RD]: 'x-m|x-m|x-m|x-m',
        [SN]: 'g-g|X-g|g-g|X-g',
        [K]: 'x--|x--|x--|x--',
        [PH]: '---|x--|---|x--'
      }
    }),
    pat('Slow Blues 12/8', {
      part: 'Groove C',
      steps: 12,
      lines: {
        [HH]: 'xmm|xmm|xmm|xmm',
        [K]: 'x--|---|x-g|---',
        [SN]: '---|X--|---|X--'
      }
    }),
    pat('Triplet Fill', {
      part: 'Fill 1',
      steps: 12,
      lines: {
        [HH]: 'x-m|x-m|---|---',
        [K]: 'x--|---|x--|x--',
        [SN]: '---|X--|xxx|---',
        [T1]: '---|---|---|xx-',
        [FT]: '---|---|---|--x'
      }
    }),
    pat('Shuffle Snare Roll', {
      part: 'Fill 2',
      steps: 12,
      lines: {
        [K]: 'x--|x--|x--|x--',
        [SN]: 'm-m|o-o|x-x|xxX'
      }
    }),
    pat('Blues Ending', {
      part: 'Ending',
      steps: 12,
      bars: 2,
      lines: {
        [CR]: 'X--|---|---|---|---|---|X--|---',
        [K]: 'x--|---|---|---|---|---|x--|---',
        [SN]: '---|---|---|xxx|---|x-x|---|---',
        [T1]: '---|---|---|---|xxx|---|---|---',
      }
    })
  ]
})

export const waltz = genre({
  id: 'waltz',
  name: 'Waltz',
  tempo: 150,
  kit: 'bop',
  description: '3/4: oom-pah-pah waltz, jazz waltz on the ride, fills and ending.',
  grooves: [
    pat('Waltz Intro', {
      part: 'Intro',
      sig: [3, 4],
      lines: {
        [K]: 'x---|----|----',
        [PH]: '----|x---|x---'
      }
    }),
    pat('Waltz (Oom-Pah-Pah)', {
      part: 'Groove A',
      sig: [3, 4],
      lines: {
        [K]: 'x---|----|----',
        [HH]: 'x-m-|x-m-|x-m-',
        [XS]: '----|x---|x---'
      }
    }),
    pat('Jazz Waltz', {
      part: 'Groove B',
      sig: [3, 4],
      steps: 9,
      bars: 2,
      lines: {
        [RD]: 'o--|x-m|x--|o--|x-m|x--',
        [PH]: '---|x--|---|---|x--|---',
        [K]: 'g--|---|---|g--|---|--g',
        [SN]: '---|---|-g-|---|--g|---'
      }
    }),
    pat('Big Waltz (Ride & Snare)', {
      part: 'Groove C',
      sig: [3, 4],
      lines: {
        [RD2]: 'x-o-|x-o-|x-o-',
        [K]: 'x---|----|----',
        [SN]: '----|x---|x---'
      }
    }),
    pat('Waltz Fill', {
      part: 'Fill 1',
      sig: [3, 4],
      lines: {
        [K]: 'x---|----|----',
        [SN]: '----|xxxx|----',
        [T1]: '----|----|xx--',
        [FT]: '----|----|--xx'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      sig: [3, 4],
      bars: 2,
      lines: {
        [K]: 'x---|----|----|x---|----|----',
        [SN]: '----|x---|xxxx|----|----|----',
        [CR2]: '----|----|----|X---|----|----'
      }
    })
  ]
})
