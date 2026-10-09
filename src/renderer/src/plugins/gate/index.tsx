import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel, Section } from '../sdk/ui'
import { Sec, FxCanvas, KnobReadout, Mid, Toggle, drawScreen, pv, useDspFeed, withAlpha } from '../fx-common/ui'
import { manifest } from './manifest'

type Feed = { inDb: number; gain: number; open: boolean }
const HIST = 200

function Editor(p: PluginEditorProps) {
  const m = useRef<Feed>({ inDb: -120, gain: -80, open: false })
  const hist = useRef({ inp: new Float32Array(HIST).fill(-120), g: new Float32Array(HIST).fill(-80), pos: 0, last: 0 })
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'inDb' in msg) m.current = msg as Feed
  })
  const color = manifest.color!
  const thr = pv(p, 'threshold')
  return (
    <PluginPanel className="flex gap-2">
      <Sec title="Gate" accent={color} body="flex items-start gap-3">
        <KnobReadout p={p} id="threshold" />
        <KnobReadout p={p} id="range" />
      </Sec>
      <Section title="Envelope" accent={color} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Mid p={p} id="attack" />
          <Mid p={p} id="hold" />
          <Mid p={p} id="release" />
        </div>
        <Toggle p={p} id="sidechain" label="Side-chain input" />
      </Section>
      <Section title="Activity" accent={color} className="flex-1">
        <FxCanvas
          width={176}
          height={128}
          animate
          className="fl-inset"
          onMouseEnter={() => p.hint('Grey = input level, colour = gate gain, dashed = threshold')}
          draw={(ctx, w, h) => {
            const H = hist.current
            const now = performance.now()
            if (now - H.last > 33) {
              H.last = now
              H.inp[H.pos] = m.current.inDb
              H.g[H.pos] = m.current.gain
              H.pos = (H.pos + 1) % HIST
            }
            drawScreen(ctx, w, h)
            const R = 80
            const Y = (db: number) => (-Math.max(-R, Math.min(0, db)) / R) * (h - 2) + 1
            ctx.fillStyle = 'rgba(160,190,200,0.25)'
            ctx.beginPath()
            ctx.moveTo(0, h)
            for (let k = 0; k < HIST; k++) ctx.lineTo((k / (HIST - 1)) * w, Y(H.inp[(H.pos + k) % HIST]))
            ctx.lineTo(w, h)
            ctx.fill()
            ctx.strokeStyle = color
            ctx.lineWidth = 1.5
            ctx.beginPath()
            for (let k = 0; k < HIST; k++) {
              const x = (k / (HIST - 1)) * w
              const y = Y(H.g[(H.pos + k) % HIST])
              if (k === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.stroke()
            ctx.lineWidth = 1
            ctx.strokeStyle = '#ffffff'
            ctx.setLineDash([4, 3])
            ctx.beginPath()
            ctx.moveTo(0, Y(thr) + 0.5)
            ctx.lineTo(w, Y(thr) + 0.5)
            ctx.stroke()
            ctx.setLineDash([])
            // gate LED
            const on = m.current.open
            ctx.fillStyle = on ? color : '#3a4c2c'
            ctx.shadowColor = color
            ctx.shadowBlur = on ? 8 : 0
            ctx.beginPath()
            ctx.arc(w - 10, 10, 4.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.shadowBlur = 0
            ctx.fillStyle = withAlpha('#dce6ea', 0.6)
            ctx.font = '9px system-ui, sans-serif'
            ctx.fillText(on ? 'OPEN' : 'CLOSED', w - 52, 13)
          }}
        />
      </Section>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 560, height: 176 } })
