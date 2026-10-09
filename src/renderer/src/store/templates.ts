// New-project templates. The default mirrors FL Studio's "Basic with limiter":
// four drum channels in the rack, one pattern, and a limiter on the master.
import { makeEmptyProject, makeChannel, uid } from './factory'
import type { Project } from './types'
import { getPlugin } from '../plugins/registry'
import { defaultParams } from '../plugins/sdk/module'

/** Keys used by the drum-machine plugin's General MIDI style map. */
const DRUM_KEYS = { kick: 36, clap: 39, hat: 42, snare: 38 }

export function defaultTemplate(): Project {
  const p = makeEmptyProject()
  const drum = getPlugin('drummachine')
  const make = (name: string, key: number, color: string) => {
    if (drum) {
      return makeChannel(name, { pluginId: 'drummachine', params: defaultParams(drum.manifest), data: structuredClone(drum.manifest.defaultData) }, { rootNote: key, color })
    }
    return makeChannel(name, { pluginId: 'triosc', params: defaultParams(getPlugin('triosc')!.manifest) }, { color })
  }
  p.channels = [
    make('Kick', DRUM_KEYS.kick, '#6d7f8c'),
    make('Clap', DRUM_KEYS.clap, '#6d7f8c'),
    make('Hat', DRUM_KEYS.hat, '#6d7f8c'),
    make('Snare', DRUM_KEYS.snare, '#6d7f8c')
  ]
  const limiter = getPlugin('limiter')
  if (limiter) p.mixer[0].slots[0] = { id: uid(), enabled: true, mix: 1, plugin: { pluginId: 'limiter', params: defaultParams(limiter.manifest) } }
  return p
}
