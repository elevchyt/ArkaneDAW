import { describe, expect, it } from 'vitest'
import { GENRES, barTicks, pat } from './grooves'
import { KITS } from './kits.gen'

const DRUM_KITS = KITS.filter((k) => k.id !== 'latin')
const PARTS_REQUIRED = ['Intro', 'Groove A', 'Fill 1', 'Ending']

describe('groove library', () => {
  it('has the requested genres', () => {
    const names = GENRES.map((g) => g.id)
    for (const id of ['rock', 'jazz', 'salsa', 'cumbia', 'metal', 'hardrock', 'bossa', 'funk', 'pop', 'blues', 'reggae', 'samba', 'waltz', 'punk', 'disco', 'country', 'hiphop', 'latinrock', 'march']) expect(names).toContain(id)
    expect(new Set(names).size).toBe(names.length)
  })

  for (const g of GENRES) {
    describe(g.name, () => {
      const kit = KITS.find((k) => k.id === g.kit)
      it('suggests an existing kit and a sane tempo', () => {
        expect(kit, g.kit).toBeDefined()
        expect(g.tempo).toBeGreaterThanOrEqual(40)
        expect(g.tempo).toBeLessThanOrEqual(250)
      })
      it('has intro, groove, fill and ending parts', () => {
        for (const part of PARTS_REQUIRED) expect(g.grooves.some((x) => x.part === part), part).toBe(true)
        expect(g.grooves.length).toBeGreaterThanOrEqual(5)
      })
      for (const groove of g.grooves) {
        it(`${groove.part}: ${groove.name}`, () => {
          expect(groove.id).toMatch(new RegExp(`^${g.id}\\.\\d+$`))
          expect(groove.length).toBe(groove.bars * barTicks(groove.timeSig))
          expect(groove.notes.length).toBeGreaterThan(0)
          for (const n of groove.notes) {
            expect(n.t).toBeGreaterThanOrEqual(0)
            expect(n.t).toBeLessThan(groove.length)
            expect(Number.isInteger(n.t)).toBe(true)
            expect(n.v).toBeGreaterThanOrEqual(1)
            expect(n.v).toBeLessThanOrEqual(127)
            expect(n.d).toBeGreaterThan(0)
            expect(kit!.keys[n.k], `key ${n.k} missing in suggested kit ${g.kit}`).toBeDefined()
          }
          // every drum kit can play it (brush sweeps only exist in the brush kit)
          for (const dk of DRUM_KITS) for (const n of groove.notes) if (n.k !== 28) expect(dk.keys[n.k], `key ${n.k} missing in ${dk.id}`).toBeDefined()
          // no duplicate hits on the same key and tick
          const seen = new Set(groove.notes.map((n) => `${n.k}@${n.t}`))
          expect(seen.size).toBe(groove.notes.length)
          // first downbeat or pickup is present: something happens in the first bar
          expect(groove.notes.some((n) => n.t < barTicks(groove.timeSig))).toBe(true)
        })
      }
    })
  }

  it('time signatures: waltz grooves are in 3/4, the pop ballad in 6/8', () => {
    const waltz = GENRES.find((g) => g.id === 'waltz')!
    for (const x of waltz.grooves) expect(x.timeSig).toEqual([3, 4])
    const ballad = GENRES.find((g) => g.id === 'pop')!.grooves.find((x) => x.timeSig[1] === 8)!
    expect(ballad.length).toBe(288)
  })

  it('swing shifts the off-beat 16ths towards the triplet', () => {
    const straight = pat('t', { part: 'Groove A', lines: { 42: 'xxxx|----|----|----' } })
    const swung = pat('t', { part: 'Groove A', swing: 1, human: 0, lines: { 42: 'xxxx|----|----|----' } })
    expect(straight.notes.map((n) => n.t)).toEqual([0, 24, 48, 72])
    expect(swung.notes.map((n) => n.t)).toEqual([0, 32, 48, 80])
  })

  it('the DSL rejects lines of the wrong length', () => {
    expect(() => pat('bad', { part: 'Groove A', lines: { 36: 'x---|----' } })).toThrow()
  })
})
