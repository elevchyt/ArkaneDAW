import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, Mid, Sec, Seg, Toggle, drawScreen, pv, useTempoSync, withAlpha } from '../fx-common/ui'
import { DIVISIONS } from '../fx-common/divisions'
import { manifest } from './manifest'

function wave(shape: number, ph: number): number {
  ph = ((ph % 1) + 1) % 1
  switch (shape) {
    case 1: return 1 - 2 * Math.abs(ph - 0.5)
    case 2: return ph < 0.5 ? 1 : 0
    case 3: return 1 - ph
    case 4: return ph
    default: return 0.5 + 0.5 * Math.cos(2 * Math.PI * ph)
  }
}

function Editor(p: PluginEditorProps) {
  const tempo = useTempoSync(p)
  const color = manifest.color!
  const sync = pv(p, 'sync') >= 0.5
  const div = Math.round(pv(p, 'div'))
  const hz = sync ? tempo / 60 / DIVISIONS[div].beats : pv(p, 'rate')
  const shape = Math.round(pv(p, 'shape'))
  const depth = pv(p, 'depth')
  const pan = Math.round(pv(p, 'mode')) === 1
  const st = useRef({ ph: 0, t: performance.now() })
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Rate" accent={color} body="flex items-start gap-3">
          {sync ? <KnobReadout p={p} id="div" label="Note" /> : <KnobReadout p={p} id="rate" />}
          <KnobReadout p={p} id="depth" />
          <div className="flex flex-col gap-1.5 pt-1">
            <Toggle p={p} id="sync" label="Tempo sync" />
            <div className="fl-lcd px-1.5 py-0.5 text-[10px] text-[#9fe870]">{hz.toFixed(2)} Hz</div>
          </div>
        </Sec>
        <Sec title="Shape" accent={color} className="flex-1" body="flex flex-col gap-1.5">
          <Seg p={p} id="mode" label={false} />
          <FxCanvas
            width={130}
            height={58}
            animate
            className="fl-inset"
            draw={(ctx, w, h) => {
              const now = performance.now()
              st.current.ph = (st.current.ph + ((now - st.current.t) / 1000) * hz) % 1
              st.current.t = now
              drawScreen(ctx, w, h)
              const Y = (v: number) => h - 5 - (1 - depth * (1 - v)) * (h - 10)
              ctx.strokeStyle = color
              ctx.lineWidth = 2
              ctx.beginPath()
              for (let x = 0; x <= w; x++) {
                const y = Y(wave(shape, (x / w) * 2))
                if (x === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              }
              ctx.stroke()
              ctx.lineWidth = 1
              const x = st.current.ph * (w / 2)
              ctx.fillStyle = withAlpha('#ffffff', 0.25)
              ctx.fillRect(x, 0, 1, h)
              ctx.fillRect(x + w / 2, 0, 1, h)
              ctx.fillStyle = 'rgba(210,220,225,0.5)'
              ctx.font = '9px system-ui, sans-serif'
              ctx.fillText(pan ? 'L ↔ R' : 'level', 4, 10)
            }}
          />
        </Sec>
      </div>
      <Sec title="Character" accent={color} body="flex items-end justify-around gap-2">
        <Seg p={p} id="shape" label="Wave" options={['Sine', 'Tri', 'Square', 'Saw ↓', 'Saw ↑']} />
        <Mid p={p} id="smooth" />
        <Mid p={p} id="stereo" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 470, height: 243 } })
