import { definePlugin } from '../sdk/module'
import { BASE_H, BASE_W, KabeeEditor } from './Editor'
import { manifest } from './manifest'

/** Kabee: the user's guitar/bass amp + pedalboard (github.com/elevchyt/kabee), DSP compiled to WebAssembly. */
export default definePlugin({
  manifest,
  Editor: KabeeEditor,
  editorSize: { width: BASE_W, height: BASE_H },
  loadWasm: async () => {
    const url = new URL('./kabee.wasm', import.meta.url)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`kabee.wasm: HTTP ${res.status}`)
    // compileStreaming needs application/wasm; fall back to bytes for file:// (packaged Electron) and odd servers
    if (res.headers.get('content-type')?.includes('application/wasm')) return WebAssembly.compileStreaming(res)
    return WebAssembly.compile(await res.arrayBuffer())
  }
})
