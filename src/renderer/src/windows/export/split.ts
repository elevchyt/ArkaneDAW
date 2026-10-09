// Pure project transforms for split (stem) exports.
import type { Project } from '../../store/types'

export interface Stem {
  /** Name used in the file name (<base>_<name>.<ext>). */
  name: string
  /** Playlist track index (split playlist) or mixer insert index (split mixer). */
  index: number
}

/** Playlist tracks holding at least one unmuted pattern/audio clip (automation-only tracks make no sound of their own). */
export function playlistStems(p: Project): Stem[] {
  const out: Stem[] = []
  p.playlist.tracks.forEach((t, i) => {
    if (t.muted) return
    if (!p.playlist.clips.some((c) => c.track === i && !c.muted && c.kind !== 'automation')) return
    out.push({ name: t.name?.trim() || `Track ${i + 1}`, index: i })
  })
  return out
}

/**
 * Project copy where only `track`'s pattern/audio clips sound. Automation clips everywhere stay active so a
 * stem follows the same automation as the full mix.
 */
export function soloPlaylistTrack(p: Project, track: number): Project {
  return {
    ...p,
    playlist: {
      ...p.playlist,
      clips: p.playlist.clips.map((c) => (c.track === track || c.kind === 'automation' || c.muted ? c : { ...c, muted: true }))
    }
  }
}

/** Mixer stems: the master plus every used insert (index ≥ 1), named like FL ("Insert 3" when unnamed). */
export function mixerStems(p: Project, used: Iterable<number>): Stem[] {
  const out: Stem[] = [{ name: 'Master', index: 0 }]
  for (const i of [...used].filter((i) => i >= 1 && i < p.mixer.length).sort((a, b) => a - b)) {
    const t = p.mixer[i]
    const n = t.name?.trim()
    out.push({ name: n && n.toLowerCase() !== 'master' ? n : `Insert ${i}`, index: i })
  }
  return out
}
