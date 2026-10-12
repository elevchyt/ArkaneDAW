// instrument.json validity (files, key / velocity coverage, keyswitch space) and loop-point continuity of every
// sustained sample.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import plugin from './index'
import { INSTRUMENTS } from './instruments.gen'
import { CONCERTO_DIR, decodeAll, hasData, hasFfmpeg, instrumentIds, readInstrument } from './testkit'

describe.skipIf(!hasData)('Concerto instrument.json', () => {
  it('index, generated metadata and instrument files agree', () => {
    const ids = instrumentIds()
    expect(ids.length).toBeGreaterThanOrEqual(20)
    expect(INSTRUMENTS.map((i) => i.id)).toEqual(ids)
    for (const id of ids) {
      const def = readInstrument(id)
      expect(def.id).toBe(id)
      expect(def.format).toBe(1)
      expect(def.keyswitchBase).toBe(12)
      expect(def.articulations.length).toBeGreaterThan(0)
      expect(def.articulations.length).toBeLessThanOrEqual(5)
      expect(INSTRUMENTS.find((i) => i.id === id)!.arts.map((a) => a.id)).toEqual(def.articulations.map((a) => a.id))
    }
  })

  it('every referenced file exists; zones cover the range; velocity layers cover 1–127; keyswitch keys stay free', () => {
    const failures: string[] = []
    for (const id of instrumentIds()) {
      const def = readInstrument(id)
      for (const a of def.articulations) {
        const tag = `${id}/${a.id}`
        const covered = new Set<number>()
        for (const z of [...a.zones, ...(a.release ?? [])]) {
          const isRelease = !a.zones.includes(z)
          if (z.lo > z.hi) failures.push(`${tag}: zone ${z.root} lo>hi`)
          if (z.lo < def.keyswitchBase + 5) failures.push(`${tag}: zone ${z.root} reaches keyswitch keys (${z.lo})`)
          for (const l of z.layers) {
            if (!l.files.length) failures.push(`${tag}: empty layer`)
            for (const f of l.files) {
              if (!existsSync(join(CONCERTO_DIR, f.f))) failures.push(`${tag}: missing ${f.f}`)
              if (a.kind === 'sustain' && !isRelease && !f.loop) failures.push(`${tag}: ${f.f} has no loop`)
              if (f.loop && !(f.loop[0] > 0 && f.loop[1] > f.loop[0] + 1000)) failures.push(`${tag}: ${f.f} bad loop ${f.loop}`)
              if (f.ofs !== undefined && f.loop && f.ofs > f.loop[0]) failures.push(`${tag}: ${f.f} legato offset after loop start`)
            }
          }
          // velocity coverage 1..127, contiguous
          const ls = [...z.layers].sort((x, y) => x.lo - y.lo)
          if (ls[0].lo !== 1 || ls[ls.length - 1].hi !== 127) failures.push(`${tag}: zone ${z.root} velocity ${ls[0].lo}-${ls[ls.length - 1].hi}`)
          for (let i = 1; i < ls.length; i++) if (ls[i].lo !== ls[i - 1].hi + 1) failures.push(`${tag}: zone ${z.root} velocity gap`)
          for (const l of ls) if (!(l.vel >= l.lo && l.vel <= l.hi && l.amp > 0 && l.amp <= 1)) failures.push(`${tag}: zone ${z.root} layer vel ${l.vel} [${l.lo},${l.hi}] amp ${l.amp}`)
        }
        for (const z of a.zones) for (let k = z.lo; k <= z.hi; k++) covered.add(k)
        for (let k = def.range[0]; k <= def.range[1]; k++) if (!covered.has(k)) {
          failures.push(`${tag}: key ${k} not covered`)
          break
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('unpitched percussion: dynamic layers get louder pp → fff, tail releases mirror their layers, swell keys are named', () => {
    const failures: string[] = []
    let unpitched = 0
    for (const id of instrumentIds()) {
      const def = readInstrument(id)
      for (const a of def.articulations) {
        if (!a.unpitched) continue
        unpitched++
        const tag = `${id}/${a.id}`
        for (const z of a.zones) {
          if (z.tune) failures.push(`${tag}: unpitched zone with tune`)
          for (let i = 1; i < z.layers.length; i++) if (!(z.layers[i].amp > z.layers[i - 1].amp)) failures.push(`${tag}: layer ${i + 1} not louder than layer ${i}`)
        }
        if (a.releaseTail) {
          if (!a.release?.length) failures.push(`${tag}: releaseTail without release samples`)
          for (const r of a.release ?? []) {
            const z = a.zones.find((q) => q.root === r.root)
            if (!z || z.lo !== r.lo || z.hi !== r.hi || z.layers.length !== r.layers.length) failures.push(`${tag}: release zone ${r.root} does not mirror its zone`)
            else r.layers.forEach((l, i) => l.vel !== z.layers[i].vel && failures.push(`${tag}: release layer ${i + 1} velocity`))
          }
        }
      }
    }
    expect(unpitched).toBeGreaterThanOrEqual(10)
    expect(failures).toEqual([])
    // piano-roll names: every key of the range plays; the swell articulation names its key ranges
    const layers = [{ inst: 'suscymbal', lo: 0, hi: 127, gain: 0, transpose: 0 }]
    const swell = INSTRUMENTS.find((i) => i.id === 'suscymbal')!.arts.findIndex((a) => a.id === 'swell')
    const mallet = plugin.keyNames!({ params: { art: 0 }, data: { layers } })!
    const sw = plugin.keyNames!({ params: { art: swell }, data: { layers } })!
    expect(mallet[48]?.group).toBe('Suspended Cymbal')
    expect(mallet[72]?.group).toBe('Suspended Cymbal')
    expect(mallet[47]).toBeUndefined()
    expect(mallet[50].name).toBe('D4')
    expect(sw[50].name).toMatch(/^D4 Swell \d+\.\d s$/)
    expect(sw[72].name).toMatch(/Swell/)
    expect(new Set([48, 54, 60, 66].map((k) => sw[k].name.slice(sw[k].name.indexOf(' ')))).size).toBe(4)
  })

  it.skipIf(!hasFfmpeg)('sustain loops are continuous: the wrap jump is no larger than the local waveform slope', async () => {
    const failures: string[] = []
    let checked = 0
    for (const id of instrumentIds()) {
      const def = readInstrument(id)
      const files = def.articulations.filter((a) => a.kind === 'sustain' && !a.zones.some((z) => z.part)).flatMap((a) => a.zones.flatMap((z) => z.layers.flatMap((l) => l.files)))
      const pcm = await decodeAll(files.map((f) => f.f))
      for (const f of files) {
        const [ls, le] = f.loop!
        for (const ch of pcm[f.f]) {
          if (ch.length < le + 2) {
            failures.push(`${f.f}: file shorter than loop end`)
            break
          }
          // biggest step in the 5 ms before the loop end vs the step taken at the wrap (le-1 → ls)
          let local = 0
          for (let i = le - 240; i < le - 1; i++) local = Math.max(local, Math.abs(ch[i + 1] - ch[i]))
          for (let i = ls; i < ls + 240; i++) local = Math.max(local, Math.abs(ch[i + 1] - ch[i]))
          const jump = Math.abs(ch[ls] - ch[le - 1])
          if (jump > local * 1.5 + 64) failures.push(`${f.f}: wrap jump ${jump} vs local ${local}`)
          // guard samples repeat the loop start
          if (Math.abs(ch[le] - ch[ls]) > 3) failures.push(`${f.f}: guard sample mismatch`)
        }
        checked++
      }
    }
    expect(checked).toBeGreaterThan(300)
    expect(failures).toEqual([])
  }, 300_000)
})
