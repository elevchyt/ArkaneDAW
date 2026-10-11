// Undoable mixer operations used by the Mixer window. Everything goes through editProject so
// knob/fader drags coalesce into one history step.
import { getExternalPluginInfo } from '@/audio/vst'
import { editProject, getProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { newPluginState } from '@/store/actions'
import { faderToGain, gainToDb } from '@/audio/engine'
import { getPlugin } from '@/plugins/registry'
import { uid, makeMixerTrack } from '@/store/factory'
import { MIXER_INSERTS, type MixerTrack, type Project } from '@/store/types'
import { openFxPlugin } from '@/windows/plugin/open'
import { useMixerView } from './state'

// ── formatting ──────────────────────────────────────────────────────────────────
export function fmtDb(db: number, digits = 1): string {
  return db === -Infinity || db < -200 ? '-inf dB' : `${db > 0 ? '+' : ''}${db.toFixed(digits)} dB`
}
export const volDb = (v: number): string => fmtDb(gainToDb(faderToGain(v)))
export const sendDb = (v: number): string => fmtDb(gainToDb(faderToGain(v, 1)))
export function fmtPan(p: number): string {
  const pc = Math.round(Math.abs(p) * 100)
  return pc === 0 ? 'Centered' : `${pc}% ${p < 0 ? 'left' : 'right'}`
}
export function fmtSep(s: number): string {
  const pc = Math.round(Math.abs(s) * 100)
  return pc === 0 ? 'Default' : s < 0 ? `${pc}% merged${pc === 100 ? ' (mono)' : ''}` : `${pc}% separated`
}
export function fmtHz(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz` : `${Math.round(f)} Hz`
}
export function trackLabel(t: Pick<MixerTrack, 'index' | 'name'>): string {
  if (t.index === 0) return t.name || 'Master'
  return t.name && t.name !== `Insert ${t.index}` ? `Insert ${t.index} (${t.name})` : `Insert ${t.index}`
}

// ── track properties ────────────────────────────────────────────────────────────
export function setTrack(i: number, patch: Partial<MixerTrack>, label: string, key?: string): void {
  editProject(label, (d) => {
    const t = d.mixer[i]
    if (t) Object.assign(t, patch)
  }, { coalesceKey: key })
}

export function setTracks(ids: number[], patch: Partial<MixerTrack>, label: string, key?: string): void {
  editProject(label, (d) => {
    for (const i of ids) if (d.mixer[i]) Object.assign(d.mixer[i], patch)
  }, { coalesceKey: key })
}

export function setEq(i: number, patch: Partial<MixerTrack['eq']>, key: string): void {
  editProject('Change mixer EQ', (d) => {
    const t = d.mixer[i]
    if (t) Object.assign(t.eq, patch)
  }, { coalesceKey: `mx:${i}:eq:${key}` })
}

export function resetTrack(i: number): void {
  editProject('Reset mixer track', (d) => {
    const fresh = makeMixerTrack(i)
    const t = d.mixer[i]
    if (!t) return
    // name and color go back to the defaults too; only effects and routing survive
    Object.assign(t, { ...fresh, id: t.id, sends: t.sends, slots: t.slots })
  })
}

// ── mute / solo ────────────────────────────────────────────────────────────────
export function toggleMute(i: number): void {
  const t = getProject().mixer[i]
  if (t) setTrack(i, { muted: !t.muted }, t.muted ? 'Unmute mixer track' : 'Mute mixer track')
}

/** FL solo: solo this track alone; soloing an already-solo'd track unsolos everything. */
export function soloTrack(i: number, additive = false): void {
  const p = getProject()
  const t = p.mixer[i]
  if (!t || i === 0) return
  const soloed = p.mixer.filter((m) => m.solo).map((m) => m.index)
  editProject('Solo mixer track', (d) => {
    if (additive) {
      d.mixer[i].solo = !t.solo
      d.mixer[i].muted = false
      return
    }
    const only = t.solo && soloed.length === 1
    for (const m of d.mixer) if (m.solo) m.solo = false
    if (!only) {
      d.mixer[i].solo = true
      d.mixer[i].muted = false
    }
  })
}

/** Alt-solo: solo the track together with every track routed into it. */
export function soloWithSources(i: number): void {
  const p = getProject()
  if (i === 0) return
  const set = new Set<number>([i])
  const up = (k: number) => {
    for (const m of p.mixer) if (!set.has(m.index) && m.index !== 0 && m.sends.some((s) => s.target === k)) {
      set.add(m.index)
      up(m.index)
    }
  }
  up(i)
  const already = p.mixer[i].solo
  editProject('Solo mixer track', (d) => {
    for (const m of d.mixer) m.solo = !already && set.has(m.index)
  })
}

export function unmuteAll(): void {
  editProject('Unmute all mixer tracks', (d) => {
    for (const m of d.mixer) {
      m.muted = false
      m.solo = false
    }
  })
}

/** Tracks that are audible given the current solo state (null = no solo active). */
export function soloAudible(mixer: MixerTrack[]): Set<number> | null {
  const soloed = mixer.filter((t) => t.solo).map((t) => t.index)
  if (!soloed.length) return null
  const out = new Set<number>([0, ...soloed])
  const down = (i: number) => {
    for (const s of mixer[i]?.sends ?? []) if (!out.has(s.target)) {
      out.add(s.target)
      down(s.target)
    }
  }
  const up = (i: number) => {
    for (const t of mixer) if (!out.has(t.index) && t.sends.some((s) => s.target === i)) {
      out.add(t.index)
      up(t.index)
    }
  }
  for (const s of soloed) {
    down(s)
    up(s)
  }
  return out
}

// ── routing ───────────────────────────────────────────────────────────────────
/** Would routing from → to create a feedback loop? */
export function createsLoop(p: Project, from: number, to: number): boolean {
  if (from === to) return true
  const seen = new Set<number>()
  const stack = [to]
  while (stack.length) {
    const k = stack.pop()!
    if (k === from) return true
    if (seen.has(k)) continue
    seen.add(k)
    for (const s of p.mixer[k]?.sends ?? []) stack.push(s.target)
  }
  return false
}

export function toggleSend(from: number, to: number): void {
  const p = getProject()
  const src = p.mixer[from]
  if (!src || from === 0 || from === to) return
  const has = src.sends.some((s) => s.target === to)
  if (!has && createsLoop(p, from, to)) {
    useUI.getState().setHint(`Can't route ${trackLabel(src)} to ${trackLabel(p.mixer[to])}: feedback loop`)
    return
  }
  editProject(has ? 'Remove mixer route' : 'Route mixer track', (d) => {
    const t = d.mixer[from]
    if (has) t.sends = t.sends.filter((s) => s.target !== to)
    else t.sends.push({ target: to, level: 1 })
  })
}

export function routeOnly(from: number, to: number): void {
  const p = getProject()
  if (from === 0 || from === to || !p.mixer[from]) return
  if (createsLoop({ ...p, mixer: p.mixer.map((m, i) => (i === from ? { ...m, sends: [] } : m)) }, from, to)) {
    useUI.getState().setHint('Routing would create a feedback loop')
    return
  }
  editProject('Route to this track only', (d) => {
    d.mixer[from].sends = [{ target: to, level: 1 }]
  })
}

export function routeOnlyMany(froms: number[], to: number): void {
  editProject('Route to this track only', (d) => {
    for (const f of froms) {
      if (f === 0 || f === to) continue
      d.mixer[f].sends = [{ target: to, level: 1 }]
    }
  })
}

export function setSendLevel(from: number, to: number, level: number): void {
  editProject('Change send level', (d) => {
    const s = d.mixer[from]?.sends.find((x) => x.target === to)
    if (s) s.level = level
  }, { coalesceKey: `mx:${from}:send:${to}` })
}

// ── channel linking ─────────────────────────────────────────────────────────────
/** Ctrl+L: link selected channels to the track. Ctrl+Shift+L: one channel per track starting here. */
export function linkChannels(track: number, startingFrom: boolean): void {
  const ids = useUI.getState().selectedChannels
  if (!ids.length) {
    useUI.getState().setHint('Select channels in the Channel rack first')
    return
  }
  editProject(startingFrom ? 'Link channels starting from this track' : 'Link channels to this track', (d) => {
    let n = track
    for (const id of ids) {
      const c = d.channels.find((x) => x.id === id)
      if (!c) continue
      const target = startingFrom ? Math.min(n++, MIXER_INSERTS) : track
      c.mixerTrack = target
      const t = d.mixer[target]
      if (target > 0 && t && (startingFrom || ids.length === 1) && t.name === `Insert ${target}`) {
        t.name = c.name
        t.color = c.color
      }
    }
  })
}

// ── FX slots ───────────────────────────────────────────────────────────────────
export function insertEffect(track: number, slot: number, pluginId: string): void {
  const kind = getPlugin(pluginId)?.manifest.kind ?? getExternalPluginInfo(pluginId)?.kind
  if (kind !== 'effect') {
    useUI.getState().setHint(`${pluginId} is not an effect`)
    return
  }
  editProject('Add effect', (d) => {
    const t = d.mixer[track]
    if (t) t.slots[slot] = { id: uid(), plugin: newPluginState(pluginId), enabled: true, mix: 1 }
  })
}

/** Drop an effect on a strip: first free slot. */
export function addEffectToTrack(track: number, pluginId: string): number {
  const t = getProject().mixer[track]
  const free = t ? t.slots.findIndex((s) => !s) : -1
  if (free >= 0) insertEffect(track, free, pluginId)
  return free
}

/** Put an effect in a slot (menu pick / drop) and open its editor, like FL does. */
export function insertEffectAndOpen(track: number, slot: number, pluginId: string): void {
  insertEffect(track, slot, pluginId)
  if (getProject().mixer[track]?.slots[slot]?.plugin.pluginId === pluginId) openFxPlugin(track, slot)
}

/** Drop an effect on a strip: first free slot, then open its editor. */
export function addEffectAndOpen(track: number, pluginId: string): number {
  const slot = addEffectToTrack(track, pluginId)
  if (slot >= 0 && getProject().mixer[track]?.slots[slot]?.plugin.pluginId === pluginId) openFxPlugin(track, slot)
  return slot
}

export function deleteSlot(track: number, slot: number): void {
  useUI.getState().closeWindow(`fx:${track}:${slot}`)
  editProject('Remove effect', (d) => {
    const t = d.mixer[track]
    if (t) t.slots[slot] = null
  })
}

export function setSlot(track: number, slot: number, patch: { enabled?: boolean; mix?: number }, label: string, key?: string): void {
  editProject(label, (d) => {
    const s = d.mixer[track]?.slots[slot]
    if (s) Object.assign(s, patch)
  }, { coalesceKey: key })
}

/** Move a slot to another position (swap). Keeps open editor windows pointing at the right slot. */
export function moveSlot(track: number, from: number, to: number): void {
  if (from === to) return
  const t = getProject().mixer[track]
  if (!t || to < 0 || to >= t.slots.length) return
  editProject('Move effect', (d) => {
    const s = d.mixer[track].slots
    ;[s[from], s[to]] = [s[to], s[from]]
  })
  const ui = useUI.getState()
  const a = ui.windows[`fx:${track}:${from}`]?.open
  const b = ui.windows[`fx:${track}:${to}`]?.open
  if (a) ui.closeWindow(`fx:${track}:${from}`)
  if (b) ui.closeWindow(`fx:${track}:${to}`)
}

// ── track order ────────────────────────────────────────────────────────────────
/** Swap two insert tracks including routing, channel links and automation targets (Alt+←/→). */
export function swapTracks(a: number, b: number): void {
  if (a === b || a <= 0 || b <= 0 || a > MIXER_INSERTS || b > MIXER_INSERTS) return
  const map = (k: number) => (k === a ? b : k === b ? a : k)
  editProject('Move mixer track', (d) => {
    const ta = d.mixer[a]
    const tb = d.mixer[b]
    d.mixer[a] = tb
    d.mixer[b] = ta
    d.mixer[a].index = a
    d.mixer[b].index = b
    for (const t of [d.mixer[a], d.mixer[b]]) {
      if (t.name === `Insert ${b === t.index ? a : b}`) t.name = `Insert ${t.index}`
    }
    for (const t of d.mixer) for (const s of t.sends) s.target = map(s.target)
    for (const c of d.channels) c.mixerTrack = map(c.mixerTrack)
    for (const au of d.automations) {
      const tg = au.target
      if (tg && (tg.kind === 'mixer' || tg.kind === 'mixerFx' || tg.kind === 'mixerFxMix')) tg.track = map(tg.track)
    }
  })
  const ui = useUI.getState()
  for (const id of Object.keys(ui.windows)) {
    if (id.startsWith(`fx:${a}:`) || id.startsWith(`fx:${b}:`)) ui.closeWindow(id)
  }
}

/** First insert that nothing uses yet (no linked channels, default name, no FX, default routing). */
export function firstFreeInsert(after = 0): number {
  const p = getProject()
  const used = new Set(p.channels.map((c) => c.mixerTrack))
  for (const t of p.mixer) {
    if (t.index <= after || used.has(t.index)) continue
    if (t.name !== `Insert ${t.index}` || t.slots.some(Boolean)) continue
    if (p.mixer.some((m) => m.sends.some((s) => s.target === t.index))) continue
    return t.index
  }
  return -1
}

// ── selection ─────────────────────────────────────────────────────────────────
export function selectTrack(i: number, mode: 'set' | 'toggle' | 'range' = 'set'): void {
  const ui = useUI.getState()
  const view = useMixerView.getState()
  const cur = ui.selectedMixerTrack
  if (mode === 'toggle') {
    const set = new Set(view.multi.length ? view.multi : [cur])
    if (set.has(i) && set.size > 1) set.delete(i)
    else set.add(i)
    view.set({ multi: [...set].sort((x, y) => x - y) })
    ui.set({ selectedMixerTrack: i })
    return
  }
  if (mode === 'range') {
    const lo = Math.min(cur, i)
    const hi = Math.max(cur, i)
    view.set({ multi: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) })
    ui.set({ selectedMixerTrack: i })
    return
  }
  view.set({ multi: [] })
  ui.set({ selectedMixerTrack: i })
}

/** Selected tracks: the multi-selection if any, else the current one. */
export function selectedTracks(): number[] {
  const m = useMixerView.getState().multi
  return m.length ? m : [useUI.getState().selectedMixerTrack]
}
