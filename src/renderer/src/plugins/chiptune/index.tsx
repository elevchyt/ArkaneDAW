import { definePlugin, type KeyName } from '../sdk/module'
import { manifest } from './manifest'
import { ChiptuneEditor } from './Editor'
import { KIT_MAPS, type DrumDef } from './drumkeys'

const GROUP: Record<DrumDef['group'], string> = { Kick: 'Kick', Snare: 'Snare', Hat: 'Hats', Cymbal: 'Cymbals', Tom: 'Toms', Perc: 'Perc', SFX: 'SFX' }

export default definePlugin({
  manifest,
  Editor: ChiptuneEditor,
  editorSize: { width: 800, height: 460 },
  /** Drums mode: label piano-roll keys with the current kit's drum / SFX names. */
  keyNames: (inst) => {
    if ((inst.params.mode ?? 0) < 0.5) return undefined
    const map = KIT_MAPS[Math.round(inst.params['drum.kit'] ?? 0)] ?? KIT_MAPS[0]
    const out: Record<number, KeyName> = {}
    for (const d of map.values()) out[d.key] = { name: d.name, group: GROUP[d.group] }
    return out
  }
})
