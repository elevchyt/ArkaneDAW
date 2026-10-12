// The audio graph. Mirrors the project's channels and mixer into Web Audio nodes and keeps
// them in sync by diffing immutable project snapshots (immer gives us cheap reference checks).
//
//   Channel:  instrument ─▶ vol ─▶ pan ─▶ (mixer insert input)
//   Insert:   input ─▶ [slot 1..10 (dry/wet)] ─▶ pan ─▶ fader ─▶ meter ─▶ sends ─▶ other inserts / master
//   Master:   ... ─▶ masterVolume ─▶ destination
import type { Channel, FxSlot, MixerTrack, Project } from '../store/types'
import type { ScheduledEvent } from '../plugins/sdk/types'
import { createPluginNode, type PluginHostNode } from './plugin-node'
import { getPlugin } from '../plugins/registry'
import { liveKeys } from './liveKeys'

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
  // [mixer-eq] 3-band EQ + stereo width / L-R swap stage between the FX chain and the panner.
  private eq: BiquadFilterNode[] = []
  private widthIn!: GainNode
  private widthGains: GainNode[] = [] // LL, RL, LR, RR (source → dest)
  private toneIn!: AudioNode
  state: MixerTrack | null = null

  /** [mixer-eq] chainEnd → eqLow → eqMid → eqHigh → width matrix → pan */
  private buildToneStage(): AudioNode {
    const ctx = this.ctx
    const types: BiquadFilterType[] = ['lowshelf', 'peaking', 'highshelf']
    this.eq = types.map((type) => {
      const f = ctx.createBiquadFilter()
      f.type = type
      f.gain.value = 0
      if (type === 'peaking') f.Q.value = 0.9
      return f
    })
    this.eq[0].connect(this.eq[1]).connect(this.eq[2])
    this.widthIn = ctx.createGain()
    this.widthIn.channelCount = 2
    this.widthIn.channelCountMode = 'explicit'
    this.widthIn.channelInterpretation = 'speakers'
    const split = ctx.createChannelSplitter(2)
    const merge = ctx.createChannelMerger(2)
    this.eq[2].connect(this.widthIn).connect(split)
    this.widthGains = [0, 1, 2, 3].map((k) => {
      const g = ctx.createGain()
      split.connect(g, k & 1) // source: L for 0/2, R for 1/3
      g.connect(merge, 0, k >> 1) // dest: L for 0/1, R for 2/3
      return g
    })
    this.applyTone({ low: [90, 0], mid: [1400, 0], high: [9000, 0], sep: 0, swap: false })
    merge.connect(this.pan)
    return this.eq[0]
  }

  private applyTone(o: { low: [number, number]; mid: [number, number]; high: [number, number]; sep: number; swap: boolean }): void {
    const bands = [o.low, o.mid, o.high]
    this.eq.forEach((f, i) => {
      f.frequency.value = bands[i][0]
      f.gain.value = bands[i][1]
    })
    const w = 1 + Math.max(-1, Math.min(1, o.sep)) // 0 = mono, 1 = unchanged, 2 = wide
    const a = (1 + w) / 2
    const b = (1 - w) / 2
    const [ll, rl, lr, rr] = o.swap ? [b, a, a, b] : [a, b, b, a]
    this.widthGains[0].gain.value = ll
    this.widthGains[1].gain.value = rl
    this.widthGains[2].gain.value = lr
    this.widthGains[3].gain.value = rr
  }

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
    this.toneIn = this.buildToneStage()
    this.input.connect(this.toneIn)
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
    node.connect(this.toneIn)
    this.chainEnd = node
  }

  apply(t: MixerTrack, mutedBySolo: boolean): void {
    const prev = this.state
    this.state = t
    this.fader.gain.value = faderToGain(t.volume)
    this.pan.pan.value = t.pan
    this.muteGain.gain.value = t.muted || mutedBySolo ? 0 : t.phaseInvert ? -1 : 1
    if (!prev || prev.eq !== t.eq || prev.stereoSep !== t.stereoSep || prev.swapLR !== t.swapLR) {
      const e = t.eq ?? { lowFreq: 90, lowGain: 0, midFreq: 1400, midGain: 0, highFreq: 9000, highGain: 0 }
      this.applyTone({ low: [e.lowFreq, e.lowGain], mid: [e.midFreq, e.midGain], high: [e.highFreq, e.highGain], sep: t.stereoSep ?? 0, swap: !!t.swapLR })
    }
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

  clearSends(): void {
    for (const g of this.sends.values()) g.disconnect()
    this.sends.clear()
  }

  setSends(targets: Map<number, number>, strips: (MixerStrip | null)[], destination: AudioNode | null): void {
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

  invalidateRoute(): void {
    this.target = -2
  }

  route(strips: (MixerStrip | null)[], destination: AudioNode): void {
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
  readonly mixer: (MixerStrip | null)[] = []
  private usedTracks: Set<number> | null = null
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

    // Mixer. Only tracks that can carry audio get nodes (an idle FL project has 125 empty inserts and
    // building all of them overloads the audio thread).
    if (!prev || prev.mixer !== project.mixer || prev.channels !== project.channels) {
      const used = usedMixerTracks(project)
      const prevUsed = this.usedTracks
      const structural = !prevUsed || used.size !== prevUsed.size || [...used].some((i) => !prevUsed.has(i))
      this.usedTracks = used
      while (this.mixer.length < project.mixer.length) this.mixer.push(null)
      for (let i = 0; i < this.mixer.length; i++) {
        const want = used.has(i) && i < project.mixer.length
        if (want && !this.mixer[i]) this.mixer[i] = new MixerStrip(ctx, i)
        else if (!want && this.mixer[i]) {
          this.mixer[i]!.dispose()
          this.mixer[i] = null
        }
      }
      const soloed = project.mixer.filter((t) => t.solo).map((t) => t.index)
      const audible = soloed.length ? soloAudible(project.mixer, soloed) : null
      const soloDirty = !prev || soloChanged(prev, project)
      project.mixer.forEach((t, i) => {
        const strip = this.mixer[i]
        if (!strip) return
        if (prev && prev.mixer[i] === t && !soloDirty && strip.state) return
        strip.apply(t, audible ? !audible.has(i) : false)
      })
      project.mixer.forEach((t, i) => {
        const strip = this.mixer[i]
        if (!strip) return
        if (!structural && prev && prev.mixer[i]?.sends === t.sends && strip.sends.size) return
        if (structural) strip.clearSends()
        const targets = new Map<number, number>()
        if (i === 0) targets.set(-1, 1)
        else for (const sd of t.sends) if (sd.target !== i && this.mixer[sd.target]) targets.set(sd.target, sd.level)
        strip.setSends(targets, this.mixer, this.masterOut)
      })
      if (structural) for (const c of this.channels.values()) c.invalidateRoute()
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
      for (const strip of this.channels.values()) strip.route(this.mixer, this.mixer[0]?.input ?? this.masterOut)
      for (const [id, strip] of this.channels) {
        if (!seen.has(id)) {
          strip.dispose()
          this.channels.delete(id)
        }
      }
    }
    this.pushTempo(this.automatedTempo ?? project.tempo)
  }

  /**
   * Plugins that declare a hidden 'tempo' param (tempo-synced delays, LFOs) get the project tempo.
   * Sent only when it changes per node.
   */
  private tempoSent = new WeakMap<PluginHostNode, number>()
  /** Tempo set by tempo automation during playback (project edits mustn't reset synced plugins to the project tempo). */
  private automatedTempo: number | null = null
  /** Tempo automation: tempo-synced plugins switch to `tempo` at context time `at`. */
  scheduleTempo(tempo: number, at: number): void {
    this.automatedTempo = tempo
    this.pushTempo(tempo, at)
  }
  /** Playback stopped: tempo-synced plugins go back to the project tempo. */
  endTempoAutomation(projectTempo: number): void {
    this.automatedTempo = null
    this.pushTempo(projectTempo)
  }
  /** Send `tempo` now, or at context time `at`, to every plugin with a hidden 'tempo' param (only when it changed). */
  private pushTempo(tempo: number, at?: number): void {
    const send = (n: PluginHostNode | null) => {
      if (!n || this.tempoSent.get(n) === tempo) return
      this.tempoSent.set(n, tempo)
      if (!getPlugin(n.pluginId)?.manifest.params.some((p) => p.id === 'tempo' && p.hidden)) return
      if (at === undefined) n.setParam('tempo', tempo)
      else n.schedule([{ kind: 'param', time: at, id: 'tempo', value: tempo }])
    }
    for (const c of this.channels.values()) send(c.instrument)
    for (const m of this.mixer) if (m) for (let i = 0; i < m.slots.length; i++) send(m.getSlotPlugin(i))
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
    if (!extra.length) liveKeys.on(channelId, id, key)
    return id
  }

  noteOff(channelId: string, id: number, key: number): void {
    this.channels.get(channelId)?.instrument?.schedule([{ kind: 'off', time: 0, id, key, rel: 0.5 }])
    liveKeys.off(channelId, id)
  }

  panic(hard = true): void {
    liveKeys.clear()
    for (const ch of this.channels.values()) {
      ch.instrument?.clearScheduled()
      ch.instrument?.panic(hard)
    }
    if (hard) for (const m of this.mixer) if (m) for (const s of m.slots) s?.plugin.panic(true)
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
    for (const m of this.mixer) m?.dispose()
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

/** Mixer tracks that need audio nodes: master, channel targets, tracks with FX or armed, plus everything downstream. */
export function usedMixerTracks(p: Project): Set<number> {
  const used = new Set<number>([0])
  for (const c of p.channels) if (c.mixerTrack >= 0 && c.mixerTrack < p.mixer.length) used.add(c.mixerTrack)
  for (const t of p.mixer) if (t.armed || t.slots.some(Boolean)) used.add(t.index)
  const stack = [...used]
  while (stack.length) {
    const i = stack.pop()!
    for (const sd of p.mixer[i]?.sends ?? []) if (!used.has(sd.target)) {
      used.add(sd.target)
      stack.push(sd.target)
    }
  }
  return used
}
