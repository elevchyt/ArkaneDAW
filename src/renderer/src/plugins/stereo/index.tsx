import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PK, PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, MID, Mid, Sec, Toggle, pv, useDspFeed, withAlpha } from '../fx-common/ui'
import { manifest } from './manifest'

type Feed = { scope: Float32Array; pos: number; corr: number }

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const feed = useRef<Feed | null>(null)
  const corr = useRef(0)
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'scope' in msg) feed.current = msg as Feed
  })
  const mb = pv(p, 'monoBass')
  return (
    <PluginPanel className="flex gap-2">
      <Sec title="Scope" accent={color} body="flex flex-col gap-1">
        <FxCanvas
          width={150}
          height={150}
          animate
          className="fl-inset"
          onMouseEnter={() => p.hint('Vectorscope: vertical = mono, horizontal = side/stereo content')}
          draw={(ctx, w, h) => {
            ctx.fillStyle = '#121719'
            ctx.fillRect(0, 0, w, h)
            ctx.strokeStyle = 'rgba(255,255,255,0.07)'
            ctx.beginPath()
            ctx.moveTo(w / 2, 0)
            ctx.lineTo(w / 2, h)
            ctx.moveTo(0, h / 2)
            ctx.lineTo(w, h / 2)
            ctx.moveTo(0, 0)
            ctx.lineTo(w, h)
            ctx.moveTo(w, 0)
            ctx.lineTo(0, h)
            ctx.stroke()
            ctx.fillStyle = 'rgba(200,210,215,0.4)'
            ctx.font = '9px system-ui, sans-serif'
            ctx.fillText('L', 6, 12)
            ctx.fillText('R', w - 12, 12)
            const f = feed.current
            if (!f) return
            const s = f.scope
            const n = s.length / 2
            const k = (w / 2 - 6) * 0.9
            for (let i = 0; i < n; i++) {
              const l = s[2 * i]
              const r = s[2 * i + 1]
              const x = w / 2 + (r - l) * 0.7071 * k
              const y = h / 2 - (l + r) * 0.7071 * k
              const age = ((i - f.pos / 2 + n) % n) / n
              ctx.fillStyle = withAlpha(color, 0.15 + 0.7 * age)
              ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5)
            }
          }}
        />
        <FxCanvas
          width={150}
          height={14}
          animate
          className="fl-inset"
          onMouseEnter={() => p.hint(`Phase correlation: ${corr.current.toFixed(2)} (+1 mono, 0 wide, -1 out of phase)`)}
          draw={(ctx, w, h) => {
            ctx.fillStyle = '#121617'
            ctx.fillRect(0, 0, w, h)
            const c = feed.current?.corr ?? 0
            corr.current += (c - corr.current) * 0.15
            const x = w / 2 + corr.current * (w / 2 - 3)
            ctx.fillStyle = corr.current < 0 ? '#ff5d55' : color
            ctx.fillRect(Math.min(w / 2, x), 3, Math.abs(x - w / 2), h - 6)
            ctx.fillStyle = 'rgba(255,255,255,0.3)'
            ctx.fillRect(w / 2, 0, 1, h)
            ctx.fillStyle = 'rgba(200,210,215,0.45)'
            ctx.font = '8px system-ui, sans-serif'
            ctx.fillText('-1', 2, h - 3)
            ctx.fillText('+1', w - 11, h - 3)
          }}
        />
      </Sec>
      <div className="flex flex-1 flex-col gap-2">
        <Sec title="Image" accent={color} body="flex items-start justify-around">
          <KnobReadout p={p} id="width" />
          <KnobReadout p={p} id="pan" />
          <div className="flex flex-col items-center gap-1">
            <PK p={p} id="monoBass" size={MID} color={color} />
            <div className="fl-lcd min-w-[54px] px-1 py-px text-center text-[10px] text-[#9fe870]">{mb < 20 ? 'Off' : `< ${Math.round(mb)} Hz`}</div>
          </div>
        </Sec>
        <Sec title="Utility" accent={color} body="flex items-center gap-2">
          <Mid p={p} id="gain" />
          <div className="grid grid-cols-2 gap-1">
            <Toggle p={p} id="swap" label="Swap L/R" />
            <span />
            <Toggle p={p} id="invL" label="Ø Left" />
            <Toggle p={p} id="invR" label="Ø Right" />
          </div>
        </Sec>
      </div>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 470, height: 243 } })
