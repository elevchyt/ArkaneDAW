import { withPack } from '../../packs/PackGate'
import { definePlugin, type KeyName, type PluginInstanceView } from '../sdk/module'
import { ConcertoEditor, EDITOR_H, EDITOR_W } from './Editor'
import { INSTRUMENTS } from './instruments.gen'
import { resolveConcerto } from './loader'
import { manifest } from './manifest'
import { readData } from './types'

/** Keyswitches start at MIDI 12 (C0 in scientific pitch, "C1" in FL naming) — below every instrument's range. */
export const KS_BASE = 12

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** DAW naming (60 = C5), like the piano roll. */
const noteName = (k: number): string => `${NOTE_NAMES[k % 12]}${Math.floor(k / 12)}`

/**
 * Piano-roll labels: the primary layer's articulation keyswitches, plus every playable key (grouped by the
 * instrument(s) sounding there) so the piano roll's named-key view shows exactly the usable range.
 */
export function concertoKeyNames(instance: PluginInstanceView): Record<number, KeyName> | undefined {
  const d = readData(instance.data)
  const primary = INSTRUMENTS.find((i) => i.id === d.layers[0]?.inst)
  if (!primary) return undefined
  const out: Record<number, KeyName> = {}
  if (primary.arts.length > 1) primary.arts.slice(0, 5).forEach((a, i) => (out[KS_BASE + i] = { name: `KS ${a.name}`, group: 'Keyswitch' }))
  for (let k = KS_BASE + 5; k <= 127; k++) {
    const who: string[] = []
    for (const l of d.layers) {
      const inst = INSTRUMENTS.find((i) => i.id === l.inst)
      if (!inst || k < l.lo || k > l.hi) continue
      const t = k + l.transpose
      if (t >= inst.range[0] && t <= inst.range[1]) who.push(inst.name)
    }
    if (who.length) out[k] = { name: noteName(k), group: who.join(' + ') }
  }
  return out
}

/**
 * Concerto: sampled Baroque & Classical orchestra. Samples come from the downloadable "concerto" content pack
 * (built from resources/concerto by `npm run pack:concerto`; dev checkouts read resources/concerto directly) and
 * are decoded on the main thread, shipped once per AudioContext. Until the pack is installed the editor shows a
 * download panel and the DSP stays silent.
 */
export default definePlugin({
  manifest,
  Editor: withPack('concerto', ConcertoEditor),
  editorSize: { width: EDITOR_W, height: EDITOR_H },
  keyNames: concertoKeyNames,
  defaultKeyView: 'piano',
  resolveData: (data, ctx) => resolveConcerto(data, ctx)
})
