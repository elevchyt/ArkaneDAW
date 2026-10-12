// Fretboard logic: which string (and so which fret) plays each note, the way a guitarist would finger it.
// Pure functions (unit-tested); the DSP keeps one note per string, so a new note on a ringing string cuts it
// off exactly like on a real guitar.
import { MAX_FRET, STRINGS } from './manifest'

export interface StringInfo {
  /** a held note owns the string (cutting it would be audible) */
  held: boolean
  /** the string is still ringing (let it ring for arpeggios if possible) */
  ringing: boolean
}

/**
 * Best string for a single note. `hand` = current fretting-hand position (fret). Returns the string index,
 * or the nearest string when the note is outside the instrument's range.
 */
export function chooseString(key: number, open: readonly number[], state: readonly StringInfo[], hand: number, avoid = -1): number {
  let best = -1
  let bestCost = Infinity
  for (let s = 0; s < STRINGS; s++) {
    const fret = key - open[s]
    if (fret < 0 || fret > MAX_FRET) continue
    let cost = fret === 0 ? 1.2 + hand * 0.08 : Math.abs(fret - hand) + fret * 0.12
    if (fret > 0 && Math.abs(fret - hand) > 4) cost += (Math.abs(fret - hand) - 4) * 1.5
    if (state[s].held) cost += 40
    if (state[s].ringing) cost += 3
    if (s === avoid) cost += 25
    if (cost < bestCost) {
      bestCost = cost
      best = s
    }
  }
  if (best >= 0) return best
  return key < open[0] ? 0 : STRINGS - 1
}

const combo = new Int8Array(STRINGS)

/**
 * Voice a chord (keys ascending, ≤ 6): each note on its own string, lower notes on lower strings, minimising
 * the fretting-hand stretch and staying near `hand`. Writes string indices to `out` (‑1 = could not be placed:
 * the caller plays it on the nearest string). Returns the new hand position.
 */
export function assignChord(keys: readonly number[], open: readonly number[], hand: number, out: Int8Array): number {
  const n = Math.min(keys.length, STRINGS)
  for (let i = 0; i < keys.length; i++) out[i] = -1
  let bestCost = Infinity
  let bestHand = hand
  const search = (i: number, from: number, cost: number, lo: number, hi: number, sum: number, cnt: number): void => {
    if (cost >= bestCost) return
    if (i === n) {
      const span = cnt ? hi - lo : 0
      let c = cost + span * 1.2 + (span > 4 ? (span - 4) * 8 : 0)
      const avg = cnt ? sum / cnt : hand
      c += Math.abs(avg - hand) * 0.25
      if (c < bestCost) {
        bestCost = c
        for (let k = 0; k < n; k++) out[k] = combo[k]
        bestHand = cnt ? avg : hand
      }
      return
    }
    // leave room for the remaining notes on higher strings
    for (let s = from; s <= STRINGS - (n - i); s++) {
      const fret = keys[i] - open[s]
      if (fret < 0 || fret > MAX_FRET) continue
      combo[i] = s
      if (fret === 0) search(i + 1, s + 1, cost + 0.3, lo, hi, sum, cnt)
      else search(i + 1, s + 1, cost + fret * 0.15, Math.min(lo, fret), Math.max(hi, fret), sum + fret, cnt + 1)
    }
  }
  search(0, 0, 0, 99, -1, 0, 0)
  return bestHand
}
