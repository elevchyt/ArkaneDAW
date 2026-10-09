// App-level VST scenario, run inside Electron by run.sh: real AudioEngine, store actions, VstHostNode,
// PluginWindow-style param edits, state capture, crash + reload, offline export. Master volume is 0 → silent.
import '@/audio/vst'
import { useProject, getProject, editProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { defaultTemplate } from '@/store/templates'
import { defaultNote } from '@/store/factory'
import { addInstrumentChannel, setChannelParam, setFxSlot, setPatternNotes } from '@/store/actions'
import { initAudio } from '@/audio/transport'
import { renderProject } from '@/audio/export'
import { VstHostNode, flushVstStates, getExternalEditor, useVstCatalog, listExternalPlugins } from '@/audio/vst'
import type { PluginInstanceState } from '@/store/types'

const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1))) as { clap: string }
let failures = 0
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const until = async (fn: () => boolean, ms = 5000) => {
  const t = Date.now()
  while (!fn() && Date.now() - t < ms) await sleep(20)
  return fn()
}

async function main(): Promise<void> {
  const initial = defaultTemplate()
  useProject.getState().load(initial, null)
  useUI.getState().set({ currentPattern: initial.patterns[0].id })
  editProject('mute', (d) => void (d.masterVolume = 0)) // silent test
  const synthId = `vst:clap:${cfg.clap}:arkane.test.synth`
  const ch = addInstrumentChannel(synthId, { name: 'Test Synth' })
  check(getExternalEditor(synthId) !== undefined, 'plugin window gets the VST editor panel')
  const eng = await initAudio()
  const node = eng.channelPlugin(ch)
  check(node instanceof VstHostNode, 'engine created a VstHostNode for the vst: id')
  const vst = node as VstHostNode
  await vst.ready
  await until(() => vst.status === 'running')
  check(vst.status === 'running', `sidecar running (${vst.status} ${vst.message ?? ''})`)
  check(vst.info?.params.length === 3, 'params described')
  const an = eng.ctx.createAnalyser()
  an.fftSize = 2048
  vst.output.connect(an)
  const buf = new Float32Array(2048)
  const peak = async (ms: number) => {
    let p = 0
    const t = Date.now()
    while (Date.now() - t < ms) {
      await sleep(30)
      an.getFloatTimeDomainData(buf)
      for (const x of buf) p = Math.max(p, Math.abs(x))
    }
    return p
  }
  const id = eng.noteOn(ch, 69, 1)
  const p1 = await peak(400)
  check(Math.abs(p1 - 0.5) < 0.02, `live note via engine.noteOn (peak ${p1.toFixed(3)})`)
  setChannelParam(ch, '0', 1) // what the VstEditorPanel slider does
  await sleep(150)
  const p2 = await peak(300)
  check(Math.abs(p2 - 1) < 0.02, `param edit through the project → plugin (peak ${p2.toFixed(3)})`)
  eng.noteOff(ch, id, 69)
  await sleep(200)
  check((await peak(200)) === 0, 'note off')

  await flushVstStates()
  const st = getProject().channels.find((c) => c.id === ch)!.plugin as PluginInstanceState
  check((st.data as { format?: string })?.format === 'arkane-vst' && st.params['0'] === 1, 'state chunk + params captured into the project')

  // offline export with the VST instrument
  const pat = getProject().patterns[0]
  setPatternNotes(pat.id, ch, [defaultNote({ key: 69, pos: 0, len: 96, vel: 1 })])
  editProject('unmute for render', (d) => void (d.masterVolume = 0.8))
  const t0 = performance.now()
  const rendered = await renderProject({ tailSeconds: 0.5, mode: 'pattern' })
  editProject('mute', (d) => void (d.masterVolume = 0))
  const data = rendered.getChannelData(0)
  let rp = 0
  for (const x of data) rp = Math.max(rp, Math.abs(x))
  check(rp > 0.1, `offline export renders the VST (${rendered.duration.toFixed(2)} s in ${(performance.now() - t0).toFixed(0)} ms, peak ${rp.toFixed(2)})`)

  // crash + reload
  setChannelParam(ch, '99', 1)
  await until(() => vst.status === 'crashed')
  check(vst.status === 'crashed', `plugin crash detected (${vst.message})`)
  editProject('reset crash param', (d) => void (d.channels.find((c) => c.id === ch)!.plugin!.params['99'] = 0))
  await vst.restart()
  check(vst.status === 'running', 'reload after crash')
  const id2 = eng.noteOn(ch, 69, 1)
  const p3 = await peak(400)
  eng.noteOff(ch, id2, 69)
  check(Math.abs(p3 - 1) < 0.02, `restored state after reload (peak ${p3.toFixed(3)})`)

  // effect in a mixer slot
  setFxSlot(1, 0, `vst:clap:${cfg.clap}:arkane.test.gain`)
  const fx = eng.fxPlugin(1, 0) as VstHostNode
  await fx.ready
  await until(() => fx.status === 'running')
  check(fx instanceof VstHostNode && fx.status === 'running', `effect slot hosts a VST (latency ${fx.latencySamples} samples)`)

  // catalogue scan of the test plugin folder
  useVstCatalog.getState().addSearchPath(cfg.clap.replace(/\/[^/]+$/, ''))
  await useVstCatalog.getState().scan()
  const found = listExternalPlugins()
  check(found.some((p) => p.id === synthId && p.kind === 'instrument') && found.some((p) => p.kind === 'effect' && p.name === 'Arkane Test Gain'), `scan lists the test plugins (${found.length} found)`)

  // removing the channel disposes the sidecar
  const pid = (vst as unknown as { proc: { pid: number } }).proc.pid
  editProject('remove', (d) => void (d.channels = d.channels.filter((c) => c.id !== ch)))
  await sleep(2000)
  let alive = true
  try {
    process.kill(pid, 0)
  } catch {
    alive = false
  }
  check(!alive, 'removing the channel stops its sidecar')
}

main()
  .catch((e) => check(false, `exception ${e?.stack ?? e}`))
  .finally(() => console.log(`E2E_DONE ${JSON.stringify({ failures })}`))
