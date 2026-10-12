# The `.arkane` project format

An ArkaneDAW project is one JSON file (`<name>.arkane`). Recorded or rendered audio is stored as WAV files in a
`<name> audio/` folder next to it. Everything here is plain data, so you can create or change projects with a
script, a text editor or an AI agent (Claude Code, Codex, …) instead of the UI.

- **Plugin reference:** [`plugins.json`](plugins.json) lists every built-in plugin with its id, its parameters
  (id, range, default, unit, option names) and its preset names. It is generated from the source and kept up to date.
- **Type definitions:** [`src/renderer/src/store/types.ts`](../src/renderer/src/store/types.ts) is the exact schema.

## Editing rules

- **Leave out what you don't care about.** When it loads a project, the app fills in defaults for every missing
  field, clamps numbers to their ranges, creates missing or duplicate ids, and drops anything that points to
  something that doesn't exist (notes for an unknown channel, clips of a missing pattern, …). A file that only has
  `channels` and `patterns` is a valid project.
- **Ids** are any unique strings. Use readable ones (`"kick"`, `"verse"`) when you write a file by hand. Notes
  inside a pattern are matched to channels by channel id.
- **Editing while the project is open:** the app watches the open file. If the project has no unsaved
  changes, it reloads automatically. Otherwise it asks first. A reload is one undo step, so Ctrl+Z in the app
  goes back to the state before it. Keep the JSON valid when you write the file: the app ignores a write it
  can't parse and waits for the next one.
- The app saves with one-space indentation. Write the file however you like.

## Units

| Thing | Unit |
|---|---|
| Time (`pos`, `len`, `start`, `length`, `offset`, …) | **ticks**, 96 per quarter note (PPQ 96): 1 step (1/16) = 24, 1 beat = 96, 1 bar of 4/4 = 384 |
| Note `key` | MIDI number 0–131, **FL Studio naming: 60 = C5** (one octave higher than the usual "C4 = 60") |
| `tempo` | BPM, 10–522 |
| Channel `volume` | 0–1.25 linear; **0.78 = 100 %** (the default) |
| Mixer track `volume` | 0–1.25 fader position; **0.8 = 0 dB** (the default) |
| `pan` | -1 (left) … 1 (right) |
| Note `vel` | 0–1 (default 0.78 ≈ FL's 100/128) |
| `pitch` (channel), `masterPitch`, note `fine` | cents |
| Plugin `params` | the plugin's own units, see `plugins.json` (an `options` param takes the option's index) |

## Structure

```jsonc
{
  "version": 1,
  "name": "My Song",
  "tempo": 128,
  "timeSig": [4, 4],
  "swing": 0,                 // 0..1
  "masterVolume": 0.8,
  "channels": [ /* Channel */ ],
  "patterns": [ /* Pattern */ ],
  "playlist": { "tracks": [ /* 200 tracks, optional */ ], "clips": [ /* Clip */ ] },
  "mixer": [ /* index 0 = Master, 1..125 = inserts; optional */ ],
  "automations": [], "samples": [], "markers": []
}
```

### Channel (channel rack)

```jsonc
{
  "id": "lead", "name": "Lead",
  "kind": "instrument",                 // "sampler" for a sample player (plugin "sampler")
  "plugin": { "pluginId": "triosc", "params": { /* only the ones you change */ } },
  "volume": 0.78, "pan": 0, "pitch": 0,
  "mixerTrack": 1,                      // 0 = Master, 1..125 = insert, -1 = none
  "rootNote": 60                        // key used by step-sequencer steps (drum channels: the drum's key)
}
```

`plugin.params` may leave out any parameter: missing ones use the plugin's default. A plugin marked `hasData` in
`plugins.json` keeps more state in `plugin.data` (kits, sequences, sample references…). Leave `data` out to get the
plugin's default. Copy it from a project saved by the app if you need something specific.

**Drum machine** (`drummachine`) plays General MIDI drum keys: 36 kick, 38 snare, 39 clap, 42 closed hat,
46 open hat, 49 crash, 51 ride, 41/43/45/48 toms (full map: [`keymap.ts`](../src/renderer/src/plugins/drummachine/keymap.ts)). Set the channel's `rootNote` to the drum's key and put the notes on that key.

### Pattern

```jsonc
{
  "id": "verse", "name": "Verse", "color": "#6b8496",
  "length": 0,                          // ticks; 0 = automatic (whole bars of content, min 1 bar)
  "notes": {
    "lead": [ { "pos": 0, "len": 96, "key": 72, "vel": 0.8 } ]
  }
}
```

A note's full field list: `id, key, pos, len, vel, pan, rel, fine, modX, modY, color, slide, porta, muted`. Only
`pos` is required. The default is a 1-step (24-tick) C5 at velocity 0.78.
**Step-sequencer steps are just notes:** a 24-tick note on the channel's `rootNote` at `pos = step * 24`.

### Playlist clip (song arrangement)

```jsonc
{ "kind": "pattern", "ref": "verse", "track": 0, "start": 0, "length": 1536 }
```

- `kind` is `"pattern"`, `"audio"` (ref = sample id) or `"automation"` (ref = automation id).
- `track` 0–199, `start` and `length` in ticks. `offset` = ticks into the source.
- A pattern clip longer than its pattern loops the pattern.

### Mixer track

```jsonc
{
  "name": "Drums", "volume": 0.8, "pan": 0,
  "slots": [ { "plugin": { "pluginId": "compressor", "params": {} }, "enabled": true, "mix": 1 }, null, … ],  // 10 FX slots
  "sends": [ { "target": 0, "level": 1 } ]            // where this insert goes (default: Master)
}
```

`mixer` is indexed by position: `mixer[0]` is the Master and `mixer[n]` is insert *n*. You can stop the list after
the last insert you use. The rest is filled in.

### Samples

```jsonc
{ "id": "kick", "name": "Kick", "path": "/abs/path/kick.wav", "duration": 0.4, "sampleRate": 44100, "channels": 2 }
```

A sampler channel uses `{ "kind": "sampler", "plugin": { "pluginId": "sampler", "params": {}, "data": { "sampleId": "kick" } } }`.

## Minimal example

Four-on-the-floor drums and a bass line, 8 bars in the playlist:

```json
{
  "name": "Example",
  "tempo": 124,
  "channels": [
    { "id": "kick", "name": "Kick", "plugin": { "pluginId": "drummachine" }, "rootNote": 36 },
    { "id": "hat", "name": "Hat", "plugin": { "pluginId": "drummachine" }, "rootNote": 42 },
    { "id": "bass", "name": "Bass", "plugin": { "pluginId": "bassline" }, "mixerTrack": 1 }
  ],
  "patterns": [
    {
      "id": "groove", "name": "Groove", "length": 384,
      "notes": {
        "kick": [ { "pos": 0, "key": 36 }, { "pos": 96, "key": 36 }, { "pos": 192, "key": 36 }, { "pos": 288, "key": 36 } ],
        "hat": [ { "pos": 48, "key": 42 }, { "pos": 144, "key": 42 }, { "pos": 240, "key": 42 }, { "pos": 336, "key": 42 } ],
        "bass": [ { "pos": 0, "len": 72, "key": 36 }, { "pos": 96, "len": 72, "key": 36 }, { "pos": 192, "len": 72, "key": 39 }, { "pos": 288, "len": 72, "key": 34 } ]
      }
    }
  ],
  "playlist": { "clips": [ { "kind": "pattern", "ref": "groove", "track": 0, "start": 0, "length": 3072 } ] }
}
```
