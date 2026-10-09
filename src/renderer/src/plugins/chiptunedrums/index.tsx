import { definePlugin } from '../sdk/module'
import chiptune from '../chiptune/index'
import { manifest } from './manifest'

export default definePlugin({
  manifest,
  Editor: chiptune.Editor,
  editorSize: chiptune.editorSize,
  keyNames: (inst) => chiptune.keyNames?.({ ...inst, params: { ...inst.params, mode: 1 } })
})
