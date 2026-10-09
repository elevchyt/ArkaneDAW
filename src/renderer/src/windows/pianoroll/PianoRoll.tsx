import { MdiWindow } from '@/shell/MdiWindow'
import type { WindowProps } from '../types'

// Placeholder – implemented by the PianoRoll work package.
export default function PianoRoll({ win, bounds }: WindowProps) {
  return (
    <MdiWindow win={win} bounds={bounds}>
      <div className="grid h-full place-items-center text-fl-dim">PianoRoll</div>
    </MdiWindow>
  )
}
