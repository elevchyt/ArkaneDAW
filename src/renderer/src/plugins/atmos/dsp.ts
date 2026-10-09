import type { DSPFactory } from '../sdk/types'
import { Atmos } from './engine'

export default { id: 'atmos', kind: 'instrument', create: (ctx) => new Atmos(ctx) } satisfies DSPFactory
