// Upstream sample sources for Studio Drums. Every source is freely redistributable (see
// resources/drumkits/LICENSES.md). Download URLs are pinned; sha256 / CRC values are recorded in
// sources.lock.json on the first run and verified on later runs.

export const VCSL_COMMIT = 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'

export const SOURCES = {
  // ── AVL Drumkits by Glen MacArthur — CC-BY-SA 3.0 (https://www.bandshed.net/avldrumkits/) ──
  'avl-redzep': { kind: 'zip', url: 'https://www.bandshed.net/sounds/AVLDrumkits_SFZ/RED_ZEPPELIN_2023_repack.zip', dir: 'RED_ZEPPELIN_2023_repack', sfz: 'Red_Zeppelin_2023_repack.sfz' },
  'avl-pearl': { kind: 'zip', url: 'https://www.bandshed.net/sounds/AVLDrumkits_SFZ/BLACK_PEARL_2023_repack.zip', dir: 'BLACK_PEARL_2023_repack', sfz: 'Black_Pearl_2023_repack.sfz' },
  'avl-bop': { kind: 'zip', url: 'https://www.bandshed.net/sounds/AVLDrumkits_SFZ/BLONDE_BOP_SFZ.zip', dir: 'BLONDE_BOP_SFZ', sfz: 'BLONDE_BOP.sfz' },
  'avl-bophr': { kind: 'zip', url: 'https://www.bandshed.net/sounds/AVLDrumkits_SFZ/BLONDE_BOP_HR_SFZ.zip', dir: 'BLONDE_BOP_HR_SFZ', sfz: 'BLONDE_BOP_HR.sfz' },
  'avl-busk': { kind: 'zip', url: 'https://www.bandshed.net/sounds/AVLDrumkits_SFZ/BUSKMANS_HOLIDAY_SFZ.zip', dir: 'BUSKMANS_HOLIDAY_SFZ', sfz: 'Buskmans_Holiday.sfz' },
  'avl-perc': { kind: 'zip', url: 'https://www.bandshed.net/sounds/sfz/AVL_Drumkits_Percussion-1.1-fix.zip', dir: 'AVL_Drumkits_Percussion-1.1-fix', sfz: 'AVL_Drumkits_Percussion-1.0.sfz' },

  // ── DrumGizmo kits — CC-BY 4.0 (https://drumgizmo.org/wiki/doku.php?id=kits). Multi-GB zips: only the
  //    needed members are fetched with HTTP range requests (and long samples only up to the length we keep). ──
  drs: {
    kind: 'remote-zip',
    url: 'https://drumgizmo.org/kits/DRSKit/DRSKit2_1.zip',
    root: 'DRSKit',
    kitXml: 'DRSKit_full.xml',
    // drummer's point of view: hihat left, floor toms / ride right
    mics: {
      AmbL: { pan: -1, gain: 0.32 },
      AmbR: { pan: 1, gain: 0.32 },
      Kdrum_back: { pan: 0, gain: 1, close: true },
      Kdrum_front: { pan: 0, gain: 0.55, close: true },
      Hihat: { pan: -0.55, gain: 0.9, close: true },
      OHL: { pan: -0.8, gain: 0.55 },
      OHR: { pan: 0.8, gain: 0.55 },
      Ride: { pan: 0.55, gain: 0.9, close: true },
      Snare_bottom: { pan: -0.12, gain: 0.4, close: true },
      Snare_top: { pan: -0.12, gain: 1, close: true },
      Tom1: { pan: -0.12, gain: 1, close: true },
      Tom2: { pan: 0.35, gain: 1, close: true },
      Tom3: { pan: 0.6, gain: 1, close: true }
    }
  },
  crocell: {
    kind: 'remote-zip',
    url: 'https://drumgizmo.org/kits/CrocellKit/CrocellKit1_1.zip',
    root: 'CrocellKit',
    kitXml: 'CrocellKit_full.xml',
    mics: {
      AmbLeft: { pan: -1, gain: 0.3 },
      AmbRight: { pan: 1, gain: 0.3 },
      OHLeft: { pan: -0.8, gain: 0.55 },
      OHRight: { pan: 0.8, gain: 0.55 },
      OHCenter: { pan: 0, gain: 0.3 },
      Hihat: { pan: -0.55, gain: 0.9, close: true },
      Ride: { pan: 0.6, gain: 0.9, close: true },
      SnareTop: { pan: -0.12, gain: 1, close: true },
      SnareBottom: { pan: -0.12, gain: 0.4, close: true },
      Tom1: { pan: -0.3, gain: 1, close: true },
      Tom2: { pan: 0.05, gain: 1, close: true },
      FTom1: { pan: 0.4, gain: 1, close: true },
      FTom2: { pan: 0.62, gain: 1, close: true },
      KDrumInside: { pan: 0, gain: 1, close: true },
      KDrumOutside: { pan: 0, gain: 0.6, close: true }
    }
  },

  // ── Versilian Community Sample Library — CC0 (https://github.com/sgossner/VCSL) ──
  vcsl: { kind: 'files', base: `https://raw.githubusercontent.com/sgossner/VCSL/${VCSL_COMMIT}/` },

  // ── FluidR3_GM SoundFont by Frank Wen — MIT. Only the timbales are used. ──
  fluid: {
    kind: 'file',
    url: 'https://github.com/pianobooster/fluid-soundfont/releases/download/v3.1/FluidR3_GM.sf2',
    local: '/usr/share/sounds/sf2/FluidR3_GM.sf2',
    sha256: '74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0'
  }
}
