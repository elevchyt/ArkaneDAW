import { definePlugin } from '../sdk/module'
import { manifest } from './manifest'
import { EDITOR_H, EDITOR_W, Editor } from './Editor'

export default definePlugin({ manifest, Editor, editorSize: { width: EDITOR_W, height: EDITOR_H } })
