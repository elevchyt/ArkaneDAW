import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, Mid, Sec, Seg, Toggle, drawScreen, pv, useTempoSync, withAlpha } from '../fx-common/ui'
import { DIVISION_NAMES, divisionMs } from '../fx-common/divisions'
import { MAX_DELAY_S, manifest } from './manifest'

function Editor(p: PluginEditorProps) {
  const tempo = useTempoSync(p)
  const color = manifest.color!
  const sync = pv(p, 'sync') >= 0.5
  const div = Math.round(pv(p, 'div'))
  const ms = Math.min(MAX_DELAY_S * 1000, sync ? divisionMs(div, tempo) : pv(p, 'time'))
  const fb = pv(p, 'feedback')
  const mode = Math.round(pv(p, 'mode'))
  const beats = (ms / 60000) * tempo
  const timeText = `${ms >= 1000 ? (ms / 1000).toFixed(3) + ' s' : ms.toFixed(1) + ' ms'}`
  const noteText = sync ? DIVISION_NAMES[div] : `${beats.toFixed(2)} beats`
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Time" accent={color} body="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1">
            {sync ? <KnobReadout p={p} id="div" label="Note" /> : <KnobReadout p={p} id="time" />}
          </div>
          <div className="flex flex-col gap-1.5 pt-1">
            <Toggle p={p} id="sync" label="Tempo sync" />
            <div className="fl-lcd px-1.5 py-1 text-[11px] leading-tight text-[#9fe870]" onMouseEnter={() => p.hint(`Delay time: ${noteText} = ${timeText} at ${tempo} BPM`)}>
              <div className="text-[13px] font-semibold">{noteText}</div>
              <div>{timeText}</div>
              <div className="text-[9px] text-[#6fa850]">@ {Math.round(tempo * 100) / 100} BPM</div>
            </div>
          </div>
        </Sec>
        <Sec title="Echoes" accent={color} className="flex-1" body="flex flex-col gap-1.5">
          <Seg p={p} id="mode" label={false} />
          <FxCanvas
            width={236}
            height={80}
            className="fl-inset"
            draw={(ctx, w, h) => {
              drawScreen(ctx, w, h)
              const span = Math.max(ms * 8.5, 200)
              const X = (t: number) => 6 + (t / span) * (w - 12)
              ctx.fillStyle = 'rgba(255,255,255,0.08)'
              ctx.fillRect(0, h / 2, w, 1)
              // dry
              ctx.fillStyle = '#e9eef0'
              ctx.fillRect(X(0) - 1.5, 6, 3, h - 12)
              let a = 1
              for (let k = 1; k <= 8; k++) {
                const x = X(k * ms)
                if (x > w - 2) break
                const hh = (h / 2 - 6) * a
                const left = mode !== 1 || k % 2 === 1
                const right = mode !== 1 || k % 2 === 0
                ctx.fillStyle = withAlpha(color, 0.35 + 0.65 * a)
                if (left) ctx.fillRect(x - 2, h / 2 - hh, 4, hh)
                if (right) ctx.fillRect(x - 2, h / 2 + 1, 4, hh)
                a *= fb
                if (a < 0.02) break
              }
              ctx.fillStyle = 'rgba(200,210,215,0.4)'
              ctx.font = '9px system-ui, sans-serif'
              ctx.fillText('L', w - 9, 11)
              ctx.fillText('R', w - 9, h - 4)
            }}
          />
        </Sec>
      </div>
      <Sec title="Feedback" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="feedback" />
        <Mid p={p} id="lowcut" />
        <Mid p={p} id="highcut" />
        <Mid p={p} id="mix" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 470, height: 263 } })
