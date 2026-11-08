// Playlist pattern clips follow their pattern when it grows (FL: a clip showing the whole pattern stays whole).
import { patternLength } from '@/audio/sequence'
import type { Project } from './types'

/**
 * Compare two project states: for every pattern that got longer, return a recipe that stretches the playlist
 * clips still showing that whole pattern (offset 0, length = the old pattern length). Clips cut shorter,
 * slipped or stretched past it by the user are left alone. Null when nothing needs to change.
 */
export function growPatternClips(prev: Project, next: Project): ((draft: Project) => void) | null {
  if (prev.patterns === next.patterns) return null
  const before = new Map(prev.patterns.map((p) => [p.id, p]))
  const grown = new Map<string, { from: number; to: number }>()
  for (const p of next.patterns) {
    const old = before.get(p.id)
    if (!old || old === p) continue
    const from = patternLength(old, prev)
    const to = patternLength(p, next)
    if (to > from) grown.set(p.id, { from, to })
  }
  if (!grown.size) return null
  const hits = next.playlist.clips.some((c) => c.kind === 'pattern' && c.offset === 0 && grown.get(c.ref)?.from === c.length)
  if (!hits) return null
  return (draft) => {
    for (const c of draft.playlist.clips) {
      const g = c.kind === 'pattern' && c.offset === 0 ? grown.get(c.ref) : undefined
      if (g && c.length === g.from) c.length = g.to
    }
  }
}
