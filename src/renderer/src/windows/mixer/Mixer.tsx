import { MdiWindow } from '@/shell/MdiWindow'
import type { WindowProps } from '../types'

// Placeholder – implemented by the Mixer work package.
export default function Mixer({ win, bounds }: WindowProps) {
  return (
    <MdiWindow win={win} bounds={bounds}>
      <div className="grid h-full place-items-center text-fl-dim">Mixer</div>
    </MdiWindow>
  )
}
