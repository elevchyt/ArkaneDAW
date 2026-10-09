import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { KnobReadout, Mid, Sec, Seg, pv } from '../fx-common/ui'
import { LfoView } from '../fx-common/mod-ui'
import { manifest } from './manifest'

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const f = pv(p, 'freq')
  const d = pv(p, 'depth') * 3
  const lo = Math.max(20, f / Math.pow(2, d))
  const hi = Math.min(20000, f * Math.pow(2, d))
  const fmt = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}k` : `${Math.round(x)}`)
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Phaser" accent={color} body="flex items-start gap-3">
          <KnobReadout p={p} id="rate" />
          <KnobReadout p={p} id="depth" />
          <KnobReadout p={p} id="feedback" />
        </Sec>
        <Sec title="Sweep" accent={color} className="flex-1" body="flex flex-col gap-1.5">
          <LfoView width={170} height={64} rate={pv(p, 'rate')} depth={pv(p, 'depth')} offset={0.5 * pv(p, 'stereo')} color={color} caption={`${fmt(lo)} – ${fmt(hi)} Hz`} />
          <Seg p={p} id="stages" />
        </Sec>
      </div>
      <Sec title="Tone" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="freq" />
        <Mid p={p} id="stereo" />
        <Mid p={p} id="mix" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 450, height: 264 } })
