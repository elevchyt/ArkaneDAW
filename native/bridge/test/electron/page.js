// Runs in the Electron renderer (nodeIntegration). Everything audible goes through a gain of 0: silent.
;(async () => {
  const P = window.ArkVst
  const { nativeDir, clap } = JSON.parse(decodeURIComponent(location.hash.slice(1)))
  const path = require('node:path')
  const { spawn } = require('node:child_process')
  let failures = 0
  const check = (ok, msg) => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`)
    if (!ok) failures++
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    check(window.crossOriginIsolated === true, 'renderer is crossOriginIsolated (SharedArrayBuffer allowed)')
    const addon = require(path.join(nativeDir, 'arkane_bridge.node'))
    check(addon.protocolVersion === P.VERSION, 'N-API addon loads in Electron (no rebuild)')
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    await ctx.resume()
    await ctx.audioWorklet.addModule('worklet.js')
    const sab = new SharedArrayBuffer(P.TOTAL_BYTES)
    P.initHeader(sab)
    const i32 = new Int32Array(sab)
    const { id, shm } = addon.open(i32) // SAB backing store pointer through napi_get_typedarray_info
    check(typeof id === 'number' && shm.startsWith('/arkane-'), `addon.open() on a V8 SharedArrayBuffer (${shm})`)
    const proc = new P.SidecarProcess((cmd, args) => spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] }), {
      exe: path.join(nativeDir, 'arkane-vsthost'), format: 'clap', path: clap, uid: 'arkane.test.synth', sampleRate: ctx.sampleRate, shm
    })
    const info = await proc.ready
    addon.unlink(id)
    check(info.kind === 'instrument', `sidecar spawned from the renderer (${info.name})`)
    Atomics.store(i32, P.H.STATUS, P.Status.RUNNING)
    const lat = P.initialLatencyBlocks(ctx.baseLatency, ctx.sampleRate)
    console.log(`  info sampleRate=${ctx.sampleRate} baseLatency=${ctx.baseLatency} outputLatency=${ctx.outputLatency} → ${lat} blocks`)
    const node = new AudioWorkletNode(ctx, 'arkane-vst-bridge', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { sab, bridge: { kind: 'instrument', latencyBlocks: lat, adaptive: true } }
    })
    let stats = null
    node.port.onmessage = (e) => { if (e.data.type === 'stats') stats = e.data }
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(analyser).connect(mute).connect(ctx.destination)
    const t = ctx.currentTime + 0.3
    node.port.postMessage({ type: 'events', events: [
      { kind: 'on', time: t, note: { id: 1, key: 69, vel: 1, pan: 0, fine: 0, rel: 0.5, modX: 0.5, modY: 0.5, porta: false, slide: false, color: 0, length: 0 } },
      { kind: 'off', time: t + 1.5, id: 1, key: 69, rel: 0.5 }
    ] })
    const buf = new Float32Array(2048)
    let peak = 0
    while (ctx.currentTime < t + 1.4) {
      await sleep(50)
      if (ctx.currentTime > t + 0.05) {
        analyser.getFloatTimeDomainData(buf)
        for (const x of buf) peak = Math.max(peak, Math.abs(x))
      }
    }
    check(Math.abs(peak - 0.5) < 0.02, `sine from the sidecar reaches the Web Audio graph (peak ${peak.toFixed(3)})`)
    await sleep(600)
    analyser.getFloatTimeDomainData(buf)
    check(buf.every((x) => x === 0), 'note-off → silence')
    const xr = Atomics.load(i32, P.H.XRUNS)
    const latNow = Atomics.load(i32, P.H.LATENCY_BLOCKS)
    console.log(`  info xruns=${xr} latencyBlocks=${latNow} (${((latNow * 128) / ctx.sampleRate * 1000).toFixed(1)} ms) stats=${JSON.stringify(stats)}`)
    check(xr <= 3, `real-time bridge without sustained dropouts (${xr} xruns in ~2.5 s)`)
    // crash containment inside Electron
    let exited = null
    proc.onExit((x) => (exited = x))
    node.port.postMessage({ type: 'wire', events: [{ time: 0, type: P.Ev.PARAM, a: 99, b: 0, v: 1 }] })
    for (let i = 0; i < 40 && !exited; i++) await sleep(50)
    check(exited && exited.signal === 'SIGSEGV', 'plugin crash only kills the sidecar; renderer keeps running')
    addon.close(id)
    node.disconnect()
    await ctx.close()
  } catch (e) {
    check(false, `exception: ${e && e.stack ? e.stack : e}`)
  }
  console.log(`E2E_DONE ${JSON.stringify({ failures })}`)
})()
