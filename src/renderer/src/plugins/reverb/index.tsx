import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { FxCanvas, KnobReadout, Mid, Sec, Seg, drawScreen, pv, withAlpha } from '../fx-common/ui'
import { manifest } from './manifest'

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const decay = pv(p, 'decay')
  const pre = pv(p, 'predelay')
  const size = pv(p, 'size')
  const damp = pv(p, 'damp')
  const lowcut = pv(p, 'lowcut')
  const mix = pv(p, 'mix')
  const mode = Math.round(pv(p, 'mode'))
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Space" accent={color} className="flex-1" body="flex flex-col gap-2">
          <Seg p={p} id="mode" label={false} />
          <FxCanvas
            width={250}
            height={96}
            className="fl-inset"
            onMouseEnter={() => p.hint(`Decay envelope: ${pre.toFixed(0)} ms pre-delay, ${decay.toFixed(2)} s decay`)}
            draw={(ctx, w, h) => {
              drawScreen(ctx, w, h)
              const span = Math.max(0.5, Math.min(22, decay * 1.1 + pre / 1000))
              const X = (t: number) => (t / span) * w
              // time grid
              ctx.fillStyle = 'rgba(200,210,215,0.3)'
              ctx.font = '9px system-ui, sans-serif'
              const step = span > 8 ? 2 : span > 3 ? 1 : span > 1 ? 0.25 : 0.1
              for (let t = step; t < span; t += step) {
                ctx.fillStyle = 'rgba(255,255,255,0.06)'
                ctx.fillRect(Math.round(X(t)), 0, 1, h)
              }
              ctx.fillStyle = 'rgba(200,210,215,0.4)'
              ctx.fillText(`${span.toFixed(span < 2 ? 1 : 0)} s`, w - 26, h - 4)
              // pseudo impulse response under an exponential envelope
              const t0 = pre / 1000
              const density = mode === 0 ? 0.5 : mode === 2 ? 0.9 : 0.7
              let seed = 12345
              ctx.strokeStyle = withAlpha(color, 0.75)
              ctx.beginPath()
              for (let x = Math.floor(X(t0)); x < w; x++) {
                const t = (x / w) * span - t0
                const env = Math.pow(10, (-3 * t) / decay) * (1 - Math.exp(-t * (40 - size * 25)))
                seed = (seed * 1103515245 + 12345) & 0x7fffffff
                const r = (seed / 0x7fffffff) * (0.4 + density * 0.6)
                const a = env * r * (h / 2 - 4)
                ctx.moveTo(x + 0.5, h / 2 - a)
                ctx.lineTo(x + 0.5, h / 2 + a)
              }
              ctx.stroke()
              // envelope outline
              ctx.strokeStyle = '#e9eef0'
              ctx.lineWidth = 1.5
              ctx.beginPath()
              ctx.moveTo(0, h / 2)
              ctx.lineTo(X(t0), h / 2)
              for (let x = Math.ceil(X(t0)); x < w; x++) {
                const t = (x / w) * span - t0
                const env = Math.pow(10, (-3 * t) / decay) * (1 - Math.exp(-t * (40 - size * 25)))
                ctx.lineTo(x, h / 2 - env * (h / 2 - 4))
              }
              ctx.stroke()
              ctx.lineWidth = 1
              // pre-delay marker
              ctx.fillStyle = 'rgba(220,230,235,0.55)'
              if (pre > 1) ctx.fillText(`${Math.round(pre)} ms`, 3, 11)
              ctx.fillText(`${(damp / 1000).toFixed(1)}k / ${Math.round(lowcut)} Hz  ·  ${Math.round(mix * 100)}% mix`, 3, h - 4)
            }}
          />
        </Sec>
        <Sec title="Reverb" accent={color} body="flex items-start gap-3 pt-1">
          <KnobReadout p={p} id="size" />
          <KnobReadout p={p} id="decay" />
          <KnobReadout p={p} id="mix" />
        </Sec>
      </div>
      <Sec title="Tone" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="predelay" />
        <Mid p={p} id="damp" />
        <Mid p={p} id="lowcut" />
        <Mid p={p} id="width" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 500, height: 281 } })
