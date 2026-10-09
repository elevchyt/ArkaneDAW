/// <reference lib="webworker" />
// Recorder AudioWorklet (separate module from processor.ts). Registers 'arkane-recorder':
//   input  → channel selection (stereo / left / right) → output (input monitoring path)
//   while recording, the selected signal is accumulated and posted to the main thread in
//   ~100 ms frame-stamped chunks (buffers are transferred, no copying on the main side).
// A 2 s pre-roll ring buffer lets a 'start' message ask for frames that were already rendered,
// so takes can start sample-accurately at the transport start even if the message arrives late.

declare const sampleRate: number
declare const currentFrame: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

interface RecorderOptions {
  channels: 1 | 2
  select: 'stereo' | 'left' | 'right'
}

type Msg = { type: 'start'; fromFrame: number } | { type: 'stop' } | { type: 'select'; select: RecorderOptions['select'] } | { type: 'dispose' }

class ArkaneRecorderProcessor extends AudioWorkletProcessor {
  private channels: 1 | 2
  private select: RecorderOptions['select']
  private ring: Float32Array[]
  private ringPos = 0 // write index
  private ringFrame = 0 // context frame of ring[ringPos] after the write (== frames written)
  private ringFilled = 0
  private recording = false
  private fromFrame = 0
  private chunk: Float32Array[] = []
  private chunkLen = 0
  private chunkFrame = 0
  private chunkSize: number
  private alive = true
  private peak = 0
  private peakCount = 0
  private scratchL = new Float32Array(128)
  private scratchR = new Float32Array(128)

  constructor(options: { processorOptions: RecorderOptions }) {
    super(options)
    const o = options.processorOptions
    this.channels = o.channels
    this.select = o.select
    const ringLen = Math.ceil(sampleRate * 2)
    this.ring = Array.from({ length: this.channels }, () => new Float32Array(ringLen))
    this.chunkSize = Math.ceil(sampleRate * 0.1)
    this.newChunk(0)
    this.port.onmessage = (e: MessageEvent<Msg>) => this.onMessage(e.data)
  }

  private newChunk(frame: number): void {
    this.chunk = Array.from({ length: this.channels }, () => new Float32Array(this.chunkSize))
    this.chunkLen = 0
    this.chunkFrame = frame
  }

  private flush(): void {
    if (this.chunkLen > 0) {
      const data = this.chunk.map((c) => c.slice(0, this.chunkLen))
      this.port.postMessage({ type: 'chunk', frame: this.chunkFrame, data }, data.map((d) => d.buffer))
    }
    this.newChunk(this.chunkFrame + this.chunkLen)
  }

  private push(frame: number, l: Float32Array, r: Float32Array, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      if (this.chunkLen === 0) this.chunkFrame = frame + i
      this.chunk[0][this.chunkLen] = l[i]
      if (this.channels === 2) this.chunk[1][this.chunkLen] = r[i]
      if (++this.chunkLen >= this.chunkSize) this.flush()
    }
  }

  private onMessage(m: Msg): void {
    if (m.type === 'start') {
      this.recording = true
      this.fromFrame = m.fromFrame
      this.newChunk(m.fromFrame)
      // Emit already-rendered frames >= fromFrame from the pre-roll ring.
      const ringLen = this.ring[0].length
      const oldest = this.ringFrame - this.ringFilled
      const begin = Math.max(oldest, m.fromFrame)
      if (begin < this.ringFrame) {
        const n = this.ringFrame - begin
        const l = new Float32Array(n)
        const r = new Float32Array(n)
        for (let i = 0; i < n; i++) {
          const idx = (this.ringPos - n + i + ringLen * 2) % ringLen
          l[i] = this.ring[0][idx]
          r[i] = this.channels === 2 ? this.ring[1][idx] : 0
        }
        this.push(begin, l, r, 0, n)
      }
    } else if (m.type === 'stop') {
      if (this.recording) this.flush()
      this.recording = false
      this.port.postMessage({ type: 'stopped', frame: currentFrame })
    } else if (m.type === 'select') {
      this.select = m.select
    } else if (m.type === 'dispose') {
      this.alive = false
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const out = outputs[0]
    const n = out?.[0]?.length ?? 128
    const inL = input?.[0]
    const inR = input?.[1] ?? inL
    const oL = out?.[0]
    const oR = out?.[1] ?? oL
    const frame = currentFrame
    const ringLen = this.ring[0].length
    let peak = this.peak
    for (let i = 0; i < n; i++) {
      let l = inL ? inL[i] : 0
      let r = inR ? inR[i] : 0
      if (this.select === 'left') r = l
      else if (this.select === 'right') l = r
      if (oL) oL[i] = l
      if (oR && oR !== oL) oR[i] = r
      const al = Math.abs(l)
      if (al > peak) peak = al
      const mono = this.channels === 1
      this.ring[0][this.ringPos] = mono ? (this.select === 'stereo' ? (l + r) * 0.5 : l) : l
      if (!mono) this.ring[1][this.ringPos] = r
      this.ringPos = (this.ringPos + 1) % ringLen
    }
    this.ringFrame = frame + n
    this.ringFilled = Math.min(ringLen, this.ringFilled + n)
    if (this.recording) {
      // Copy this block from the ring (already channel-selected) for frames >= fromFrame.
      const start = Math.max(0, this.fromFrame - frame)
      if (start < n) {
        if (this.scratchL.length < n) {
          this.scratchL = new Float32Array(n)
          this.scratchR = new Float32Array(n)
        }
        const l = this.scratchL
        const r = this.scratchR
        for (let i = 0; i < n; i++) {
          const idx = (this.ringPos - n + i + ringLen) % ringLen
          l[i] = this.ring[0][idx]
          r[i] = this.channels === 2 ? this.ring[1][idx] : 0
        }
        this.push(frame, l, r, start, n)
      }
    }
    // ~20 level reports per second (input meter in the settings window / mixer)
    if (++this.peakCount >= Math.ceil(sampleRate / 128 / 20)) {
      this.port.postMessage({ type: 'level', peak })
      this.peakCount = 0
      peak = 0
    }
    this.peak = peak
    return this.alive
  }
}

registerProcessor('arkane-recorder', ArkaneRecorderProcessor)
