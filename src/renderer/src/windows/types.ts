import type { WindowState } from '@/store/ui'

export interface WindowProps {
  win: WindowState
  bounds: { w: number; h: number }
}
