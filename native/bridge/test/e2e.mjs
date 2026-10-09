// End-to-end bridge test in plain Node (no Electron, no audio device — completely silent):
//   real BridgeCore (the code inside the AudioWorklet) → SharedArrayBuffer → arkane_bridge.node copier thread
//   → POSIX shm → arkane-vsthost sidecar → test CLAP plugin → back.
// Simulates Chromium's bursty rendering (4 quanta per "hardware callback" every 10.7 ms).
//
//   node native/bridge/test/e2e.mjs <resources/native dir> <arkane-test-synth.clap>
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../../src/renderer/src/audio/vst')
const P = await import(join(src, 'protocol.ts'))
const { SidecarProcess } = await import(join(src, 'sidecar.ts'))

const [nativeDir, synthPath] = process.argv.slice(2)
const require = createRequire(import.meta.url)
const addon = require(join(resolve(nativeDir), 'arkane_bridge.node'))
const exe = join(resolve(nativeDir), 'arkane-vsthost')
const SR = 48000
let failures = 0
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function startInstance(uid) {
  const sab = new SharedArrayBuffer(P.TOTAL_BYTES)
  P.initHeader(sab)
  const i32 = new Int32Array(sab)
  const { id, shm } = addon.open(i32)
  const proc = new SidecarProcess((cmd, args) => spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }), {
    exe, format: 'clap', path: resolve(synthPath), uid, sampleRate: SR, shm
  })
  const info = await proc.ready
  addon.unlink(id)
  Atomics.store(i32, P.H.STATUS, P.Status.RUNNING)
  return { sab, i32, id, proc, info }
}

console.log('bridge e2e: instrument, real-time bursts, latency-compensated events')
{
  check(addon.totalBytes === P.TOTAL_BYTES && addon.protocolVersion === P.VERSION, 'addon and TS protocol agree on layout')
  const inst = await startInstance('arkane.test.synth')
  check(inst.info.name === 'Arkane Test Synth', `sidecar ready (${inst.info.name})`)
  const LAT = 4
  const core = new P.BridgeCore(inst.sab, { kind: 'instrument', latencyBlocks: LAT, adaptive: false })
  const noteTime = 0.25 // seconds (AudioContext time)
  const noteFrame = noteTime * SR
  core.push(P.toWireEvents([
    { kind: 'on', time: noteTime, note: { id: 1, key: 69, vel: 1, pan: 0, fine: 0, rel: 0.5, modX: 0.5, modY: 0.5, porta: false, slide: false, color: 0, length: 0 } },
    { kind: 'param', time: noteTime, id: '0', value: 1 },
    { kind: 'off', time: 0.75, id: 1, key: 69, rel: 0.5 }
  ]))
  const total = Math.ceil(SR / 128) // 1 s
  const out = new Float32Array(total * 128)
  const L = new Float32Array(128), R = new Float32Array(128)
  const t0 = performance.now()
  let q = 0
  while (q < total) {
    for (let b = 0; b < 4 && q < total; b++, q++) {
      core.process(q * 128, SR, null, null, L, R)
      out.set(L, q * 128)
    }
    await sleep(10.67) // next "hardware callback"
  }
  const wall = performance.now() - t0
  const first = out.findIndex((x) => x !== 0)
  check(first === noteFrame + 1 || first === noteFrame, `note onset lands at frame ${first} (scheduled ${noteFrame}) — latency compensated`)
  let cross = 0
  for (let i = noteFrame + 1; i < 0.7 * SR; i++) if ((out[i - 1] < 0) !== (out[i] < 0)) cross++
  const freq = cross / 2 / (0.7 - noteTime)
  check(Math.abs(freq - 440) < 4, `440 Hz through the bridge (${freq.toFixed(1)})`)
  const peak = out.subarray(noteFrame, 0.7 * SR).reduce((m, x) => Math.max(m, Math.abs(x)), 0)
  check(Math.abs(peak - 1) < 0.02, `timed param event applied with the note (peak ${peak.toFixed(3)})`)
  const after = out.subarray(0.75 * SR + 1).reduce((m, x) => Math.max(m, Math.abs(x)), 0)
  check(after === 0, 'note-off at 0.75 s')
  check(core.xruns === 0, `no xruns at ${LAT} blocks latency (${((LAT * 128) / SR * 1000).toFixed(1)} ms), wall ${wall.toFixed(0)} ms`)

  // state round trip through the control channel
  const st = await inst.proc.call('getState')
  check(typeof st.data === 'string' && st.data.length > 0, 'getState over JSON-lines')

  // crash containment
  let exited = null
  inst.proc.onExit((x) => (exited = x))
  core.push([{ time: 0, type: P.Ev.PARAM, a: 99, b: 0, v: 1 }])
  for (let i = 0; i < 50 && !exited; i++) {
    core.process(q++ * 128, SR, null, null, L, R)
    await sleep(10)
  }
  check(exited && exited.signal === 'SIGSEGV', `plugin crash kills only the sidecar (${exited?.signal})`)
  Atomics.store(inst.i32, P.H.STATUS, P.Status.CRASHED)
  L.fill(1)
  core.process(q++ * 128, SR, null, null, L, R)
  check(L.every((x) => x === 0), 'crashed instance outputs silence')
  addon.close(inst.id)
}

console.log('bridge e2e: effect, offline (sync) mode')
{
  const inst = await startInstance('arkane.test.gain')
  const core = new P.BridgeCore(inst.sab, { kind: 'effect', latencyBlocks: 0, sync: true })
  core.push([{ time: 0, type: P.Ev.PARAM, a: 0, b: 0, v: 0.25 }]) // 0..2 → 0.5
  const inL = new Float32Array(128), inR = new Float32Array(128), L = new Float32Array(128), R = new Float32Array(128)
  let ok = true
  const blocks = 2000
  const t0 = performance.now()
  for (let q = 0; q < blocks; q++) {
    for (let i = 0; i < 128; i++) { inL[i] = Math.sin((q * 128 + i) * 0.01); inR[i] = -inL[i] }
    core.process(q * 128, SR, inL, inR, L, R)
    for (let i = 0; i < 128; i++) ok &&= Math.abs(L[i] - inL[i] * 0.5) < 1e-6 && Math.abs(R[i] - inR[i] * 0.5) < 1e-6
  }
  const ms = performance.now() - t0
  check(ok, 'offline: out = in * 0.5 with zero added latency')
  check(ms < 5000, `offline speed: ${blocks} blocks (${(blocks * 128 / SR).toFixed(1)} s audio) in ${ms.toFixed(0)} ms`)
  // bypass passes input through
  core.bypass = true
  core.process(blocks * 128, SR, inL, inR, L, R)
  check(L.every((x, i) => x === inL[i]), 'bypass = dry input')
  inst.proc.stop()
  await sleep(300)
  addon.close(inst.id)
  const s = addon.stats()
  check(s.instances === 0, `addon cleaned up (forwarded ${s.forwarded}, returned ${s.returned})`)
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall bridge tests passed')
process.exit(failures ? 1 : 0)
