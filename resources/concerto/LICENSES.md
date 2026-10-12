# Concerto — sample sources & licences

The instruments in this folder are **derived works** of the freely redistributable sample libraries listed
below. They were produced by `scripts/concerto/build.mjs` (`npm run concerto`): velocity layers and round
robins were selected, root keys were verified by pitch detection (octave naming corrected, small tuning
offsets measured), leading silence was trimmed, sustained samples were shortened and given crossfaded loops,
decaying samples were shortened and faded, levels were normalised per note, and everything was resampled to
48 kHz and encoded as 16-bit FLAC. Exact download URLs and checksums are in `scripts/concerto/sources.mjs` /
`sources.lock.json`. Ensemble instruments (e.g. `strings/`) reuse other instruments' files.

## VSCO 2 Community Edition — CC0 1.0

Versilian Studios Chamber Orchestra 2: Community Edition — recorded by Sam Gossner & Simon Dalzell, sample
cutting by Elan Hickler / Soundemote. <https://github.com/sgossner/VSCO-2-CE> (commit `6dd651d55dde97fd4028699be9d4481f26917891`, the "SFZ" branch).
Public domain dedication: Creative Commons CC0 1.0 Universal — <https://creativecommons.org/publicdomain/zero/1.0/>.
The authors ask (not as a licence condition) that the samples are not sold on their own as a sample library,
that improvements are shared, and for credit to *Versilian Studios / Sam Gossner* and a link to the VSCO
Community page (<https://vis.versilstudios.net/vsco-community.html>).

Used for: Solo Violin — Sustain; Solo Violin — Spiccato; Solo Violin — Pizzicato; Solo Violin — Tremolo; Violins — Sustain; Violins — Spiccato; Violins — Pizzicato; Violins — Tremolo; Violas — Sustain; Violas — Spiccato; Violas — Pizzicato; Violas — Tremolo; Cellos — Sustain; Cellos — Spiccato; Cellos — Pizzicato; Cellos — Tremolo; Double Bass — Sustain; Double Bass — Spiccato; Double Bass — Pizzicato; Double Bass — Tremolo; Flute — Vibrato; Flute — Staccato; Flute — Non-vib; Oboe — Vibrato; Oboe — Staccato; Oboe — Non-vib; Clarinet — Sustain; Clarinet — Staccato; Bassoon — Sustain; Bassoon — Staccato; French Horn — Sustain; French Horn — Staccato; Baroque Trumpet — Sustain; Baroque Trumpet — Staccato; Trombone — Sustain; Trombone — Staccato; Timpani — Hits; Timpani — Roll.

## Versilian Community Sample Library — CC0 1.0

Versilian Studios — <https://github.com/sgossner/VCSL> (commit `c1ea7bcc3c7309650ab0da9d15c9cd1fbc4a4c7e`).
Public domain dedication (CC0 1.0): "you can do whatever you want with these sounds (even make commercial
software), no royalties, no credit, no special terms".

Used for: Recorder — Sustain; Recorder — Staccato; Harpsichord — 8′ Stop; Harpsichord — 8′ Stop (release samples); Harpsichord — Lute Stop; Harpsichord — Lute Stop (release samples); Pipe Organ — Full; Pipe Organ — Soft; Chamber Organ — 8′ Flute; Chamber Organ — Full; Fortepiano — Normal; Fortepiano — Normal (release samples); Celesta & Glockenspiel — Glockenspiel; Clash Cymbals — Crash; Clash Cymbals — Crash II; Clash Cymbals — Choke; Suspended Cymbal — Mallet; Suspended Cymbal — Stick; Suspended Cymbal — Bell; Suspended Cymbal — Roll; Suspended Cymbal — Roll (release samples); Suspended Cymbal — Swell; Gong / Tam-tam — Hit; Gong / Tam-tam — Scrape; Harp — Normal.

## FluidR3_GM SoundFont — MIT

FluidR3_GM by Frank Wen (and contributors), distributed under the MIT licence
(<https://github.com/pianobooster/fluid-soundfont>, file `FluidR3_GM.sf2`, sha256 `74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0`). Used only where no CC0
multi-sampled recording was available. Loops were unrolled and re-looped at 48 kHz; the celesta got a baked decay.

Used for: Solo Cello — Sustain; Celesta & Glockenspiel — Celesta; Choir — Aahs; Choir — Oohs; Lute / Guitar — Normal.

> Copyright (c) 2000-2002, 2008, 2012 Frank Wen <getfrank@gmail.com>
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
> documentation files (the "Software"), to deal in the Software without restriction, including without
> limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
> the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial
> portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
> TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
> THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

## Suggested credit

> Orchestral samples: VSCO 2 Community Edition & VCSL by Versilian Studios (CC0); FluidR3_GM by Frank Wen (MIT).
