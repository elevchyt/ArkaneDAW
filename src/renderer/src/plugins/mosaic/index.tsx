import { definePlugin } from '../sdk/module'
import { manifest } from './manifest'
import { MosaicEditor } from './Editor'

export default definePlugin({ manifest, Editor: MosaicEditor, editorSize: { width: 860, height: 520 } })
