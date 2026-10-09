import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PK, PluginPanel } from '../sdk/ui'
import { FxCanvas, Sec, drawScreen, pv, ptext, useDspFeed, withAlpha } from '../fx-common/ui'
import { KEYS, SCALES, manifest, noteName, scaleMask } from './manifest'

type Feed = { t: 'vt'; v: number; det: number; tgt: number; out: number; corr: number }

const HIST = 180 // history points (posted at ~30 Hz -> ~6 s)
const WHITE = [0, 2, 4, 5, 7, 9, 11]
const BLACK: [number, number][] = [
  [1, 1],
  [3, 2],
  [6, 4],
  [8, 5],
  [10, 6]
] // [pitch class, white-key index it sits before]

/** Blend two #rrggbb colours (t = 0 -> a, 1 -> b). */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

function KeyPicker({ p, keyIdx, mask, color }: { p: PluginEditorProps; keyIdx: number; mask: Uint8Array; color: string }) {
  const W = 266
  const H = 50
  const ww = W / 7
  const bw = ww * 0.62
  const pick = (pc: number) => {
    p.setParam('key', pc)
    p.hint(`Key: ${KEYS[pc]}`)
  }
  const hover = (pc: number) => p.hint(`Key: ${KEYS[pc]}${pc === keyIdx ? ' (current root)' : ' — click to make it the root'}${mask[pc] ? ' · in scale' : ''}`)
  const fill = (pc: number, black: boolean) => {
    if (pc === keyIdx) return color
    if (mask[pc]) return black ? mixHex(color, '#1b2023', 0.45) : mixHex(color, '#e6eaec', 0.62)
    return black ? '#1b2023' : '#8f999d'
  }
  return (
    <div className="relative select-none" style={{ width: W, height: H }}>
      {WHITE.map((pc, i) => (
        <button
          key={pc}
          onClick={() => pick(pc)}
          onMouseEnter={() => hover(pc)}
          className="absolute top-0 flex items-end justify-center rounded-b-[3px] border border-[#14181a] pb-0.5 text-[10px] font-semibold"
          style={{
            left: i * ww,
            width: ww - 1,
            height: H,
            background: fill(pc, false),
            color: pc === keyIdx || mask[pc] ? '#15191b' : '#4a5458'
          }}
        >
          {KEYS[pc]}
        </button>
      ))}
      {BLACK.map(([pc, at]) => (
        <button
          key={pc}
          onClick={() => pick(pc)}
          onMouseEnter={() => hover(pc)}
          className="absolute top-0 flex items-end justify-center rounded-b-[3px] border border-[#0e1112] pb-0.5 text-[8px] font-semibold"
          style={{
            left: at * ww - bw / 2 - 0.5,
            width: bw,
            height: H * 0.6,
            background: fill(pc, true),
            color: pc === keyIdx ? '#15191b' : mask[pc] ? '#fff' : '#5b666b',
            zIndex: 1
          }}
        >
          {KEYS[pc]}
        </button>
      ))}
    </div>
  )
}

function ScalePicker({ p, scale, keyIdx, color }: { p: PluginEditorProps; scale: number; keyIdx: number; color: string }) {
  return (
    <div className="grid grid-cols-3 gap-px rounded-[3px] bg-[#1a1f22] p-px">
      {SCALES.map((s, i) => (
        <button
          key={s.name}
          onClick={() => {
            p.setParam('scale', i)
            p.hint(`Scale: ${s.name}`)
          }}
          onMouseEnter={() => p.hint(`Scale: ${s.name} — ${s.steps.map((st) => KEYS[(keyIdx + st) % 12]).join(' ')}`)}
          className={cn(
            'h-[15px] rounded-[2px] px-1 text-[10px] leading-none whitespace-nowrap',
            i === scale ? 'font-semibold text-[#15191b]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]'
          )}
          style={i === scale ? { background: color } : undefined}
        >
          {s.short}
        </button>
      ))}
    </div>
  )
}

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const keyIdx = Math.round(pv(p, 'key'))
  const scale = Math.round(pv(p, 'scale'))
  const mask = scaleMask(keyIdx, scale)
  const maskRef = useRef(mask)
  maskRef.current = mask

  const live = useRef({ feed: null as Feed | null, at: 0 })
  const hist = useRef({ det: new Float32Array(HIST), out: new Float32Array(HIST), v: new Uint8Array(HIST), w: 0 })
  const view = useRef({ center: 69, needle: 0, corr: 0, note: -1 })

  useDspFeed(p, (msg) => {
    if (!msg || typeof msg !== 'object' || (msg as Feed).t !== 'vt') return
    const f = msg as Feed
    live.current = { feed: f, at: performance.now() }
    const h = hist.current
    h.det[h.w] = f.det
    h.out[h.w] = f.out
    h.v[h.w] = f.v
    h.w = (h.w + 1) % HIST
  })

  const robot = () => {
    p.setParams({ speed: 0, scale: 0, humanize: 0 })
    p.hint('Robot: instant retune, chromatic')
  }
  const isRobot = pv(p, 'speed') === 0 && scale === 0

  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Key" accent={color}>
          <KeyPicker p={p} keyIdx={keyIdx} mask={mask} color={color} />
        </Sec>
        <Sec title="Scale" accent={color} className="flex-1">
          <ScalePicker p={p} scale={scale} keyIdx={keyIdx} color={color} />
        </Sec>
      </div>
      <div className="flex flex-1 gap-2">
        <Sec title="Retune" accent={color} className="w-[150px]" body="flex flex-col items-center">
          <PK p={p} id="speed" size={62} color={color} label="" />
          <div className="mt-0.5 flex w-full justify-between text-[9px] uppercase tracking-wide text-fl-dim">
            <span>Robotic</span>
            <span>Natural</span>
          </div>
          <div
            className="fl-lcd mt-0.5 min-w-[64px] px-1 py-px text-center text-[10px] text-[#9fe870]"
            onMouseEnter={() => p.hint(`Retune Speed: ${ptext(p, 'speed')} (0 = instant hard-tune)`)}
          >
            {ptext(p, 'speed')}
          </div>
          <div className="mt-1 flex w-full items-end justify-around">
            <PK p={p} id="humanize" size={32} color={color} />
            <PK p={p} id="mix" size={32} color={color} />
            <button
              onClick={robot}
              onMouseEnter={() => p.hint('Robot: Retune Speed 0 + Chromatic (the hard-tune effect)')}
              className="mb-3 rounded-[3px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={isRobot ? { background: color, color: '#15191b' } : { background: '#1f2528', color: '#c9d0d3' }}
            >
              Robot
            </button>
          </div>
        </Sec>
        <Sec title="Pitch" accent={color} className="flex-1">
          <FxCanvas
            width={322}
            height={140}
            animate
            className="fl-inset"
            onMouseEnter={() => p.hint('Pitch: detected note, how far off it is (needle) and the correction applied (bar); history: input (grey) vs corrected (colour)')}
            draw={(ctx, w, h) => drawDisplay(ctx, w, h, color, live.current, hist.current, view.current, maskRef.current)}
          />
        </Sec>
      </div>
    </PluginPanel>
  )
}

function drawDisplay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  color: string,
  live: { feed: Feed | null; at: number },
  hist: { det: Float32Array; out: Float32Array; v: Uint8Array; w: number },
  view: { center: number; needle: number; corr: number; note: number },
  mask: Uint8Array
): void {
  drawScreen(ctx, w, h)
  const f = live.feed
  const fresh = !!f && performance.now() - live.at < 400
  const voiced = fresh && f!.v === 1 && f!.tgt >= 0
  const topH = 52

  // ── note readout + cents meter ──
  if (voiced) {
    view.note = f!.tgt
    view.needle += ((f!.det - f!.tgt) * 100 - view.needle) * 0.35
    view.corr += (f!.corr * 100 - view.corr) * 0.35
  } else {
    view.needle *= 0.85
    view.corr *= 0.85
  }
  ctx.textBaseline = 'middle'
  ctx.font = 'bold 30px system-ui, sans-serif'
  ctx.fillStyle = voiced ? color : 'rgba(200,210,215,0.25)'
  ctx.fillText(view.note >= 0 ? noteName(view.note) : '—', 8, topH / 2)
  ctx.font = '9px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(200,210,215,0.5)'
  ctx.fillText(voiced ? 'TARGET' : fresh ? 'NO PITCH' : 'IDLE', 10, topH - 6)

  const mx = 92
  const mw = w - mx - 10
  const my = 16
  const cx = mx + mw / 2
  const X = (c: number) => cx + (Math.max(-50, Math.min(50, c)) / 50) * (mw / 2)
  // scale
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fillRect(mx, my - 2, mw, 14)
  for (let c = -50; c <= 50; c += 10) {
    ctx.fillStyle = c === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.18)'
    ctx.fillRect(Math.round(X(c)), my - 4, 1, c % 50 === 0 ? 18 : 6)
  }
  ctx.fillStyle = 'rgba(200,210,215,0.4)'
  ctx.fillText('-50', mx, my + 22)
  ctx.fillText('+50', mx + mw - 16, my + 22)
  ctx.fillText('¢', cx - 2, my + 22)
  // correction bar (from the needle toward the centre)
  if (Math.abs(view.corr) > 0.5) {
    ctx.fillStyle = withAlpha(color, 0.75)
    const a = X(view.needle)
    const b = X(view.needle + view.corr)
    ctx.fillRect(Math.min(a, b), my + 1, Math.abs(b - a), 8)
  }
  // needle (detected deviation)
  ctx.fillStyle = voiced ? '#ffffff' : 'rgba(255,255,255,0.25)'
  ctx.fillRect(Math.round(X(view.needle)) - 1, my - 6, 2, 22)
  ctx.font = '10px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(220,228,232,0.8)'
  if (voiced) {
    const off = Math.round(view.needle)
    const cor = Math.round(view.corr)
    ctx.fillText(`off ${off > 0 ? '+' : ''}${off}¢`, mx + 26, my + 34)
    ctx.fillStyle = color
    ctx.fillText(`fix ${cor > 0 ? '+' : ''}${cor}¢`, mx + mw - 64, my + 34)
  }

  // ── history graph ──
  const gy = topH + 4
  const gh = h - gy - 2
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(0, gy, w, gh)
  if (voiced) view.center += (f!.tgt - view.center) * 0.05
  const span = 7 // semitones visible
  const Y = (m: number) => gy + gh / 2 - ((m - view.center) / span) * gh
  ctx.font = '8px system-ui, sans-serif'
  for (let n = Math.floor(view.center - span / 2) - 1; n <= view.center + span / 2 + 1; n++) {
    const y = Math.round(Y(n)) + 0.5
    if (y < gy || y > gy + gh) continue
    const inScale = mask[((n % 12) + 12) % 12] === 1
    ctx.fillStyle = inScale ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.035)'
    ctx.fillRect(22, y, w - 22, 1)
    if (inScale) {
      ctx.fillStyle = 'rgba(200,210,215,0.45)'
      ctx.fillText(noteName(n), 2, y)
    }
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(22, gy, w - 22, gh)
  ctx.clip()
  const step = (w - 22) / (HIST - 1)
  const line = (arr: Float32Array, stroke: string, width: number) => {
    ctx.strokeStyle = stroke
    ctx.lineWidth = width
    ctx.beginPath()
    let pen = false
    for (let i = 0; i < HIST; i++) {
      const k = (hist.w + i) % HIST
      if (!hist.v[k]) {
        pen = false
        continue
      }
      const x = 22 + i * step
      const y = Y(arr[k])
      if (pen) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
      pen = true
    }
    ctx.stroke()
  }
  line(hist.det, 'rgba(210,220,225,0.45)', 1)
  line(hist.out, color, 2)
  ctx.restore()
  ctx.lineWidth = 1
}

export default definePlugin({ manifest, Editor, editorSize: { width: 520, height: 300 } })
