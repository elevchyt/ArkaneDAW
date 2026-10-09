// Stereo peak meter canvas for mixer strips; drawing happens in the shared loop (meterLoop.ts).
import { useEffect, useRef } from 'react'
import { useUI } from '@/store/ui'
import { fmtDb } from './ops'
import { FLOOR, registerMeter, type MeterState } from './meterLoop'

export function StereoMeter({ index, height, width = 9, label }: { index: number; height: number; width?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef<MeterState | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const m: MeterState = { index, canvas, disp: [FLOOR, FLOOR], hold: [FLOOR, FLOOR], holdT: [0, 0], clip: false, lastPeak: 0 }
    state.current = m
    return registerMeter(m)
  }, [index])
  return (
    <canvas
      ref={ref}
      className="block rounded-[1px] fl-inset"
      style={{ width, height }}
      onMouseEnter={() => {
        const m = state.current
        const peak = m ? Math.max(m.hold[0], m.hold[1]) : FLOOR
        useUI.getState().setHint(`${label} peak: ${peak <= FLOOR ? '-inf dB' : fmtDb(peak)}${m?.clip ? ' — CLIPPED (click to reset)' : ''}`)
      }}
      onPointerDown={(e) => {
        const m = state.current
        if (!m) return
        e.stopPropagation()
        m.clip = false
        m.hold = [FLOOR, FLOOR]
      }}
    />
  )
}
