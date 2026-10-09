// Device helpers for the audio settings window: enumeration, output routing (setSinkId), test tone.
import { getEngine, initAudio } from '@/audio/transport'

export interface DeviceInfo {
  id: string
  label: string
}

export async function listDevices(): Promise<{ outputs: DeviceInfo[]; inputs: DeviceInfo[]; labelled: boolean }> {
  try {
    const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? []
    const map = (kind: MediaDeviceKind) =>
      all
        .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Input' : 'Output'} ${i + 1}` }))
    return { outputs: map('audiooutput'), inputs: map('audioinput'), labelled: all.some((d) => !!d.label) }
  } catch {
    return { outputs: [], inputs: [], labelled: false }
  }
}

/** Device labels are hidden until the page has had input permission once. */
export async function requestDeviceLabels(): Promise<string | null> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const t of s.getTracks()) t.stop()
    return null
  } catch (e) {
    return String((e as Error)?.message ?? e)
  }
}

type SinkCtx = AudioContext & { setSinkId?: (id: string | { type: 'none' }) => Promise<void>; sinkId?: string }

export const canSelectOutput = (): boolean => typeof (AudioContext.prototype as SinkCtx).setSinkId === 'function'

/** Route the live AudioContext to an output device ('' = default). Returns an error message or null. */
export async function applyOutputDevice(id: string): Promise<string | null> {
  const ctx = getEngine()?.ctx as SinkCtx | undefined
  if (!ctx) return null // applied at audio boot
  if (!ctx.setSinkId) return 'Output device selection is not supported here'
  try {
    if ((ctx.sinkId ?? '') !== id) await ctx.setSinkId(id)
    return null
  } catch (e) {
    return `Could not open output device: ${String((e as Error)?.message ?? e)}`
  }
}

export interface AudioInfo {
  sampleRate: number
  baseLatency: number
  outputLatency: number
  state: string
}

export function audioInfo(): AudioInfo | null {
  const ctx = getEngine()?.ctx as AudioContext | undefined
  if (!ctx) return null
  return { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency || 0, outputLatency: ctx.outputLatency || 0, state: ctx.state }
}

/** Short 440 Hz tone (≈0.7 s, -14 dBFS) straight to the output. Stops by itself. */
export async function playTestTone(): Promise<void> {
  const engine = await initAudio()
  const ctx = engine.ctx
  const t = ctx.currentTime + 0.02
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.frequency.value = 440
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(0.2, t + 0.02)
  g.gain.setValueAtTime(0.2, t + 0.6)
  g.gain.linearRampToValueAtTime(0, t + 0.7)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.72)
  osc.onended = () => g.disconnect()
}
