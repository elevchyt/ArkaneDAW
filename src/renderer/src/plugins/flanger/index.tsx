import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { KnobReadout, Mid, Sec, pv } from '../fx-common/ui'
import { LfoView } from '../fx-common/mod-ui'
import { manifest } from './manifest'

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const man = pv(p, 'manual')
  const top = man * Math.pow(2, pv(p, 'depth') * 3)
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Flanger" accent={color} body="flex items-start gap-3">
          <KnobReadout p={p} id="rate" />
          <KnobReadout p={p} id="depth" />
          <KnobReadout p={p} id="feedback" />
        </Sec>
        <Sec title="Sweep" accent={color} className="flex-1">
          <LfoView width={150} height={86} rate={pv(p, 'rate')} depth={pv(p, 'depth')} offset={0.5 * pv(p, 'stereo')} shape="tri" color={color} caption={`${man.toFixed(2)} – ${top.toFixed(1)} ms`} />
        </Sec>
      </div>
      <Sec title="Tone" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="manual" />
        <Mid p={p} id="stereo" />
        <Mid p={p} id="mix" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 430, height: 243 } })
