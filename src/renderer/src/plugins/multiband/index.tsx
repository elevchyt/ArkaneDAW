import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PK, PluginPanel } from '../sdk/ui'
import { FxCanvas, MID, SMALL, Sec, Small, VMeter, drawFreqGrid, freqToX, pv, ptext, useDspFeed, withAlpha, xToFreq } from '../fx-common/ui'
import { BANDS, manifest } from './manifest'

const COLORS = ['#ff8a65', '#ffd54f', '#64b5f6']
const NAMES = ['Low', 'Mid', 'High']
const GW = 560
const GH = 64

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const gr = useRef<number[]>([0, 0, 0])
  const drag = useRef<'xlow' | 'xhigh' | null>(null)
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'gr' in msg) gr.current = (msg as { gr: number[] }).gr
  })
  const xl = pv(p, 'xlow')
  const xh = pv(p, 'xhigh')
  const posX = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return ((e.clientX - r.left) / r.width) * GW
  }
  return (
    <PluginPanel className="flex flex-col gap-2">
      <FxCanvas
        width={GW}
        height={GH}
        className="fl-inset cursor-ew-resize"
        onMouseEnter={() => p.hint(`Crossovers: ${ptext(p, 'xlow')} / ${ptext(p, 'xhigh')} — drag the lines`)}
        onPointerDown={(e) => {
          const x = posX(e)
          drag.current = Math.abs(x - freqToX(xl, GW)) < Math.abs(x - freqToX(xh, GW)) ? 'xlow' : 'xhigh'
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const id = drag.current
          const def = manifest.params.find((d) => d.id === id)!
          const f = Math.max(def.min, Math.min(def.max, xToFreq(posX(e), GW)))
          p.setParam(id, f)
          p.hint(`${def.name}: ${ptext(p, id, f)}`)
        }}
        onPointerUp={() => (drag.current = null)}
        draw={(ctx, w, h) => {
          ctx.fillStyle = '#151b1d'
          ctx.fillRect(0, 0, w, h)
          const a = freqToX(xl, w)
          const b = freqToX(xh, w)
          const regions: [number, number][] = [[0, a], [a, b], [b, w]]
          regions.forEach(([x0, x1], i) => {
            ctx.fillStyle = withAlpha(COLORS[i], 0.16)
            ctx.fillRect(x0, 0, x1 - x0, h)
            ctx.fillStyle = withAlpha(COLORS[i], 0.85)
            ctx.font = 'bold 10px system-ui, sans-serif'
            ctx.fillText(NAMES[i].toUpperCase(), x0 + 6, 13)
          })
          drawFreqGrid(ctx, w, h)
          for (const x of [a, b]) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(Math.round(x) - 1, 0, 2, h)
          }
        }}
      />
      <div className="flex gap-2">
        {BANDS.map((b, i) => (
          <Sec key={b} title={NAMES[i]} accent={COLORS[i]} className="flex-1" body="flex items-start gap-2">
            <div className="flex flex-col items-center gap-1">
              <PK p={p} id={`${b}.thr`} size={MID} color={COLORS[i]} label="Thresh" />
              <div className="flex gap-1">
                <PK p={p} id={`${b}.ratio`} size={SMALL} color={COLORS[i]} label="Ratio" />
                <PK p={p} id={`${b}.gain`} size={SMALL} color={COLORS[i]} label="Gain" />
              </div>
            </div>
            <VMeter get={() => gr.current[i] ?? 0} min={-24} max={0} height={104} width={10} color={COLORS[i]} fromTop label="GR" />
          </Sec>
        ))}
      </div>
      <Sec title="Global" accent={color} body="flex items-start justify-around">
        <Small p={p} id="attack" />
        <Small p={p} id="release" />
        <Small p={p} id="output" />
        <Small p={p} id="mix" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 576, height: 338 } })
