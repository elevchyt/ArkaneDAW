import { describe, expect, it } from 'vitest'
import factory from './dsp'
import { manifest } from './manifest'
import { KITS } from './data'
import { DRUM_KEYS, PAD_NAMES, ROLES, resolveKey } from './keymap'
import { defaultParams } from '../sdk/module'
import { Biquad } from '../sdk/dsp'
import { SR, note, renderInstrument, stats, writeWav, type Rendered } from '../sdk/test-utils'
import { resolveKit } from './kits'
import { SampleEntry } from './engine'

const params = defaultParams(manifest)
const data = (kit: string) => ({ kit, pads: {} })

function one(kit: string, key: number, seconds = 4, vel = 0.8): Rendered {
  return renderInstrument(factory, { params, data: data(kit), notes: [{ at: 0, dur: 0.1, note: note(key, { vel }) }], seconds })
}

function rms(x: Float32Array, from: number, to: number): number {
  let s = 0
  const a = Math.floor(from * SR)
  const b = Math.min(x.length, Math.floor(to * SR))
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, b - a))
}

function goertzel(x: Float32Array, f: number, n: number): number {
  const w = (2 * Math.PI * f) / SR
  const c = 2 * Math.cos(w)
  let s1 = 0, s2 = 0
  for (let i = 0; i < n; i++) {
    const s = x[i] + c * s1 - s2
    s2 = s1
    s1 = s
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2
}

function hfRatio(x: Float32Array, cutoff = 4000): number {
  const hp = new Biquad(SR)
  hp.set('hp', cutoff, 0.707)
  let e = 0, eh = 0
  for (let i = 0; i < x.length; i++) {
    const y = hp.process(x[i])
    e += x[i] * x[i]
    eh += y * y
  }
  return eh / Math.max(1e-12, e)
}

describe('drummachine: contract', () => {
  it('manifest + key map', () => {
    expect(manifest.id).toBe('drummachine')
    expect(JSON.parse(JSON.stringify(manifest.defaultData))).toEqual({ kit: '808', pads: {} })
    expect(DRUM_KEYS.kick).toBe(36)
    expect(DRUM_KEYS.snare).toBe(38)
    expect(DRUM_KEYS.clap).toBe(39)
    expect(DRUM_KEYS.closedHat).toBe(42)
    expect(DRUM_KEYS.openHat).toBe(46)
    expect(PAD_NAMES[36]).toBe('Kick')
    expect(resolveKey(60)).toEqual([63, 7])
    expect(resolveKey(30)).toEqual([36, -6])
    expect(resolveKey(100)).toBeNull()
    expect(manifest.presets!.map((p) => p.name)).toEqual(KITS.map((k) => k.name))
  })
})

describe('drummachine: every kit, every pad', () => {
  for (const kit of KITS) {
    it(`${kit.id}: all mapped keys render, are bounded and decay`, () => {
      for (const r of ROLES) {
        const out = one(kit.id, r.key, 4)
        const s = stats(out.L)
        const sr = stats(out.R)
        const tag = `${kit.id} ${r.key} ${r.name}`
        expect(s.nan || sr.nan, tag).toBe(false)
        expect(Math.max(s.peak, sr.peak), tag).toBeGreaterThan(0.03)
        expect(Math.max(s.peak, sr.peak), tag).toBeLessThan(1.5)
        expect(rms(out.L, 3.5, 4), tag).toBeLessThan(1e-3)
      }
    })
  }
})

describe('drummachine: sound character', () => {
  it('808 kick has its fundamental around 45-65 Hz', () => {
    const r = one('808', 36, 1)
    let best = 0, bestF = 0
    for (let f = 20; f <= 200; f += 1) {
      const p = goertzel(r.L, f, SR)
      if (p > best) {
        best = p
        bestF = f
      }
    }
    expect(bestF).toBeGreaterThanOrEqual(45)
    expect(bestF).toBeLessThanOrEqual(65)
  })

  it('hats are bright in every kit', () => {
    for (const kit of KITS) {
      for (const key of [42, 46]) {
        const r = one(kit.id, key, 1)
        expect(hfRatio(r.L), `${kit.id} ${key}`).toBeGreaterThan(0.5)
      }
    }
  })

  it('closed hat chokes open hat', () => {
    for (const kit of ['808', '909', 'Linn', 'SP-12']) {
      const alone = renderInstrument(factory, { params, data: data(kit), notes: [{ at: 0, dur: 0.1, note: note(46) }], seconds: 1 })
      const choked = renderInstrument(factory, {
        params,
        data: data(kit),
        notes: [
          { at: 0, dur: 0.1, note: note(46) },
          { at: 0.1, dur: 0.05, note: note(42) }
        ],
        seconds: 1
      })
      expect(rms(choked.L, 0.3, 1), kit).toBeLessThan(rms(alone.L, 0.3, 1) * 0.05)
    }
  })

  it('per-pad tweaks: level -40 silences, tune changes pitch, choke group 0 lets hats ring', () => {
    const silent = renderInstrument(factory, { params, data: { kit: '808', pads: { '808': { '36': { level: -40 } } } }, notes: [{ at: 0, dur: 0.1, note: note(36) }], seconds: 0.3 })
    expect(stats(silent.L).peak).toBe(0)
    const up = renderInstrument(factory, { params, data: { kit: '808', pads: { '808': { '36': { tune: 12 } } } }, notes: [{ at: 0, dur: 0.1, note: note(36) }], seconds: 1 })
    expect(goertzel(up.L, 100, SR)).toBeGreaterThan(goertzel(up.L, 50, SR))
    const alone = renderInstrument(factory, { params, data: data('808'), notes: [{ at: 0, dur: 0.1, note: note(46) }], seconds: 1 })
    const ring = renderInstrument(factory, {
      params,
      data: { kit: '808', pads: { '808': { '46': { choke: 0 } } } },
      notes: [
        { at: 0, dur: 0.1, note: note(46) },
        { at: 0.1, dur: 0.05, note: note(42) }
      ],
      seconds: 1
    })
    expect(rms(ring.L, 0.15, 0.4)).toBeGreaterThan(rms(alone.L, 0.15, 0.4) * 0.5)
  })

  it('velocity: accents are louder', () => {
    const soft = stats(one('909', 38, 0.5, 0.3).L).peak
    const loud = stats(one('909', 38, 0.5, 1).L).peak
    expect(loud).toBeGreaterThan(soft * 1.5)
  })

  it('gated mode cuts long sounds at note-off', () => {
    const r = renderInstrument(factory, { params: { ...params, gate: 1 }, data: data('Trap'), notes: [{ at: 0, dur: 0.2, note: note(36) }], seconds: 1 })
    expect(rms(r.L, 0.4, 1)).toBeLessThan(1e-4)
  })
})

// A busy 16th-note pattern for CPU numbers + listening renders.
function beat(bars: number, bpm = 120): { at: number; dur: number; note: ReturnType<typeof note> }[] {
  const s16 = 60 / bpm / 4
  const ev: { at: number; dur: number; note: ReturnType<typeof note> }[] = []
  const add = (step: number, key: number, vel = 0.8) => ev.push({ at: step * s16, dur: s16, note: note(key, { vel }) })
  for (let b = 0; b < bars; b++) {
    const o = b * 16
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0 || i === 10) add(o + i, 36, i === 0 ? 1 : 0.8)
      if (i === 4 || i === 12) add(o + i, 38, 0.9)
      if (i === 12) add(o + i, 39, 0.7)
      if (i % 4 === 2) add(o + i, 46, 0.6)
      else add(o + i, 42, i % 2 ? 0.45 : 0.7)
      if (i === 7 || i === 15) add(o + i, 37, 0.5)
      if (i === 6 || i === 14) add(o + i, 56, 0.5)
      if (i === 3 || i === 11) add(o + i, 63, 0.6)
    }
    if (b % 4 === 0) add(o, 49, 0.8)
    if (b % 2 === 1) for (const [i, k] of [[12, 50], [13, 48], [14, 45], [15, 41]] as const) add(o + i, k, 0.8)
    add(o + 8, 51, 0.5)
  }
  return ev
}

describe('drummachine: CPU + renders', () => {
  it('benchmark busy pattern on every kit + write WAVs', async () => {
    const lines: string[] = []
    const seconds = 16
    for (const kit of KITS) {
      // warm the ROM cache / normalization so we measure steady-state playback
      renderInstrument(factory, { params, data: data(kit.id), notes: beat(1), seconds: 2 })
      const t0 = performance.now()
      const r = renderInstrument(factory, { params, data: data(kit.id), notes: beat(8), seconds })
      const ms = performance.now() - t0
      const s = stats(r.L)
      expect(s.nan).toBe(false)
      lines.push(`${kit.id.padEnd(11)} ${(ms / seconds).toFixed(2).padStart(6)} ms per audio-second  (${((ms / 1000 / seconds) * 100).toFixed(2)}% of one core, peak ${s.peak.toFixed(2)})`)
      await writeWav(`/tmp/drummachine-${kit.id}.wav`, r)
    }
    console.log('Drum Machine CPU (busy 16th pattern, 120 bpm, 1 instance):\n' + lines.join('\n'))
    for (const l of lines) expect(Number(/peak ([\d.]+)/.exec(l)![1]), l).toBeLessThan(2.5) // 4-5 stacked hits per step
  }, 120000)

  it('first-load ROM render time for sampled kits', () => {
    const lines: string[] = []
    for (const kit of KITS.filter((k) => k.mode === 'sampled')) {
      const { def, pads } = resolveKit(kit.id)
      const t0 = performance.now()
      let worst = 0
      let worstName = ''
      let bytes = 0
      for (const p of pads) {
        const t1 = performance.now()
        const e = new SampleEntry(p.recipe, def.conv!, p.key)
        e.finish()
        bytes += (e.clean.length + (e.dirty !== e.clean ? e.dirty.length : 0) + (def.conv!.alias ? e.clean.length * 2 : 0)) * 4
        const dt = performance.now() - t1
        if (dt > worst) {
          worst = dt
          worstName = p.name
        }
      }
      lines.push(`${kit.id.padEnd(11)} ${(performance.now() - t0).toFixed(0).padStart(4)} ms for ${pads.length} pads (slowest ${worstName} ${worst.toFixed(0)} ms), ${(bytes / 1e6).toFixed(1)} MB`)
    }
    console.log('ROM render (done in the background, ~0.2 ms per audio block; cached across instances):\n' + lines.join('\n'))
  })

  it('writes a pad tour per kit', async () => {
    for (const kit of KITS) {
      const notes = ROLES.map((r, i) => ({ at: i * 0.45, dur: 0.1, note: note(r.key, { vel: 0.9 }) }))
      const r = renderInstrument(factory, { params, data: data(kit.id), notes, seconds: ROLES.length * 0.45 + 2 })
      await writeWav(`/tmp/drummachine-${kit.id}-pads.wav`, r)
    }
  }, 60000)
})

describe('drummachine: UI data helpers', () => {
  it('keyNames follow the selected kit', async () => {
    const mod = (await import('./index')).default
    const names808 = mod.keyNames!({ params, data: { kit: '808', pads: {} } })!
    expect(names808[36]).toEqual({ name: 'Kick', group: 'Kick' })
    expect(names808[42].group).toBe('Hats')
    expect(Object.keys(names808).length).toBe(ROLES.length)
    const trap = mod.keyNames!({ params, data: { kit: 'Trap', pads: {} } })!
    expect(trap[36].name).toBe('808 Bass')
    expect(mod.manifest.name).toBe('Classic Drum Machines')
  })

  it('grooves expand to in-range notes on mapped keys', async () => {
    const { GROOVES, grooveNotes } = await import('./grooves')
    for (const g of GROOVES) {
      const n = grooveNotes(g, 1)
      expect(n.length).toBeGreaterThan(4)
      for (const x of n) {
        expect(resolveKey(x.key), `${g.name} ${x.key}`).not.toBeNull()
        expect(x.pos).toBeGreaterThanOrEqual(0)
        expect(x.pos).toBeLessThan(96 * 4)
      }
    }
  })
})
