import { MdiWindow } from '@/shell/MdiWindow'
import type { WindowProps } from '../types'

// Placeholder – implemented by the Playlist work package.
export default function Playlist({ win, bounds }: WindowProps) {
  return (
    <MdiWindow win={win} bounds={bounds}>
      <div className="grid h-full place-items-center text-fl-dim">Playlist</div>
    </MdiWindow>
  )
}
