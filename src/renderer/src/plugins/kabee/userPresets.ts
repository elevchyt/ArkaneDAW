// Kabee user preset library. Upstream keeps one text file per preset in ~/.config/Kabee/presets/<mode>/; inside
// ArkaneDAW the library lives in the renderer's localStorage, shared by every Kabee instance and project.
import { useCallback, useSyncExternalStore } from 'react'
import { KABEE_PARAMS, MODE_BASS, MODE_GUITAR, cleanName, type UserPreset } from './model'

const KEY = 'arkane.kabee.userPresets.v1'
const known = new Set(KABEE_PARAMS.map((p) => p.symbol))

let cache: UserPreset[] | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Parses stored presets, dropping anything malformed (like PresetLibrary ignores broken files). */
export function parseLibrary(raw: string | null): UserPreset[] {
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    const out: UserPreset[] = []
    for (const item of list) {
      const name = cleanName(String((item as UserPreset)?.name ?? ''))
      const mode = (item as UserPreset)?.mode === MODE_BASS ? MODE_BASS : MODE_GUITAR
      const vals = (item as UserPreset)?.values
      if (!name || !vals || typeof vals !== 'object') continue
      const values: Record<string, number> = {}
      for (const [k, v] of Object.entries(vals)) if (known.has(k) && Number.isFinite(v)) values[k] = Number(v)
      out.push({ name, mode, values: { ...values, mode } })
    }
    return out
  } catch {
    return []
  }
}

export function getLibrary(): UserPreset[] {
  if (!cache) cache = parseLibrary(storage()?.getItem(KEY) ?? null)
  return cache
}

/** Returns false when the library couldn't be written. */
export function updateLibrary(fn: (list: UserPreset[]) => UserPreset[]): boolean {
  const next = fn(getLibrary())
  let ok = true
  try {
    const s = storage()
    if (!s) ok = false
    else s.setItem(KEY, JSON.stringify(next))
  } catch {
    ok = false
  }
  cache = next
  for (const l of listeners) l()
  return ok
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cache = null
    cb()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export function useUserPresets(): [UserPreset[], (fn: (list: UserPreset[]) => UserPreset[]) => boolean] {
  const list = useSyncExternalStore(subscribe, getLibrary, getLibrary)
  const update = useCallback((fn: (list: UserPreset[]) => UserPreset[]) => updateLibrary(fn), [])
  return [list, update]
}
