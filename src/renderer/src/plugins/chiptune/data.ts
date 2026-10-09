// Opaque `data` of a Chiptune instance: MML/Famitracker-style sequences, the Game Boy wave table and
// per-drum tweaks. Pure data + helpers, safe to import from the AudioWorklet and the UI.

/** A step sequence. `loop`/`release` are step indices or -1 (none). */
export interface Seq {
  values: number[]
  loop: number
  release: number
}

export interface DrumTweak {
  /** semitones */
  tune: number
  /** decay multiplier (0.25..4) */
  decay: number
  /** level 0..1.5 */
  level: number
}

export interface ChipData {
  vol: Seq
  pitch: Seq
  duty: Seq
  /** Game Boy wave RAM: 32 samples, 0..15 */
  wave: number[]
  /** Keyed by MIDI key (string in JSON). */
  drums: Record<string, DrumTweak>
}

export const SEQ_MAX = 64
export const SEQ_RANGES = {
  vol: { min: 0, max: 15 },
  pitch: { min: -12, max: 12 },
  duty: { min: 0, max: 3 }
} as const
export type SeqKind = keyof typeof SEQ_RANGES

export const WAVE_PRESETS: Record<string, number[]> = {
  Sine: Array.from({ length: 32 }, (_, i) => Math.round(7.5 + 7.5 * Math.sin((i / 32) * Math.PI * 2))),
  Saw: Array.from({ length: 32 }, (_, i) => Math.floor(i / 2)),
  Square: Array.from({ length: 32 }, (_, i) => (i < 16 ? 15 : 0)),
  Triangle: Array.from({ length: 32 }, (_, i) => (i < 16 ? i : 31 - i)),
  'Pulse 25': Array.from({ length: 32 }, (_, i) => (i < 8 ? 15 : 0)),
  Organ: Array.from({ length: 32 }, (_, i) => {
    const t = (i / 32) * Math.PI * 2
    return Math.round(7.5 + 3.8 * Math.sin(t) + 2.4 * Math.sin(2 * t) + 1.3 * Math.sin(4 * t))
  }),
  Bass: [0, 2, 5, 8, 11, 13, 15, 15, 14, 13, 12, 10, 9, 8, 8, 7, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0],
  Growl: [15, 15, 14, 12, 15, 9, 13, 7, 11, 6, 10, 4, 8, 3, 6, 1, 0, 2, 1, 4, 2, 6, 4, 8, 5, 10, 7, 12, 9, 13, 12, 14]
}

export const seq = (values: number[], loop = -1, release = -1): Seq => ({ values, loop, release })

export function defaultChipData(): ChipData {
  return {
    vol: seq([15, 14, 13, 12, 11, 10, 9, 8], 7),
    pitch: seq([0]),
    duty: seq([2]),
    wave: WAVE_PRESETS.Sine.slice(),
    drums: {}
  }
}

const clampInt = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d
  return n < lo ? lo : n > hi ? hi : n
}

function normSeq(s: unknown, kind: SeqKind, fallback: Seq): Seq {
  const r = SEQ_RANGES[kind]
  const o = (s && typeof s === 'object' ? s : {}) as Partial<Seq>
  const vals = Array.isArray(o.values) && o.values.length ? o.values.slice(0, SEQ_MAX) : fallback.values
  const values = vals.map((v) => clampInt(v, r.min, r.max, 0))
  const n = values.length
  let loop = clampInt(o.loop, -1, n - 1, fallback.loop < n ? fallback.loop : -1)
  const release = clampInt(o.release, -1, n - 1, fallback.release < n ? fallback.release : -1)
  if (o.loop === undefined && fallback.loop >= n) loop = -1
  return { values, loop, release }
}

/** Sanitize unknown JSON into a complete ChipData (missing parts take defaults). */
export function normalizeData(d: unknown): ChipData {
  const def = defaultChipData()
  const o = (d && typeof d === 'object' ? d : {}) as Partial<ChipData>
  const wave = Array.isArray(o.wave) && o.wave.length === 32 ? o.wave.map((v) => clampInt(v, 0, 15, 8)) : def.wave
  const drums: Record<string, DrumTweak> = {}
  if (o.drums && typeof o.drums === 'object') {
    for (const [k, t] of Object.entries(o.drums)) {
      if (!t || typeof t !== 'object') continue
      const x = t as Partial<DrumTweak>
      drums[k] = {
        tune: typeof x.tune === 'number' && Number.isFinite(x.tune) ? Math.max(-24, Math.min(24, x.tune)) : 0,
        decay: typeof x.decay === 'number' && x.decay > 0 ? Math.max(0.25, Math.min(4, x.decay)) : 1,
        level: typeof x.level === 'number' && x.level >= 0 ? Math.min(1.5, x.level) : 1
      }
    }
  }
  return {
    vol: normSeq(o.vol, 'vol', def.vol),
    pitch: normSeq(o.pitch, 'pitch', def.pitch),
    duty: normSeq(o.duty, 'duty', def.duty),
    wave,
    drums
  }
}

/**
 * Advance a sequence index by one step (Famitracker semantics):
 * while held, playback stops at the release point (looping back to `loop` if loop <= release);
 * after release it continues past the release point and loops at `loop` only if loop > release.
 */
export function seqNext(idx: number, len: number, loop: number, release: number, released: boolean): number {
  if (!released && release >= 0 && idx >= release) return loop >= 0 && loop <= release ? loop : release
  const next = idx + 1
  if (next < len) return next
  if (loop >= 0 && (release < 0 || loop > release || !released)) return loop
  return len - 1
}

/** True once a released sequence sits on its final step for good. */
export function seqFinished(idx: number, len: number, loop: number, release: number, released: boolean): boolean {
  if (idx < len - 1) return false
  if (loop >= 0 && (release < 0 || loop > release)) return false
  return released || release < 0
}
