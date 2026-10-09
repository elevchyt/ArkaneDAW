/// <reference lib="webworker" />
// The single AudioWorklet module. Registers:
//   'arkane-plugin' – hosts any built-in instrument or effect DSP by id
//   'arkane-meter'  – peak/RMS meter that reports ~30x per second
import { dspFactories } from '../../plugins/dsp-registry'
import type { EffectDSP, InstrumentDSP, ScheduledEvent, ToWorklet } from '../../plugins/sdk/types'

declare const sampleRate: number
declare const currentTime: number
declare const currentFrame: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

const BLOCK = 128

interface PluginOptions {
  pluginId: string
  kind: 'instrument' | 'effect'
  params: Record<string, number>
  data?: unknown
  wasm?: WebAssembly.Module
}

class ArkanePluginProcessor extends AudioWorkletProcessor {
  private dsp: InstrumentDSP | EffectDSP | null = null
  private kind: 'instrument' | 'effect'
  private queue: ScheduledEvent[] = []
  private bypass = false
  private zeroL = new Float32Array(BLOCK)
  private zeroR = new Float32Array(BLOCK)
  private alive = true

  constructor(options: { processorOptions: PluginOptions }) {
    super(options)
    const o = options.processorOptions
    this.kind = o.kind
    const factory = dspFactories[o.pluginId]
    if (!factory) {
      this.port.postMessage({ type: 'error', message: `Unknown DSP "${o.pluginId}"` })
    } else {
      try {
        this.dsp = factory.create({
          sampleRate,
          wasm: o.wasm,
          post: (msg) => this.port.postMessage({ type: 'message', msg })
        })
        if (o.data !== undefined) this.dsp.setData?.(o.data)
        for (const [k, v] of Object.entries(o.params ?? {})) this.dsp.setParam(k, v)
        this.port.postMessage({ type: 'ready' })
      } catch (e) {
        this.port.postMessage({ type: 'error', message: String(e) })
      }
    }
    this.port.onmessage = (e: MessageEvent<ToWorklet | { type: 'dispose' }>) => this.onMessage(e.data)
  }

  private onMessage(m: ToWorklet | { type: 'dispose' }): void {
    const dsp = this.dsp
    switch (m.type) {
      case 'dispose':
        this.alive = false
        return
      case 'param':
        dsp?.setParam(m.id, m.value)
        return
      case 'params':
        for (const k in m.values) dsp?.setParam(k, m.values[k])
        return
      case 'data':
        dsp?.setData?.(m.data)
        return
      case 'events': {
        for (const ev of m.events) this.queue.push(ev)
        this.queue.sort((a, b) => a.time - b.time)
        return
      }
      case 'clearScheduled':
        this.queue.length = 0
        return
      case 'panic':
        this.queue.length = 0
        if (this.kind === 'instrument') (dsp as InstrumentDSP | null)?.allNotesOff(m.hard)
        else (dsp as EffectDSP | null)?.reset?.()
        return
      case 'reset':
        ;(dsp as EffectDSP | null)?.reset?.()
        return
      case 'message':
        dsp?.onMessage?.(m.msg)
        return
      case 'bypass':
        this.bypass = m.bypass
        return
    }
  }

  private fire(ev: ScheduledEvent): void {
    const dsp = this.dsp
    if (!dsp) return
    switch (ev.kind) {
      case 'on':
        ;(dsp as InstrumentDSP).noteOn?.(ev.note)
        break
      case 'off':
        ;(dsp as InstrumentDSP).noteOff?.(ev.id, ev.key, ev.rel)
        break
      case 'param':
        dsp.setParam(ev.id, ev.value)
        break
      case 'bend':
        ;(dsp as InstrumentDSP).pitchBend?.(ev.semitones)
        break
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false
    const out = outputs[0]
    const outL = out[0]
    const outR = out[1] ?? out[0]
    const dsp = this.dsp
    if (!dsp) {
      outL.fill(0)
      outR.fill(0)
      return true
    }

    const input = inputs[0]
    const inL = input && input.length ? input[0] : this.zeroL
    const inR = input && input.length > 1 ? input[1] : inL
    const sc = inputs[1]
    const scL = sc && sc.length ? sc[0] : this.zeroL
    const scR = sc && sc.length > 1 ? sc[1] : scL

    if (this.kind === 'effect' && this.bypass) {
      outL.set(inL)
      outR.set(inR)
      this.drain(BLOCK)
      return true
    }

    // Split the block at scheduled event boundaries for sample-accurate timing.
    const blockStart = currentTime
    const secPerFrame = 1 / sampleRate
    let pos = 0
    if (this.kind === 'instrument') {
      outL.fill(0)
      outR.fill(0)
    }
    while (pos < BLOCK) {
      let next = BLOCK
      while (this.queue.length) {
        const ev = this.queue[0]
        const frame = Math.max(0, Math.round((ev.time - blockStart) / secPerFrame))
        if (frame <= pos) {
          this.queue.shift()
          this.fire(ev)
        } else {
          next = Math.min(BLOCK, frame)
          break
        }
      }
      if (this.kind === 'instrument') (dsp as InstrumentDSP).process(outL, outR, pos, next)
      else (dsp as EffectDSP).process(inL, inR, outL, outR, pos, next, scL, scR)
      pos = next
    }
    return true
  }

  /** Fire events whose time has passed without processing audio (bypassed effects). */
  private drain(frames: number): void {
    const end = currentTime + frames / sampleRate
    while (this.queue.length && this.queue[0].time < end) this.fire(this.queue.shift()!)
  }
}

class ArkaneMeterProcessor extends AudioWorkletProcessor {
  private peakL = 0
  private peakR = 0
  private sumL = 0
  private sumR = 0
  private n = 0
  private interval: number
  private alive = true

  constructor(options: unknown) {
    super(options)
    this.interval = Math.round(sampleRate / 30)
    this.port.onmessage = (e: MessageEvent<{ type: string }>) => {
      if (e.data.type === 'dispose') this.alive = false
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (!this.alive) return false
    const inp = inputs[0]
    const out = outputs[0]
    if (!inp || inp.length === 0) {
      this.n += BLOCK
    } else {
      const l = inp[0]
      const r = inp[1] ?? inp[0]
      for (let i = 0; i < l.length; i++) {
        const a = l[i] < 0 ? -l[i] : l[i]
        const b = r[i] < 0 ? -r[i] : r[i]
        if (a > this.peakL) this.peakL = a
        if (b > this.peakR) this.peakR = b
        this.sumL += l[i] * l[i]
        this.sumR += r[i] * r[i]
      }
      this.n += l.length
      // pass-through so the meter can sit inline
      if (out && out.length) {
        out[0].set(l)
        if (out[1]) out[1].set(r)
      }
    }
    if (this.n >= this.interval) {
      this.port.postMessage([this.peakL, this.peakR, Math.sqrt(this.sumL / this.n), Math.sqrt(this.sumR / this.n)])
      this.peakL = this.peakR = this.sumL = this.sumR = 0
      this.n = 0
    }
    return true
  }
}

registerProcessor('arkane-plugin', ArkanePluginProcessor)
registerProcessor('arkane-meter', ArkaneMeterProcessor)

export {}
void currentFrame
