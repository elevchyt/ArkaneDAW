// Retro widgets for the Chiptune editor: a 3x5 bitmap font rendered as SVG, NES palette, chunky boxes.
import { useMemo } from 'react'
import type { PluginEditorProps } from '../sdk/module'
import { W } from './chip'

export const NES = {
  red: '#f83800',
  orange: '#fca044',
  yellow: '#f8b800',
  green: '#58d854',
  dkgreen: '#00a800',
  cyan: '#3cbcfc',
  blue: '#0078f8',
  purple: '#9878f8',
  pink: '#f878f8',
  white: '#fcfcfc',
  gray: '#7c7c7c',
  ltgray: '#bcbcbc',
  black: '#000000',
  bg: '#14161c',
  panel: '#1f232b',
  well: '#0b0c10'
}

const GLYPHS: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', ' ': '000000000000000', '-': '000000111000000', '.': '000000000000010', '/': '001001010100100',
  '%': '101001010100101', '!': '010010010000010', '+': '000010111010000', '&': '010101010101011', ':': '000010000010000',
  '(': '001010010010001', ')': '100010010010100', '#': '101111101111101', '>': '100010001010100', '<': '001010100010001'
}

/** Bitmap text. `scale` = pixel size. */
export function PixelText({ text, scale = 2, color = NES.white, shadow = NES.black, className }: { text: string; scale?: number; color?: string; shadow?: string | null; className?: string }) {
  const d = useMemo(() => {
    let path = ''
    let x = 0
    for (const ch of text.toUpperCase()) {
      const g = GLYPHS[ch] ?? GLYPHS[' ']
      for (let i = 0; i < 15; i++) if (g[i] === '1') path += `M${x + (i % 3)} ${Math.floor(i / 3)}h1v1h-1z`
      x += 4
    }
    return { path, w: Math.max(1, x - 1) }
  }, [text])
  const pad = shadow ? 1 : 0
  return (
    <svg className={className} width={(d.w + pad) * scale} height={(5 + pad) * scale} viewBox={`0 0 ${d.w + pad} ${5 + pad}`} shapeRendering="crispEdges" style={{ display: 'block' }}>
      {shadow && <path d={d.path} fill={shadow} transform="translate(1 1)" />}
      <path d={d.path} fill={color} />
    </svg>
  )
}

/** Chunky NES-style framed box with a pixel title tab. */
export function Box({ title, color = NES.red, children, style, right }: { title: string; color?: string; children: React.ReactNode; style?: React.CSSProperties; right?: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        background: NES.panel,
        border: `2px solid ${NES.black}`,
        boxShadow: `inset 0 0 0 2px ${color}55, 2px 2px 0 ${NES.black}`,
        padding: '13px 6px 5px',
        ...style
      }}
    >
      <div style={{ position: 'absolute', left: 4, top: -2, background: color, padding: '2px 4px', border: `2px solid ${NES.black}`, borderTop: 'none' }}>
        <PixelText text={title} scale={1.5} color={NES.white} shadow={NES.black} />
      </div>
      {right && <div style={{ position: 'absolute', right: 6, top: 2 }}>{right}</div>}
      {children}
    </div>
  )
}

const pixBtn = (active: boolean, color: string): React.CSSProperties => ({
  background: active ? color : '#2b303a',
  color: active ? NES.black : NES.ltgray,
  border: `2px solid ${NES.black}`,
  boxShadow: active ? `inset -2px -2px 0 #00000055, inset 2px 2px 0 #ffffff55` : `inset -2px -2px 0 #00000088, inset 2px 2px 0 #ffffff1a`,
  fontFamily: 'var(--font-mono, monospace)',
  fontWeight: 700,
  fontSize: 9,
  textTransform: 'uppercase',
  lineHeight: 1,
  cursor: 'pointer',
  imageRendering: 'pixelated'
})

export function PixButton({ active, color = NES.yellow, onClick, children, title, style, onHover, onMouseDown, onMouseUp, onMouseLeave }: {
  active?: boolean
  color?: string
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
  title?: string
  style?: React.CSSProperties
  onHover?: () => void
  onMouseDown?: (e: React.MouseEvent) => void
  onMouseUp?: (e: React.MouseEvent) => void
  onMouseLeave?: (e: React.MouseEvent) => void
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onMouseEnter={onHover}
      onContextMenu={(e) => e.preventDefault()}
      style={{ ...pixBtn(!!active, color), padding: '3px 5px', ...style }}
    >
      {children}
    </button>
  )
}

/** Segmented selector for an enumerated param, pixel styled. */
export function PixSeg({ p, id, labels, color = NES.yellow, style, btnStyle }: { p: PluginEditorProps; id: string; labels?: string[]; color?: string; style?: React.CSSProperties; btnStyle?: React.CSSProperties }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def?.options) return null
  const v = Math.round(p.instance.params[id] ?? def.default)
  return (
    <div style={{ display: 'flex', gap: 2, ...style }}>
      {def.options.map((o, i) => (
        <PixButton key={o} active={i === v} color={color} style={btnStyle} onClick={() => p.setParam(id, i)} onHover={() => p.hint(`${def.name}: ${o}`)}>
          {labels?.[i] ?? o}
        </PixButton>
      ))}
    </div>
  )
}

/** Pixel LED toggle for 0/1 params. */
export function PixToggle({ p, id, label, color = NES.green }: { p: PluginEditorProps; id: string; label?: string; color?: string }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def) return null
  const on = (p.instance.params[id] ?? def.default) >= 0.5
  return (
    <button
      onClick={() => p.setParam(id, on ? 0 : 1)}
      onMouseEnter={() => p.hint(`${def.name}: ${on ? 'On' : 'Off'}`)}
      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
    >
      <span style={{ width: 9, height: 9, background: on ? color : '#33363d', border: `2px solid ${NES.black}`, boxShadow: on ? `0 0 6px ${color}` : undefined }} />
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 9, fontWeight: 700, color: on ? NES.white : NES.gray, textTransform: 'uppercase' }}>{label ?? def.name}</span>
    </button>
  )
}

/** Pixel-styled native select bound to an enumerated param. */
export function PixSelect({ p, id, width = 90 }: { p: PluginEditorProps; id: string; width?: number }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def?.options) return null
  const v = Math.round(p.instance.params[id] ?? def.default)
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }} onMouseEnter={() => p.hint(`${def.name}: ${def.options![v]}`)}>
      <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 8, color: NES.gray, textTransform: 'uppercase', fontWeight: 700 }}>{def.name}</span>
      <select
        value={v}
        onChange={(e) => p.setParam(id, Number(e.target.value))}
        style={{ width, background: NES.well, color: NES.green, border: `2px solid ${NES.black}`, boxShadow: 'inset 0 0 0 1px #ffffff14', fontFamily: 'var(--font-mono, monospace)', fontSize: 10, fontWeight: 700, padding: '1px 2px' }}
      >
        {def.options.map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Tiny pixel waveform icon for a wave id. */
export function WaveIcon({ wave, color = NES.white }: { wave: number; color?: string }) {
  const pts = useMemo(() => {
    const H = 10
    const y = (v: number): number => (1 - (v + 1) / 2) * (H - 2) + 1
    let d = ''
    if (wave <= W.P50) {
      const duty = [0.125, 0.25, 0.5][wave]
      for (let c = 0; c < 2; c++) {
        const x0 = c * 12
        const xh = x0 + Math.max(1, Math.round(12 * duty))
        d += `${c === 0 ? 'M' : 'L'}${x0} ${y(-1)} L${x0} ${y(1)} L${xh} ${y(1)} L${xh} ${y(-1)} L${x0 + 12} ${y(-1)} `
      }
    } else if (wave === W.TRI) {
      d = 'M0 9'
      for (let i = 0; i <= 24; i++) {
        const t = (i % 12) / 12
        const v = Math.round((1 - 2 * Math.abs(2 * t - 1)) * 3) / 3
        d += ` H${i} V${y(-v)}`
      }
    } else if (wave === W.TRIS) {
      d = `M0 ${y(-1)} L6 ${y(1)} L12 ${y(-1)} L18 ${y(1)} L24 ${y(-1)}`
    } else if (wave === W.GB) {
      const tb = [0, 0.5, 1, 0.8, 0.2, -0.3, -0.9, -0.6, 0.1, 0.9, 0.4, -0.5]
      d = `M0 ${y(tb[0])}`
      for (let i = 0; i < 24; i++) d += ` H${i} V${y(tb[i % 12])}`
      d += ' H24'
    } else {
      let s = wave * 7919
      d = `M0 ${y(0)}`
      const step = wave === W.N4 ? 2 : 1
      for (let i = 0; i < 24; i += step) {
        s = (s * 1103515245 + 12345) & 0x7fffffff
        const v = wave === W.N4 ? ((s >> 8) % 7) / 3 - 1 : wave === W.NS ? (i % 6 < 3 ? 1 : -1) * (i % 12 < 6 ? 1 : 0.4) : (s >> 9) & 1 ? 1 : -1
        d += ` H${i} V${y(v)}`
      }
      d += ' H24'
    }
    return d
  }, [wave])
  return (
    <svg width={36} height={15} viewBox="-1 -1 26 12" shapeRendering="crispEdges" style={{ display: 'block' }}>
      <path d={pts} fill="none" stroke={color} strokeWidth={1.4} />
    </svg>
  )
}

/** FL note naming (C5 = MIDI 60). */
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const keyName = (k: number): string => `${NAMES[((k % 12) + 12) % 12]}${Math.floor(k / 12)}`

export const monoFont: React.CSSProperties = { fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, textTransform: 'uppercase' }
