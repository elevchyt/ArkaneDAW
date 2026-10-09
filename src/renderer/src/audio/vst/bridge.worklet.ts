/// <reference lib="webworker" />
// AudioWorklet module for bridged (out-of-process) plugins. Registers 'arkane-vst-bridge'.
// Loaded with its own audioWorklet.addModule() by audio/vst/host-node.ts.
import { BridgeCore, toWireEvents, Ev, type BridgeOptions, type FromBridge, type ToBridge } from './protocol'

declare const sampleRate: number
declare const currentFrame: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

interface Options {
  sab: SharedArrayBuffer
  bridge: BridgeOptions
}

class ArkaneVstBridge extends AudioWorkletProcessor {
  private core: BridgeCore
  private alive = true
  private zero = new Float32Array(128)
  private silentL = new Float32Array(128)
  private silentR = new Float32Array(128)
  private lastStats = ''
  private n = 0

  constructor(options: { processorOptions: Options }) {
    super(options)
    const o = options.processorOptions
    this.core = new BridgeCore(o.sab, o.bridge)
    this.port.onmessage = (e: MessageEvent<ToBridge>) => {
      const m = e.data
      switch (m.type) {
        case 'events':
          this.core.push(toWireEvents(m.events))
          break
        case 'wire':
          this.core.push(m.events)
          break
        case 'clearScheduled':
          this.core.clearScheduled()
          break
        case 'panic':
          this.core.clearScheduled()
          this.core.push([{ time: 0, type: Ev.ALL_NOTES_OFF, a: m.hard ? 1 : 0, b: 0, v: 0 }])
          break
        case 'bypass':
          this.core.bypass = m.bypass
          break
        case 'flush':
          this.port.postMessage({ type: 'flushed', id: m.id } satisfies FromBridge)
          break
        case 'dispose':
          this.alive = false
          break
      }
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false
    const out = outputs[0]
    const outL = out[0] ?? this.silentL
    const outR = out[1] ?? this.silentR
    const input = inputs[0]
    const inL = input && input.length ? input[0] : null
    const inR = input && input.length > 1 ? input[1] : inL
    this.core.process(currentFrame, sampleRate, inL ?? this.zero, inR ?? this.zero, outL, outR)
    if ((++this.n & 127) === 0) {
      const s = this.core.stats()
      const key = `${s.xruns}:${s.dropped}:${s.latencyBlocks}`
      if (key !== this.lastStats) {
        this.lastStats = key
        this.port.postMessage({ type: 'stats', ...s } satisfies FromBridge)
      }
    }
    return true
  }
}

registerProcessor('arkane-vst-bridge', ArkaneVstBridge)

export {}
