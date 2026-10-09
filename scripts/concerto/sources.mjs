// Upstream sample sources for Concerto. Every source is freely redistributable (see resources/concerto/LICENSES.md).
// Download URLs are pinned to commits; sha256 values are recorded in sources.lock.json on the first run and
// verified on later runs (`--update-lock` accepts changes).

/** VSCO 2 Community Edition, "SFZ" branch (same WAVs as master 4403009, plus the SFZ mappings). CC0 1.0. */
export const VSCO_COMMIT = '6dd651d55dde97fd4028699be9d4481f26917891'
/** Versilian Community Sample Library. CC0 1.0. */
export const VCSL_COMMIT = 'c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e'

export const SOURCES = {
  vsco: {
    name: 'VSCO 2 Community Edition (Versilian Studios)',
    licence: 'CC0 1.0',
    home: 'https://github.com/sgossner/VSCO-2-CE',
    base: `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${VSCO_COMMIT}/`
  },
  vcsl: {
    name: 'Versilian Community Sample Library (Versilian Studios)',
    licence: 'CC0 1.0',
    home: 'https://github.com/sgossner/VCSL',
    base: `https://raw.githubusercontent.com/sgossner/VCSL/${VCSL_COMMIT}/`
  },
  // FluidR3_GM SoundFont by Frank Wen — MIT licence. Used where no CC0 multi-sample exists (choir, nylon guitar,
  // celesta, solo cello). Shared with the Studio Drums build (same pinned URL + checksum).
  fluid: {
    name: 'FluidR3_GM SoundFont (Frank Wen)',
    licence: 'MIT',
    home: 'https://github.com/pianobooster/fluid-soundfont',
    url: 'https://github.com/pianobooster/fluid-soundfont/releases/download/v3.1/FluidR3_GM.sf2',
    local: '/usr/share/sounds/sf2/FluidR3_GM.sf2',
    sha256: '74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0'
  }
}
