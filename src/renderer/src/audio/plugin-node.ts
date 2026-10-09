// Main-thread handles for plugin instances living in the audio graph.
import type { FromWorklet, PluginKind, ScheduledEvent, ToWorklet } from '../plugins/sdk/types'
import type { PluginInstanceState } from '../store/types'
import { getPlugin, getWasm } from '../plugins/registry'
import { defaultParams } from '../plugins/sdk/module'
import { resolvePluginData } from './samples'

/** Anything that can sit in a channel or an FX slot: built-in worklet DSP, VST bridge, ... */
export interface PluginHostNode {
  readonly pluginId: string
  readonly kind: PluginKind
  /** null for instruments */
  readonly input: AudioNode | null
  readonly output: AudioNode
  readonly ready: Promise<void>
  setParam(id: string, value: number): void
  setParams(values: Record<string, number>): void
  setData(data: unknown): void
  schedule(events: ScheduledEvent[]): void
  clearScheduled(): void
  panic(hard: boolean): void
  post(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
  setBypass(bypass: boolean): void
  dispose(): void
}

export type HostNodeFactory = (ctx: BaseAudioContext, state: PluginInstanceState, kind: PluginKind) => PluginHostNode

const externalFactories: { prefix: string; factory: HostNodeFactory }[] = []

/** Lets non-builtin plugin formats (e.g. "vst:") provide their own node implementation. */
export function registerHostNodeFactory(prefix: string, factory: HostNodeFactory): void {
  externalFactories.push({ prefix, factory })
}

export function createPluginNode(ctx: BaseAudioContext, state: PluginInstanceState, kind: PluginKind): PluginHostNode {
  const ext = externalFactories.find((f) => state.pluginId.startsWith(f.prefix))
  if (ext) return ext.factory(ctx, state, kind)
  return new BuiltinPluginNode(ctx, state, kind)
}

class BuiltinPluginNode implements PluginHostNode {
  readonly pluginId: string
  readonly kind: PluginKind
  input: AudioNode | null
  output: AudioNode
  readonly ready: Promise<void>
  private node: AudioWorkletNode | null = null
  private pending: ToWorklet[] = []
  private listeners = new Set<(msg: unknown) => void>()
  private disposed = false
  /** Stable in/out so the graph can be wired before the worklet node exists (wasm compile is async). */
  private inGain: GainNode | null
  private outGain: GainNode

  constructor(private ctx: BaseAudioContext, state: PluginInstanceState, kind: PluginKind) {
    this.pluginId = state.pluginId
    this.kind = kind
    this.outGain = ctx.createGain()
    this.inGain = kind === 'effect' ? ctx.createGain() : null
    this.output = this.outGain
    this.input = this.inGain
    this.ready = this.init(state)
  }

  private async init(state: PluginInstanceState): Promise<void> {
    const mod = getPlugin(state.pluginId)
    const wasm = await getWasm(state.pluginId)
    const base = await resolvePluginData(state.data ?? mod?.manifest.defaultData)
    const data = mod?.resolveData ? await mod.resolveData(base, this.ctx) : base
    if (this.disposed) return
    const params = { ...(mod ? defaultParams(mod.manifest) : {}), ...state.params }
    const node = new AudioWorkletNode(this.ctx, 'arkane-plugin', {
      numberOfInputs: this.kind === 'effect' ? 2 : 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { pluginId: state.pluginId, kind: this.kind, params, data, wasm }
    })
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
      const m = e.data
      if (m.type === 'message') for (const l of this.listeners) l(m.msg)
      else if (m.type === 'error') console.error(`[plugin ${this.pluginId}]`, m.message)
    }
    if (this.inGain) this.inGain.connect(node, 0, 0)
    node.connect(this.outGain)
    this.node = node
    for (const m of this.pending) node.port.postMessage(m)
    this.pending = []
  }

  private send(m: ToWorklet): void {
    if (this.node) this.node.port.postMessage(m)
    else this.pending.push(m)
  }

  /** Connect a side-chain source into input #1. */
  connectSidechain(src: AudioNode): void {
    void this.ready.then(() => this.node && src.connect(this.node, 0, 1))
  }

  setParam(id: string, value: number): void {
    this.send({ type: 'param', id, value })
  }
  setParams(values: Record<string, number>): void {
    this.send({ type: 'params', values })
  }
  setData(data: unknown): void {
    const mod = getPlugin(this.pluginId)
    void resolvePluginData(data)
      .then((d) => (mod?.resolveData ? mod.resolveData(d, this.ctx) : d))
      .then((d) => this.send({ type: 'data', data: d }))
  }
  schedule(events: ScheduledEvent[]): void {
    if (events.length) this.send({ type: 'events', events })
  }
  clearScheduled(): void {
    this.send({ type: 'clearScheduled' })
  }
  panic(hard: boolean): void {
    this.send({ type: 'panic', hard })
  }
  post(msg: unknown): void {
    this.send({ type: 'message', msg })
  }
  onMessage(cb: (msg: unknown) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  setBypass(bypass: boolean): void {
    this.send({ type: 'bypass', bypass })
  }
  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    try {
      this.inGain?.disconnect()
      this.outGain.disconnect()
      if (this.node) {
        this.node.port.postMessage({ type: 'dispose' })
        this.node.disconnect()
      }
    } catch {
      /* already disconnected */
    }
  }
}
