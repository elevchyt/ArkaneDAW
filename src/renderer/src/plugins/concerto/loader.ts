// Main-thread side of Concerto: loads <root>/<instrument>/instrument.json for every layer, reads & decodes the FLAC
// samples with the AudioContext and attaches them (as 16-bit PCM) to the data sent to the DSP.
// <root> is the "concerto" content pack (<userData>/packs/concerto, downloaded on demand — see packs/), or
// <resources>/concerto when running unpackaged from a dev checkout. Without either the plugin is "not installed":
// the DSP gets no instruments (silent) and the editor shows the download panel (packs/PackGate.tsx).
// Same approach as Studio Drums: worklet module globals are shared by every instance living in one AudioContext,
// so each sample file is shipped to a given context only once; later instances / instrument switches only send
// the definitions and the DSP picks the PCM from its shared store.
import { host } from '../../platform'
import { onPackRootChange, packRoot } from '../../packs/paths'
import { readData, type InstrumentJson, type ResolvedConcertoData } from './types'

export type LoadState =
  | { state: 'idle' }
  | { state: 'loading'; done: number; total: number }
  | { state: 'ready'; files: number }
  | { state: 'error'; message: string }
  | { state: 'unavailable'; message: string }

const status = new Map<string, LoadState>()
const listeners = new Set<() => void>()

export function instStatus(id: string): LoadState {
  return status.get(id) ?? { state: 'idle' }
}
export function subscribeStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
function setStatus(id: string, s: LoadState): void {
  status.set(id, s)
  for (const l of listeners) l()
}

export const PACK_ID = 'concerto'
export const NOT_INSTALLED = 'Concerto sound library not installed — open the instrument to download it.'

export class NotInstalledError extends Error {
  constructor() {
    super(NOT_INSTALLED)
  }
}

/** Sample root (installed pack, or the dev checkout's resources/concerto). Rejects with NotInstalledError. */
export async function concertoDir(): Promise<string> {
  if (!host) throw new Error('no host')
  const r = await packRoot(PACK_ID)
  if (!r) throw new NotInstalledError()
  return r.dir
}

const jsonCache = new Map<string, Promise<InstrumentJson>>()
// pack installed / removed / updated: re-read everything from the new root
onPackRootChange((id) => id === PACK_ID && jsonCache.clear())
export function loadInstrumentJson(id: string): Promise<InstrumentJson> {
  let p = jsonCache.get(id)
  if (!p) {
    p = (async () => {
      const dir = await concertoDir()
      const text = await host!.fsp.readFile(host!.path.join(dir, id, 'instrument.json'), 'utf8')
      return JSON.parse(text) as InstrumentJson
    })()
    p.catch(() => jsonCache.delete(id))
    jsonCache.set(id, p)
  }
  return p
}

/** Every sample file an instrument uses (all articulations + release samples). */
export function instrumentFiles(def: InstrumentJson): string[] {
  const set = new Set<string>()
  for (const a of def.articulations) {
    for (const z of a.zones) for (const l of z.layers) for (const f of l.files) set.add(f.f)
    for (const z of a.release ?? []) for (const l of z.layers) for (const f of l.files) set.add(f.f)
  }
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

export async function resolveConcerto(data: unknown, ctx: BaseAudioContext): Promise<ResolvedConcertoData> {
  const d = readData(data)
  const ids = [...new Set(d.layers.map((l) => l.inst))]
  if (!host) {
    for (const id of ids) setStatus(id, { state: 'unavailable', message: 'Orchestral samples load from disk: run ArkaneDAW in Electron (npm run dev).' })
    return { ...d, error: 'no-host' }
  }
  let dir: string
  try {
    dir = await concertoDir()
  } catch (e) {
    if (e instanceof NotInstalledError) {
      for (const id of ids) setStatus(id, { state: 'unavailable', message: NOT_INSTALLED })
      return { ...d, error: 'not-installed' }
    }
    return { ...d, error: String(e) }
  }
  const defs: Record<string, InstrumentJson> = {}
  const pcm: Record<string, Int16Array[]> = {}
  let sent = shipped.get(ctx)
  if (!sent) shipped.set(ctx, (sent = new Set()))
  let anyError: string | undefined
  for (const id of ids) {
    let def: InstrumentJson
    try {
      def = await loadInstrumentJson(id)
    } catch (e) {
      anyError = String(e)
      setStatus(id, { state: 'error', message: `Instrument "${id}" not found in the Concerto sound library (${dir}) — reinstall it from OPTIONS › Sound libraries. (${String(e)})` })
      continue
    }
    defs[id] = def
    const all = instrumentFiles(def)
    const need = all.filter((f) => !sent!.has(f))
    for (const f of need) sent.add(f) // claim now so concurrent instances don't decode the same files
    if (!need.length) {
      if (instStatus(id).state !== 'loading') setStatus(id, { state: 'ready', files: all.length })
      continue
    }
    let done = 0
    let failed: unknown = null
    setStatus(id, { state: 'loading', done, total: need.length })
    let next = 0
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
        if (done % 12 === 0) setStatus(id, { state: 'loading', done, total: need.length })
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    if (failed) {
      console.warn('[concerto] some samples failed to load', failed)
      setStatus(id, { state: 'error', message: `Some samples failed to load: ${String(failed)}` })
    } else setStatus(id, { state: 'ready', files: all.length })
  }
  return { ...d, defs, pcm: Object.keys(pcm).length ? pcm : undefined, ...(anyError ? { error: anyError } : {}) }
}
