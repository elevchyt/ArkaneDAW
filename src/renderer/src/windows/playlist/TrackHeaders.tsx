// Playlist track headers (left of the grid): name, color, mute LED, resize, context menu.
import { memo, useEffect, useRef, useState } from 'react'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { Led } from '@/components/controls'
import type { PlaylistTrack } from '@/store/types'
import { MAX_TRACK_H, MIN_TRACK_H } from './geometry'
import { getPl, usePlaylist } from './state'
import { moveTrack, soloTrack, updateTrack } from './actions'
import { openTrackMenu } from './menus'
import { shade } from './render'

export const HEADER_W = 150

export function TrackHeaders({ offsets }: { offsets: Float64Array }) {
  const tracks = useProject((s) => s.project.playlist.tracks)
  const scrollY = usePlaylist((s) => s.scrollY)
  const vZoom = usePlaylist((s) => s.vZoom)
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(400)

  useEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setH(el.clientHeight))
    ro.observe(el)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const pl = getPl()
      if (e.shiftKey) {
        // Shift+wheel over a header re-orders tracks (FL)
        const row = (e.target as HTMLElement).closest('[data-track]') as HTMLElement | null
        if (row) moveTrack(Number(row.dataset.track), e.deltaY > 0 ? 1 : -1)
        return
      }
      if (e.altKey) {
        const nz = Math.min(4, Math.max(0.3, pl.vZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
        pl.set({ vZoom: nz })
        return
      }
      const total = offsets[offsets.length - 1]
      pl.set({ scrollY: Math.max(0, Math.min(total - el.clientHeight + 20, pl.scrollY + e.deltaY)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [offsets])

  const rows: React.ReactNode[] = []
  for (let i = 0; i < tracks.length; i++) {
    const top = offsets[i] - scrollY
    const height = offsets[i + 1] - offsets[i]
    if (top + height < 0) continue
    if (top > h) break
    rows.push(<TrackRow key={tracks[i].id} index={i} track={tracks[i]} top={top} height={height} vZoom={vZoom} />)
  }
  return (
    <div ref={ref} className="relative h-full overflow-hidden bg-[#2c353a]" style={{ width: HEADER_W }}>
      {rows}
    </div>
  )
}

const TrackRow = memo(function TrackRow({ index, track, top, height, vZoom }: { index: number; track: PlaylistTrack; top: number; height: number; vZoom: number }) {
  const [editing, setEditing] = useState(false)
  const resize = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const sy = e.clientY
    const h0 = track.height
    const key = `trk-h:${track.id}:${Date.now()}`
    const move = (ev: PointerEvent) => {
      const nh = Math.round(Math.min(MAX_TRACK_H, Math.max(MIN_TRACK_H, h0 + (ev.clientY - sy) / vZoom)))
      updateTrack(index, { height: nh }, 'Resize track', key)
      useUI.getState().setHint(`Track height: ${nh}px`)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const compact = height < 28
  return (
    <div
      data-track={index}
      className="absolute left-0 right-0 flex select-none items-center gap-1 border-b border-r border-[#1d2326] pl-0 pr-1.5"
      style={{
        top,
        height,
        background: `linear-gradient(to right, ${shade(track.color, -0.15)}, ${shade(track.color, -0.35)})`,
        opacity: track.muted ? 0.6 : 1
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        openTrackMenu(e, index)
      }}
      onPointerEnter={() => useUI.getState().setHint(`${track.name} — double-click to rename, right-click for options, Shift+wheel to re-order, drag bottom edge to resize`)}
    >
      <div className="h-full w-[5px] shrink-0" style={{ background: track.color, boxShadow: 'inset -1px 0 0 rgba(0,0,0,.4)' }} />
      <div className="flex min-w-0 flex-1 flex-col justify-center" onDoubleClick={() => setEditing(true)}>
        {editing ? (
          <input
            autoFocus
            defaultValue={track.name}
            className="h-[16px] w-full rounded-[2px] bg-fl-well px-1 text-[11px] text-fl-text outline-none"
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={(e) => {
              setEditing(false)
              const v = e.target.value.trim()
              if (v && v !== track.name) updateTrack(index, { name: v }, 'Rename track')
            }}
          />
        ) : (
          <span className="truncate text-[11px] text-[#e3e9ec]" style={{ textShadow: '0 1px 0 rgba(0,0,0,.5)' }}>
            {track.name}
          </span>
        )}
        {!compact && height >= 40 && <span className="text-[9px] text-[#c5cdd1]/50">{track.locked ? 'locked' : ''}</span>}
      </div>
      <Led
        on={!track.muted}
        size={compact ? 8 : 10}
        onClick={(e) => {
          if (e.ctrlKey) soloTrack(index)
          else updateTrack(index, { muted: !track.muted }, track.muted ? 'Unmute track' : 'Mute track')
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          soloTrack(index)
        }}
        title="Mute (right-click / Ctrl+click: solo)"
      />
      <div className="absolute bottom-0 left-0 right-0 h-[4px] cursor-ns-resize" onPointerDown={resize} />
    </div>
  )
})
