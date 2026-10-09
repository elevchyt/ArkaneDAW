import { useRef } from 'react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PluginPanel, Section } from '../sdk/ui'
import { Sec, Big, FxCanvas, Mid, Seg, Small, Toggle, VMeter, drawScreen, pv, useDspFeed, withAlpha } from '../fx-common/ui'
import { autoMakeup, compGain, manifest } from './manifest'

type Feed = { gr: number; inDb: number; outDb: number }

function Editor(p: PluginEditorProps) {
  const m = useRef<Feed>({ gr: 0, inDb: -120, outDb: -120 })
  useDspFeed(p, (msg) => {
    if (msg && typeof msg === 'object' && 'gr' in msg) m.current = msg as Feed
  })
  const color = manifest.color!
  const thr = pv(p, 'threshold')
  const ratio = pv(p, 'ratio')
  const knee = pv(p, 'knee')
  const mk = pv(p, 'makeup') + (pv(p, 'auto') >= 0.5 ? autoMakeup(thr, ratio, knee) : 0)
  const S = 150
  const lvl = useRef(-120)

  return (
    <PluginPanel className="flex gap-2">
      <Section title="Transfer" accent={color} className="flex flex-col items-center">
        <FxCanvas
          width={S}
          height={S}
          animate
          className="fl-inset"
          draw={(ctx, w, h) => {
            drawScreen(ctx, w, h)
            const R = 60
            const X = (db: number) => ((db + R) / R) * w
            const Y = (db: number) => h - ((db + R) / R) * h
            ctx.strokeStyle = 'rgba(255,255,255,0.06)'
            for (let d = -48; d < 0; d += 12) {
              ctx.beginPath()
              ctx.moveTo(X(d), 0)
              ctx.lineTo(X(d), h)
              ctx.moveTo(0, Y(d))
              ctx.lineTo(w, Y(d))
              ctx.stroke()
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.15)'
            ctx.beginPath()
            ctx.moveTo(0, h)
            ctx.lineTo(w, 0)
            ctx.stroke()
            // threshold marker
            ctx.strokeStyle = withAlpha(color, 0.35)
            ctx.setLineDash([3, 3])
            ctx.beginPath()
            ctx.moveTo(X(thr), 0)
            ctx.lineTo(X(thr), h)
            ctx.stroke()
            ctx.setLineDash([])
            // curve (without make-up so it reads like FL's display)
            ctx.strokeStyle = color
            ctx.lineWidth = 2
            ctx.beginPath()
            for (let x = 0; x <= w; x++) {
              const db = (x / w) * R - R
              const y = Y(db + compGain(db, thr, ratio, knee))
              if (x === 0) ctx.moveTo(x, y)
              else ctx.lineTo(x, y)
            }
            ctx.stroke()
            ctx.lineWidth = 1
            // live input dot
            const target = m.current.inDb
            lvl.current = target > lvl.current ? target : lvl.current + (target - lvl.current) * 0.2
            const li = Math.max(-R, Math.min(0, lvl.current))
            if (li > -R + 1) {
              ctx.fillStyle = '#ffffff'
              ctx.beginPath()
              ctx.arc(X(li), Y(li + compGain(li, thr, ratio, knee)), 3.5, 0, Math.PI * 2)
              ctx.fill()
            }
            ctx.fillStyle = 'rgba(200,210,215,0.45)'
            ctx.font = '9px system-ui, sans-serif'
            ctx.fillText(`${ratio.toFixed(1)}:1`, 5, 12)
            ctx.fillText(`${mk >= 0 ? '+' : ''}${mk.toFixed(1)} dB make-up`, 5, 24)
          }}
        />
      </Section>
      <div className="flex flex-1 flex-col gap-2">
        <Section title="Compression" accent={color} className="flex-1">
          <div className="flex items-start justify-around">
            <Big p={p} id="threshold" />
            <Big p={p} id="ratio" />
            <Mid p={p} id="attack" />
            <Mid p={p} id="release" />
          </div>
        </Section>
        <Section accent={color}>
          <div className="flex items-end gap-3">
            <Small p={p} id="knee" />
            <Small p={p} id="makeup" />
            <Small p={p} id="mix" />
            <Seg p={p} id="detector" />
            <div className="flex flex-col gap-1">
              <Toggle p={p} id="auto" label="Auto gain" />
              <Toggle p={p} id="sidechain" label="Side-chain" />
            </div>
          </div>
        </Section>
      </div>
      <Sec title="Meters" accent={color} body="flex gap-1.5">
        <VMeter get={() => m.current.inDb} height={160} color={color} label="In" />
        <VMeter get={() => m.current.gr} min={-24} max={0} height={160} color={color} fromTop label="GR" title="Gain reduction" />
        <VMeter get={() => m.current.outDb} height={160} color={color} label="Out" />
      </Sec>
    </PluginPanel>
  )
}

export default definePlugin({ manifest, Editor, editorSize: { width: 620, height: 222 } })
