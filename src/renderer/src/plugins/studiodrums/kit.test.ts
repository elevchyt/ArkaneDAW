import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KITS } from './kits.gen'
import { STRIPS } from './types'
import { DRUMKITS_DIR, hasKits, kitIds, readKit } from './testkit'
import plugin from './index'
import { manifest } from './manifest'

const CORE_DRUM_KEYS = [35, 36, 37, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 55, 57, 59]
const CORE_PERC_KEYS = [39, 54, 56, 60, 61, 62, 63, 64, 65, 66, 69, 70, 73, 74, 75, 76, 82, 84]

describe.skipIf(!hasKits)('kit.json files', () => {
  const ids = kitIds()

  it('index lists every kit of kits.gen.ts', () => {
    expect(ids.sort()).toEqual(KITS.map((k) => k.id).sort())
  })

  for (const id of ids) {
    describe(id, () => {
      const kit = readKit(id)

      it('is well formed', () => {
        expect(kit.format).toBe(1)
        expect(kit.id).toBe(id)
        expect(kit.velocityExponent).toBeGreaterThan(0)
        expect(Object.keys(kit.keys).length).toBeGreaterThan(20)
      })

      it('every key points to an existing piece and a valid mixer strip', () => {
        for (const [k, def] of Object.entries(kit.keys)) {
          const key = Number(k)
          expect(key, k).toBeGreaterThanOrEqual(0)
          expect(key, k).toBeLessThanOrEqual(127)
          expect(kit.pieces[def.piece], `${id} key ${k} → ${def.piece}`).toBeDefined()
          expect(STRIPS as readonly string[], `${id} key ${k} strip`).toContain(def.ch)
          expect(def.name.length).toBeGreaterThan(0)
          for (const g of def.chokes ?? []) expect(g).toBeGreaterThan(0)
        }
      })

      it('every piece has velocity layers covering 1–127 and existing sample files', () => {
        for (const [pid, p] of Object.entries(kit.pieces)) {
          expect(p.layers.length, pid).toBeGreaterThan(0)
          expect([1, 2]).toContain(p.channels)
          expect(p.layers[0].lo, pid).toBe(1)
          expect(p.layers[p.layers.length - 1].hi, pid).toBe(127)
          p.layers.forEach((l, i) => {
            expect(l.lo, `${pid} layer ${i}`).toBeLessThanOrEqual(l.hi)
            expect(l.vel).toBeGreaterThanOrEqual(l.lo)
            expect(l.vel).toBeLessThanOrEqual(l.hi)
            if (i > 0) {
              expect(l.lo, `${pid} layer ${i} contiguous`).toBe(p.layers[i - 1].hi + 1)
              expect(l.vel).toBeGreaterThan(p.layers[i - 1].vel)
            }
            expect(l.amp).toBeGreaterThan(0)
            expect(l.amp).toBeLessThanOrEqual(1)
            expect(l.files.length).toBeGreaterThan(0)
            expect(l.files.length).toBeLessThanOrEqual(4)
            for (const f of l.files) {
              const path = join(DRUMKITS_DIR, f)
              expect(existsSync(path), f).toBe(true)
              expect(statSync(path).size, f).toBeGreaterThan(200)
            }
          })
        }
      })

      it('has the General MIDI percussion keys', () => {
        for (const k of CORE_PERC_KEYS) expect(kit.keys[k], `${id} key ${k}`).toBeDefined()
        if (id !== 'latin') for (const k of CORE_DRUM_KEYS) expect(kit.keys[k], `${id} key ${k}`).toBeDefined()
      })

      it('open hat is choked by closed & pedal hat', () => {
        if (id === 'latin') return
        expect(kit.keys[46].choke).toBe(1)
        expect(kit.keys[42].chokes).toContain(1)
        expect(kit.keys[44].chokes).toContain(1)
      })

      it('kits.gen.ts metadata matches kit.json', () => {
        const meta = KITS.find((k) => k.id === id)!
        expect(Object.keys(meta.keys).sort()).toEqual(Object.keys(kit.keys).sort())
        for (const [k, v] of Object.entries(kit.keys)) expect(meta.keys[k].name).toBe(v.name)
        expect(meta.pads.length).toBeGreaterThanOrEqual(2)
        for (const b of meta.pads) expect(b.keys.length).toBe(16)
      })
    })
  }
})

describe('plugin module', () => {
  it('keyNames follows the selected kit', () => {
    const names = plugin.keyNames!({ params: {}, data: { kit: 'metal' } })!
    expect(names[36].name).toBe('Kick')
    expect(names[36].group).toBe('Kick')
    expect(names[42].group).toBe('Hats')
    expect(names[63].group).toBe('Perc')
    const latin = plugin.keyNames!({ params: {}, data: { kit: 'latin' } })!
    expect(latin[36]).toBeUndefined()
    expect(latin[65].name).toMatch(/Timbale/)
  })

  it('presets reference existing kits and params', () => {
    const ids = new Set(KITS.map((k) => k.id))
    const params = new Set(manifest.params.map((p) => p.id))
    for (const pr of manifest.presets!) {
      expect(ids.has((pr.data as { kit: string }).kit), pr.name).toBe(true)
      for (const k of Object.keys(pr.params)) expect(params.has(k), `${pr.name}: ${k}`).toBe(true)
    }
  })
})
