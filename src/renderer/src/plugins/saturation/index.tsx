import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, Mid, Sec, Seg, Toggle, VMeter, drawScreen, pv, useDspFeed } from '../fx-common/ui'
import { manifest, satCurve } from './manifest'

type Feed = { inDb: number; outDb: number }

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const m = useRef<Feed>({ inDb: -120, outDb: -120 })
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'inDb' in msg) m.current = msg as Feed
  })
  const mode = Math.round(pv(p, 'mode'))
  const g = Math.pow(10, pv(p, 'drive') / 20)
  const asym = pv(p, 'bias')
  return (
    <PluginPanel className="flex gap-2">
      <div className="flex flex-1 flex-col gap-2">
        <Seg p={p} id="mode" label={false} />
        <div className="flex gap-2">
          <Sec title="Curve" accent={color}>
            <FxCanvas
              width={112}
              height={112}
              className="fl-inset"
              onMouseEnter={() => p.hint('Transfer curve (before auto-gain)')}
              draw={(ctx, w, h) => {
                drawScreen(ctx, w, h)
                ctx.fillStyle = 'rgba(255,255,255,0.08)'
                ctx.fillRect(0, h / 2, w, 1)
                ctx.fillRect(w / 2, 0, 1, h)
                ctx.strokeStyle = 'rgba(255,255,255,0.15)'
                ctx.beginPath()
                ctx.moveTo(0, h)
                ctx.lineTo(w, 0)
                ctx.stroke()
                ctx.strokeStyle = color
                ctx.lineWidth = 2
                ctx.shadowColor = color
                ctx.shadowBlur = 5
                ctx.beginPath()
                const off = satCurve(mode, 0, asym)
                for (let px = 0; px <= w; px++) {
                  const x = (px / w) * 2 - 1
                  const y = Math.max(-1.3, Math.min(1.3, satCurve(mode, x * g, asym) - off))
                  const py = h / 2 - y * (h / 2 - 8)
                  if (px === 0) ctx.moveTo(px, py)
                  else ctx.lineTo(px, py)
                }
                ctx.stroke()
                ctx.shadowBlur = 0
                ctx.lineWidth = 1
              }}
            />
          </Sec>
          <Sec title="Drive" accent={color} className="flex-1" body="flex flex-col items-center gap-2 pt-1">
            <KnobReadout p={p} id="drive" size={60} />
            <Toggle p={p} id="auto" label="Auto gain" />
          </Sec>
        </div>
        <Sec title="Colour" accent={color} body="flex items-start justify-around">
          <Mid p={p} id="tone" />
          <Mid p={p} id="bias" />
          <Mid p={p} id="output" />
          <Mid p={p} id="mix" />
        </Sec>
      </div>
      <Sec title="Level" accent={color} body="flex gap-1.5">
        <VMeter get={() => m.current.inDb} min={-48} max={6} height={250} color={color} label="In" />
        <VMeter get={() => m.current.outDb} min={-48} max={6} height={250} color={color} label="Out" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 430, height: 313 } })
