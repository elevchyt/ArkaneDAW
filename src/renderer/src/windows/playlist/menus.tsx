// Menus for clips, tracks and automation targets.
import { getProject, editProject } from '@/store/project'
import type { AutomationTarget, Clip } from '@/store/types'
import { getPlugin } from '@/plugins/registry'
import { barTicks } from '@/audio/sequence'
import { clonePattern, deletePattern } from '@/store/actions'
import { colorItem, openMenu, type MenuItem } from './PopupMenu'
import { askText } from './Prompt'
import {
  colorClipSource,
  commitClips,
  createAutomationClip,
  deleteAutomation,
  deleteClips,
  deleteTrack,
  insertTrack,
  makeUnique,
  renameClipSource,
  selectSource,
  setClipsMuted,
  soloTrack,
  sourceColor,
  sourceName,
  updateTrack
} from './actions'
import { chopClip } from './ops'
import { uid } from '@/store/factory'
import { getPl, setSelection } from './state'
import { openPatternEditor } from './open'

type Pt = { clientX: number; clientY: number }

/** FL clip menu (opened from the clip's top-left arrow). */
export function openClipMenu(e: Pt, clip: Clip): void {
  const p = getProject()
  const name = sourceName(p, clip)
  const bar = barTicks(p)
  const items: MenuItem[] = [
    {
      label: 'Rename...',
      onSelect: () => void askText('Rename', name, e).then((v) => v && renameClipSource(clip, v))
    },
    { label: 'Color', items: [colorItem(sourceColor(p, clip, clip.channelId), (c) => colorClipSource(clip, c))] },
    { separator: true },
    { label: 'Make unique', disabled: clip.kind === 'audio', onSelect: () => makeUnique(clip.id) },
    {
      label: 'Chop',
      items: [
        { label: 'Every bar', onSelect: () => chop(clip, bar) },
        { label: 'Every 2 bars', onSelect: () => chop(clip, bar * 2) },
        { label: 'Every 4 bars', onSelect: () => chop(clip, bar * 4) },
        { label: 'Every beat', onSelect: () => chop(clip, bar / getProject().timeSig[0]) }
      ]
    },
    { label: 'Select source clips', hint: 'Shift+C', onSelect: () => selectBySource([clip]) },
    { separator: true },
    { label: clip.muted ? 'Unmute' : 'Mute', checked: clip.muted, onSelect: () => setClipsMuted(new Set([clip.id]), 'toggle', clip.muted ? 'Unmute clip' : 'Mute clip') },
    { label: 'Delete', onSelect: () => deleteClips(new Set([clip.id]), 'Delete clip') }
  ]
  if (clip.kind === 'pattern') items.unshift({ label: 'Open in channel rack', onSelect: () => openPatternEditor(clip.ref) }, { separator: true })
  openMenu(e, items, name)
}

function chop(clip: Clip, size: number): void {
  const before = getProject().playlist.clips
  const parts = chopClip(clip, size, uid)
  if (parts.length < 2) return
  commitClips('Chop clip', before, before.flatMap((c) => (c.id === clip.id ? parts : [c])))
}

export function selectBySource(of: readonly Clip[]): void {
  const keys = new Set(of.map((c) => `${c.kind}:${c.ref}`))
  setSelection(getProject().playlist.clips.filter((c) => keys.has(`${c.kind}:${c.ref}`)).map((c) => c.id))
}

/** Automation targets: channels (vol/pan/pitch + plugin params), mixer tracks, main volume. */
export function automationTargetItems(onPick: (t: AutomationTarget) => void): MenuItem[] {
  const p = getProject()
  const chans: MenuItem[] = p.channels
    .filter((c) => c.kind !== 'automation')
    .map((ch) => {
      const params = ch.plugin ? (getPlugin(ch.plugin.pluginId)?.manifest.params ?? []) : []
      const sub: MenuItem[] = [
        { label: 'Volume', onSelect: () => onPick({ kind: 'channel', channelId: ch.id, param: 'volume' }) },
        { label: 'Panning', onSelect: () => onPick({ kind: 'channel', channelId: ch.id, param: 'pan' }) },
        { label: 'Pitch', onSelect: () => onPick({ kind: 'channel', channelId: ch.id, param: 'pitch' }) }
      ]
      if (params.length) {
        sub.push({ separator: true })
        for (const def of params) sub.push({ label: def.name, onSelect: () => onPick({ kind: 'channelPlugin', channelId: ch.id, paramId: def.id }) })
      }
      return { label: ch.name, items: sub }
    })
  const used = new Set(p.channels.map((c) => c.mixerTrack))
  const mix: MenuItem[] = p.mixer
    .filter((m) => m.index === 0 || used.has(m.index) || m.slots.some(Boolean) || m.index <= 8)
    .map((m) => ({
      label: m.index === 0 ? 'Master' : `${m.index} - ${m.name}`,
      items: [
        { label: 'Volume', onSelect: () => onPick({ kind: 'mixer', track: m.index, param: 'volume' }) },
        { label: 'Panning', onSelect: () => onPick({ kind: 'mixer', track: m.index, param: 'pan' }) }
      ]
    }))
  return [
    { label: 'Channels', items: chans.length ? chans : [{ label: '(no channels)', disabled: true }] },
    { label: 'Mixer', items: mix },
    { label: 'Main volume', onSelect: () => onPick({ kind: 'masterVolume' }) }
  ]
}

/** Track header right-click menu. */
export function openTrackMenu(e: Pt, i: number): void {
  const p = getProject()
  const t = p.playlist.tracks[i]
  if (!t) return
  const items: MenuItem[] = [
    { label: 'Rename...', onSelect: () => void askText('Track name', t.name, e).then((v) => v && updateTrack(i, { name: v }, 'Rename track')) },
    { label: 'Color', items: [colorItem(t.color, (c) => updateTrack(i, { color: c }, 'Track color'))] },
    { separator: true },
    { label: 'Mute', checked: t.muted, onSelect: () => updateTrack(i, { muted: !t.muted }, 'Mute track') },
    { label: 'Solo', onSelect: () => soloTrack(i) },
    { label: 'Lock', checked: t.locked, onSelect: () => updateTrack(i, { locked: !t.locked }, 'Lock track') },
    {
      label: 'Size',
      items: [
        { label: 'Small', onSelect: () => updateTrack(i, { height: 30 }, 'Track size') },
        { label: 'Medium', onSelect: () => updateTrack(i, { height: 52 }, 'Track size') },
        { label: 'Large', onSelect: () => updateTrack(i, { height: 90 }, 'Track size') },
        { label: 'Huge', onSelect: () => updateTrack(i, { height: 150 }, 'Track size') }
      ]
    },
    { separator: true },
    { label: 'Select all clips', onSelect: () => setSelection(getProject().playlist.clips.filter((c) => c.track === i).map((c) => c.id)) },
    { label: 'Add automation clip', items: automationTargetItems((target) => createAutomationClip(target, i, getPl().timeSel ?? undefined)) },
    { separator: true },
    { label: 'Insert one', onSelect: () => insertTrack(i) },
    { label: 'Delete one', onSelect: () => deleteTrack(i) },
    {
      label: 'Reset name & color',
      onSelect: () => updateTrack(i, { name: `Track ${i + 1}`, color: '#5f6e77' }, 'Reset track')
    }
  ]
  openMenu(e, items, t.name)
}

/** Picker panel item menu. */
export function openPickerMenu(e: Pt, kind: 'pattern' | 'audio' | 'automation', id: string): void {
  const p = getProject()
  if (kind === 'pattern') {
    const pat = p.patterns.find((x) => x.id === id)
    if (!pat) return
    openMenu(
      e,
      [
        { label: 'Open in channel rack', onSelect: () => openPatternEditor(id) },
        {
          label: 'Rename...',
          onSelect: () =>
            void askText('Pattern name', pat.name, e).then((v) => v && editProject('Rename pattern', (d) => void (d.patterns.find((x) => x.id === id)!.name = v)))
        },
        { label: 'Color', items: [colorItem(pat.color, (c) => editProject('Pattern color', (d) => void (d.patterns.find((x) => x.id === id)!.color = c)))] },
        { label: 'Clone', onSelect: () => clonePattern(id) },
        { separator: true },
        { label: 'Delete', onSelect: () => deletePattern(id) }
      ],
      pat.name
    )
  } else if (kind === 'automation') {
    const a = p.automations.find((x) => x.id === id)
    if (!a) return
    openMenu(
      e,
      [
        {
          label: 'Rename...',
          onSelect: () => void askText('Automation name', a.name, e).then((v) => v && editProject('Rename automation', (d) => void (d.automations.find((x) => x.id === id)!.name = v)))
        },
        { label: 'Color', items: [colorItem(a.color, (c) => editProject('Automation color', (d) => void (d.automations.find((x) => x.id === id)!.color = c)))] },
        { label: 'Select in playlist', onSelect: () => selectSource({ kind: 'automation', ref: id }) },
        { separator: true },
        { label: 'Delete', onSelect: () => deleteAutomation(id) }
      ],
      a.name
    )
  } else {
    const s = p.samples.find((x) => x.id === id)
    if (!s) return
    openMenu(
      e,
      [
        { label: 'Select source clips', onSelect: () => selectBySource([{ kind: 'audio', ref: id } as Clip]) },
        {
          label: 'Delete from pool',
          disabled: p.playlist.clips.some((c) => c.kind === 'audio' && c.ref === id),
          onSelect: () => editProject('Delete sample', (d) => void (d.samples = d.samples.filter((x) => x.id !== id)))
        }
      ],
      s.name
    )
  }
}
