// Known content packs: optional sample libraries downloaded on demand (see src/main/packs.ts, scripts/packs/build.mjs).
// Versions / sizes / checksums come from packs.json, which the pack builder keeps up to date.
import defs from './packs.json'

export interface PackDef {
  id: string
  /** short name used in menus and dialog titles ("Download Concerto?") */
  name: string
  /** what the library is, for the download dialog */
  description: string
  version: string
  /** tar size (what is downloaded) */
  sizeBytes: number
  files: number
  /** expected sha256 of the tar (verified by the main process) */
  sha256: string
  /** plugins that need this pack */
  pluginIds: string[]
  /** folder under <resources> used as a fallback when running from a dev checkout (unpackaged) */
  devDir: string
  /** licence summary + path of the licence file inside the repo / pack */
  license: string
  licenseFile: string
}

type Raw = { version: string; sizeBytes: number; files: number; sha256?: string }
const raw = defs as Record<string, Raw>

export const PACKS: PackDef[] = [
  {
    id: 'concerto',
    name: 'Concerto',
    description:
      'Orchestral sample library for the Concerto instrument: solo and section strings, woodwinds, brass, harpsichord, organs, fortepiano, choir, timpani, harp and lute — articulations, release samples and layered ensembles.',
    ...raw.concerto,
    sha256: raw.concerto.sha256 ?? '',
    pluginIds: ['concerto'],
    devDir: 'concerto',
    license: 'Free samples: VSCO 2 Community Edition and VCSL (CC0 1.0), FluidR3_GM (MIT).',
    licenseFile: 'resources/concerto/LICENSES.md'
  },
  {
    id: 'studiodrums',
    name: 'Studio Drums',
    description:
      'Acoustic drum kits for the Studio Drums instrument: studio rock, metal, vintage, jazz brushes, bop, rods, latin percussion and more — multi-layer, round-robin, close / overhead / room mics.',
    ...raw.studiodrums,
    sha256: raw.studiodrums.sha256 ?? '',
    pluginIds: ['studiodrums'],
    devDir: 'drumkits',
    license: 'Free samples: DrumGizmo kits (CC BY 4.0), AVL Drumkits (CC BY-SA 3.0), VCSL (CC0), FluidR3_GM (MIT).',
    licenseFile: 'resources/drumkits/LICENSES.md'
  }
]

export function getPack(id: string): PackDef | undefined {
  return PACKS.find((p) => p.id === id)
}

export function packForPlugin(pluginId: string): PackDef | undefined {
  return PACKS.find((p) => p.pluginIds.includes(pluginId))
}
