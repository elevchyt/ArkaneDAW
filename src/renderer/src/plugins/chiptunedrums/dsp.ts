import type { DSPFactory, InstrumentDSP } from '../sdk/types'
import chiptune from '../chiptune/dsp'

export default {
  id: 'chiptunedrums',
  kind: 'instrument',
  create: (ctx) => {
    const dsp = chiptune.create(ctx) as InstrumentDSP
    dsp.setParam('mode', 1)
    const setParam = dsp.setParam.bind(dsp)
    // Always drums: ignore attempts to switch back to synth mode.
    dsp.setParam = (id, v) => setParam(id, id === 'mode' ? 1 : v)
    return dsp
  }
} satisfies DSPFactory
