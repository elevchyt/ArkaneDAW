import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, Mid, Sec, useDspFeed } from '../fx-common/ui'
import { manifest } from './manifest'

const HIST = 160

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const m = useRef({ max: 0, min: 0 })
  const hist = useRef({ max: new Float32Array(HIST), min: new Float32Array(HIST), pos: 0, last: 0 })
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'max' in msg) m.current = msg as { max: number; min: number }
  })
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Shape" accent={color} body="flex items-start gap-3">
          <KnobReadout p={p} id="attack" size={60} />
          <KnobReadout p={p} id="sustain" size={60} />
        </Sec>
        <Sec title="Gain" accent={color} className="flex-1">
          <FxCanvas
            width={170}
            height={92}
            animate
            className="fl-inset"
            onMouseEnter={() => p.hint('Gain applied over time: up = boost, down = cut')}
            draw={(ctx, w, h) => {
              const H = hist.current
              const now = performance.now()
              if (now - H.last > 33) {
                H.last = now
                H.max[H.pos] = m.current.max
                H.min[H.pos] = m.current.min
                H.pos = (H.pos + 1) % HIST
              }
              ctx.fillStyle = '#141a1c'
              ctx.fillRect(0, 0, w, h)
              ctx.fillStyle = 'rgba(255,255,255,0.15)'
              ctx.fillRect(0, h / 2, w, 1)
              const R = 18
              for (let k = 0; k < HIST; k++) {
                const i = (H.pos + k) % HIST
                const x = (k / HIST) * w
                const up = (Math.min(R, H.max[i]) / R) * (h / 2 - 2)
                const dn = (Math.min(R, -H.min[i]) / R) * (h / 2 - 2)
                ctx.fillStyle = color
                ctx.fillRect(x, h / 2 - up, w / HIST + 0.5, up)
                ctx.fillStyle = '#5fb7ff'
                ctx.fillRect(x, h / 2 + 1, w / HIST + 0.5, dn)
              }
              ctx.fillStyle = 'rgba(210,220,225,0.5)'
              ctx.font = '9px system-ui, sans-serif'
              ctx.fillText('+18', 3, 10)
              ctx.fillText('-18', 3, h - 3)
            }}
          />
        </Sec>
      </div>
      <Sec title="Detector & Output" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="speed" />
        <Mid p={p} id="output" />
        <Mid p={p} id="mix" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 430, height: 249 } })
