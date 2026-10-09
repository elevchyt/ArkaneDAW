# Studio Drums — sample sources & licences

The drum kits in this folder are **derived works** of the freely redistributable sample libraries listed
below. They were produced by `scripts/drumkits/build.mjs` (`npm run drumkits`): velocity layers and round
robins were selected, multi-microphone recordings were mixed down to stereo, silence was trimmed, tails were
shortened and faded, levels were normalised per drum, and everything was resampled to 48 kHz and encoded as
16-bit FLAC. Exact download URLs and checksums are in `scripts/drumkits/sources.mjs` / `sources.lock.json`.

| Folder | Kit | Source | Licence |
|---|---|---|---|
| `studio/` | Studio Rock | DRSKit 2.1 (DrumGizmo) | CC BY 4.0 |
| `brushes/` | Jazz Brushes | DRSKit 2.1 (DrumGizmo), brush ("whisker") articulations | CC BY 4.0 |
| `metal/` | Metal | CrocellKit 1.1 (DrumGizmo) | CC BY 4.0 |
| `vintage/` | Vintage Funk | AVL Drumkits — Red Zeppelin (2023 repack) | CC BY-SA 3.0 |
| `pearl/` | Pop Pearl | AVL Drumkits — Black Pearl (2023 repack) | CC BY-SA 3.0 |
| `bop/` | Jazz Bop | AVL Drumkits — Blonde Bop | CC BY-SA 3.0 |
| `rods/` | Hot Rods | AVL Drumkits — Blonde Bop HR (Hot Rods) | CC BY-SA 3.0 |
| `latin/` | Latin Percussion | AVL Drumkits — Buskman's Holiday & Percussion 1.1; VCSL; FluidR3_GM | CC BY-SA 3.0 / CC0 / MIT (per file, see below) |

Some kits reuse pieces of other kits (e.g. the Studio kit's china and splash come from `metal/`, the sticks
click from `vintage/`); `kit.json` always points at the original file.

---

## DrumGizmo kits — DRSKit & CrocellKit (CC BY 4.0)

* **DRSKit** — kit by Jes Eiler / DRSDrums (drsdrums.dk); kit setup, mic setup and sampling by Deva & Lars
  Muldjord; edited and prepared for DrumGizmo by Lars Muldjord. <https://drumgizmo.org/wiki/doku.php?id=kits:drskit>
* **CrocellKit** — the kit of the Danish metal band Crocell (crocell.dk), mic setup by Jacob Olsen of JBOSound
  (jbosound.com), sampled and prepared for DrumGizmo by Lars Muldjord. <https://drumgizmo.org/wiki/doku.php?id=kits:crocellkit>

Licence: Creative Commons Attribution 4.0 International — <https://creativecommons.org/licenses/by/4.0/>.
Changes: see the top of this file (multi-mic mixdown to stereo, selection, trimming, normalisation, resampling).

The DrumGizmo team asks that *when the samples are used in a composition, any context in which other credits
(e.g. to performers) are presented includes an attribution*, e.g.:

> Drum samples: DRSKit / CrocellKit by DrumGizmo (drumgizmo.org), CC BY 4.0

## AVL Drumkits by Glen MacArthur (CC BY-SA 3.0)

Red Zeppelin, Black Pearl, Blonde Bop, Blonde Bop HR, Buskman's Holiday and AVL Percussion —
© Glen MacArthur, <https://www.bandshed.net/avldrumkits/>.

Licence: Creative Commons Attribution-ShareAlike 3.0 Unported — <https://creativecommons.org/licenses/by-sa/3.0/>
(with the author's clarification that music made with the kits may be distributed or sold without credit;
attribution and share-alike apply to the samples / library itself).

The processed AVL-derived files in `vintage/`, `pearl/`, `bop/`, `rods/` and the AVL-derived files in `latin/`
(`clap`, `snap`, `tamb`, `tambshake`, `cowbell`, `congahi`, `congalo`, `claves`, `shaker`, `cajonbass`,
`cajonslap`, `maracas`, `woodblock`, plus the `sticks` click in `vintage/`) are therefore distributed under
**CC BY-SA 3.0** as well.

## Versilian Community Sample Library (CC0)

Versilian Studios — <https://github.com/sgossner/VCSL> (commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`).
Public domain dedication (CC0 1.0). Used in `latin/`: `cowbell2`, `paila` (a muted cowbell standing in for the
timbale shell), `vibraslap`, `bongohi`, `bongolo`, `bongohimute`, `congamute`, `quinto`, `tumba`, `agogohi`,
`agogolo`, `cabasa`, `guiroshort`, `guirolong`, `trianglemute`, `triangle`.

## FluidR3_GM SoundFont (MIT)

Used in `latin/`: `timbalehi`, `timbalelo`.

```
Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>
Copyright (c) 2008 Toby Smithe

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```
