import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { UiLink, gainToDb, msCoef } from '../fx-common/dsp-util'
import { manifest } from './manifest'

const HYST_DB = 4

class GateDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private thrOpen = 0.01
  private thrClose = 0.006
  private floor = 0 // closed gain (linear)
  private aCoef = 0
  private rCoef = 0
  private holdN = 0
  private sc = false
  private det = 0
  private detCoef: number
  private open = false
  private holdLeft = 0
  private gDb = -80 // current gain in dB
  private floorDb = -80
  private ui: UiLink
  private mIn = 0
  private mG = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.detCoef = msCoef(5, this.sr)
    this.ui = new UiLink(this.sr, 30)
    for (const p of manifest.params) this.setParam(p.id, p.default)
    this.gDb = this.floorDb
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'threshold':
        this.thrOpen = Math.pow(10, v / 20)
        this.thrClose = Math.pow(10, (v - HYST_DB) / 20)
        break
      case 'range':
        this.floorDb = Math.min(0, v)
        this.floor = v <= -79.9 ? 0 : Math.pow(10, v / 20)
        break
      case 'attack': this.aCoef = msCoef(v, this.sr); break
      case 'release': this.rCoef = msCoef(v, this.sr); break
      case 'hold': this.holdN = Math.round((v / 1000) * this.sr); break
      case 'sidechain': this.sc = v >= 0.5; break
    }
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.det = 0
    this.open = false
    this.holdLeft = 0
    this.gDb = this.floorDb
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number, scL?: Float32Array, scR?: Float32Array): void {
    const useSc = this.sc && scL && scR
    const dL = useSc ? scL! : inL
    const dR = useSc ? scR! : inR
    let det = this.det
    let gDb = this.gDb
    let mIn = this.mIn, mG = this.mG
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      const a = Math.max(Math.abs(dL[i]), Math.abs(dR[i]))
      det = a > det ? a : a + (det - a) * this.detCoef
      if (det < 1e-12) det = 0
      if (det >= this.thrOpen) {
        this.open = true
        this.holdLeft = this.holdN
      } else if (det < this.thrClose) {
        if (this.holdLeft > 0) this.holdLeft--
        else this.open = false
      }
      const target = this.open ? 0 : this.floorDb
      gDb = target > gDb ? target + (gDb - target) * this.aCoef : target + (gDb - target) * this.rCoef
      let g = Math.pow(10, gDb / 20)
      // full mute at the bottom of the range: fade the last 80 dB into true silence
      if (this.floor === 0 && gDb < -79) g = 0
      outL[i] = l * g
      outR[i] = r * g
      if (a > mIn) mIn = a
      if (gDb < mG) mG = gDb
    }
    this.det = det
    this.gDb = gDb
    if (this.ui.tick(end - start)) {
      this.post({ inDb: gainToDb(mIn), gain: mG, open: this.open })
      mIn = 0
      mG = 0
    }
    this.mIn = mIn
    this.mG = mG
  }
}

export default { id: 'gate', kind: 'effect', create: (ctx) => new GateDSP(ctx) } satisfies DSPFactory
