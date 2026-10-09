import type { PluginManifest } from '../sdk/types'
import { PARAMS } from './params'
import { PRESETS } from './presets'

/** "Bassline": every kind of bass — 303 acid, Moog, 808/sub, reese, wobble, FM, plucks and modelled electric/upright basses. */
export const manifest: PluginManifest = {
  id: 'bassline',
  name: 'Bassline',
  kind: 'instrument',
  category: 'Synth',
  description: 'All-in-one bass instrument: 303 acid with accent & slide, analog/Moog, 808 & sub, reese, wobble, FM, plucks and physically modelled finger/pick/slap/fretless/upright basses.',
  color: '#e8b04a',
  mono: true,
  params: PARAMS,
  presets: PRESETS
}
