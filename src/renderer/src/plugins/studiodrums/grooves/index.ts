// Groove library: genre → patterns (Intro, Grooves, Fills, Ending). Written as data with the step-grid DSL.
import type { GrooveGenre } from './dsl'
import { brushes, blues, jazz, waltz } from './jazz'
import { bossa, chacha, cumbia, latinRock, salsa, samba } from './latin'
import { disco, funk, hiphop, pop } from './pop'
import { hardRock, metal, punk, rock } from './rock'
import { country, march, reggae } from './world'

export * from './dsl'

export const GENRES: GrooveGenre[] = [
  rock,
  hardRock,
  metal,
  punk,
  pop,
  funk,
  disco,
  hiphop,
  jazz,
  brushes,
  blues,
  waltz,
  bossa,
  samba,
  salsa,
  chacha,
  cumbia,
  latinRock,
  reggae,
  country,
  march
]

export function findGroove(id: string): { genre: GrooveGenre; groove: GrooveGenre['grooves'][number] } | null {
  for (const genre of GENRES) for (const groove of genre.grooves) if (groove.id === id) return { genre, groove }
  return null
}
