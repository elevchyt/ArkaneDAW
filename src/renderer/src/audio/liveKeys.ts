// Keys currently held by the user on each channel (typing keyboard, MIDI controller, piano roll keys,
// on-screen plugin keyboards). Fed by AudioEngine.noteOn/noteOff so plugin editors can light up
// their own keyboards for any live input, not only for mouse clicks on them.

type Listener = (keys: ReadonlySet<number>) => void

/** channelId → note id → key (ids, so the same key held from two sources is counted twice). */
const held = new Map<string, Map<number, number>>()
const listeners = new Map<string, Set<Listener>>()
const EMPTY: ReadonlySet<number> = new Set()

function keysOf(channelId: string): ReadonlySet<number> {
  const m = held.get(channelId)
  return m && m.size ? new Set(m.values()) : EMPTY
}

function emit(channelId: string): void {
  const ls = listeners.get(channelId)
  if (!ls?.size) return
  const keys = keysOf(channelId)
  for (const l of ls) l(keys)
}

export const liveKeys = {
  on(channelId: string, id: number, key: number): void {
    let m = held.get(channelId)
    if (!m) held.set(channelId, (m = new Map()))
    m.set(id, key)
    emit(channelId)
  },
  off(channelId: string, id: number): void {
    if (held.get(channelId)?.delete(id)) emit(channelId)
  },
  /** Panic / stop: forget everything. */
  clear(): void {
    const ids = [...held.keys()]
    held.clear()
    for (const id of ids) emit(id)
  },
  get: keysOf,
  /** Calls `cb` with the current keys right away and on every change. */
  subscribe(channelId: string, cb: Listener): () => void {
    let ls = listeners.get(channelId)
    if (!ls) listeners.set(channelId, (ls = new Set()))
    ls.add(cb)
    cb(keysOf(channelId))
    return () => {
      ls.delete(cb)
    }
  }
}
