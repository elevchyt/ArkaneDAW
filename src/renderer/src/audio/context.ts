import processorUrl from './worklet/processor.ts?worker&url'

let ctx: AudioContext | null = null
let ready: Promise<AudioContext> | null = null

/** The live AudioContext (created lazily). */
export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' })
  return ctx
}

/** Create the context, load the worklet module and resume. Safe to call repeatedly. */
export function ensureAudio(): Promise<AudioContext> {
  if (!ready) {
    const c = getAudioContext()
    ready = c.audioWorklet.addModule(processorUrl).then(() => c)
  }
  return ready.then(async (c) => {
    if (c.state === 'suspended') await c.resume()
    return c
  })
}

/** Load the worklet into another context (offline render). */
export async function prepareContext(c: BaseAudioContext): Promise<void> {
  await c.audioWorklet.addModule(processorUrl)
}
