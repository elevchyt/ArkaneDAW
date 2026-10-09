import { definePlugin, type KeyName, type PluginInstanceView } from '../sdk/module'
import { manifest } from './manifest'
import { Editor } from './Editor'
import { readData } from './data'
import { resolveKit } from './kits'
import { ROLE_GROUP } from './keymap'

const cache = new Map<string, Record<number, KeyName>>()

/** Piano-roll drum map for the currently selected kit. */
function keyNames(instance: PluginInstanceView): Record<number, KeyName> {
  const kit = readData(instance.data).kit
  let m = cache.get(kit)
  if (!m) {
    m = {}
    for (const pad of resolveKit(kit).pads) m[pad.key] = { name: pad.name, group: ROLE_GROUP[pad.role] }
    cache.set(kit, m)
  }
  return m
}

export default definePlugin({ manifest, Editor, editorSize: { width: 760, height: 420 }, keyNames })
