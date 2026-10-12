// Sampler Channel Settings, modelled on FL Studio's: a SAMPLE tab (file, playback / looping, declicking,
// pitch, precomputed effects and the sample view) and an ENVELOPE tab (root note, ADSR, filter, amp).
import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { definePlugin, type PluginEditorProps } from '../sdk/module'
import { PK, PToggle, PluginPanel, Section } from '../sdk/ui'
import { manifest } from './manifest'
import { DECLICK_MODES, processSample, processingKey } from './process'
import { STRETCH_MODES, isResample } from './stretch'
import { openMenu } from '@/windows/playlist/PopupMenu'
import { cn } from '@/lib/utils'
import { host } from '@/platform'
import { useProject } from '@/store/project'
import { importSampleFile, loadSample } from '@/audio/samples'
import { AUDIO_EXT, droppedPaths } from '@/windows/channelrack/drop'
import { noteName } from '@/windows/pianoroll/music'

const COLOR = manifest.color!
const param = (p: PluginEditorProps, id: string) => p.instance.params[id] ?? manifest.params.find((d) => d.id === id)!.default

function sampleIdOf(p: PluginEditorProps): string | null {
  const id = (p.instance.data as { sampleId?: unknown } | undefined)?.sampleId
  return typeof id === 'string' ? id : null
}

async function loadInto(p: PluginEditorProps, path: string): Promise<void> {
  if (!AUDIO_EXT.test(path)) {
    p.hint('Not an audio file')
    return
  }
  const s = await importSampleFile(path)
  if (s) p.setData({ ...(p.instance.data as object), sampleId: s.id })
}

function SampleEditor(p: PluginEditorProps) {
  const [tab, setTab] = useState<'smp' | 'env'>('smp')
  return (
    <PluginPanel className="flex flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 gap-px self-start rounded-[3px] bg-[#1a1f22] p-px">
        {(
          [
            ['smp', 'Sample'],
            ['env', 'Envelope']
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn('rounded-[2px] px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide', tab === id ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'smp' ? <SampleTab p={p} /> : <EnvelopeTab p={p} />}
    </PluginPanel>
  )
}

function SampleTab({ p }: { p: PluginEditorProps }) {
  const sampleId = sampleIdOf(p)
  const sample = useProject((s) => s.project.samples.find((x) => x.id === sampleId))
  const browse = async () => {
    if (!host) return
    const r = await host.dialog.open({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'aif', 'aiff', 'm4a', 'opus', 'webm'] }] })
    if (!r.canceled && r.filePaths[0]) await loadInto(p, r.filePaths[0])
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* file */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="w-[44px] text-[10px] uppercase tracking-wide text-fl-dim">Sample</span>
        <button
          className="h-[20px] min-w-0 flex-1 truncate rounded-[2px] bg-fl-well px-1.5 text-left text-[11px] text-[#cfe9b8] fl-inset disabled:text-fl-dim"
          disabled={!sample?.path || !host}
          title={sample?.path ?? sample?.name ?? ''}
          onClick={() => sample?.path && void host?.shell.showItem(sample.path)}
          onMouseEnter={() => p.hint(sample ? `${sample.path ?? sample.name}${sample.path ? ' – click to show in the file manager' : ''}` : 'No sample loaded')}
        >
          {sample ? (sample.path ?? sample.name) : '(none)'}
        </button>
        <button className="grid h-[20px] w-[22px] place-items-center rounded-[2px] bg-[#46525a] fl-bevel hover:bg-[#515e66] disabled:opacity-40" disabled={!host} title="Load sample file" onClick={() => void browse()}>
          <FolderOpen size={12} />
        </button>
        <button
          className="grid h-[20px] w-[22px] place-items-center rounded-[2px] bg-[#46525a] fl-bevel hover:bg-[#515e66] disabled:opacity-40"
          disabled={!sampleId}
          title="Remove sample (the file is not deleted)"
          onClick={() => p.setData({ ...(p.instance.data as object), sampleId: null })}
        >
          <X size={12} />
        </button>
      </div>

      <div className="flex shrink-0 gap-2">
        <Section title="Playback" accent={COLOR} className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-start gap-3">
            <PK p={p} id="start" size={32} color={COLOR} label="Start" />
            <div className="flex flex-col gap-1.5 pt-1">
              <PToggle p={p} id="loop" label="Use loop points" />
              <PToggle p={p} id="pingPong" label="Ping pong loop" />
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fl-dim" onMouseEnter={() => p.hint('Declicking: short fades on every note so samples never click')}>
            Declicking
            <select
              value={Math.round(param(p, 'declick'))}
              onChange={(e) => p.setParam('declick', Number(e.target.value))}
              className="h-[18px] rounded-[2px] bg-fl-well px-1 text-[10px] normal-case tracking-normal text-fl-text outline-none fl-inset"
            >
              {DECLICK_MODES.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </Section>
        <TimeStretch p={p} />
        <Section title="Fades" accent={COLOR}>
          <div className="flex gap-3">
            <PK p={p} id="fadeIn" size={32} color={COLOR} label="In" />
            <PK p={p} id="fadeOut" size={32} color={COLOR} label="Out" />
          </div>
        </Section>
      </div>
      <Section title="Precomputed effects" accent={COLOR} className="shrink-0">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 whitespace-nowrap">
          <PToggle p={p} id="normalize" />
          <PToggle p={p} id="removeDC" />
          <PToggle p={p} id="polarity" />
          <PToggle p={p} id="reverse" />
          <PToggle p={p} id="swapStereo" />
        </div>
      </Section>

      <SampleView p={p} sampleId={sampleId} />
    </div>
  )
}

/** FL "Time stretching": mode, PITCH, MUL and TIME (right-click TIME for beat / bar presets). */
function TimeStretch({ p }: { p: PluginEditorProps }) {
  const timeSig = useProject((s) => s.project.timeSig)
  const mode = Math.round(param(p, 'stretchMode'))
  const time = param(p, 'time')
  const beatsPerBar = timeSig[0] * (4 / timeSig[1])
  const timeText = time <= 0 ? 'Off' : time % beatsPerBar === 0 ? `${time / beatsPerBar} bar${time === beatsPerBar ? '' : 's'}` : `${time} beat${time === 1 ? '' : 's'}`
  const timeMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const beats = (n: number) => ({ label: `${n} beat${n === 1 ? '' : 's'}`, checked: time === n, onSelect: () => p.setParam('time', n) })
    const bars = (n: number) => ({ label: `${n} bar${n === 1 ? '' : 's'}`, checked: time === n * beatsPerBar, onSelect: () => p.setParam('time', n * beatsPerBar) })
    openMenu(e, [{ label: '(none)', checked: time <= 0, onSelect: () => p.setParam('time', 0) }, { separator: true }, beats(1), beats(2), { separator: true }, bars(1), bars(2), bars(4), bars(8), bars(16)], 'Time')
  }
  return (
    <Section title="Time stretching" accent={COLOR} className="flex flex-col gap-1.5">
      <div className="flex gap-3">
        <PK p={p} id="pitch" size={32} color={COLOR} label="Pitch" />
        <PK p={p} id="mul" size={32} color={COLOR} label="Mul" />
        <div className="flex flex-col items-center" onContextMenu={timeMenu}>
          <PK p={p} id="time" size={32} color={COLOR} label="Time" />
          <span className="font-mono text-[9px] text-[#9fe870]">{timeText}</span>
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-fl-dim" onMouseEnter={() => p.hint(isResample(mode) ? 'Resample: pitch and length change together' : 'Stretch: pitch and length change independently')}>
        Mode
        <select
          value={mode}
          onChange={(e) => p.setParam('stretchMode', Number(e.target.value))}
          className="h-[18px] rounded-[2px] bg-fl-well px-1 text-[10px] normal-case tracking-normal text-fl-text outline-none fl-inset"
        >
          {STRETCH_MODES.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </Section>
  )
}

function EnvelopeTab({ p }: { p: PluginEditorProps }) {
  const root = Math.round(param(p, 'root'))
  return (
    <div className="flex flex-wrap content-start gap-2">
      <Section title="Pitch" accent={COLOR}>
        <div className="flex items-start gap-3">
          <div className="flex flex-col items-center gap-1">
            <PK p={p} id="root" size={32} color={COLOR} label="Root" />
            <span className="font-mono text-[10px] text-[#9fe870]">{noteName(root)}</span>
          </div>
          <div className="flex flex-col gap-1.5 pt-1">
            <PToggle p={p} id="pitchToKey" />
            <PToggle p={p} id="oneShot" />
            <PToggle p={p} id="cutSelf" />
          </div>
        </div>
      </Section>
      <Section title="Volume envelope" accent={COLOR}>
        <div className="flex items-end gap-3">
          <PK p={p} id="attack" size={32} color={COLOR} label="Att" />
          <PK p={p} id="decay" size={32} color={COLOR} label="Dec" />
          <PK p={p} id="sustain" size={32} color={COLOR} label="Sus" />
          <PK p={p} id="release" size={32} color={COLOR} label="Rel" />
          <EnvelopeGraph p={p} />
        </div>
      </Section>
      <Section title="Filter / amp" accent={COLOR}>
        <div className="flex gap-3">
          <PK p={p} id="cutoff" size={32} color={COLOR} label="Cut" />
          <PK p={p} id="res" size={32} color={COLOR} label="Res" />
          <PK p={p} id="gain" size={32} color={COLOR} label="Amp" />
        </div>
      </Section>
    </div>
  )
}

/** ADSR shape (time axis compressed with a square root so short and long settings both read). */
function EnvelopeGraph({ p }: { p: PluginEditorProps }) {
  const W = 180
  const H = 52
  const t = (s: number) => Math.sqrt(Math.max(0, s))
  const a = t(param(p, 'attack'))
  const d = t(param(p, 'decay'))
  const r = t(param(p, 'release'))
  const hold = 0.6
  const scale = (W - 8) / Math.max(0.5, a + d + hold + r)
  const sus = param(p, 'sustain')
  const y = (v: number) => 4 + (1 - v) * (H - 8)
  const x1 = 4 + a * scale
  const x2 = x1 + d * scale
  const x3 = x2 + hold * scale
  const x4 = x3 + r * scale
  const path = `M4 ${y(0)} L${x1} ${y(1)} L${x2} ${y(sus)} L${x3} ${y(sus)} L${x4} ${y(0)}`
  return (
    <svg width={W} height={H} className="rounded-[3px] bg-[#1c2225] fl-inset">
      <path d={`${path} Z`} fill={COLOR} fillOpacity={0.15} />
      <path d={path} fill="none" stroke={COLOR} strokeWidth={1.5} />
    </svg>
  )
}

type Marker = 'start' | 'loopStart' | 'loopEnd'

/** FL's sample view: the processed waveform with draggable start / loop markers. Click to preview. */
function SampleView({ p, sampleId }: { p: PluginEditorProps; sampleId: string | null }) {
  const sample = useProject((s) => s.project.samples.find((x) => x.id === sampleId))
  const [buf, setBuf] = useState<AudioBuffer | null>(null)
  const [missing, setMissing] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const drag = useRef<Marker | null>(null)
  const previewing = useRef(false)
  const [over, setOver] = useState(false)

  useEffect(() => {
    let alive = true
    setBuf(null)
    setMissing(false)
    if (sample)
      void loadSample(sample).then((b) => {
        if (!alive) return
        setBuf(b)
        setMissing(!b)
      })
    return () => {
      alive = false
    }
  }, [sample])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const params = p.instance.params
  const key = processingKey(params)
  const data = useMemo(() => {
    if (!buf) return null
    const raw = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
    return processSample(raw, buf.sampleRate, params)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buf, key])

  const loop = param(p, 'loop') >= 0.5
  const marks: Record<Marker, number> = { start: param(p, 'start'), loopStart: param(p, 'loopStart'), loopEnd: param(p, 'loopEnd') }

  useEffect(() => {
    const c = cv.current
    const { w, h } = size
    if (!c || !w || !h) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#1c2225'
    g.fillRect(0, 0, w, h)
    if (!data || !data[0].length) return
    const len = data[0].length
    if (loop) {
      g.fillStyle = 'rgba(159,210,122,0.08)'
      g.fillRect(marks.loopStart * w, 0, (marks.loopEnd - marks.loopStart) * w, h)
    }
    const lane = h / data.length
    data.forEach((ch, ci) => {
      const mid = lane * ci + lane / 2
      g.strokeStyle = 'rgba(255,255,255,0.08)'
      g.beginPath()
      g.moveTo(0, Math.round(mid) + 0.5)
      g.lineTo(w, Math.round(mid) + 0.5)
      g.stroke()
      g.fillStyle = COLOR
      const per = len / w
      for (let x = 0; x < w; x++) {
        const a = Math.floor(x * per)
        const b = Math.max(a + 1, Math.floor((x + 1) * per))
        let lo = 1
        let hi = -1
        // long samples: sample the column instead of scanning every frame
        const stride = Math.max(1, Math.floor((b - a) / 64))
        for (let i = a; i < b && i < len; i += stride) {
          const v = ch[i]
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        if (hi < lo) continue
        const y0 = mid - hi * (lane / 2) * 0.92
        const y1 = mid - lo * (lane / 2) * 0.92
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
      }
      if (ci > 0) {
        g.fillStyle = '#11161a'
        g.fillRect(0, Math.round(lane * ci), w, 1)
      }
    })
    const line = (t: number, color: string) => {
      const x = Math.round(Math.min(w - 1, t * w)) + 0.5
      g.strokeStyle = color
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(x, 0)
      g.lineTo(x, h)
      g.stroke()
      g.fillStyle = color
      g.beginPath()
      g.moveTo(x - 4, 0)
      g.lineTo(x + 4, 0)
      g.lineTo(x, 6)
      g.closePath()
      g.fill()
    }
    if (loop) {
      line(marks.loopStart, '#ff6a5f')
      line(marks.loopEnd, '#ff6a5f')
    }
    if (marks.start > 0) line(marks.start, '#ffd36b')
  }, [data, size, loop, marks.start, marks.loopStart, marks.loopEnd])

  const frac = (e: { clientX: number }) => {
    const r = cv.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)))
  }
  const markerAt = (e: { clientX: number }): Marker | null => {
    const w = size.w || 1
    const x = frac(e) * w
    const near = (t: number) => Math.abs(t * w - x) <= 4
    if (loop && near(marks.loopEnd)) return 'loopEnd'
    if (loop && near(marks.loopStart)) return 'loopStart'
    if (near(marks.start)) return 'start'
    return null
  }
  const root = Math.round(param(p, 'root'))
  const stopPreview = () => {
    if (previewing.current) p.previewNote?.(root, 0, false)
    previewing.current = false
  }
  const info = buf ? `${(buf.sampleRate / 1000).toFixed(1)} kHz · ${buf.numberOfChannels === 1 ? 'Mono' : buf.numberOfChannels === 2 ? 'Stereo' : `${buf.numberOfChannels} ch`} · ${buf.duration.toFixed(2)} s` : ''

  return (
    <div
      ref={wrap}
      className={cn('relative min-h-[70px] flex-1 overflow-hidden rounded-[3px] border border-[#11161a] fl-inset', over && 'outline outline-2 -outline-offset-2 outline-fl-orange')}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const path = droppedPaths(e)[0]
        if (path) void loadInto(p, path)
      }}
    >
      <canvas
        ref={cv}
        className="absolute inset-0 h-full w-full"
        onPointerDown={(e) => {
          if (e.button !== 0 || !data) return
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          const m = markerAt(e)
          if (m) {
            drag.current = m
            return
          }
          previewing.current = true
          p.previewNote?.(root, 0.8, true)
        }}
        onPointerMove={(e) => {
          const m = drag.current
          const c = cv.current
          if (!m) {
            if (c) c.style.cursor = markerAt(e) ? 'ew-resize' : 'pointer'
            const near = markerAt(e)
            p.hint(near ? `${near === 'start' ? 'Sample start' : near === 'loopStart' ? 'Loop start' : 'Loop end'} – drag to move` : 'Click to preview · drag the markers to set the start / loop points · drop an audio file to replace')
            return
          }
          let v = frac(e)
          if (m === 'loopStart') v = Math.min(v, marks.loopEnd - 0.001)
          if (m === 'loopEnd') v = Math.max(v, marks.loopStart + 0.001)
          p.setParam(m, v)
        }}
        onPointerUp={() => {
          drag.current = null
          stopPreview()
        }}
        onPointerCancel={() => {
          drag.current = null
          stopPreview()
        }}
      />
      {!data && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-[11px] text-fl-dim">
          {sampleId ? (sample && !missing ? 'Loading…' : 'Sample file missing') : 'No sample – load one with the folder button or drop an audio file here'}
        </div>
      )}
      {info && <div className="pointer-events-none absolute bottom-1 right-1.5 rounded-[2px] bg-black/40 px-1 font-mono text-[9px] text-fl-dim">{info}</div>}
    </div>
  )
}

export default definePlugin({ manifest, Editor: SampleEditor, editorSize: { width: 700, height: 410 } })
