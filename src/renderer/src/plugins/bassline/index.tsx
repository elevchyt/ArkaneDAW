import { definePlugin } from '../sdk/module'
import { manifest } from './manifest'
import BasslineEditor, { EDITOR_H, EDITOR_W } from './Editor'

export default definePlugin({ manifest, Editor: BasslineEditor, editorSize: { width: EDITOR_W, height: EDITOR_H } })
