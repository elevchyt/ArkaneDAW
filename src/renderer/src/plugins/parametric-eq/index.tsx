import { useMemo, useRef, useState } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PK, PluginPanel, Section } from '../sdk/ui'
import { Biquad } from '../sdk/dsp'
import { formatParam } from '../sdk/params'
import { Sec, FxCanvas, MID, drawFreqGrid, freqToX, pv, useDspFeed, withAlpha, xToFreq } from '../fx-common/ui'
import { BAND_TYPES, MAX_GAIN, NBANDS, bandShape, manifest } from './manifest'

const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dd4c6', '#5fb7ff', '#c49bff']
const GW = 624
const GH = 216
const SR = 48000
const DB_RANGE = MAX_GAIN

const dbToY = (db: number, h: number) => h / 2 - (db / DB_RANGE) * (h / 2 - 8)
const yToDb = (y: number, h: number) => ((h / 2 - y) / (h / 2 - 8)) * DB_RANGE

interface BandState {
  on: boolean
  type: number
  freq: number
  gain: number
  q: number
}

function readBands(p: PluginEditorProps): BandState[] {
  const out: BandState[] = []
  for (let n = 1; n <= NBANDS; n++)
    out.push({
      on: pv(p, `b${n}.on`) >= 0.5,
      type: Math.round(pv(p, `b${n}.type`)),
      freq: pv(p, `b${n}.freq`),
      gain: pv(p, `b${n}.gain`),
      q: pv(p, `b${n}.q`)
    })
  return out
}

/** Per-band magnitude (dB) at each x pixel. */
function bandCurves(bands: BandState[], w: number): Float32Array[] {
  const bq = new Biquad(SR)
  const freqs = new Float32Array(w)
  for (let x = 0; x < w; x++) freqs[x] = xToFreq(x, w)
  return bands.map((b) => {
    const arr = new Float32Array(w)
    if (!b.on) return arr
    const sh = bandShape(b.type)
    bq.set(sh.kind, b.freq, b.q, b.gain)
    for (let x = 0; x < w; x++) {
      const m = bq.magnitude(freqs[x])
      arr[x] = (sh.double ? 40 : 20) * Math.log10(Math.max(1e-6, m))
    }
    return arr
  })
}

function nodeY(b: BandState, h: number): number {
  const sh = bandShape(b.type)
  return dbToY(sh.usesGain ? b.gain : 0, h)
}

function bandText(n: number, b: BandState): string {
  const f = b.freq >= 1000 ? `${(b.freq / 1000).toFixed(2)} kHz` : `${Math.round(b.freq)} Hz`
  const g = bandShape(b.type).usesGain ? `, ${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)} dB` : ''
  return `Band ${n} (${BAND_TYPES[b.type]}): ${f}${g}, Q ${b.q.toFixed(2)}${b.on ? '' : ' [off]'}`
}

function Editor(p: PluginEditorProps) {
  const [sel, setSel] = useState(3)
  const [hover, setHover] = useState(-1)
  const drag = useRef<{ band: number } | null>(null)
  const spec = useRef<Float32Array | null>(null)
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'spec' in msg) spec.current = (msg as { spec: Float32Array }).spec
  })

  const bands = readBands(p)
  const key = JSON.stringify(bands)
  const curves = useMemo(() => bandCurves(bands, GW), [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => {
    const t = new Float32Array(GW)
    for (const c of curves) for (let x = 0; x < GW; x++) t[x] += c[x]
    return t
  }, [curves])

  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * GW, y: ((e.clientY - r.top) / r.height) * GH }
  }
  const nearest = (x: number, y: number, radius = 14): number => {
    let best = -1
    let bd = radius * radius
    bands.forEach((b, i) => {
      const dx = freqToX(b.freq, GW) - x
      const dy = nodeY(b, GH) - y
      const d = dx * dx + dy * dy
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  const moveBand = (i: number, x: number, y: number) => {
    const b = bands[i]
    const n = i + 1
    const f = Math.min(20000, Math.max(20, xToFreq(x, GW)))
    const values: Record<string, number> = { [`b${n}.freq`]: f }
    let g = b.gain
    if (bandShape(b.type).usesGain) {
      g = Math.max(-MAX_GAIN, Math.min(MAX_GAIN, yToDb(y, GH)))
      if (Math.abs(g) < 0.25) g = 0
      values[`b${n}.gain`] = g
    }
    p.setParams(values)
    p.hint(bandText(n, { ...b, freq: f, gain: g }))
  }

  const sb = bands[sel]
  const color = manifest.color!

  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="relative fl-inset rounded-[3px]" style={{ width: GW, height: GH }}>
        {/* live spectrum (animated) */}
        <FxCanvas
          width={GW}
          height={GH}
          animate
          className="absolute inset-0"
          draw={(ctx, w, h) => {
            const g = ctx.createLinearGradient(0, 0, 0, h)
            g.addColorStop(0, '#1b2326')
            g.addColorStop(1, '#121719')
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h)
            const s = spec.current
            if (!s) return
            const N = s.length
            ctx.beginPath()
            ctx.moveTo(0, h)
            for (let b = 0; b < N; b++) {
              const f = 20 * Math.pow(1000, (b + 0.5) / N)
              const db = Math.max(-90, Math.min(0, s[b]))
              ctx.lineTo(freqToX(f, w), h - ((db + 90) / 90) * h)
            }
            ctx.lineTo(w, h)
            ctx.closePath()
            const sg = ctx.createLinearGradient(0, 0, 0, h)
            sg.addColorStop(0, withAlpha('#9fd6ff', 0.32))
            sg.addColorStop(1, withAlpha('#9fd6ff', 0.04))
            ctx.fillStyle = sg
            ctx.fill()
          }}
        />
        {/* grid, curves and nodes (redrawn on param change) */}
        <FxCanvas
          width={GW}
          height={GH}
          className="absolute inset-0 cursor-crosshair"
          draw={(ctx, w, h) => {
            drawFreqGrid(ctx, w, h, DB_RANGE)
            // individual band fills
            curves.forEach((c, i) => {
              if (!bands[i].on) return
              ctx.beginPath()
              ctx.moveTo(0, dbToY(0, h))
              for (let x = 0; x < w; x++) ctx.lineTo(x, dbToY(Math.max(-DB_RANGE - 6, Math.min(DB_RANGE + 6, c[x])), h))
              ctx.lineTo(w, dbToY(0, h))
              ctx.closePath()
              ctx.fillStyle = withAlpha(COLORS[i], i === sel ? 0.22 : 0.08)
              ctx.fill()
            })
            // total response
            ctx.strokeStyle = '#f2f7fa'
            ctx.lineWidth = 2
            ctx.shadowColor = color
            ctx.shadowBlur = 6
            ctx.beginPath()
            for (let x = 0; x < w; x++) {
              const y = dbToY(Math.max(-DB_RANGE - 6, Math.min(DB_RANGE + 6, total[x])), h)
              if (x === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.stroke()
            ctx.shadowBlur = 0
            ctx.lineWidth = 1
            // nodes
            bands.forEach((b, i) => {
              const x = freqToX(b.freq, w)
              const y = nodeY(b, h)
              const r = i === sel || i === hover ? 8 : 6.5
              ctx.beginPath()
              ctx.arc(x, y, r, 0, Math.PI * 2)
              ctx.fillStyle = b.on ? COLORS[i] : '#3a4448'
              ctx.globalAlpha = b.on ? 1 : 0.8
              ctx.fill()
              ctx.globalAlpha = 1
              ctx.strokeStyle = i === sel ? '#ffffff' : '#101415'
              ctx.lineWidth = i === sel ? 2 : 1
              ctx.stroke()
              ctx.lineWidth = 1
              ctx.fillStyle = b.on ? '#101415' : '#9aa6ab'
              ctx.font = 'bold 9px system-ui, sans-serif'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(String(i + 1), x, y + 0.5)
              ctx.textAlign = 'start'
              ctx.textBaseline = 'alphabetic'
            })
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return
            const { x, y } = local(e)
            const i = nearest(x, y)
            if (i < 0) return
            setSel(i)
            drag.current = { band: i }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            p.hint(bandText(i + 1, bands[i]))
          }}
          onPointerMove={(e) => {
            const { x, y } = local(e)
            if (drag.current) moveBand(drag.current.band, x, y)
            else {
              const i = nearest(x, y)
              if (i !== hover) setHover(i)
              if (i >= 0) p.hint(bandText(i + 1, bands[i]))
              else p.hint(`${formatParam({ id: 'f', name: 'f', min: 20, max: 20000, default: 0, unit: 'Hz' }, xToFreq(x, GW))}, ${yToDb(y, GH).toFixed(1)} dB — drag a band, wheel = Q, right-click = on/off, double-click = reset`)
            }
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerLeave={() => setHover(-1)}
          onWheel={(e) => {
            const { x, y } = local(e)
            let i = nearest(x, y, 24)
            if (i < 0) i = sel
            const b = bands[i]
            const q = Math.min(18, Math.max(0.1, b.q * Math.exp(-Math.sign(e.deltaY) * (e.shiftKey ? 0.03 : 0.12))))
            p.setParam(`b${i + 1}.q`, q)
            p.hint(bandText(i + 1, { ...b, q }))
          }}
          onDoubleClick={(e) => {
            const { x, y } = local(e)
            const i = nearest(x, y)
            if (i < 0) return
            const n = i + 1
            const def = (id: string) => manifest.params.find((d) => d.id === id)!.default
            p.setParams({ [`b${n}.gain`]: 0, [`b${n}.q`]: def(`b${n}.q`) })
          }}
          onContextMenu={(e) => {
            const { x, y } = local(e)
            const i = nearest(x, y)
            if (i < 0) return
            e.preventDefault()
            p.setParam(`b${i + 1}.on`, bands[i].on ? 0 : 1)
            setSel(i)
          }}
        />
      </div>

      <div className="flex gap-2">
        <Section title="Bands" accent={color} className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            {bands.map((b, i) => (
              <button
                key={i}
                onClick={() => setSel(i)}
                onDoubleClick={() => p.setParam(`b${i + 1}.on`, b.on ? 0 : 1)}
                onMouseEnter={() => p.hint(`${bandText(i + 1, b)} — click to edit, double-click = on/off`)}
                className="grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold"
                style={{
                  background: b.on ? COLORS[i] : '#2b3337',
                  color: b.on ? '#101415' : '#8a979c',
                  borderColor: i === sel ? '#fff' : '#101415'
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => p.setParam(`b${sel + 1}.on`, sb.on ? 0 : 1)}
              className="flex items-center gap-1 rounded-[3px] bg-[#1f2528] px-1.5 py-1 text-[10px] uppercase tracking-wide"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: sb.on ? COLORS[sel] : 'var(--fl-led-off)', boxShadow: sb.on ? `0 0 6px ${COLORS[sel]}` : undefined }} />
              On
            </button>
            <select
              value={sb.type}
              onChange={(e) => p.setParam(`b${sel + 1}.type`, Number(e.target.value))}
              onMouseEnter={() => p.hint(`Band ${sel + 1} type: ${BAND_TYPES[sb.type]}`)}
              className="h-6 flex-1 rounded-[3px] border border-[#141819] bg-[#1c2225] px-1 text-[11px] text-fl-text outline-none"
            >
              {BAND_TYPES.map((t, i) => (
                <option key={t} value={i}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </Section>
        <Sec title={`Band ${sel + 1}`} accent={COLORS[sel]} className="flex-1" body="flex items-start justify-around gap-1">
          <PK p={p} id={`b${sel + 1}.freq`} size={MID} color={COLORS[sel]} label="Freq" />
          <PK p={p} id={`b${sel + 1}.gain`} size={MID} color={COLORS[sel]} label="Gain" />
          <PK p={p} id={`b${sel + 1}.q`} size={MID} color={COLORS[sel]} label="Q / Width" />
          <div className="self-center fl-lcd w-[118px] px-1.5 py-1 text-[10px] leading-tight text-[#9fe870]">
            <div>{BAND_TYPES[sb.type]}</div>
            <div>
              {sb.freq >= 1000 ? `${(sb.freq / 1000).toFixed(2)} kHz` : `${Math.round(sb.freq)} Hz`}
              {bandShape(sb.type).usesGain ? `  ${sb.gain > 0 ? '+' : ''}${sb.gain.toFixed(1)} dB` : ''}  Q {sb.q.toFixed(2)}
            </div>
          </div>
        </Sec>
        <Sec title="Output" accent={color}>
          <PK p={p} id="out" size={MID} color={color} label="Gain" />
        </Sec>
      </div>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 640, height: 330 } })
