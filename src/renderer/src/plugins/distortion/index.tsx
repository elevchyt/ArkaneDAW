import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, Mid, Sec, Seg, drawScreen, pv, withAlpha } from '../fx-common/ui'
import { driveComp, manifest, shape } from './manifest'

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const mode = Math.round(pv(p, 'mode'))
  const driveDb = pv(p, 'drive')
  const g = Math.pow(10, driveDb / 20)
  const comp = Math.pow(10, (driveComp(driveDb) + pv(p, 'output')) / 20)
  return (
    <PluginPanel className="flex flex-col gap-2">
      <Seg p={p} id="mode" label={false} />
      <div className="flex gap-2">
        <Sec title="Curve" accent={color} body="flex gap-2">
          <FxCanvas
            width={110}
            height={110}
            className="fl-inset"
            onMouseEnter={() => p.hint('Transfer curve (input → output)')}
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
              ctx.beginPath()
              for (let px = 0; px <= w; px++) {
                const x = (px / w) * 2 - 1
                const y = Math.max(-1.2, Math.min(1.2, shape(mode, x * g)))
                const py = h / 2 - y * (h / 2 - 6)
                if (px === 0) ctx.moveTo(px, py)
                else ctx.lineTo(px, py)
              }
              ctx.stroke()
              ctx.lineWidth = 1
            }}
          />
          <FxCanvas
            width={150}
            height={110}
            className="fl-inset"
            onMouseEnter={() => p.hint('A sine wave before (grey) and after (colour) the distortion')}
            draw={(ctx, w, h) => {
              drawScreen(ctx, w, h)
              ctx.fillStyle = 'rgba(255,255,255,0.08)'
              ctx.fillRect(0, h / 2, w, 1)
              const wave = (fn: (x: number) => number, stroke: string, lw: number) => {
                ctx.strokeStyle = stroke
                ctx.lineWidth = lw
                ctx.beginPath()
                for (let px = 0; px <= w; px++) {
                  const s = 0.8 * Math.sin((px / w) * Math.PI * 4)
                  const y = Math.max(-1.3, Math.min(1.3, fn(s)))
                  const py = h / 2 - y * (h / 2 - 8)
                  if (px === 0) ctx.moveTo(px, py)
                  else ctx.lineTo(px, py)
                }
                ctx.stroke()
                ctx.lineWidth = 1
              }
              wave((x) => x, 'rgba(220,230,235,0.3)', 1)
              ctx.shadowColor = color
              ctx.shadowBlur = 6
              wave((x) => shape(mode, x * g) * Math.min(2.5, comp * 1.6), withAlpha(color, 0.95), 1.8)
              ctx.shadowBlur = 0
            }}
          />
        </Sec>
        <Sec title="Drive" accent={color} body="flex items-start pt-2">
          <KnobReadout p={p} id="drive" size={64} />
        </Sec>
      </div>
      <Sec title="Output" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="tone" />
        <Mid p={p} id="output" />
        <Mid p={p} id="mix" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 410, height: 295 } })
