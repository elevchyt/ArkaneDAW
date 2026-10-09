// VstHostNode: a PluginHostNode whose DSP runs in an arkane-vsthost sidecar process.
//
//   AudioWorklet 'arkane-vst-bridge'  ⇄  SharedArrayBuffer  ⇄  arkane_bridge.node copier thread  ⇄  POSIX shm  ⇄  sidecar
//
// Latency: the bridge runs `latencyBlocks` render quanta behind (default = the context's output buffer + 1 block,
// raised automatically on repeated xruns). Note/param events of INSTRUMENTS are sent that many blocks early, so
// sequenced notes stay sample-accurate and in time; effects add latencyBlocks*128 samples (+ the plugin's own).
import bridgeUrl from './bridge.worklet.ts?worker&url'
import type { PluginKind, ScheduledEvent } from '../../plugins/sdk/types'
import type { PluginHostNode } from '../plugin-node'
import type { PluginInstanceState } from '../../store/types'
import { PPQ } from '../../store/types'
import { getProject, editProject } from '../../store/project'
import { useTransport, playhead } from '../../store/transport'
import { getEngine } from '../transport'
import { host } from '../../platform'
import { parsePluginId } from './ids'
import { childProcess, loadAddon, nativeStatus, sidecarPath, type BridgeAddon } from './native'
import { SidecarProcess, describeExit, type VstParamInfo, type VstPluginInfo } from './sidecar'
import {
  Ev,
  F64_ANCHOR_PPQ,
  F64_ANCHOR_TIME,
  F64_TEMPO,
  H,
  Status,
  TOTAL_BYTES,
  BLOCK,
  initHeader,
  initialLatencyBlocks,
  type FromBridge,
  type ToBridge,
  type WireEvent
} from './protocol'

/** What a VST instance stores in PluginInstanceState.data */
export interface VstStateData {
  format: 'arkane-vst'
  version: 1
  /** base64 plugin state chunk (CLAP state / VST3 component+controller / VST2 chunk) */
  state: string
}

export function isVstState(d: unknown): d is VstStateData {
  return !!d && typeof d === 'object' && (d as VstStateData).format === 'arkane-vst' && typeof (d as VstStateData).state === 'string'
}

export type VstStatus = 'loading' | 'running' | 'crashed' | 'error' | 'unavailable' | 'disposed'

export interface VstSnapshot {
  status: VstStatus
  message?: string
  info: VstPluginInfo | null
  values: Record<string, number>
  editorOpen: boolean
  /** bridge latency (ms) + plugin latency (ms) */
  latencyMs: number
  xruns: number
}

/** Messages VstHostNode emits through onMessage() (in addition to the typed subscribe() API). */
export type VstNodeMessage =
  | ({ type: 'vst:state' } & VstSnapshot)
  | { type: 'vst:params'; values: Record<string, number> }

const live = new Set<VstHostNode>()
const modules = new WeakMap<BaseAudioContext, Promise<void>>()

function ensureBridgeModule(ctx: BaseAudioContext): Promise<void> {
  let p = modules.get(ctx)
  if (!p) {
    p = ctx.audioWorklet.addModule(bridgeUrl)
    modules.set(ctx, p)
  }
  return p
}

let nativeHandle: Promise<number | undefined> | null = null
function mainWindowXid(): Promise<number | undefined> {
  if (!nativeHandle) {
    const fn = (host?.window as unknown as { nativeHandle?: () => Promise<number | undefined> } | undefined)?.nativeHandle
    nativeHandle = fn ? fn().catch(() => undefined) : Promise.resolve(undefined)
  }
  return nativeHandle
}

export class VstHostNode implements PluginHostNode {
  readonly pluginId: string
  readonly kind: PluginKind
  readonly input: AudioNode | null
  readonly output: AudioNode
  readonly ready: Promise<void>

  status: VstStatus = 'loading'
  message: string | undefined
  info: VstPluginInfo | null = null
  values: Record<string, number> = {}
  editorOpen = false
  xruns = 0
  private bridgeLatency = 0
  private inGain: GainNode | null
  private outGain: GainNode
  private node: AudioWorkletNode | null = null
  private sab: SharedArrayBuffer | null = null
  private i32: Int32Array | null = null
  private f64: Float64Array | null = null
  private addon: BridgeAddon | null = null
  private addonId = -1
  private proc: SidecarProcess | null = null
  private exe = ''
  private disposed = false
  private bypass = false
  private portQueue: ToBridge[] = []
  private listeners = new Set<(msg: unknown) => void>()
  private subscribers = new Set<() => void>()
  private lastStateB64: string | null = null
  private lastData: unknown = undefined
  private captureTimer: ReturnType<typeof setTimeout> | null = null
  private passthrough = false
  private cachedSnap: VstSnapshot | null = null
  private flushes = new Map<number, () => void>()
  private flushSeq = 0

  constructor(
    private ctx: BaseAudioContext,
    state: PluginInstanceState,
    kind: PluginKind
  ) {
    this.pluginId = state.pluginId
    this.kind = kind
    this.outGain = ctx.createGain()
    this.inGain = kind === 'effect' ? ctx.createGain() : null
    this.input = this.inGain
    this.output = this.outGain
    live.add(this)
    this.ready = this.init(state).catch((e: unknown) => this.fail('error', e instanceof Error ? e.message : String(e)))
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  private async init(state: PluginInstanceState): Promise<void> {
    const ref = parsePluginId(state.pluginId)
    if (!ref) return this.fail('error', `Invalid plugin id ${state.pluginId}`)
    const ns = await nativeStatus()
    if (!ns.available) return this.fail('unavailable', ns.reason)
    if (host && !host.fs.existsSync(ref.path)) return this.fail('unavailable', `Plugin file not found: ${ref.path}`)
    this.addon = await loadAddon()
    this.exe = (await sidecarPath())!
    await ensureBridgeModule(this.ctx)
    if (this.disposed) return
    this.sab = new SharedArrayBuffer(TOTAL_BYTES)
    initHeader(this.sab)
    this.i32 = new Int32Array(this.sab)
    this.f64 = new Float64Array(this.sab)
    updateTransport(this)

    const offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext
    let stateB64 = isVstState(state.data) ? state.data.state : null
    if (offline) {
      // Offline export: start from the live instance's current state (it may not be in the project yet).
      const twin = liveTwin(state)
      if (twin) {
        await twin.captureState()
        stateB64 = twin.currentState ?? stateB64
      }
    }
    await this.startSidecar(stateB64)
    if (this.disposed) return
    this.lastData = state.data
    // initial params (normalized), sent through the audio stream so they apply before the first note
    const init: WireEvent[] = []
    for (const [k, v] of Object.entries(state.params ?? {})) {
      const id = Number(k)
      if (Number.isInteger(id)) {
        init.push({ time: 0, type: Ev.PARAM, a: id, b: 0, v })
        this.values[k] = v
      }
    }

    const latencyBlocks = offline ? 0 : initialLatencyBlocks((this.ctx as AudioContext).baseLatency, this.ctx.sampleRate)
    this.bridgeLatency = latencyBlocks
    const node = new AudioWorkletNode(this.ctx, 'arkane-vst-bridge', {
      numberOfInputs: this.kind === 'effect' ? 1 : 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { sab: this.sab, bridge: { kind: this.kind, latencyBlocks, adaptive: !offline, sync: offline } }
    })
    node.port.onmessage = (e: MessageEvent<FromBridge>) => {
      if (e.data.type === 'flushed') {
        this.flushes.get(e.data.id)?.()
        this.flushes.delete(e.data.id)
      } else if (e.data.type === 'stats') {
        this.xruns = e.data.xruns
        this.bridgeLatency = e.data.latencyBlocks
        this.changed()
      }
    }
    if (this.inGain) this.inGain.connect(node)
    node.connect(this.outGain)
    this.node = node
    if (init.length) this.send({ type: 'wire', events: init })
    if (this.bypass) this.send({ type: 'bypass', bypass: true })
    for (const m of this.portQueue) node.port.postMessage(m)
    this.portQueue = []
  }

  private async startSidecar(stateB64: string | null): Promise<void> {
    const cp = childProcess()!
    const { id, shm } = this.addon!.open(this.i32!)
    this.addonId = id
    const ref = parsePluginId(this.pluginId)!
    const proc = new SidecarProcess((cmd, args) => cp.spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }), {
      exe: this.exe,
      format: ref.format,
      path: ref.path,
      uid: ref.uid,
      sampleRate: this.ctx.sampleRate,
      shm,
      transientFor: await mainWindowXid(),
      scale: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    })
    this.proc = proc
    proc.onExit((x) => this.onExit(proc, describeExit(x)))
    proc.on((e) => {
      if (proc !== this.proc) return
      switch (e.ev) {
        case 'params':
          Object.assign(this.values, e.values)
          this.emit({ type: 'vst:params', values: e.values })
          break
        case 'dirty':
          this.scheduleCapture()
          break
        case 'latency':
          if (this.info) this.info.latency = e.samples
          this.changed()
          break
        case 'paramsChanged':
          if (this.info) this.info.params = e.params
          this.changed()
          break
        case 'editor':
          this.editorOpen = e.open
          if (!e.open) this.scheduleCapture(200)
          this.changed()
          break
      }
    })
    let info: VstPluginInfo
    try {
      info = await proc.ready
    } finally {
      this.addon!.unlink(id)
    }
    if (this.disposed) {
      proc.stop()
      return
    }
    this.info = info
    if (stateB64) {
      try {
        await proc.call('setState', { data: stateB64 })
        this.lastStateB64 = stateB64
      } catch (e) {
        console.warn(`[vst] ${info.name}: could not restore state`, e)
      }
    }
    try {
      const r = await proc.call<{ values: Record<string, number> }>('values')
      this.values = { ...r.values, ...this.values }
    } catch {
      /* ignore */
    }
    Atomics.store(this.i32!, H.STATUS, Status.RUNNING)
    this.status = 'running'
    this.message = undefined
    this.changed()
  }

  private onExit(proc: SidecarProcess, why: string): void {
    if (proc !== this.proc) return
    if (this.i32) Atomics.store(this.i32, H.STATUS, this.disposed ? Status.CLOSED : Status.CRASHED)
    if (this.addon && this.addonId >= 0) this.addon.close(this.addonId)
    this.addonId = -1
    this.editorOpen = false
    if (this.disposed) return
    if (this.status === 'loading') return // init() reports the error
    this.status = 'crashed'
    this.message = why
    console.error(`[vst] ${this.info?.name ?? this.pluginId}: ${why}`)
    this.changed()
  }

  private fail(status: VstStatus, message?: string): void {
    if (this.disposed) return
    this.status = status
    this.message = message
    if (this.i32) Atomics.store(this.i32, H.STATUS, Status.CRASHED)
    // A missing plugin should not silence the whole mixer track: effects pass audio through.
    if (status === 'unavailable' && this.inGain && !this.passthrough) {
      this.passthrough = true
      this.inGain.connect(this.outGain)
    }
    console.warn(`[vst] ${this.pluginId}: ${message ?? status}`)
    this.changed()
  }

  /** Re-spawn after a crash, restoring the last captured state. */
  async restart(): Promise<void> {
    if (this.disposed || this.status === 'running' || this.status === 'loading' || !this.sab) return
    this.status = 'loading'
    this.message = undefined
    this.changed()
    try {
      Atomics.store(this.i32!, H.STATUS, Status.STARTING)
      await this.startSidecar(this.lastStateB64)
    } catch (e) {
      this.status = 'crashed'
      this.message = e instanceof Error ? e.message : String(e)
      this.changed()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.status = 'disposed'
    live.delete(this)
    if (this.captureTimer) clearTimeout(this.captureTimer)
    this.listeners.clear()
    this.subscribers.clear()
    if (this.i32) Atomics.store(this.i32, H.STATUS, Status.CLOSED)
    try {
      this.inGain?.disconnect()
      this.outGain.disconnect()
      if (this.node) {
        this.node.port.postMessage({ type: 'dispose' } satisfies ToBridge)
        this.node.disconnect()
      }
    } catch {
      /* already disconnected */
    }
    const proc = this.proc
    if (proc) {
      proc.stop()
      // close the shm once the sidecar is gone (or after a grace period)
      const id = this.addonId
      const addon = this.addon
      const t = setTimeout(() => id >= 0 && addon?.close(id), 3000)
      proc.onExit(() => {
        clearTimeout(t)
        if (id >= 0) addon?.close(id)
      })
      this.addonId = -1
    }
  }

  // ── PluginHostNode ─────────────────────────────────────────────────────────
  setParam(id: string, value: number): void {
    this.setParams({ [id]: value })
  }

  setParams(values: Record<string, number>): void {
    const evs: WireEvent[] = []
    for (const [k, v] of Object.entries(values)) {
      const id = Number(k)
      if (!Number.isInteger(id) || id < 0) continue
      if (this.values[k] !== undefined && Math.abs(this.values[k] - v) < 1e-7) continue
      this.values[k] = v
      evs.push({ time: 0, type: Ev.PARAM, a: id, b: 0, v: Math.min(1, Math.max(0, v)) })
    }
    if (!evs.length) return
    this.send({ type: 'wire', events: evs })
    this.emit({ type: 'vst:params', values: Object.fromEntries(evs.map((e) => [String(e.a), e.v])) })
  }

  setData(data: unknown): void {
    if (data === this.lastData) return
    this.lastData = data
    if (!isVstState(data) || data.state === this.lastStateB64) return
    this.lastStateB64 = data.state
    if (this.status !== 'running' || !this.proc) return
    void this.proc.call('setState', { data: data.state }).then(
      () => this.refreshValues(),
      (e) => console.warn('[vst] setState failed', e)
    )
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
    const m = msg as { type?: string }
    switch (m?.type) {
      case 'showEditor':
        void this.showEditor()
        break
      case 'hideEditor':
        void this.hideEditor()
        break
      case 'toggleEditor':
        void (this.editorOpen ? this.hideEditor() : this.showEditor())
        break
      case 'restart':
        void this.restart()
        break
      case 'captureState':
        void this.captureState()
        break
      case 'vst:hello':
        this.changed()
        break
    }
  }

  onMessage(cb: (msg: unknown) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Resolves once everything sent so far reached the worklet (offline export awaits this before rendering). */
  async flush(): Promise<void> {
    await this.ready
    const node = this.node
    if (!node) return
    const id = ++this.flushSeq
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.flushes.delete(id)
        resolve()
      }, 2000)
      this.flushes.set(id, () => {
        clearTimeout(t)
        resolve()
      })
      node.port.postMessage({ type: 'flush', id } satisfies ToBridge)
    })
  }

  setBypass(bypass: boolean): void {
    this.bypass = bypass
    this.send({ type: 'bypass', bypass })
  }

  // ── richer API used by VstEditorPanel ─────────────────────────────────────
  snapshot(): VstSnapshot {
    const sr = this.ctx.sampleRate
    const pluginLat = this.info?.latency ?? 0
    return {
      status: this.status,
      message: this.message,
      info: this.info,
      values: this.values,
      editorOpen: this.editorOpen,
      latencyMs: ((this.kind === 'effect' ? this.bridgeLatency * BLOCK : 0) + pluginLat) / sr * 1000,
      xruns: this.xruns
    }
  }

  /** Bridge latency in samples as seen by the graph (effects only; instruments are compensated). */
  get latencySamples(): number {
    return (this.kind === 'effect' ? this.bridgeLatency * BLOCK : 0) + (this.info?.latency ?? 0)
  }

  /** Immutable snapshot, stable until the next change (for useSyncExternalStore). */
  cachedSnapshot(): VstSnapshot {
    if (!this.cachedSnap) this.cachedSnap = { ...this.snapshot(), values: { ...this.values } }
    return this.cachedSnap
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  async showEditor(): Promise<void> {
    if (!this.proc || this.status !== 'running') return
    try {
      await this.proc.call('showEditor')
    } catch (e) {
      this.message = e instanceof Error ? e.message : String(e)
      this.changed()
    }
  }

  async hideEditor(): Promise<void> {
    if (!this.proc || this.status !== 'running') return
    await this.proc.call('hideEditor').catch(() => {})
  }

  async params(): Promise<VstParamInfo[]> {
    if (!this.proc || this.status !== 'running') return this.info?.params ?? []
    const r = await this.proc.call<{ params: VstParamInfo[] }>('params')
    for (const p of r.params) if (p.value !== undefined) this.values[String(p.id)] = p.value
    return r.params
  }

  async paramText(id: number, value: number): Promise<string> {
    if (!this.proc || this.status !== 'running') return ''
    const r = await this.proc.call<{ text: string }>('paramText', { param: id, value })
    return r.text
  }

  /** Read the plugin state and store it in the project (non-undoable), together with tracked param values. */
  async captureState(): Promise<void> {
    if (this.captureTimer) {
      clearTimeout(this.captureTimer)
      this.captureTimer = null
    }
    if (this.status !== 'running' || !this.proc) return
    let data: string
    try {
      data = (await this.proc.call<{ data: string }>('getState')).data
    } catch {
      return
    }
    if (data === this.lastStateB64 || this.disposed) return
    this.lastStateB64 = data
    const value: VstStateData = { format: 'arkane-vst', version: 1, state: data }
    this.lastData = value
    writeBack(this, value)
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private scheduleCapture(delay = 1500): void {
    if (this.captureTimer) clearTimeout(this.captureTimer)
    this.captureTimer = setTimeout(() => void this.captureState(), delay)
  }

  private async refreshValues(): Promise<void> {
    if (!this.proc || this.status !== 'running') return
    try {
      const r = await this.proc.call<{ values: Record<string, number> }>('values')
      this.values = r.values
      this.emit({ type: 'vst:params', values: r.values })
    } catch {
      /* ignore */
    }
  }

  private send(m: ToBridge): void {
    if (this.node) this.node.port.postMessage(m)
    else if (!this.disposed) this.portQueue.push(m)
  }

  private emit(msg: VstNodeMessage): void {
    this.cachedSnap = null
    for (const l of [...this.listeners]) l(msg)
    for (const s of [...this.subscribers]) s()
  }

  private changed(): void {
    this.emit({ type: 'vst:state', ...this.snapshot() })
  }

  /** @internal transport anchor (written from the UI thread, read by the worklet) */
  writeTransport(tempo: number, playing: boolean, anchorTime: number, anchorPpq: number): void {
    if (!this.i32 || !this.f64) return
    this.f64[F64_TEMPO] = tempo
    this.f64[F64_ANCHOR_TIME] = anchorTime
    this.f64[F64_ANCHOR_PPQ] = anchorPpq
    Atomics.store(this.i32, H.PLAYING, playing ? 1 : 0)
  }

  /** Last known state chunk (base64). */
  get currentState(): string | null {
    return this.lastStateB64
  }

  get context(): BaseAudioContext {
    return this.ctx
  }
}

/** Store captured state in the project where this node lives (channel instrument or mixer slot). */
function writeBack(node: VstHostNode, data: VstStateData): void {
  const eng = getEngine()
  if (!eng || eng.ctx !== node.context) return
  const sync = (target: PluginInstanceState | undefined | null): void => {
    if (!target || target.pluginId !== node.pluginId) return
    target.data = data
    for (const k of Object.keys(target.params)) if (node.values[k] !== undefined) target.params[k] = node.values[k]
  }
  for (const [channelId, strip] of eng.channels) {
    if (strip.instrument !== node) continue
    editProject('Plugin state', (d) => sync(d.channels.find((c) => c.id === channelId)?.plugin), { undoable: false })
    return
  }
  eng.mixer.forEach((m, track) =>
    m?.slots.forEach((s, slot) => {
      if (s?.plugin !== node) return
      editProject('Plugin state', (d) => sync(d.mixer[track]?.slots[slot]?.plugin), { undoable: false })
    })
  )
}

/** The live-engine node hosting exactly this PluginInstanceState object (same project snapshot), if any. */
function liveTwin(state: PluginInstanceState): VstHostNode | null {
  const eng = getEngine()
  if (!eng) return null
  for (const strip of eng.channels.values())
    if (strip.state.plugin === state && strip.instrument instanceof VstHostNode) return strip.instrument
  for (const m of eng.mixer)
    if (m) for (const s of m.slots) if (s && s.state.plugin === state && s.plugin instanceof VstHostNode) return s.plugin
  return null
}

function updateTransport(node: VstHostNode): void {
  const ctx = node.context as AudioContext
  const playing = useTransport.getState().playing
  node.writeTransport(getProject().tempo || 120, playing, ctx.currentTime - (ctx.outputLatency || 0), playhead.tick / PPQ)
}

// Keep every live bridge's transport anchor fresh (playhead updates each animation frame while playing).
let transportHooked = false
export function hookTransport(): void {
  if (transportHooked) return
  transportHooked = true
  playhead.subscribe(() => {
    for (const n of live) updateTransport(n)
  })
  useTransport.subscribe(() => {
    for (const n of live) updateTransport(n)
  })
}

/** Capture the state of every live plugin into the project (call before saving / exporting). */
export async function flushVstStates(): Promise<void> {
  await Promise.all([...live].map((n) => n.captureState()))
}

export function liveVstNodes(): VstHostNode[] {
  return [...live]
}
