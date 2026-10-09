import { withPack } from '../../packs/PackGate'
import { definePlugin, type KeyName } from '../sdk/module'
import { EDITOR_H, EDITOR_W, StudioDrumsEditor } from './Editor'
import { KITS } from './kits.gen'
import { resolveStudioDrums } from './loader'
import { DEFAULT_KIT, manifest } from './manifest'
import type { StudioDrumsData } from './types'

/**
 * Studio Drums: sampled acoustic kits (FPC / Power Drum Kit style) with a genre groove library.
 * Samples come from the downloadable "studiodrums" content pack (built from resources/drumkits by
 * `npm run pack:studiodrums`; dev checkouts read resources/drumkits directly) and are decoded on the main thread.
 * Until the pack is installed the editor shows a download panel and the DSP stays silent.
 */
export default definePlugin({
  manifest,
  Editor: withPack('studiodrums', StudioDrumsEditor),
  editorSize: { width: EDITOR_W, height: EDITOR_H },
  keyNames: (instance) => {
    const id = (instance.data as Partial<StudioDrumsData> | null)?.kit ?? DEFAULT_KIT
    const kit = KITS.find((k) => k.id === id) ?? KITS[0]
    if (!kit) return undefined
    const out: Record<number, KeyName> = {}
    for (const [k, v] of Object.entries(kit.keys)) out[Number(k)] = { name: v.name, group: v.group }
    return out
  },
  resolveData: (data, ctx) => resolveStudioDrums(data, ctx)
})
