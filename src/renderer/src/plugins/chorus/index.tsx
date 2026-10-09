import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel } from '../sdk/ui'
import { KnobReadout, Mid, Sec, pv } from '../fx-common/ui'
import { LfoView } from '../fx-common/mod-ui'
import { manifest } from './manifest'

function Editor(p: PluginEditorProps) {
  const color = manifest.color!
  const v = Math.round(pv(p, 'voices'))
  return (
    <PluginPanel className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Sec title="Chorus" accent={color} body="flex items-start gap-3">
          <KnobReadout p={p} id="rate" />
          <KnobReadout p={p} id="depth" />
          <KnobReadout p={p} id="mix" />
        </Sec>
        <Sec title="LFO" accent={color} className="flex-1">
          <LfoView width={150} height={86} rate={pv(p, 'rate')} depth={pv(p, 'depth')} offset={0.25 * pv(p, 'width')} color={color} caption={`${v} voice${v > 1 ? 's' : ''}`} />
        </Sec>
      </div>
      <Sec title="Character" accent={color} body="flex items-start justify-around">
        <Mid p={p} id="delay" />
        <Mid p={p} id="voices" />
        <Mid p={p} id="width" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 430, height: 243 } })
