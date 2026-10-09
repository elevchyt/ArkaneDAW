import { D, genre, pat } from './dsl'

const {
  K, SN, XS, HH, PH, T1, FT, FT2, CR, CR2, RD, BL, CB, CBCHA, BGH, BGL, BGM, CGM, CGO, CGL,
  TBH, TBL, PAILA, AGH, AGL, CAB, GRS, GRL, CLV, SHK, TAMB
} = D

export const bossa = genre({
  id: 'bossa',
  name: 'Bossa Nova',
  tempo: 130,
  kit: 'rods',
  description: 'Cross-stick bossa clave over a dotted bass-drum figure, 8th-note hats or ride, shaker.',
  grooves: [
    pat('Cross-Stick Intro', {
      part: 'Intro',
      bars: 2,
      lines: {
        [XS]: 'x---|--x-|----|x---|----|x---|--x-|----',
        [HH]: 'm-g-|m-g-|m-g-|m-g-|m-g-|m-g-|m-g-|m-g-'
      }
    }),
    pat('Bossa (3-2)', {
      part: 'Groove A',
      bars: 2,
      lines: {
        [XS]: 'x---|--x-|----|x---|----|x---|--x-|----',
        [HH]: 'o-m-|o-m-|o-m-|o-m-|o-m-|o-m-|o-m-|o-m-',
        [K]: 'm--g|m---|m--g|m---|m--g|m---|m--g|m---'
      }
    }),
    pat('Bossa (2-3) on Ride', {
      part: 'Groove B',
      bars: 2,
      lines: {
        [XS]: '----|x---|--x-|----|x---|--x-|----|x---',
        [RD]: 'o-m-|o-m-|o-m-|o-m-|o-m-|o-m-|o-m-|o-m-',
        [PH]: '----|x---|----|x---|----|x---|----|x---',
        [K]: 'm--g|m---|m--g|m---|m--g|m---|m--g|m---'
      }
    }),
    pat('Bossa with Shaker & Cabasa', {
      part: 'Groove C',
      bars: 2,
      lines: {
        [XS]: 'x---|--x-|----|x---|----|x---|--x-|----',
        [SHK]: 'mggg|mggg|mggg|mggg|mggg|mggg|mggg|mggg',
        [CAB]: '--h-|--h-|--h-|--h-|--h-|--h-|--h-|--h-',
        [K]: 'm--g|m---|m--g|m---|m--g|m---|m--g|m---'
      }
    }),
    pat('Soft Fill', {
      part: 'Fill 1',
      lines: {
        [XS]: 'x---|--x-|----|----',
        [HH]: 'o-m-|o-m-|----|----',
        [SN]: '----|----|hhmm|----',
        [T1]: '----|----|----|mm--',
        [FT]: '----|----|----|--mo'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      bars: 2,
      lines: {
        [XS]: 'x---|--x-|----|x---|x---|----|----|----',
        [K]: 'm--g|m---|m--g|m---|m---|----|----|----',
        [BL]: '----|----|----|----|m---|----|----|----'
      }
    })
  ]
})

export const samba = genre({
  id: 'samba',
  name: 'Samba',
  tempo: 100,
  kit: 'pearl',
  description: 'Kit samba (surdo-style kick, accented 16ths), partido alto, batucada with agogô & tamborim.',
  grooves: [
    pat('Surdo & Ganzá Intro', {
      part: 'Intro',
      lines: {
        [K]: 'm--h|X--h|m--h|X--h',
        [SHK]: 'mggx|mggx|mggx|mggx'
      }
    }),
    pat('Drum-Set Samba', {
      part: 'Groove A',
      bars: 2,
      lines: {
        [K]: 'm--h|X--h|m--h|X--h|m--h|X--h|m--h|X--h',
        [HH]: 'mggx|mggx|mggx|mggx|mggx|mggx|mggx|mggx',
        [PH]: '--x-|--x-|--x-|--x-|--x-|--x-|--x-|--x-',
        [SN]: 'gggx|ggxg|gxgg|xggx|gggx|ggxg|gxgg|xgxg'
      }
    }),
    pat('Partido Alto', {
      part: 'Groove B',
      bars: 2,
      lines: {
        [K]: 'm--h|X--h|m--h|X--h|m--h|X--h|m--h|X--h',
        [RD]: 'x-m-|x-m-|x-m-|x-m-|x-m-|x-m-|x-m-|x-m-',
        [XS]: '---x|--x-|---x|----|x--x|--x-|---x|----'
      }
    }),
    pat('Batucada', {
      part: 'Groove C',
      bars: 2,
      lines: {
        [FT2]: '----|X---|----|X---|----|X---|----|X---',
        [FT]: 'x---|----|x---|----|x---|----|x---|----',
        [SN]: 'gggx|gggx|gggx|gggx|gggx|gggx|gggx|gggx',
        [BGM]: 'x-xx|-x-x|-xx-|x-x-|x-xx|-x-x|-xx-|x-x-',
        [AGH]: 'x-x-|----|x---|x---|x-x-|----|x---|x---',
        [AGL]: '----|x-x-|----|--x-|----|x-x-|----|--x-',
        [SHK]: 'mggx|mggx|mggx|mggx|mggx|mggx|mggx|mggx'
      }
    }),
    pat('Chamada (Call) Fill', {
      part: 'Fill 1',
      lines: {
        [SN]: 'x-xx|-x-x|xxxx|X---',
        [K]: 'm--h|X--h|m--h|X---',
        [CR]: '----|----|----|X---'
      }
    }),
    pat('Tom Fill', {
      part: 'Fill 2',
      lines: {
        [K]: 'm--h|X--h|m--h|X--h',
        [SN]: 'xxxx|----|----|----',
        [T1]: '----|xxxx|----|----',
        [FT]: '----|----|xxxx|----',
        [FT2]: '----|----|----|xxXX'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      bars: 2,
      lines: {
        [SN]: 'x-xx|-x-x|-xx-|x---|----|----|----|----',
        [K]: 'm--h|X--h|m--h|X---|X---|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----',
        [AGH]: '----|----|----|----|x---|----|----|----'
      }
    })
  ]
})

// Salsa is written the way it is played: 2 bars of 4/4 in 8th notes at ~190 BPM (one clave cycle).
export const salsa = genre({
  id: 'salsa',
  name: 'Salsa',
  tempo: 190,
  kit: 'pearl',
  description: 'Son clave 2-3 / 3-2, cascara on the timbale shell, conga tumbao, bongo martillo, mambo bells, timbale fills.',
  grooves: [
    pat('Clave & Bongo Intro', {
      part: 'Intro',
      steps: 8,
      bars: 2,
      lines: {
        [CLV]: '--x-x---|x--x--x-',
        [BGH]: 'xgmgxgm-|xgmgxgm-',
        [BGL]: '-------x|-------x'
      }
    }),
    pat('Son Montuno (2-3)', {
      part: 'Groove A',
      steps: 8,
      bars: 2,
      lines: {
        [CLV]: '--x-x---|x--x--x-',
        [PAILA]: 'x-x-xx-x|x-xx-x-x',
        [CGM]: 'mgxgmg--|mgxgmg--',
        [CGO]: '------xx|------xx',
        [BGH]: 'xgmgxgm-|xgmgxgm-',
        [BGL]: '-------x|-------x',
        [K]: '------m-|---x--m-'
      }
    }),
    pat('Mambo (2-3, Bells)', {
      part: 'Groove B',
      steps: 8,
      bars: 2,
      lines: {
        [CLV]: '--x-x---|x--x--x-',
        [CBCHA]: 'x-x-xx-x|x-xx-x-x',
        [CB]: 'X-x-X-x-|X-x-X-x-',
        [CGM]: 'mgxgmg--|mgxgmg--',
        [CGO]: '------x-|------x-',
        [CGL]: '-------x|-------x',
        [K]: '------m-|---x--m-'
      }
    }),
    pat('Son Montuno (3-2)', {
      part: 'Groove C',
      steps: 8,
      bars: 2,
      lines: {
        [CLV]: 'x--x--x-|--x-x---',
        [PAILA]: 'x-xx-x-x|x-x-xx-x',
        [CGM]: 'mgxgmg--|mgxgmg--',
        [CGO]: '------xx|------xx',
        [BGH]: 'xgmgxgm-|xgmgxgm-',
        [BGL]: '-------x|-------x',
        [K]: '---x--m-|------m-'
      }
    }),
    pat('Drum-Set Salsa (2-3)', {
      part: 'Groove D',
      steps: 8,
      bars: 2,
      lines: {
        [XS]: '--x-x---|x--x--x-',
        [BL]: 'x-x-xx-x|x-xx-x-x',
        [K]: '---x--x-|---x--x-',
        [PH]: '--x---x-|--x---x-',
        [CGO]: '------xx|------xx'
      }
    }),
    pat('Timbale Abanico Fill', {
      part: 'Fill 1',
      lines: {
        [TBH]: 'x-x-|x-xx|----|xxxx',
        [TBL]: '----|----|x-xx|----',
        [CLV]: '----|x---|x---|----',
        [K]: '----|----|----|x---'
      }
    }),
    pat('Timbale + Conga Break', {
      part: 'Fill 2',
      lines: {
        [TBH]: 'x--x|--x-|----|----',
        [TBL]: '----|----|x-x-|x-X-',
        [CGO]: '-x--|x---|-x--|----',
        [CGL]: '----|----|--x-|-x--',
        [CR]: '----|----|----|---X'
      }
    }),
    pat('Ending (Clave Hits)', {
      part: 'Ending',
      steps: 8,
      bars: 2,
      lines: {
        [CLV]: '--x-x---|x--x--x-',
        [TBH]: '--x-x---|x--x--x-',
        [K]: '--x-x---|x--x--x-',
        [CR]: '--------|------X-'
      }
    })
  ]
})

export const chacha = genre({
  id: 'chacha',
  name: 'Cha-Cha-Chá',
  tempo: 118,
  kit: 'pearl',
  description: 'Cha-cha bell on the beat, güiro long–short–short, conga tumbao, timbale “cha-cha-chá” pickup.',
  grooves: [
    pat('Güiro Intro', {
      part: 'Intro',
      lines: {
        [GRL]: 'x---|----|x---|----',
        [GRS]: '----|x-x-|----|x-x-'
      }
    }),
    pat('Cha-Cha-Chá', {
      part: 'Groove A',
      lines: {
        [CBCHA]: 'X---|x---|X---|x---',
        [GRL]: 'x---|----|x---|----',
        [GRS]: '----|x-x-|----|x-x-',
        [CGM]: 'm---|x---|m---|----',
        [CGO]: '----|----|----|x-x-',
        [K]: '----|----|----|x---'
      }
    }),
    pat('Cha-Cha with Timbales', {
      part: 'Groove B',
      lines: {
        [CBCHA]: 'X---|x---|X---|x---',
        [GRL]: 'x---|----|x---|----',
        [GRS]: '----|x-x-|----|x-x-',
        [CGM]: 'm---|x---|m---|----',
        [CGO]: '----|----|----|x-x-',
        [TBL]: '----|----|----|x-x-',
        [CLV]: '----|x---|x---|----'
      }
    }),
    pat('Fill', {
      part: 'Fill 1',
      lines: {
        [TBH]: 'x-x-|x-x-|----|----',
        [TBL]: '----|----|x-x-|x-X-'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      lines: {
        [TBH]: 'x---|----|x-x-|x---',
        [CBCHA]: 'x---|----|x-x-|x---',
        [K]: '----|----|----|x---',
        [CR]: '----|----|----|X---'
      }
    })
  ]
})

export const cumbia = genre({
  id: 'cumbia',
  name: 'Cumbia',
  tempo: 95,
  kit: 'pearl',
  description: 'Güiro long–short–short, kick on 1 & 3, rim on 2 & 4, conga and cowbell on the offbeats.',
  grooves: [
    pat('Güiro & Conga Intro', {
      part: 'Intro',
      lines: {
        [GRL]: 'x---|x---|x---|x---',
        [GRS]: '--xx|--xx|--xx|--xx',
        [CGM]: 'x---|----|x---|----',
        [CGO]: '----|--x-|----|x-x-'
      }
    }),
    pat('Cumbia', {
      part: 'Groove A',
      lines: {
        [GRL]: 'x---|x---|x---|x---',
        [GRS]: '--xx|--xx|--xx|--xx',
        [K]: 'x---|----|x---|----',
        [XS]: '----|x---|----|x---',
        [CGM]: 'x---|----|x---|----',
        [CGO]: '----|--x-|----|x-x-'
      }
    }),
    pat('Cumbia with Cowbell & Timbal', {
      part: 'Groove B',
      lines: {
        [GRL]: 'x---|x---|x---|x---',
        [GRS]: '--xx|--xx|--xx|--xx',
        [K]: 'x---|----|x---|----',
        [CB]: '--x-|--x-|--x-|--x-',
        [TBH]: '----|x---|----|x---',
        [CGM]: 'x---|----|x---|----',
        [CGO]: '----|--x-|----|x-x-'
      }
    }),
    pat('Cumbia on the Kit (Hats & Shaker)', {
      part: 'Groove C',
      lines: {
        [HH]: '--x-|--x-|--x-|--x-',
        [SHK]: 'xggg|xggg|xggg|xggg',
        [K]: 'x---|----|x---|----',
        [SN]: '----|x---|----|x---',
        [CGO]: '----|--x-|----|x-x-'
      }
    }),
    pat('Timbal Fill', {
      part: 'Fill 1',
      lines: {
        [GRL]: 'x---|x---|----|----',
        [GRS]: '--xx|--xx|----|----',
        [K]: 'x---|----|x---|----',
        [TBH]: '----|----|xxxx|x---',
        [TBL]: '----|----|----|--xx'
      }
    }),
    pat('Conga Fill', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|----|x---|----',
        [CGO]: 'x-x-|xx--|----|----',
        [CGL]: '----|--x-|x-x-|xx-X'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      lines: {
        [GRL]: 'x---|----|----|----',
        [K]: 'x---|----|----|----',
        [TBL]: 'x---|----|----|----',
        [CR]: 'X---|----|----|----'
      }
    })
  ]
})

export const latinRock = genre({
  id: 'latinrock',
  name: 'Latin Rock',
  tempo: 112,
  kit: 'studio',
  description: 'Rock kit with cowbell, congas and timbales (cascara, tumbao), timbale fills.',
  grooves: [
    pat('Conga & Bell Intro', {
      part: 'Intro',
      lines: {
        [CB]: 'X-x-|X-x-|X-x-|X-x-',
        [CGM]: 'm-g-|x-g-|m-g-|----',
        [CGO]: '----|----|----|x---',
        [CGL]: '----|----|----|--x-'
      }
    }),
    pat('Cowbell Groove', {
      part: 'Groove A',
      lines: {
        [CB]: 'X-x-|X-x-|X-x-|X-x-',
        [K]: 'x---|--x-|x---|--x-',
        [SN]: '----|x---|----|x---',
        [CGM]: 'm-g-|x-g-|m-g-|----',
        [CGO]: '----|----|----|x---',
        [CGL]: '----|----|----|--x-'
      }
    }),
    pat('Cascara Groove (3-2)', {
      part: 'Groove B',
      lines: {
        [PAILA]: 'x-xx|-x-x|x-x-|xx-x',
        [CLV]: 'x--x|--x-|--x-|x---',
        [K]: 'x---|--x-|x---|--x-',
        [SN]: '----|x---|----|x---',
        [CGO]: '----|----|----|x---',
        [CGL]: '----|----|----|--x-'
      }
    }),
    pat('Ride Bell Chorus', {
      part: 'Groove C',
      lines: {
        [BL]: 'x-x-|x-x-|x-x-|x-x-',
        [CR]: 'X---|----|----|----',
        [K]: 'x---|--x-|x-x-|--x-',
        [SN]: '----|X---|----|X---',
        [CGO]: '-x--|-x--|-x--|x---',
        [CGL]: '----|----|----|--x-',
        [TAMB]: '--x-|--x-|--x-|--x-'
      }
    }),
    pat('Timbale Fill', {
      part: 'Fill 1',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [TBH]: 'x-xx|x-xx|----|----',
        [TBL]: '----|----|xxxx|x-X-',
        [CR2]: '----|----|----|---X'
      }
    }),
    pat('Toms & Timbales Fill', {
      part: 'Fill 2',
      lines: {
        [K]: 'x---|x---|x---|x---',
        [TBH]: 'xxxx|----|----|----',
        [TBL]: '----|xxxx|----|----',
        [T1]: '----|----|xxxx|----',
        [FT]: '----|----|----|xxXX'
      }
    }),
    pat('Ending', {
      part: 'Ending',
      bars: 2,
      lines: {
        [TBH]: 'x--x|--x-|--x-|x---|----|----|----|----',
        [K]: 'x--x|--x-|--x-|x---|x---|----|----|----',
        [CR]: '----|----|----|----|X---|----|----|----',
        [CB]: '----|----|----|----|X---|----|----|----'
      }
    })
  ]
})
