import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, Mid, Sec, drawScreen, pv } from '../fx-common/ui'
import { manifest } from './manifest'

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const bits = pv(p, 'bits')
  const rate = pv(p, 'rate')
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Crush" accent={color} body="flex items-start gap-3">
          <KnobReadout p={p} id="bits" />
          <KnobReadout p={p} id="rate" />
        </Sec>
        <Sec title="Waveform" accent={color} className="flex-1">
          <FxCanvas
            width={190}
            height={96}
            className="fl-inset"
            onMouseEnter={() => p.hint('Two cycles of a 220 Hz sine before (grey) and after (green) crushing')}
            draw={(ctx, w, h) => {
              drawScreen(ctx, w, h)
              const SR = 48000
              const N = Math.round((2 / 220) * SR)
              const q = Math.pow(2, bits - 1)
              const ratio = Math.min(1, rate / SR)
              const amp = h / 2 - 8
              ctx.strokeStyle = 'rgba(220,230,235,0.3)'
              ctx.beginPath()
              for (let x = 0; x <= w; x++) {
                const y = h / 2 - Math.sin((x / w) * 4 * Math.PI) * 0.9 * amp
                if (x === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              }
              ctx.stroke()
              ctx.strokeStyle = color
              ctx.lineWidth = 1.6
              ctx.beginPath()
              let ph = 1
              let hold = 0
              for (let i = 0; i < N; i++) {
                ph += ratio
                if (ph >= 1) {
                  ph -= Math.floor(ph)
                  hold = Math.round(0.9 * Math.sin((i / N) * 4 * Math.PI) * q) / q
                }
                const x = (i / N) * w
                const y = h / 2 - hold * amp
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              }
              ctx.stroke()
              ctx.lineWidth = 1
            }}
          />
        </Sec>
      </div>
      <Sec title="Output" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="output" />
        <Mid p={p} id="mix" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 420, height: 252 } })
