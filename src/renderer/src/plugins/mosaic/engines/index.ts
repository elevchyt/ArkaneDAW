import type { EngineId } from '../model'
import type { PartEngine } from './common'
import { PolyPart } from './voice'
import { PianoBody, PianoVoice } from './piano'
import { EPPost, EPVoice } from './epiano'
import { OrganPart } from './organ'
import { FMVoice } from './fm'
import { BodyPost, PluckVoice } from './pluck'
import { AnalogVoice } from './analog'
import { ChoirVoice } from './choir'
import { MalletVoice, MotorPost } from './mallet'

/** Build the runtime for one Part. Called from setData (never from process()). */
export function createPartEngine(engine: EngineId, sr: number): PartEngine {
  switch (engine) {
    case 'epiano':
      return new PolyPart(sr, () => new EPVoice(), new EPPost(sr), 32)
    case 'organ':
      return new OrganPart(sr)
    case 'fm':
      return new PolyPart(sr, () => new FMVoice(), null, 32)
    case 'pluck':
      return new PolyPart(sr, (s) => new PluckVoice(s), new BodyPost(sr), 32)
    case 'analog':
      return new PolyPart(sr, () => new AnalogVoice(), null, 32)
    case 'choir':
      return new PolyPart(sr, () => new ChoirVoice(), null, 32)
    case 'mallet':
      return new PolyPart(sr, () => new MalletVoice(), new MotorPost(sr), 32)
    case 'piano':
    default:
      return new PolyPart(sr, () => new PianoVoice(), new PianoBody(sr), 32)
  }
}
