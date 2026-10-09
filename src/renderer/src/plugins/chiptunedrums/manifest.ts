import type { PluginManifest, Preset } from '../sdk/types'
import { defaultChipData } from '../chiptune/data'
import { PARAMS } from '../chiptune/params'
import { PRESETS } from '../chiptune/presets'

/** "Chiptune Drums": the Chiptune engine locked to its retro drum mode (NES / Game Boy / Arcade kits + SFX). */
export const manifest: PluginManifest = {
  id: 'chiptunedrums',
  name: 'Chiptune Drums',
  kind: 'instrument',
  category: 'Drums',
  description: 'NES, Game Boy and Arcade drum kits plus game SFX, built from 8-bit chip channels. Each key plays a drum.',
  color: '#fc74b4',
  params: PARAMS.map((p) => (p.id === 'mode' ? { ...p, default: 1, hidden: true } : p)),
  presets: kitPresets(),
  defaultData: defaultChipData()
}

/** Chiptune's drum kits plus a few extra console-flavoured variations. */
function kitPresets(): Preset[] {
  const base = PRESETS.filter((p) => p.category === 'Drums').map((p) => ({ ...p, category: undefined }))
  const nes = base.find((p) => p.name === 'NES Kit')
  const vary = (name: string, params: Record<string, number>): Preset => ({ name, params: { ...(nes?.params ?? {}), ...params }, data: nes?.data })
  return [
    ...base,
    vary('Famicom DAC Kit', { 'drum.kit': 0, 'out.dac': 1 }),
    vary('Game Boy Pocket Kit', { 'drum.kit': 1, 'out.rate': 4, 'drum.decay': 0.8 }),
    vary('Arcade Crunch Kit', { 'drum.kit': 2, 'out.rate': 5, 'drum.tune': 2 }),
    vary('Boss Battle Kit', { 'drum.kit': 2, 'drum.decay': 1.3 })
  ]
}
