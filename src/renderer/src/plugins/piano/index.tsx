import { definePlugin } from '../sdk/module'
import { manifest } from './manifest'
import { Editor } from './Editor'

export default definePlugin({ manifest, Editor, editorSize: { width: 760, height: 400 } })
