import { useMemo, useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { Biquad } from '../sdk/dsp'
import { denormalize, normalize } from '../sdk/params'
import { FxCanvas, KnobReadout, Mid, Sec, Seg, Small, Toggle, drawFreqGrid, freqToX, pv, ptext, useTempoSync, withAlpha, xToFreq } from '../fx-common/ui'
import { manifest, resToQ } from './manifest'

const GW = 330
const GH = 150
const KIND = ['lp', 'hp', 'bp', 'notch']
const RANGE = 30 // dB shown above/below 0

function response(type: number, slope: number, fc: number, q: number, w: number): Float32Array {
  const a = new Biquad(48000)
  const b = new Biquad(48000)
  const kind = KIND[type] ?? 'lp'
  const two = slope === 1
  a.set(kind, fc, two ? 0.54 : q)
  if (two) b.set(kind, fc, q)
  const out = new Float32Array(w)
  for (let x = 0; x < w; x++) {
    const f = xToFreq(x, w)
    let m = a.magnitude(f)
    if (two) m *= b.magnitude(f)
    out[x] = 20 * Math.log10(Math.max(1e-6, m))
  }
  return out
}

function Editor(p: PluginEditorProps) {
  useTempoSync(p)
  const color = manifest.color!
  const type = Math.round(pv(p, 'type'))
  const slope = Math.round(pv(p, 'slope'))
  const cutoff = pv(p, 'cutoff')
  const res = pv(p, 'res')
  const amt = pv(p, 'lfoAmt')
  const sync = pv(p, 'lfoSync') >= 0.5
  const curve = useMemo(() => response(type, slope, cutoff, resToQ(res), GW), [type, slope, cutoff, res])
  const drag = useRef(false)
  const cutDef = manifest.params.find((d) => d.id === 'cutoff')!

  const Y = (db: number, h: number) => h * 0.42 - (db / RANGE) * (h * 0.42 - 6)
  const fromPointer = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * GW
    const y = ((e.clientY - r.top) / r.height) * GH
    const f = Math.max(20, Math.min(20000, xToFreq(x, GW)))
    const rs = Math.max(0, Math.min(1, 1 - y / GH))
    p.setParams({ cutoff: denormalize(cutDef, normalize(cutDef, f)), res: rs })
    p.hint(`Cutoff ${ptext(p, 'cutoff', f)}, resonance ${Math.round(rs * 100)}%`)
  }

  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Response" accent={color} body="flex flex-col gap-1">
          <FxCanvas
            width={GW}
            height={GH}
            className="fl-inset cursor-crosshair"
            onMouseEnter={() => p.hint('Drag: X = cutoff, Y = resonance')}
            onPointerDown={(e) => {
              drag.current = true
              ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
              fromPointer(e)
            }}
            onPointerMove={(e) => drag.current && fromPointer(e)}
            onPointerUp={() => (drag.current = false)}
            draw={(ctx, w, h) => {
              const g = ctx.createLinearGradient(0, 0, 0, h)
              g.addColorStop(0, '#1a2124')
              g.addColorStop(1, '#13181a')
              ctx.fillStyle = g
              ctx.fillRect(0, 0, w, h)
              drawFreqGrid(ctx, w, h)
              ctx.fillStyle = 'rgba(255,255,255,0.12)'
              ctx.fillRect(0, Math.round(Y(0, h)), w, 1)
              // LFO range band
              if (Math.abs(amt) > 0.001) {
                const lo = cutoff * Math.pow(2, -4 * Math.abs(amt))
                const hi = cutoff * Math.pow(2, 4 * Math.abs(amt))
                ctx.fillStyle = withAlpha(color, 0.1)
                ctx.fillRect(freqToX(lo, w), 0, freqToX(hi, w) - freqToX(lo, w), h)
              }
              ctx.beginPath()
              ctx.moveTo(0, h)
              for (let x = 0; x < w; x++) ctx.lineTo(x, Math.min(h, Y(Math.max(-RANGE * 2, curve[x]), h)))
              ctx.lineTo(w, h)
              ctx.closePath()
              ctx.fillStyle = withAlpha(color, 0.18)
              ctx.fill()
              ctx.strokeStyle = color
              ctx.lineWidth = 2
              ctx.beginPath()
              for (let x = 0; x < w; x++) {
                const y = Math.min(h, Y(Math.max(-RANGE * 2, curve[x]), h))
                if (x === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              }
              ctx.stroke()
              ctx.lineWidth = 1
              // node
              const nx = freqToX(cutoff, w)
              const ny = h * (1 - res)
              ctx.fillStyle = '#ffffff'
              ctx.strokeStyle = color
              ctx.lineWidth = 2
              ctx.beginPath()
              ctx.arc(nx, ny, 5.5, 0, Math.PI * 2)
              ctx.fill()
              ctx.stroke()
              ctx.lineWidth = 1
            }}
          />
          <div className="flex gap-2">
            <Seg p={p} id="type" label={false} className="flex-1" options={['LP', 'HP', 'BP', 'Notch']} />
            <Seg p={p} id="slope" label={false} />
          </div>
        </Sec>
        <Sec title="Filter" accent={color} body="flex flex-col items-center gap-2">
          <KnobReadout p={p} id="cutoff" />
          <div className="flex gap-2">
            <Mid p={p} id="res" />
            <Mid p={p} id="drive" />
          </div>
        </Sec>
      </div>
      <Sec title="LFO" accent={color} body="flex items-end gap-3">
        <Mid p={p} id="lfoAmt" label="Amount" />
        {sync ? <Mid p={p} id="lfoDiv" label="Rate" /> : <Mid p={p} id="lfoRate" label="Rate" />}
        <div className="flex flex-col gap-1">
          <Toggle p={p} id="lfoSync" label="Sync" />
        </div>
        <Seg p={p} id="lfoShape" label="Shape" options={['Sin', 'Tri', 'Saw', 'Sqr', 'S&H']} />
        <div className="ml-auto">
          <Small p={p} id="mix" />
        </div>
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 500, height: 330 } })
