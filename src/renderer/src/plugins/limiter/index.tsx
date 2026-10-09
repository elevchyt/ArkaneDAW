import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel, Section } from '../sdk/ui'
import { Sec, FxCanvas, KnobReadout, VMeter, drawScreen, pv, useDspFeed, withAlpha, MID } from '../fx-common/ui'
import { manifest } from './manifest'

type Feed = { gr: number; inDb: number; outDb: number }
const HIST = 240

function Editor(p: PluginEditorProps) {
  const m = useRef<Feed>({ gr: 0, inDb: -120, outDb: -120 })
  const hist = useRef({ inp: new Float32Array(HIST).fill(-120), gr: new Float32Array(HIST), pos: 0, last: 0 })
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'gr' in msg) m.current = msg as Feed
  })
  const color = manifest.color!
  const ceiling = pv(p, 'ceiling')
  return (
    <PluginPanel className="flex gap-2">
      <Sec title="Limiter" accent={color} body="flex items-start gap-3">
        <KnobReadout p={p} id="gain" />
        <KnobReadout p={p} id="ceiling" />
        <div className="flex flex-col gap-2">
          <KnobReadout p={p} id="release" size={MID} />
        </div>
        <KnobReadout p={p} id="lookahead" size={MID} />
      </Sec>
      <Section title="History" accent={color} className="flex-1">
        <FxCanvas
          width={196}
          height={148}
          animate
          className="fl-inset"
          draw={(ctx, w, h) => {
            const H = hist.current
            const now = performance.now()
            if (now - H.last > 33) {
              H.last = now
              H.inp[H.pos] = m.current.inDb
              H.gr[H.pos] = m.current.gr
              H.pos = (H.pos + 1) % HIST
            }
            drawScreen(ctx, w, h)
            const R = 36
            const Y = (db: number) => (-Math.max(-R, Math.min(0, db)) / R) * h
            ctx.strokeStyle = 'rgba(255,255,255,0.07)'
            for (let d = -6; d > -R; d -= 6) {
              ctx.beginPath()
              ctx.moveTo(0, Y(d) + 0.5)
              ctx.lineTo(w, Y(d) + 0.5)
              ctx.stroke()
            }
            // input level (filled)
            ctx.fillStyle = 'rgba(160,190,200,0.22)'
            ctx.beginPath()
            ctx.moveTo(0, h)
            for (let k = 0; k < HIST; k++) ctx.lineTo((k / (HIST - 1)) * w, Y(H.inp[(H.pos + k) % HIST]))
            ctx.lineTo(w, h)
            ctx.fill()
            // gain reduction (hanging from the top)
            ctx.fillStyle = withAlpha(color, 0.55)
            ctx.strokeStyle = color
            ctx.beginPath()
            ctx.moveTo(0, 0)
            for (let k = 0; k < HIST; k++) ctx.lineTo((k / (HIST - 1)) * w, Y(H.gr[(H.pos + k) % HIST]) * 1)
            ctx.lineTo(w, 0)
            ctx.fill()
            // ceiling line
            ctx.strokeStyle = '#ffffff'
            ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(0, Y(ceiling) + 0.5)
            ctx.lineTo(w, Y(ceiling) + 0.5)
            ctx.stroke()
            ctx.setLineDash([])
            ctx.fillStyle = 'rgba(220,230,235,0.6)'
            ctx.font = '9px system-ui, sans-serif'
            ctx.fillText(`GR ${m.current.gr.toFixed(1)} dB`, 4, h - 5)
          }}
        />
      </Section>
      <Sec title="Meters" accent={color} body="flex gap-1.5">
        <VMeter get={() => m.current.inDb} min={-48} max={6} height={148} color={color} label="In" />
        <VMeter get={() => m.current.gr} min={-24} max={0} height={148} color={color} fromTop label="GR" />
        <VMeter get={() => m.current.outDb} min={-48} max={0} height={148} color={color} label="Out" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 640, height: 210 } })
