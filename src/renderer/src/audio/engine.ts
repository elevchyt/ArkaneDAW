// The audio graph. Mirrors the project's channels and mixer into Web Audio nodes and keeps
// them in sync by diffing immutable project snapshots (immer gives us cheap reference checks).
//
//   Channel:  instrument ─▶ vol ─▶ pan ─▶ (mixer insert input)
//   Insert:   input ─▶ [slot 1..10 (dry/wet)] ─▶ pan ─▶ fader ─▶ meter ─▶ sends ─▶ other inserts / master
//   Master:   ... ─▶ masterVolume ─▶ destination
import type { Channel, FxSlot, MixerTrack, Project } from '../store/types'
import type { ScheduledEvent } from '../plugins/sdk/types'
import { createPluginNode, type PluginHostNode } from './plugin-node'

export const faderToGain = (v: number, ref = 0.8): number => (v <= 0 ? 0 : Math.pow(v / ref, 1.6))
export const gainToDb = (g: number): number => (g <= 0.00001 ? -Infinity : 20 * Math.log10(g))

export interface Meter {
  peakL: number
  peakR: number
  rmsL: number
  rmsR: number
}

class SlotStrip {
  plugin: PluginHostNode
  readonly input: GainNode
  readonly output: GainNode
  private dry: GainNode
  private wet: GainNode
  state: FxSlot

  constructor(ctx: BaseAudioContext, slot: FxSlot) {
    this.state = slot
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    this.plugin = createPluginNode(ctx, slot.plugin, 'effect')
    this.input.connect(this.dry).connect(this.output)
    this.input.connect(this.plugin.input!)
    this.plugin.output.connect(this.wet).connect(this.output)
    this.apply(slot)
  }

  apply(slot: FxSlot): void {
    const prev = this.state
    this.state = slot
    const on = slot.enabled
    this.dry.gain.value = on ? 1 - slot.mix : 1
    this.wet.gain.value = on ? slot.mix : 0
    this.plugin.setBypass(!on)
    if (prev.plugin.params !== slot.plugin.params) this.plugin.setParams(diff(prev.plugin.params, slot.plugin.params))
    if (prev.plugin.data !== slot.plugin.data) this.plugin.setData(slot.plugin.data)
  }

  dispose(): void {
    this.plugin.dispose()
    this.input.disconnect()
    this.output.disconnect()
    this.dry.disconnect()
    this.wet.disconnect()
  }
}

export class MixerStrip {
  readonly input: GainNode
  readonly pan: StereoPannerNode
  readonly fader: GainNode
  readonly post: AudioNode // after meter: sends tap here
  readonly meter: Meter = { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 }
  readonly analyser: AnalyserNode
  slots: (SlotStrip | null)[] = []
  sends = new Map<number, GainNode>()
  private chainEnd: AudioNode
  private meterNode: AudioWorkletNode
  private muteGain: GainNode
  state: MixerTrack | null = null

  constructor(private ctx: BaseAudioContext, readonly index: number) {
    this.input = ctx.createGain()
    this.pan = ctx.createStereoPanner()
    this.fader = ctx.createGain()
    this.muteGain = ctx.createGain()
    this.meterNode = new AudioWorkletNode(ctx, 'arkane-meter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
    this.meterNode.port.onmessage = (e: MessageEvent<number[]>) => {
      const [pl, pr, rl, rr] = e.data
      this.meter.peakL = pl
      this.meter.peakR = pr
      this.meter.rmsL = rl
      this.meter.rmsR = rr
    }
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.chainEnd = this.input
    this.pan.connect(this.fader).connect(this.muteGain).connect(this.meterNode)
    this.meterNode.connect(this.analyser)
    this.post = this.meterNode
    this.input.connect(this.pan)
  }

  private rewireChain(): void {
    this.input.disconnect()
    for (const s of this.slots) s?.output.disconnect()
    let node: AudioNode = this.input
    for (const s of this.slots) {
      if (!s) continue
      node.connect(s.input)
      node = s.output
    }
    node.connect(this.pan)
    this.chainEnd = node
  }

  apply(t: MixerTrack, mutedBySolo: boolean): void {
    const prev = this.state
    this.state = t
    this.fader.gain.value = faderToGain(t.volume)
    this.pan.pan.value = t.pan
    this.muteGain.gain.value = t.muted || mutedBySolo ? 0 : t.phaseInvert ? -1 : 1
    if (!prev || prev.slots !== t.slots || prev.fxEnabled !== t.fxEnabled) {
      let structural = false
      const next: (SlotStrip | null)[] = []
      for (let i = 0; i < t.slots.length; i++) {
        const slot = t.fxEnabled ? t.slots[i] : null
        const cur = this.slots[i] ?? null
        if (!slot) {
          if (cur) {
            cur.dispose()
            structural = true
          }
          next.push(null)
        } else if (cur && cur.state.id === slot.id && cur.state.plugin.pluginId === slot.plugin.pluginId) {
          cur.apply(slot)
          next.push(cur)
        } else {
          cur?.dispose()
          next.push(new SlotStrip(this.ctx, slot))
          structural = true
        }
      }
      this.slots = next
      if (structural || !prev) this.rewireChain()
    }
  }

  setSends(targets: Map<number, number>, strips: MixerStrip[], destination: AudioNode | null): void {
    for (const [target, g] of this.sends) {
      if (!targets.has(target)) {
        g.disconnect()
        this.sends.delete(target)
      }
    }
    for (const [target, level] of targets) {
      let g = this.sends.get(target)
      if (!g) {
        g = this.ctx.createGain()
        this.post.connect(g)
        const dest = target === -1 ? destination : strips[target]?.input
        if (dest) g.connect(dest)
        this.sends.set(target, g)
      }
      g.gain.value = faderToGain(level, 1)
    }
  }

  getSlotPlugin(slot: number): PluginHostNode | null {
    return this.slots[slot]?.plugin ?? null
  }

  dispose(): void {
    for (const s of this.slots) s?.dispose()
    this.meterNode.port.postMessage({ type: 'dispose' })
    this.input.disconnect()
    this.meterNode.disconnect()
    for (const g of this.sends.values()) g.disconnect()
  }
}

export class ChannelStrip {
  instrument: PluginHostNode | null = null
  readonly input: GainNode // for audio-clip playback / samples routed by the scheduler
  readonly vol: GainNode
  readonly pan: StereoPannerNode
  state: Channel
  private target = -2

  constructor(private ctx: BaseAudioContext, ch: Channel) {
    this.state = ch
    this.input = ctx.createGain()
    this.vol = ctx.createGain()
    this.pan = ctx.createStereoPanner()
    this.input.connect(this.vol)
    this.vol.connect(this.pan)
    if (ch.plugin) this.setInstrument(ch)
    this.applyMix(ch)
  }

  private setInstrument(ch: Channel): void {
    this.instrument?.dispose()
    this.instrument = ch.plugin ? createPluginNode(this.ctx, ch.plugin, 'instrument') : null
    this.instrument?.output.connect(this.vol)
  }

  private applyMix(ch: Channel): void {
    this.vol.gain.value = ch.muted ? 0 : faderToGain(ch.volume, 0.78)
    this.pan.pan.value = ch.pan
  }

  apply(ch: Channel): void {
    const prev = this.state
    this.state = ch
    if (prev.plugin?.pluginId !== ch.plugin?.pluginId) this.setInstrument(ch)
    else if (ch.plugin && prev.plugin) {
      if (prev.plugin.params !== ch.plugin.params) this.instrument?.setParams(diff(prev.plugin.params, ch.plugin.params))
      if (prev.plugin.data !== ch.plugin.data) this.instrument?.setData(ch.plugin.data)
    }
    this.applyMix(ch)
    if (prev.pitch !== ch.pitch) this.instrument?.schedule([{ kind: 'bend', time: 0, semitones: ch.pitch / 100 }])
  }

  route(strips: MixerStrip[], destination: AudioNode): void {
    const t = this.state.mixerTrack
    if (t === this.target) return
    this.pan.disconnect()
    const dest = t >= 0 ? strips[t]?.input ?? destination : destination
    this.pan.connect(dest)
    this.target = t
  }

  dispose(): void {
    this.instrument?.dispose()
    this.input.disconnect()
    this.vol.disconnect()
    this.pan.disconnect()
  }
}

function diff(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k in b) if (a[k] !== b[k]) out[k] = b[k]
  return out
}

/**
 * One engine per AudioContext. The live app has one; offline export creates another
 * bound to an OfflineAudioContext.
 */
export class AudioEngine {
  readonly channels = new Map<string, ChannelStrip>()
  readonly mixer: MixerStrip[] = []
  readonly masterOut: GainNode
  readonly output: AudioNode
  private project: Project | null = null
  private noteSeq = 1

  constructor(readonly ctx: BaseAudioContext) {
    this.masterOut = ctx.createGain()
    this.masterOut.connect(ctx.destination)
    this.output = this.masterOut
  }

  nextNoteId(): number {
    return this.noteSeq++
  }

  sync(project: Project): void {
    const prev = this.project
    this.project = project
    if (prev === project) return
    const ctx = this.ctx

    // Mixer
    if (!prev || prev.mixer !== project.mixer) {
      while (this.mixer.length < project.mixer.length) this.mixer.push(new MixerStrip(ctx, this.mixer.length))
      const soloed = project.mixer.filter((t) => t.solo).map((t) => t.index)
      const audible = soloed.length ? soloAudible(project.mixer, soloed) : null
      const soloDirty = !prev || soloChanged(prev, project)
      project.mixer.forEach((t, i) => {
        if (prev && prev.mixer[i] === t && !soloDirty) return
        this.mixer[i].apply(t, audible ? !audible.has(i) : false)
      })
      project.mixer.forEach((t, i) => {
        if (prev && prev.mixer[i]?.sends === t.sends && this.mixer[i].sends.size) return
        const targets = new Map<number, number>()
        if (i === 0) targets.set(-1, 1)
        else for (const s of t.sends) if (s.target !== i) targets.set(s.target, s.level)
        this.mixer[i].setSends(targets, this.mixer, this.masterOut)
      })
    }
    this.masterOut.gain.value = faderToGain(project.masterVolume)

    // Channels
    if (!prev || prev.channels !== project.channels) {
      const seen = new Set<string>()
      for (const ch of project.channels) {
        seen.add(ch.id)
        let strip = this.channels.get(ch.id)
        if (!strip) {
          strip = new ChannelStrip(ctx, ch)
          this.channels.set(ch.id, strip)
        } else if (strip.state !== ch) strip.apply(ch)
        strip.route(this.mixer, this.mixer[0]?.input ?? this.masterOut)
      }
      for (const [id, strip] of this.channels) {
        if (!seen.has(id)) {
          strip.dispose()
          this.channels.delete(id)
        }
      }
    }
  }

  // ── note I/O ────────────────────────────────────────────────────────────────
  schedule(channelId: string, events: ScheduledEvent[]): void {
    this.channels.get(channelId)?.instrument?.schedule(events)
  }

  /** Immediate note for previews, typing keyboard and MIDI input. Returns the note id. */
  noteOn(channelId: string, key: number, vel = 0.78, extra: Partial<{ pan: number; fine: number; modX: number; modY: number; length: number }> = {}): number {
    const id = this.nextNoteId()
    this.channels.get(channelId)?.instrument?.schedule([
      {
        kind: 'on',
        time: 0,
        note: { id, key, vel, pan: 0, fine: 0, rel: 0.5, modX: 0.5, modY: 0.5, porta: false, slide: false, color: 0, length: 0, ...extra }
      }
    ])
    return id
  }

  noteOff(channelId: string, id: number, key: number): void {
    this.channels.get(channelId)?.instrument?.schedule([{ kind: 'off', time: 0, id, key, rel: 0.5 }])
  }

  panic(hard = true): void {
    for (const ch of this.channels.values()) {
      ch.instrument?.clearScheduled()
      ch.instrument?.panic(hard)
    }
    if (hard) for (const m of this.mixer) for (const s of m.slots) s?.plugin.panic(true)
  }

  stopScheduled(): void {
    for (const ch of this.channels.values()) {
      ch.instrument?.clearScheduled()
      ch.instrument?.panic(false)
    }
  }

  channelPlugin(channelId: string): PluginHostNode | null {
    return this.channels.get(channelId)?.instrument ?? null
  }

  fxPlugin(track: number, slot: number): PluginHostNode | null {
    return this.mixer[track]?.getSlotPlugin(slot) ?? null
  }

  dispose(): void {
    for (const c of this.channels.values()) c.dispose()
    for (const m of this.mixer) m.dispose()
    this.masterOut.disconnect()
  }
}

/** Tracks audible when soloing: the soloed tracks, everything feeding them, and their path to master. */
function soloAudible(mixer: MixerTrack[], soloed: number[]): Set<number> {
  const out = new Set<number>([0, ...soloed])
  const down = (i: number) => {
    for (const s of mixer[i]?.sends ?? []) if (!out.has(s.target)) {
      out.add(s.target)
      down(s.target)
    }
  }
  const up = (i: number) => {
    mixer.forEach((t) => {
      if (!out.has(t.index) && t.sends.some((s) => s.target === i)) {
        out.add(t.index)
        up(t.index)
      }
    })
  }
  for (const s of soloed) {
    down(s)
    up(s)
  }
  return out
}

function soloChanged(a: Project, b: Project): boolean {
  for (let i = 0; i < b.mixer.length; i++) if (a.mixer[i]?.solo !== b.mixer[i].solo) return true
  return false
}
