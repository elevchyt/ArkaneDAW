// Pure MIDI helpers (parsing, sustain-pedal bookkeeping) shared by audio/midi.ts and tests.

export type MidiMessage =
  | { type: 'on'; ch: number; key: number; vel: number } // vel 0..1 (never 0: that's an off)
  | { type: 'off'; ch: number; key: number; vel: number }
  | { type: 'cc'; ch: number; cc: number; value: number } // value 0..127
  | { type: 'bend'; ch: number; value: number } // -1..1
  | { type: 'pressure'; ch: number; value: number } // channel aftertouch 0..1
  | { type: 'other' }

export function parseMidi(data: ArrayLike<number>): MidiMessage {
  if (!data || data.length < 1) return { type: 'other' }
  const status = data[0] & 0xf0
  const ch = data[0] & 0x0f
  const d1 = data[1] ?? 0
  const d2 = data[2] ?? 0
  switch (status) {
    case 0x90:
      return d2 === 0 ? { type: 'off', ch, key: d1, vel: 0.5 } : { type: 'on', ch, key: d1, vel: d2 / 127 }
    case 0x80:
      return { type: 'off', ch, key: d1, vel: d2 / 127 }
    case 0xb0:
      return { type: 'cc', ch, cc: d1, value: d2 }
    case 0xe0:
      return { type: 'bend', ch, value: Math.max(-1, Math.min(1, ((d2 << 7) | d1) / 8192 - 1)) }
    case 0xd0:
      return { type: 'pressure', ch, value: d1 / 127 }
    default:
      return { type: 'other' }
  }
}

/** Pitch-wheel position (-1..1) to semitones for a ±range bend. */
export const bendSemitones = (value: number, range = 2): number => value * range

/**
 * Tracks sounding voices per key with sustain-pedal (CC64) note-off deferral.
 * Every method returns the voices whose note-off should be sent *now*.
 */
export class SustainTracker<V> {
  private held = new Map<string, V>()
  private sustained = new Map<string, V[]>()
  pedal = false

  /** A key went down. A voice of the same key still ringing under the pedal is released first. */
  press(key: string, voice: V): V[] {
    const out: V[] = []
    const prevHeld = this.held.get(key)
    if (prevHeld !== undefined) out.push(prevHeld)
    const s = this.sustained.get(key)
    if (s) {
      out.push(...s)
      this.sustained.delete(key)
    }
    this.held.set(key, voice)
    return out
  }

  /** A key went up: released now, or kept ringing while the pedal is down. */
  release(key: string): V[] {
    const v = this.held.get(key)
    if (v === undefined) return []
    this.held.delete(key)
    if (this.pedal) {
      const list = this.sustained.get(key) ?? []
      list.push(v)
      this.sustained.set(key, list)
      return []
    }
    return [v]
  }

  /** Pedal down/up. Lifting the pedal releases every sustained (not physically held) voice. */
  setPedal(down: boolean): V[] {
    this.pedal = down
    if (down) return []
    const out: V[] = []
    for (const l of this.sustained.values()) out.push(...l)
    this.sustained.clear()
    return out
  }

  /** Release everything (panic / all notes off / device unplugged). */
  releaseAll(): V[] {
    const out = [...this.held.values()]
    for (const l of this.sustained.values()) out.push(...l)
    this.held.clear()
    this.sustained.clear()
    return out
  }

  get size(): number {
    let n = this.held.size
    for (const l of this.sustained.values()) n += l.length
    return n
  }
}

/** MIDI note velocity → 0..1 with an optional curve (FL "Link note on velocity" curve, simplified). */
export function velocityCurve(v: number, curve: number): number {
  // curve -1..1: <0 softer (more effort for loud), >0 harder
  const x = Math.max(0, Math.min(1, v))
  if (Math.abs(curve) < 0.001) return x
  return Math.pow(x, Math.pow(2, -curve * 1.5))
}
