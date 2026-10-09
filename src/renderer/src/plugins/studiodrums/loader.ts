// Main-thread side of Studio Drums: loads resources/drumkits/<kit>/kit.json, reads & decodes the FLAC
// samples with the AudioContext and attaches them (as 16-bit PCM) to the data sent to the DSP.
//
// Worklet module globals are shared by every instance living in one AudioContext, so each sample file is
// shipped to a given context only once (`shipped`); later instances / kit switches only send the kit
// definition and the DSP picks the PCM from its shared store.
import { host } from '../../platform'
import type { KitJson, ResolvedDrumsData, StudioDrumsData } from './types'
import { DEFAULT_KIT } from './manifest'

export type KitLoadState =
  | { state: 'idle' }
  | { state: 'loading'; done: number; total: number }
  | { state: 'ready'; files: number }
  | { state: 'error'; message: string }
  | { state: 'unavailable'; message: string }

const status = new Map<string, KitLoadState>()
const listeners = new Set<() => void>()

export function kitStatus(kit: string): KitLoadState {
  return status.get(kit) ?? { state: 'idle' }
}
export function subscribeKitStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function setStatus(kit: string, s: KitLoadState): void {
  status.set(kit, s)
  for (const l of listeners) l()
}

let rootPromise: Promise<string> | null = null
/** <resources>/drumkits (Electron only). */
export function drumkitsDir(): Promise<string> {
  if (!host) return Promise.reject(new Error('no host'))
  if (!rootPromise) rootPromise = host.paths().then((p) => host!.path.join(p.resources, 'drumkits'))
  return rootPromise
}

const kitJsonCache = new Map<string, Promise<KitJson>>()
export function loadKitJson(kit: string): Promise<KitJson> {
  let p = kitJsonCache.get(kit)
  if (!p) {
    p = (async () => {
      const dir = await drumkitsDir()
      const text = await host!.fsp.readFile(host!.path.join(dir, kit, 'kit.json'), 'utf8')
      return JSON.parse(text) as KitJson
    })()
    p.catch(() => kitJsonCache.delete(kit))
    kitJsonCache.set(kit, p)
  }
  return p
}

export function kitFiles(kit: KitJson): string[] {
  const set = new Set<string>()
  for (const id in kit.pieces) for (const l of kit.pieces[id].layers) for (const f of l.files) set.add(f)
  return [...set]
}

/** Files already shipped (or being shipped) to each context's worklet. */
const shipped = new WeakMap<BaseAudioContext, Set<string>>()

function toInt16(buf: AudioBuffer): Int16Array[] {
  const out: Int16Array[] = []
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c)
    const y = new Int16Array(x.length)
    for (let i = 0; i < x.length; i++) {
      const v = x[i] < -1 ? -1 : x[i] > 1 ? 1 : x[i]
      y[i] = Math.round(v * 32767)
    }
    out.push(y)
  }
  return out
}

async function decodeFile(ctx: BaseAudioContext, dir: string, file: string): Promise<Int16Array[]> {
  const bytes = await host!.fsp.readFile(host!.path.join(dir, file))
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return toInt16(await ctx.decodeAudioData(ab))
}

export async function resolveStudioDrums(data: unknown, ctx: BaseAudioContext): Promise<ResolvedDrumsData> {
  const d = (data && typeof data === 'object' ? data : {}) as Partial<StudioDrumsData>
  const kitId = typeof d.kit === 'string' && d.kit ? d.kit : DEFAULT_KIT
  const base: ResolvedDrumsData = { ...(d as object), kit: kitId }
  if (!host) {
    setStatus(kitId, { state: 'unavailable', message: 'Drum samples load from disk: run ArkaneDAW in Electron (npm run dev).' })
    return { ...base, error: 'no-host' }
  }
  try {
    const [dir, kit] = await Promise.all([drumkitsDir(), loadKitJson(kitId)])
    let sent = shipped.get(ctx)
    if (!sent) shipped.set(ctx, (sent = new Set()))
    const need = kitFiles(kit).filter((f) => !sent!.has(f))
    for (const f of need) sent.add(f) // claim now so concurrent instances don't decode the same files
    const pcm: Record<string, Int16Array[]> = {}
    let done = 0
    if (need.length) setStatus(kitId, { state: 'loading', done, total: need.length })
    let next = 0
    let failed: unknown = null
    const worker = async (): Promise<void> => {
      while (next < need.length) {
        const f = need[next++]
        try {
          pcm[f] = await decodeFile(ctx, dir, f)
        } catch (e) {
          sent!.delete(f)
          failed = failed ?? e
        }
        done++
        if (done % 16 === 0) setStatus(kitId, { state: 'loading', done, total: need.length })
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    if (failed) {
      console.warn('[studiodrums] some samples failed to load', failed)
      setStatus(kitId, { state: 'error', message: `Some samples failed to load: ${String(failed)}` })
    } else setStatus(kitId, { state: 'ready', files: kitFiles(kit).length })
    return { ...base, kitDef: kit, pcm: need.length ? pcm : undefined }
  } catch (e) {
    setStatus(kitId, { state: 'error', message: `Kit "${kitId}" not found in resources/drumkits — run "npm run drumkits". (${String(e)})` })
    return { ...base, error: String(e) }
  }
}
