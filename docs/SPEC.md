# ArkaneDAW — Product & Engineering Spec

ArkaneDAW is a Linux-first, pattern-based DAW whose UX copies **FL Studio (20/21/24)** as faithfully as possible:
same windows, same mouse/keyboard conventions, same workflow (Channel rack → patterns → Playlist → Mixer).
No AI features inside the app (outside tools may edit projects, see PROJECT_FORMAT.md). It ships its own family of built-in plugins (named plainly: "Compressor", "Reverb", … — no brand prefix),
hosts third-party VST2/VST3/CLAP plugins, and records audio and notes.

Reference: FL Studio manual — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/>
(especially `pianoroll.htm`, `playlist.htm`, `mixer.htm`, `channelrack.htm`, `basics_shortcuts.htm`).
When in doubt, **do what FL Studio does**.

---

## 1. Stack

| Layer | Choice |
|---|---|
| Shell | Electron 44 (frameless window, custom title/menu bar like FL) |
| Build | electron-vite 5 + Vite 7, TypeScript strict |
| UI | React 19, Tailwind v4, shadcn/ui (Radix) restyled to FL's skin, lucide-react icons |
| State | zustand + immer patches (undo/redo history = FL "History") |
| Audio | Web Audio API. All built-in DSP runs in **one AudioWorklet module** (`audio/worklet/processor.ts`) |
| Native | C++ sidecar `native/vsthost` for VST/CLAP hosting (bridged, crash-isolated), N-API addon `native/bridge` for shared-memory audio; Kabee compiled to WASM |
| Tests | vitest (DSP is pure TS → render offline in node) |

Run: `npm run dev` (Electron) · `npm run dev:web` (renderer only, browser, port 5180) · `npm run typecheck` · `npm test` · `npm run build`.

## 2. Source layout

```
src/main/                 Electron main (window, app:// protocol w/ COOP/COEP, dialogs, permissions)
src/preload/              host API (fs, path, dialogs, window controls) → globalThis.arkaneHost
src/renderer/src/
  store/                  types.ts (project model), project.ts (undoable store), ui.ts, transport.ts,
                          actions.ts (shared mutations), io.ts (save/load), normalize.ts (repair loaded JSON),
                          filewatch.ts (reload on outside edits), templates.ts, factory.ts
  audio/                  context.ts, engine.ts (graph), transport.ts (scheduler), sequence.ts (pure timing),
                          plugin-node.ts (PluginHostNode + external factories), samples.ts (pool, WAV),
                          export.ts (offline render), recording.ts (live notes), worklet/processor.ts
  plugins/
    sdk/                  types.ts (ParamDef, DSP API, protocol), module.ts (PluginModule), params.ts,
                          dsp.ts (ADSR, SVF, Biquad, Osc, DelayLine, LFO, voices), ui.tsx (Panel/Section/PK/PSelect…),
                          test-utils.ts (offline render for vitest)
    registry.ts           UI registry  (import.meta.glob './*/index.tsx')
    dsp-registry.ts       DSP registry (import.meta.glob './*/dsp.ts') – bundled into the worklet
    <plugin-id>/          manifest.ts · dsp.ts · index.tsx · (Editor.tsx, presets.ts, *.test.ts …)
  components/controls/    Knob, Fader, MiniKnob, Led, ToggleButton, ParamKnob
  components/ui/          shadcn primitives
  shell/                  Toolbar (transport/tempo/time/monitor), MainMenu, Browser, Workspace (MDI),
                          MdiWindow (FL window chrome), shortcuts.ts, keys.ts (per-window key routing), commands.ts
  windows/                channelrack/ pianoroll/ playlist/ mixer/ plugin/ (wrapper) + registry.tsx
native/                   vsthost/ (C++ sidecar), bridge/ (N-API), kabee/ (WASM build)
docs/                     this spec, PROJECT_FORMAT.md (.arkane for scripts/agents), plugins.json (npm run catalog)
```

## 3. Core model (store/types.ts)

* **Ticks**: PPQ 96, 1 step = 24 ticks, 4/4 bar = 384 ticks.
* **Project** → `patterns[]` (notes per channel), `channels[]` (instrument + vol/pan/pitch + mixer target),
  `playlist { tracks[200], clips[] }` (pattern / audio / automation clips), `mixer[126]` (0 = Master, 1–125 inserts, 10 FX slots each,
  sends/routing, EQ), `automations[]`, `samples[]` (audio pool), `markers[]`.
* Step-sequencer steps **are notes** (key = channel `rootNote ?? 60`, len = 1 step). The rack shows step buttons while a channel's
  notes are step-like, otherwise a mini piano-roll preview (FL behaviour).
* All edits go through `editProject(label, recipe, { coalesceKey })` → undo history. Use a coalesceKey for drags/knobs.
* UI-only state (windows, selection, tools, snap, current pattern) lives in `useUI`; transport in `useTransport`;
  the playhead position is NOT React state: use `playhead.subscribe()` / `transport.tick()` and draw on canvas.

## 4. Audio engine

* `AudioEngine.sync(project)` diffs project snapshots by reference and (re)builds nodes:
  `Channel: instrument → vol → pan → mixer insert` · `Insert: input → FX slots (dry/wet) → pan → fader → meter → sends`.
  Fader law: `faderToGain(v)` with 0.8 = 0 dB (channels: 0.78 = 0 dB).
* `transport` (audio/transport.ts): look-ahead scheduler; pattern mode loops the current pattern; song mode plays the
  playlist (pattern clips loop their pattern when stretched, audio clips via AudioBufferSourceNode, automation clips
  sampled every 1/16 beat and applied with `applyAutomation`). Metronome, start marker, pause.
* `getEngine().noteOn(channelId, key, vel)` / `noteOff` for previews, typing keyboard, MIDI.
* Offline export (`audio/export.ts`) builds a second AudioEngine on an OfflineAudioContext.
* **External plugin formats** register `registerHostNodeFactory('vst:', factory)` returning a `PluginHostNode`.

## 5. Plugin SDK (contract for every built-in plugin)

```
plugins/<id>/manifest.ts   export const manifest: PluginManifest   (id === folder name)
plugins/<id>/dsp.ts        export default { id, kind, create(ctx) } satisfies DSPFactory
plugins/<id>/index.tsx     export default definePlugin({ manifest, Editor?, editorSize?, loadWasm? })
```

* DSP runs in the AudioWorklet: **no DOM, no fetch, no timers, no imports of React/UI code, avoid allocation in `process`**.
  Instruments **add** into pre-zeroed `outL/outR[start..end)`; effects **write** `out[start..end)` from `in`.
* Params are plain numbers (`ParamDef`: min/max/default/unit/curve/step/options). Preset = partial param map + optional `data`.
  Larger state (sequences, kits, wavetables, sample refs) goes in `data` (opaque JSON; `{ sampleId }` objects get PCM attached).
* Editor gets `PluginEditorProps` (params, setParam, setData, presets, `onDSPMessage`, `postToDSP`, `previewNote`, `hint`).
  Use `plugins/sdk/ui.tsx` + `components/controls` so all plugins share one look. Without an Editor a generic knob panel is generated.
* Editors are fixed-size (set `editorSize`), rendered inside the FL-style wrapper window (preset ◀ ▶ + dropdown).
* Drum plugins implement `keyNames(instance)` → the piano roll labels keys and offers a drum view; editors can write notes into the
  current pattern with `insertNotes`; `resolveData(data, ctx)` lets a plugin load/decode its own sample files before the DSP gets data.
* NoteOn carries FL per-note props: vel, pan, fine (cents), rel, modX (→ cutoff), modY (→ resonance), porta, slide, color.
* Test DSP with vitest + `sdk/test-utils.ts` (`renderInstrument`, `renderEffect`, `stats`, `writeWav`).

### Built-in plugin line-up

Generators: **Sampler**, **Triple Osc** (3x Osc-style starter), **Mosaic** (flagship layered workstation, homage to
Yamaha Montage: pianos, EPs, organs, strings, brass, choir, guitars, bells, pads, leads, basses), **Polygon** (homage to 90s Japanese
digital synths — Roland JV/Sound Canvas, Yamaha MU/XG, Korg M1/01W/Trinity — the "PS1 soundtrack" sound), **Atmos** (atmospheric
pads/textures/drones), **Guitar** (modelled acoustic / classical / electric guitars, Ample / Shreddage style: every note on a
string and fret, chord strumming, solo legato, keyswitches, strummer mode, double tracking, amp & cab), **Bassline** (every kind of bass: 303 acid, sub, reese, Moog, FM, slap, finger, wobble…), **Classic Drum Machines** (id `drummachine`;
kits: TR-808, TR-909, LinnDrum, Oberheim DMX, CR-78, TR-707, SP-1200-ish, Simmons… GM key map: 36 kick, 38 snare, 39 clap,
42 closed hat, 46 open hat, 49 crash, …), **Studio Drums** (realistic sampled acoustic kits, FPC / Power Drum Kit style: pad grid, per-piece mixer, genre groove library
→ "Send to pattern"), **Hexa** (DX7 clone: 6-op FM, 32 algorithms, loads DX7 .syx cartridges), **Chiptune** (Magical 8bit Plug homage: NES/GB pulse/tri/noise, envelopes & sequences,
sweep, vibrato, arpeggio, plus a retro drum mode played from the piano roll).

Effects (simple, few knobs, good defaults): **Parametric EQ**, **Compressor**, **Limiter**, **Reverb**, **Delay**, **Chorus**,
**Phaser**, **Flanger**, **Distortion**, **Saturation**, **Filter**, **Bitcrusher**, **Stereo**, **Gate**, … and **Kabee** (guitar/bass amp &
pedalboard, from github.com/elevchyt/kabee, compiled to WASM).

## 6. UX rules (FL Studio parity)

* Frameless main window. Header = menu (FILE EDIT ADD PATTERNS VIEW OPTIONS TOOLS HELP) + **hint bar** (every control calls
  `useUI.setHint(text)` on hover/drag showing name + value) + PAT/SONG + transport + tempo + time + monitor + snap + pattern selector
  + window toggles. Browser docked left. Everything else is an MDI child window (`MdiWindow`) that can be moved, resized,
  maximized, minimized, closed; Playlist is maximized by default.
* Mouse: left = add/act, **right-click = delete** (notes, clips, steps), right-drag = erase, double-click = properties, Ctrl+drag =
  select, Shift+drag = copy/clone, Alt = bypass snap, wheel = scroll, Ctrl+wheel = zoom, middle-drag = pan, knobs drag vertically
  (Shift = fine), double-click/Alt-click knob = reset, right-click knob = context menu.
* Keyboard: see `shell/shortcuts.ts` and per-window handlers via `useWindowKeys(windowId, handler)`; follow
  `basics_shortcuts.htm`. With "typing keyboard to piano" (Ctrl+T) on, letters play notes, except Shift / Ctrl / Alt
  combos and the focused Playlist's tool letters (P B D T S C E Z Y), which stay shortcuts.
* Colors/tokens in `styles.css` (`--fl-*`). Font 11px. Dark only.

## 7. Native / Linux

* **VST hosting** (`native/vsthost`, `native/bridge`, `audio/vst/`): out-of-process host (FL calls this "bridged"), shared-memory
  audio exchange with the AudioWorklet via SharedArrayBuffer + N-API addon; plugin editors open in their own X11 window;
  scan `~/.vst ~/.vst3 ~/.clap /usr/lib/{vst,vst3,clap}` (+ yabridge-wrapped Windows plugins appear automatically).
* No root needed: dev headers can be fetched with `apt-get download` into a private sysroot (see Kabee's `scripts/local-deps.sh`).
* Audio I/O is Chromium's (PulseAudio/PipeWire). Recording uses getUserMedia with all processing (AGC/NS/EC) disabled.
* Record (right-click it) records **Mixer input into playlist** (armed mixer tracks become audio clips, song mode) and / or
  **MIDI into channel** (MIDI controller / typing keyboard → the first selected channel's notes in the current pattern);
  both are on by default and remembered per machine.

## 8. Content packs (optional sound libraries)

Large sample libraries are **not shipped with the app** (keeps the AppImage small); users download them on demand.
Packs: `concerto` (Concerto, ~195 MB, from `resources/concerto/`) and `studiodrums` (Studio Drums, ~86 MB, from
`resources/drumkits/`). The git-lfs files in those folders stay the source of truth for building the packs.

* **Registry** `renderer/src/packs/packs.json` (id → version, source folder, sizeBytes, files, sha256 — the last three are
  written by the builder) + `packs/registry.ts` (names, descriptions, licences, which plugins need which pack).
* **Build** `npm run pack:concerto` / `npm run pack:studiodrums` / `npm run packs` → `dist-packs/<id>-<version>.tar`
  (deterministic, uncompressed ustar — FLACs are already compressed) + `<id>-<version>.json` manifest
  `{ id, version, file, size, sha256, files }`. It prints the `gh release upload packs-v1 …` command.
  **Bump the pack's `version` in packs.json whenever its content changes**, rebuild, upload; the app compares the sha256
  compiled into it with the release manifest, so a re-built pack must be re-uploaded.
* **Hosting** GitHub release tag `packs-v1` of the repo in package.json `"repository"` (fallback `elevchyt/ArkaneDAW`):
  `https://github.com/<repo>/releases/download/packs-v1/<id>-<version>.{json,tar}`. `ARKANE_PACKS_BASE_URL` overrides the
  base URL (testing / mirrors).
* **Install** (main process, `src/main/packs.ts`, Node built-ins only): fetch manifest → download the tar to
  `<userData>/packs/.downloads/<asset>.part` (follows redirects, resumes with `Range`, cancellable) → verify size + sha256 →
  extract into `<userData>/packs/<id>.tmp` (rejects absolute / `..` paths; pax + ustar-prefix + GNU long names) → write
  `pack.json` → rename to `<userData>/packs/<id>/` (e.g. `~/.config/ArkaneDAW/packs/concerto`). Installed ⇔ `pack.json`
  exists. IPC: `packs:info|installed|install|cancel|remove`, progress events on `packs:progress`; preload exposes `host.packs`.
* **Loaders** (`plugins/concerto/loader.ts`, `plugins/studiodrums/loader.ts`) take their root from `packs/paths.ts`:
  installed pack first, then `<resources>/<dir>` **only when unpackaged** (dev checkout). Neither → "not installed": the DSP
  gets no instruments (silent) and the editor (wrapped with `withPack`) shows a *"… sound library not installed — Download"*
  panel. After install/remove every channel using the plugin re-resolves its data (no project reload needed).
* **UX** every instrument list (channel rack `+` menu and Replace/Insert submenus, ADD menu, plugin picker, browser plugin
  database, drag & drop onto the rack) shows a dim-orange `⬇ 181 MB` badge on not-installed pack plugins and inline progress
  while downloading. Selecting such an item does not add a channel: `guardPack()` opens the download dialog (description,
  size, licence, install location → Download / Cancel → progress with MB, speed, ETA, Cancel; closable — the download
  continues) and, once installed, offers the original action ("Add to channel rack" / "Replace <channel>").
  OPTIONS › *Sound libraries…* lists packs with Install / Update / Remove. Offline → error with Retry; release asset missing
  (HTTP 404) → "Pack not published yet".
* **Packaging**: `resources/concerto/**` and `resources/drumkits/**` must be excluded from packaged builds — see
  `build/package-excludes.json` (feed it to the packager's exclude list once one is configured).
