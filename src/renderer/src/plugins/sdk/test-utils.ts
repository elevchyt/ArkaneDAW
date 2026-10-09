// Offline helpers for unit-testing DSP code under vitest (node). No Web Audio needed.
import type { DSPFactory, EffectDSP, InstrumentDSP, NoteOn } from './types'

export const SR = 48000
const BLOCK = 128

export function note(key: number, partial: Partial<NoteOn> = {}): NoteOn {
  return { id: key * 1000 + Math.floor(Math.random() * 1000), key, vel: 0.8, pan: 0, fine: 0, rel: 0.5, modX: 0.5, modY: 0.5, porta: false, slide: false, color: 0, length: 0, ...partial }
}

export interface Rendered {
  L: Float32Array
  R: Float32Array
}

/** Play notes: [{ at: seconds, dur: seconds, note }] and render `seconds` of audio. */
export function renderInstrument(
  factory: DSPFactory,
  opts: { params?: Record<string, number>; data?: unknown; notes: { at: number; dur: number; note: NoteOn }[]; seconds: number; sampleRate?: number; wasm?: WebAssembly.Module }
): Rendered {
  const sr = opts.sampleRate ?? SR
  const dsp = factory.create({ sampleRate: sr, wasm: opts.wasm, post: () => {} }) as InstrumentDSP
  if (opts.data !== undefined) dsp.setData?.(opts.data)
  for (const [k, v] of Object.entries(opts.params ?? {})) dsp.setParam(k, v)
  const n = Math.ceil(opts.seconds * sr)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const events = opts.notes.flatMap((x) => [
    { t: Math.round(x.at * sr), on: true, n: x.note },
    { t: Math.round((x.at + x.dur) * sr), on: false, n: x.note }
  ]).sort((a, b) => a.t - b.t)
  const bl = new Float32Array(BLOCK)
  const br = new Float32Array(BLOCK)
  for (let pos = 0; pos < n; pos += BLOCK) {
    bl.fill(0)
    br.fill(0)
    let i = 0
    while (i < BLOCK) {
      while (events.length && events[0].t <= pos + i) {
        const ev = events.shift()!
        if (ev.on) dsp.noteOn(ev.n)
        else dsp.noteOff(ev.n.id, ev.n.key, ev.n.rel)
      }
      const next = events.length ? Math.min(BLOCK, events[0].t - pos) : BLOCK
      const end = Math.max(i + 1, next)
      dsp.process(bl, br, i, Math.min(BLOCK, end))
      i = Math.min(BLOCK, end)
    }
    L.set(bl.subarray(0, Math.min(BLOCK, n - pos)), pos)
    R.set(br.subarray(0, Math.min(BLOCK, n - pos)), pos)
  }
  return { L, R }
}

export function renderEffect(factory: DSPFactory, opts: { params?: Record<string, number>; input: Rendered; sampleRate?: number; data?: unknown }): Rendered {
  const sr = opts.sampleRate ?? SR
  const dsp = factory.create({ sampleRate: sr, post: () => {} }) as EffectDSP
  if (opts.data !== undefined) dsp.setData?.(opts.data)
  for (const [k, v] of Object.entries(opts.params ?? {})) dsp.setParam(k, v)
  const n = opts.input.L.length
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const il = new Float32Array(BLOCK), ir = new Float32Array(BLOCK), ol = new Float32Array(BLOCK), or = new Float32Array(BLOCK)
  for (let pos = 0; pos < n; pos += BLOCK) {
    il.fill(0)
    ir.fill(0)
    il.set(opts.input.L.subarray(pos, pos + BLOCK))
    ir.set(opts.input.R.subarray(pos, pos + BLOCK))
    dsp.process(il, ir, ol, or, 0, BLOCK)
    L.set(ol.subarray(0, Math.min(BLOCK, n - pos)), pos)
    R.set(or.subarray(0, Math.min(BLOCK, n - pos)), pos)
  }
  return { L, R }
}

export function stats(x: Float32Array): { peak: number; rms: number; nan: boolean } {
  let peak = 0, sum = 0, nan = false
  for (const v of x) {
    if (!Number.isFinite(v)) nan = true
    const a = Math.abs(v)
    if (a > peak) peak = a
    sum += v * v
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, x.length)), nan }
}

export function sine(freq: number, seconds: number, amp = 0.5, sr = SR): Rendered {
  const n = Math.ceil(seconds * sr)
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) L[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp
  return { L, R: L.slice() }
}

/** Write a 16-bit stereo WAV (for listening to test renders): writeWav('/tmp/x.wav', r) */
export async function writeWav(path: string, r: Rendered, sr = SR): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  const n = r.L.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r.L[i] * 32767))), 44 + i * 4)
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r.R[i] * 32767))), 46 + i * 4)
  }
  await writeFile(path, buf)
}
