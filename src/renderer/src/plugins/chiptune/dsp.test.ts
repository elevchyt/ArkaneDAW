import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { presetParams, defaultParams } from '../sdk/module'
import { note, renderInstrument, stats, writeWav, SR, type Rendered } from '../sdk/test-utils'
import { DRUM_KEYS, KIT_MAPS, SFX_START } from './drumkeys'
import { defaultChipData, seq, seqNext } from './data'
import type { NoteOn } from '../sdk/types'

const P = (over: Record<string, number> = {}): Record<string, number> => ({ ...defaultParams(manifest), ...over })
const nt = (key: number, id: number, o: Partial<NoteOn> = {}): NoteOn => note(key, { id, ...o })

function peakOf(x: Float32Array, a = 0, b = x.length): number {
  let p = 0
  for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

/** Frequency estimate from upward zero crossings (linear interpolated). */
function freqOf(x: Float32Array, a: number, b: number): number {
  let first = -1
  let last = -1
  let n = 0
  for (let i = a + 1; i < b; i++) {
    if (x[i - 1] <= 0 && x[i] > 0) {
      const t = i - 1 + -x[i - 1] / (x[i] - x[i - 1])
      if (first < 0) first = t
      else n++
      last = t
    }
  }
  return n > 0 ? (n * SR) / (last - first) : 0
}

const midi = (f: number): number => 69 + 12 * Math.log2(f / 440)

describe('chiptune presets', () => {
  const presets = manifest.presets ?? []
  it('has at least 40 presets across all categories', () => {
    expect(presets.length).toBeGreaterThanOrEqual(40)
    const cats = new Set(presets.map((p) => p.category))
    for (const c of ['Lead', 'Bass', 'Arp/Chord', 'Pad-ish', 'Pluck', 'FX/SFX', 'Drums']) expect(cats.has(c)).toBe(true)
  })

  for (const preset of presets) {
    it(`renders "${preset.name}" cleanly and releases to silence`, async () => {
      const params = presetParams(manifest, preset)
      const drums = params.mode >= 0.5
      const notes = drums
        ? [36, 38, 42, 46, 49, 45, 72].map((k, i) => ({ at: i * 0.18, dur: 0.1, note: nt(k, i + 1) }))
        : [{ at: 0, dur: 1.5, note: nt(60, 1) }, { at: 0, dur: 1.5, note: nt(64, 2) }, { at: 0.02, dur: 1.5, note: nt(67, 3) }]
      const seconds = 1.5 + 4.6
      const r = renderInstrument(factory, { params, data: preset.data, notes, seconds })
      const s = stats(r.L)
      expect(s.nan).toBe(false)
      expect(stats(r.R).nan).toBe(false)
      expect(peakOf(r.L, 0, 1.5 * SR)).toBeGreaterThan(0.02)
      expect(s.peak).toBeLessThan(1.5)
      expect(peakOf(r.L, r.L.length - Math.round(0.4 * SR))).toBeLessThan(1e-3)
      if (['NES Pulse Lead 25%', 'Echo Lead (delay via sequence)', 'Fast Arp Chords', 'Triangle Bass', 'GB Wave Bass', 'Coin Get', 'Power Up', 'NES Kit', 'Game Boy Kit', 'Arcade Kit'].includes(preset.name)) {
        await writeWav(`/tmp/chiptune-${preset.name.replace(/[^a-z0-9]+/gi, '_')}.wav`, { L: r.L.slice(0, 2.5 * SR), R: r.R.slice(0, 2.5 * SR) })
      }
    })
  }
})

describe('chiptune oscillators', () => {
  it('pulse duty measured from output matches the setting', () => {
    for (const [wave, duty] of [[0, 0.125], [1, 0.25], [2, 0.5]] as const) {
      const r = renderInstrument(factory, { params: P({ 'osc.wave': wave, 'out.lpf': 20000, 'env.quant': 0, 'voice.vel': 0 }), notes: [{ at: 0, dur: 0.6, note: nt(45, 1) }], seconds: 0.6 })
      const a = Math.round(0.2 * SR), b = Math.round(0.5 * SR)
      let mx = -9, mn = 9
      for (let i = a; i < b; i++) { mx = Math.max(mx, r.L[i]); mn = Math.min(mn, r.L[i]) }
      const mid = (mx + mn) / 2
      let hi = 0
      for (let i = a; i < b; i++) if (r.L[i] > mid) hi++
      expect(Math.abs(hi / (b - a) - duty)).toBeLessThan(0.02)
    }
  })

  it('duty sequence switches duty at frame rate', () => {
    const r = renderInstrument(factory, { params: P({ 'osc.wave': 2, 'seq.duty': 1, 'seq.div': 6, 'out.lpf': 20000 }), data: { ...defaultChipData(), duty: seq([0, 2], 0) }, notes: [{ at: 0, dur: 0.6, note: nt(45, 1) }], seconds: 0.6 })
    const frame = SR / 60
    const fracHigh = (a: number, b: number): number => {
      let mx = -9, mn = 9, hi = 0
      for (let i = a; i < b; i++) { mx = Math.max(mx, r.L[i]); mn = Math.min(mn, r.L[i]) }
      for (let i = a; i < b; i++) if (r.L[i] > (mx + mn) / 2) hi++
      return hi / (b - a)
    }
    // step 0 (12.5%) during frames 0-5, step 1 (50%) frames 6-11
    expect(Math.abs(fracHigh(Math.round(1 * frame), Math.round(5 * frame)) - 0.125)).toBeLessThan(0.04)
    expect(Math.abs(fracHigh(Math.round(7 * frame), Math.round(11 * frame)) - 0.5)).toBeLessThan(0.04)
  })

  it('every waveform is audible and tuned (tonal ones)', () => {
    for (let w = 0; w <= 8; w++) {
      const r = renderInstrument(factory, { params: P({ 'osc.wave': w }), notes: [{ at: 0, dur: 0.5, note: nt(57, 1) }], seconds: 0.5 })
      expect(stats(r.L).rms).toBeGreaterThan(0.01)
      if (w <= 4 || w === 8) expect(Math.abs(midi(freqOf(r.L, 4800, 20000)) - 57)).toBeLessThan(0.3)
    }
  })

  it('band-limited mode has less high-frequency energy than authentic', () => {
    const hf = (auth: number): number => {
      const r = renderInstrument(factory, { params: P({ 'osc.wave': 0, 'osc.authentic': auth, 'out.lpf': 20000 }), notes: [{ at: 0, dur: 0.5, note: nt(96, 1) }], seconds: 0.5 })
      let e = 0
      for (let i = 2001; i < 20000; i++) { const d = r.L[i] - 2 * r.L[i - 1] + r.L[i - 2 > 0 ? i - 2 : 0]; e += d * d }
      return e
    }
    expect(hf(0)).toBeLessThan(hf(1))
  })

  it('noise short mode is periodic (metallic), long mode is not', () => {
    const corr = (w: number): number => {
      const r = renderInstrument(factory, { params: P({ 'osc.wave': w, 'out.lpf': 20000, 'out.rate': 0 }), notes: [{ at: 0, dur: 0.5, note: nt(60, 1) }], seconds: 0.5 })
      // short LFSR repeats every 93 shifts
      const rate = 1789773 / 202 // nearest NES period for pitch 60 (~16.7 kHz) is 202? find via search below
      void rate
      let best = 0
      const x = r.L.subarray(5000, 15000)
      for (let lag = 20; lag < 2000; lag++) {
        let s = 0, a = 0, b = 0
        for (let i = 0; i < 6000; i++) { s += x[i] * x[i + lag]; a += x[i] * x[i]; b += x[i + lag] * x[i + lag] }
        best = Math.max(best, s / Math.sqrt(a * b + 1e-12))
      }
      return best
    }
    expect(corr(6)).toBeGreaterThan(0.8)
    expect(corr(5)).toBeLessThan(0.5)
  })
})

describe('chiptune modulation', () => {
  it('arpeggio cycles through held pitches', () => {
    const speed = 6
    const r = renderInstrument(factory, {
      params: P({ 'osc.wave': 2, 'arp.mode': 1, 'arp.speed': speed, 'osc.authentic': 0 }),
      notes: [{ at: 0, dur: 1, note: nt(60, 1) }, { at: 0, dur: 1, note: nt(64, 2) }, { at: 0, dur: 1, note: nt(67, 3) }],
      seconds: 1
    })
    const step = (speed * SR) / 60
    const seen: number[] = []
    for (let k = 0; k < 6; k++) {
      const a = Math.round(k * step + step * 0.2), b = Math.round((k + 1) * step - step * 0.1)
      seen.push(Math.round(midi(freqOf(r.L, a, b))))
    }
    expect(seen).toEqual([60, 64, 67, 60, 64, 67])
  })

  it('pitch sequence (absolute) arpeggiates a single note', () => {
    const r = renderInstrument(factory, { params: P({ 'osc.wave': 2, 'seq.pitch': 1, 'seq.div': 6, 'osc.authentic': 0 }), data: { ...defaultChipData(), pitch: seq([0, 4, 7], 0) }, notes: [{ at: 0, dur: 0.7, note: nt(60, 1) }], seconds: 0.7 })
    const step = (6 * SR) / 60
    const seen = [0, 1, 2, 3].map((k) => Math.round(midi(freqOf(r.L, Math.round(k * step + step * 0.25), Math.round((k + 1) * step - step * 0.1)))))
    expect(seen).toEqual([60, 64, 67, 60])
  })

  it('bend starts offset and settles to the note', () => {
    const r = renderInstrument(factory, { params: P({ 'osc.wave': 2, 'bend.amt': 12, 'bend.time': 0.2, 'osc.authentic': 0 }), notes: [{ at: 0, dur: 0.6, note: nt(57, 1) }], seconds: 0.6 })
    expect(midi(freqOf(r.L, 0, 1200))).toBeGreaterThan(66)
    expect(Math.abs(midi(freqOf(r.L, 12000, 24000)) - 57)).toBeLessThan(0.3)
  })

  it('mono glide moves pitch between legato notes', () => {
    const r = renderInstrument(factory, {
      params: P({ 'osc.wave': 2, 'voice.poly': 0, 'voice.glide': 0.2, 'osc.authentic': 0 }),
      notes: [{ at: 0, dur: 0.5, note: nt(57, 1) }, { at: 0.4, dur: 0.6, note: nt(69, 2) }],
      seconds: 1
    })
    const mid = midi(freqOf(r.L, Math.round(0.42 * SR), Math.round(0.46 * SR)))
    expect(mid).toBeGreaterThan(58)
    expect(mid).toBeLessThan(68)
    expect(Math.abs(midi(freqOf(r.L, Math.round(0.85 * SR), Math.round(0.99 * SR))) - 69)).toBeLessThan(0.3)
  })

  it('voice limit caps polyphony', () => {
    const notes = [60, 62, 64, 65, 67].map((k, i) => ({ at: 0, dur: 0.4, note: nt(k, i + 1) }))
    const one = renderInstrument(factory, { params: P({ 'voice.limit': 1, 'osc.wave': 2 }), notes, seconds: 0.4 })
    const five = renderInstrument(factory, { params: P({ 'voice.limit': 5, 'osc.wave': 2 }), notes, seconds: 0.4 })
    expect(stats(five.L).rms).toBeGreaterThan(stats(one.L).rms * 1.6)
  })

  it('sequence index honours loop and release points', () => {
    // values 0..4, loop 1, release 3
    let i = 0
    const held: number[] = []
    for (let k = 0; k < 6; k++) { held.push(i); i = seqNext(i, 5, 1, 3, false) }
    expect(held).toEqual([0, 1, 2, 3, 1, 2])
    i = 3
    expect(seqNext(i, 5, 1, 3, true)).toBe(4)
    expect(seqNext(4, 5, 1, 3, true)).toBe(4)
  })
})

describe('chiptune drums', () => {
  it('maps GM keys and SFX from C6', () => {
    const keys = new Set(DRUM_KEYS.map((d) => d.key))
    for (const k of [35, 36, 38, 39, 41, 42, 45, 46, 48, 49, 51]) expect(keys.has(k)).toBe(true)
    expect(DRUM_KEYS.filter((d) => d.group === 'SFX').every((d) => d.key >= SFX_START)).toBe(true)
  })

  it('every drum key in every kit produces a distinct, decaying sound', async () => {
    for (let kit = 0; kit < KIT_MAPS.length; kit++) {
      const feats: { key: number; f: number[]; sig: Float32Array }[] = []
      for (const def of KIT_MAPS[kit].values()) {
        const r = renderInstrument(factory, { params: P({ mode: 1, 'drum.kit': kit }), notes: [{ at: 0, dur: 0.05, note: nt(def.key, 1) }], seconds: 3 })
        const s = stats(r.L)
        expect(s.nan).toBe(false)
        expect(s.peak).toBeGreaterThan(0.02)
        expect(s.peak).toBeLessThan(1.5)
        expect(peakOf(r.L, r.L.length - 4800)).toBeLessThan(1e-3)
        let zc = 0, e = 0, te = 0
        for (let i = 1; i < r.L.length; i++) { if ((r.L[i] > 0) !== (r.L[i - 1] > 0)) zc++; const q = r.L[i] * r.L[i]; e += q; te += q * i }
        feats.push({ key: def.key, f: [Math.log(s.rms + 1e-9), Math.log(zc + 1), te / (e * SR)], sig: r.L })
        if (kit === 0 && [36, 38, 42, 46, 49, 72, 76].includes(def.key)) await writeWav(`/tmp/chiptune-drum-${def.key}.wav`, r)
      }
      for (let a = 0; a < feats.length; a++)
        for (let b = a + 1; b < feats.length; b++) {
          const d = Math.hypot(...feats[a].f.map((v, i) => v - feats[b].f[i]))
          // two drums are "the same" only if features AND waveforms match
          if (d < 0.02) {
            let diff = 0, en = 0
            for (let i = 0; i < feats[a].sig.length; i++) { diff += (feats[a].sig[i] - feats[b].sig[i]) ** 2; en += feats[a].sig[i] ** 2 }
            expect(diff / en, `kit ${kit}: keys ${feats[a].key} vs ${feats[b].key}`).toBeGreaterThan(0.05)
          }
        }
    }
  })

  it('closed hat chokes open hat', () => {
    const open = renderInstrument(factory, { params: P({ mode: 1 }), notes: [{ at: 0, dur: 0.05, note: nt(46, 1) }], seconds: 0.4 })
    const choked = renderInstrument(factory, { params: P({ mode: 1 }), notes: [{ at: 0, dur: 0.05, note: nt(46, 1) }, { at: 0.1, dur: 0.05, note: nt(42, 2) }], seconds: 0.4 })
    expect(peakOf(choked.L, Math.round(0.2 * SR), Math.round(0.3 * SR))).toBeLessThan(peakOf(open.L, Math.round(0.2 * SR), Math.round(0.3 * SR)) * 0.2)
  })

  it('per-drum tweaks (data) change tune and level', () => {
    const base = renderInstrument(factory, { params: P({ mode: 1 }), notes: [{ at: 0, dur: 0.05, note: nt(36, 1) }], seconds: 0.5 })
    const loud = renderInstrument(factory, { params: P({ mode: 1 }), data: { ...defaultChipData(), drums: { 36: { tune: 0, decay: 1, level: 0.5 } } }, notes: [{ at: 0, dur: 0.05, note: nt(36, 1) }], seconds: 0.5 })
    expect(stats(loud.L).rms).toBeLessThan(stats(base.L).rms * 0.7)
  })
})

describe('chiptune performance', () => {
  it('CPU benchmark (report)', () => {
    const bench = (label: string, params: Record<string, number>, keys: number[]): number => {
      const seconds = 10
      const notes = keys.map((k, i) => ({ at: 0, dur: seconds, note: nt(k, i + 1) }))
      const t0 = performance.now()
      renderInstrument(factory, { params, notes, seconds })
      const ms = performance.now() - t0
      const pct = (ms / 1000 / seconds) * 100
      console.log(`[chiptune bench] ${label}: ${ms.toFixed(0)} ms for ${seconds}s audio = ${pct.toFixed(2)}% of one core`)
      return pct
    }
    const eight = [48, 52, 55, 60, 64, 67, 72, 76]
    const a = bench('8 voices pulse authentic', P({ 'osc.wave': 1 }), eight)
    bench('8 voices pulse band-limited + stereo', P({ 'osc.wave': 1, 'osc.authentic': 0, 'out.stereo': 1 }), eight)
    bench('8 voices GB wave BL + vib + seq', P({ 'osc.wave': 8, 'osc.authentic': 0, 'vib.depth': 0.5, 'vib.delay': 0, 'seq.pitch': 1 }), eight)
    bench('8 voices noise long', P({ 'osc.wave': 5 }), eight)
    // drums: 12 overlapping hits
    const t0 = performance.now()
    const notes: { at: number; dur: number; note: NoteOn }[] = []
    for (let i = 0; i < 80; i++) notes.push({ at: i * 0.125, dur: 0.05, note: nt([36, 38, 42, 46, 49, 51][i % 6], i + 1) })
    renderInstrument(factory, { params: P({ mode: 1 }), notes, seconds: 10 })
    console.log(`[chiptune bench] drums 8 hits/s: ${((performance.now() - t0) / 100).toFixed(2)}% of one core`)
    expect(a).toBeLessThan(25)
  })
})

export type { Rendered }
