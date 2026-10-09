# Native plugin hosting (VST2 / VST3 / CLAP on Linux)

```
AudioWorklet 'arkane-vst-bridge'          (src/renderer/src/audio/vst/bridge.worklet.ts + protocol.ts)
   │  SharedArrayBuffer ring: 32 slots × 128 frames, events with sample offsets, transport
   ▼
arkane_bridge.node copier thread          (native/bridge, N-API — same binary for Node and Electron)
   │  memcpy SAB ⇄ POSIX shm, futex doorbell
   ▼
arkane-vsthost  (one process per plugin instance)   (native/vsthost)
   ├─ audio thread: futex wait → plugin process() → output back into shm
   └─ main thread: JSON-lines control on stdin/stdout, X11 editor window, plugin timers/fds (CLAP/VST3 run loop)
```

* **Why a copier thread**: Electron's V8 sandbox forbids external ArrayBuffers, so the SAB must be V8 memory and
  cannot live in shm; the worklet cannot call native code and `Atomics.notify` does not wake OS futexes. The addon
  gets the SAB's backing store via `napi_get_typedarray_info`, polls it (200 µs, spinning for 300 µs after traffic),
  and rings the sidecar's futex. The audio thread never blocks: late output = silence + xrun counter.
* **Latency**: `ceil(baseLatency·sr/128)+1` blocks (5 blocks = 13.3 ms at 48 kHz on this machine), raised
  automatically after 3 xruns within ~1 s. Events for **instruments are sent that many blocks early**, so sequenced
  notes/automation are sample-accurate and on time. Effects are delayed by `latencyBlocks·128` + the plugin's own
  latency (`VstHostNode.latencySamples`, for a future mixer PDC).
* **Offline export**: the worklet runs in sync mode on an `OfflineAudioContext` (spins until each block returns,
  ~200× real time for a light plugin), the offline sidecar starts from the live instance's current state, and
  `flush()` is implemented.
* **Crash isolation**: a crashing plugin kills only its sidecar → node outputs silence, the plugin window shows
  "Plugin crashed" + **Reload** (respawns with the last captured state). Scanning runs each file in a throw-away
  sidecar with a timeout (20 s, 60 s for yabridge).
* **State**: `PluginInstanceState.data = { format: 'arkane-vst', version: 1, state: <base64> }`
  (CLAP state / VST3 "AV3S" component+controller / VST2 chunk or param dump). Captured 1.5 s after the plugin
  reports a change, when its editor closes, and by `flushVstStates()`. Params in the project are **normalized 0..1**
  keyed by the numeric param id (also what automation sends).
* **VST3**: built only on the MIT `pluginterfaces` (vendored, Steinberg relicensed the SDK under MIT in 3.8) — host
  objects (IHostApplication, IMessage/IAttributeList, IBStream, IParameterChanges, IEventList, IComponentHandler,
  IPlugFrame + Linux IRunLoop) are implemented in `vst3_host.cpp`.
* **VST2**: `src/vst2_abi.h` is a clean-room description of the AEffect binary interface (no Steinberg code).
* **X11**: libX11 is `dlopen`ed (no dev headers needed); editors are embedded into a top-level window titled with
  the plugin name, transient for the DAW window, HiDPI scale passed from `devicePixelRatio`; closing it destroys the
  plugin view. Wayland sessions need XWayland.
* **yabridge**: Windows plugins wrapped by yabridge are ordinary Linux `.so`/`.vst3`/`.clap` files in
  `~/.vst`, `~/.vst3`, `~/.clap` and are scanned/hosted like native ones.

## Build & test (no root, no cmake)

```
npm run build:native     # → resources/native/{arkane-vsthost, arkane_bridge.node}
npm run test:native      # C++ sidecar tests + Node bridge e2e (silent, no audio device)
EXTRA_PLUGINS="vst3:/path/X.vst3 clap:/path/Y.clap vst2:/path/Z.so" ARK_TEST_GUI=1 npm run test:native
npx vitest run src/renderer/src/audio/vst
ELECTRON=/path/to/electron bash native/bridge/test/electron/run.sh   # real Chromium AudioWorklet + SAB + addon
ELECTRON=/path/to/electron bash native/bridge/test/app/run.sh        # app engine/store/VstHostNode scenario (hidden window, muted)
```

## Renderer API (`src/renderer/src/audio/vst/index.ts`)

| export | use |
|---|---|
| `listExternalPlugins(kind?)`, `useExternalPlugins(kind?)` | catalogue for pickers; `entry.id` is the pluginId (`vst:<format>:<path>[:<uid>]`) |
| `getExternalPluginInfo(id)` | name/vendor/kind for channel names and window titles |
| `getExternalEditor(id)` | `VstEditorPanel` used by `PluginWindow` for non-builtin ids |
| `flushVstStates()` | write all live plugin states into the project (call before saving) |
| `useVstCatalog` | zustand store behind the Plugin manager window |

## Known gaps

* Mixer has no plugin delay compensation; live-played notes (typing keyboard/MIDI) hear the bridge latency.
* Main stereo bus only: no side-chain inputs, no multi-output instruments, no MIDI out, no note expressions / MPE;
  per-note fine/pan ignored; channel pitch is sent as pitch bend assuming a ±2 st plugin range.
* VST2: parameter changes are applied at block start (≤ 128 samples); shell plugins (e.g. Waves) unsupported.
* LV2 is only listed in the Plugin manager. Plugin presets/programs are not shown in the wrapper's preset strip.
* One process per instance (simple and crash-safe, but more memory than grouping); the sidecar asks for
  SCHED_FIFO, which only works with rtprio limits (otherwise adaptive latency covers scheduling hiccups).
* Not wired yet by the UI owners: channel-rack "+"/mixer slot menus/plugin picker (use `listExternalPlugins`),
  channel names / FX window titles for VST ids (`getExternalPluginInfo(id)?.name`), and `flushVstStates()` before save.
* Packaging must ship `resources/native/` (e.g. electron-builder `extraResources`).
