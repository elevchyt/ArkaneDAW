import { definePlugin, type KeyName, type PluginInstanceView } from '../sdk/module'
import { GuitarEditor, EDITOR_H, EDITOR_W } from './Editor'
import { KS, MAX_FRET, TUNINGS, manifest } from './manifest'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** DAW naming (60 = C5), like the piano roll. */
const noteName = (k: number): string => `${NOTE_NAMES[k % 12]}${Math.floor(k / 12)}`

const KS_NAMES: [number, string, string][] = [
  [KS.SUSTAIN, 'Sustain', 'Articulation'],
  [KS.PALM, 'Palm Mute', 'Articulation'],
  [KS.MUTED, 'Muted', 'Articulation'],
  [KS.HARMONIC, 'Harmonics', 'Articulation'],
  [KS.STRUM_DOWN, 'Strum Down', 'Strum'],
  [KS.STRUM_UP, 'Strum Up', 'Strum'],
  [KS.STRUM_MUTE, 'Mute Strum', 'Strum']
]

/** Piano-roll labels: keyswitches, then the playable range of the current tuning (by string). */
export function guitarKeyNames(instance: PluginInstanceView): Record<number, KeyName> {
  const out: Record<number, KeyName> = {}
  for (const [k, name, group] of KS_NAMES) out[k] = { name, group }
  const open = (TUNINGS[Math.round(instance.params.tuning ?? 0)] ?? TUNINGS[0]).strings
  for (let k = open[0]; k <= open[5] + MAX_FRET; k++) out[k] = { name: noteName(k), group: 'Guitar' }
  return out
}

/** Guitar: physically modelled acoustic, classical and electric guitars. */
export default definePlugin({
  manifest,
  Editor: GuitarEditor,
  editorSize: { width: EDITOR_W, height: EDITOR_H },
  keyNames: guitarKeyNames,
  defaultKeyView: 'piano'
})
