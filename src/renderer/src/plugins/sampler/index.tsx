import { definePlugin } from '../sdk/module'
import { manifest } from './manifest'

export default definePlugin({ manifest, editorSize: { width: 560, height: 260 } })
