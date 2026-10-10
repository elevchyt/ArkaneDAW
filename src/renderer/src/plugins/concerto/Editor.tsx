// Concerto editor (820×460): instrument browser by section, articulation buttons (with keyswitch labels),
// layer strip (1–3 instruments with key splits), performance / legato / hall / stage controls with a seating
// plan, and a 61-key keyboard that auditions through previewNote.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ParamKnob } from '@/components/controls'
import type { PluginEditorProps } from '../sdk/module'
import { useHeldKeys } from '../sdk/ui'
import { ENSEMBLES, INSTRUMENTS, SECTIONS } from './instruments.gen'
import { instStatus, subscribeStatus, type LoadState } from './loader'
import { presets } from './manifest'
import { layer, MAX_LAYERS, readData, type ConcertoData, type ConcertoStatus, type InstrumentMeta } from './types'

export const EDITOR_W = 820
export const EDITOR_H = 460

const GOLD = '#d4b16a'
const GOLD_DIM = '#8f7748'
const INK = '#f1e6cf'
const PANEL = '#24191a'
const PANEL2 = '#2e2021'
const EDGE = '#130d0d'
const SERIF = 'Georgia, "Times New Roman", serif'
const KS_BASE = 12
const SECTION_COLORS: Record<string, string> = { Strings: '#c98a5a', Woodwinds: '#8fbf72', Brass: '#e0b84f', Keys: '#b99ad8', Choir: '#e7d7b0', Percussion: '#d46a5a', Plucked: '#6fb3c8', Ensembles: GOLD }
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const sciName = (k: number): string => `${NOTE_NAMES[k % 12]}${Math.floor(k / 12) - 1}`
const instMeta = (id: string): InstrumentMeta | undefined => INSTRUMENTS.find((i) => i.id === id)

function Knob({ p, id, label, color = GOLD, size = 30 }: { p: PluginEditorProps; id: string; label?: string; color?: string; size?: number }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def) return null
  return <ParamKnob def={def} value={p.instance.params[id] ?? def.default} onChange={(v) => p.setParam(id, v)} size={size} label={label} color={color} />
}

function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col rounded-[3px] border px-1.5 pb-1 pt-0.5', className)} style={{ borderColor: EDGE, background: PANEL2, boxShadow: 'inset 0 1px 0 rgba(255,235,200,0.06)' }}>
      <div className="mb-0.5 text-[9px] uppercase tracking-[0.22em]" style={{ color: GOLD_DIM, fontFamily: SERIF }}>
        {title}
      </div>
      <div className="flex flex-1 items-center justify-around gap-1">{children}</div>
    </div>
  )
}

export function ConcertoEditor(p: PluginEditorProps) {
  const data = readData(p.instance.data)
  const primary = instMeta(data.layers[0].inst) ?? INSTRUMENTS[0]
  const [section, setSection] = useState<string>(primary?.section ?? 'Strings')
  const [dsp, setDsp] = useState<ConcertoStatus | null>(null)
  useEffect(() => p.onDSPMessage((m) => {
    const s = m as ConcertoStatus
    if (s && s.type === 'status') setDsp(s)
  }), [p])
  const ids = data.layers.map((l) => l.inst)
  const statusKey = useSyncExternalStore(subscribeStatus, () => ids.map((id) => JSON.stringify(instStatus(id))).join('|'))
  const statuses = useMemo(() => statusKey.split('|').map((s) => JSON.parse(s) as LoadState), [statusKey])
  const artParam = Math.round(p.instance.params.art ?? 0)
  const art = dsp?.art ?? artParam

  const setLayers = (layers: ConcertoData['layers']): void => p.setData({ layers })
  const pickInstrument = (id: string): void => {
    const m = instMeta(id)
    setLayers([layer(id)])
    p.setParams({ art: 0, legato: m?.solo ? 1 : 0 })
    p.hint(`${m?.name}: ${m?.description}`)
  }
  const pickEnsemble = (name: string): void => {
    const pr = presets.find((x) => x.name === name && x.category === 'Ensembles')
    if (pr) p.loadPreset(pr)
  }

  return (
    <div className="flex h-full w-full flex-col gap-1 p-1.5" style={{ fontSize: 11, color: INK, background: `radial-gradient(120% 90% at 50% 0%, #3b2526 0%, #22171a 55%, #160f11 100%)` }}>
      {/* header */}
      <div className="flex h-[40px] shrink-0 items-center gap-3 rounded-[3px] border px-2" style={{ borderColor: EDGE, background: 'linear-gradient(#2c1d1e, #1d1416)' }}>
        <div className="flex flex-col leading-none">
          <span className="text-[19px] italic tracking-[0.06em]" style={{ color: GOLD, fontFamily: SERIF, textShadow: '0 1px 0 #000' }}>
            Concerto
          </span>
          <span className="mt-0.5 text-[8.5px] uppercase tracking-[0.28em]" style={{ color: GOLD_DIM }}>
            baroque · classical orchestra
          </span>
        </div>
        <div className="h-[26px] w-px" style={{ background: GOLD_DIM, opacity: 0.4 }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]" style={{ fontFamily: SERIF }}>
            {data.layers.map((l) => instMeta(l.inst)?.name ?? l.inst).join('  +  ')}
          </div>
          <LoadLine statuses={statuses} names={ids.map((id) => instMeta(id)?.name ?? id)} dsp={dsp} />
        </div>
        <div className="flex items-end gap-2">
          <TuningSelect p={p} />
          <Knob p={p} id="volume" label="Volume" size={30} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-1">
        {/* browser */}
        <div className="flex w-[196px] shrink-0 gap-px overflow-hidden rounded-[3px] border" style={{ borderColor: EDGE, background: PANEL }}>
          <div className="flex w-[72px] shrink-0 flex-col gap-px p-0.5" style={{ background: '#1a1213' }}>
            {[...SECTIONS, 'Ensembles'].map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className="flex h-[22px] items-center gap-1 rounded-[2px] px-1 text-left text-[10px]"
                style={{ background: section === s ? '#3d2a2b' : 'transparent', color: section === s ? INK : '#bba98a', fontFamily: SERIF }}
              >
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SECTION_COLORS[s] }} />
                {s}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-px overflow-y-auto p-0.5">
            {section === 'Ensembles'
              ? ENSEMBLES.map((e) => (
                  <button key={e.name} onClick={() => pickEnsemble(e.name)} onMouseEnter={() => p.hint(`${e.name}: ${e.description}`)} className="rounded-[2px] px-1.5 py-[3px] text-left text-[10.5px] hover:bg-[#3a2829]" style={{ fontFamily: SERIF }}>
                    {e.name}
                    <div className="truncate text-[8.5px]" style={{ color: '#a08f73' }}>
                      {e.layers.map((l) => instMeta(l.inst)?.name ?? l.inst).join(' · ')}
                    </div>
                  </button>
                ))
              : INSTRUMENTS.filter((i) => i.section === section).map((i) => {
                  const active = data.layers.length === 1 && data.layers[0].inst === i.id
                  return (
                    <button
                      key={i.id}
                      onClick={() => pickInstrument(i.id)}
                      onMouseEnter={() => p.hint(`${i.name}: ${i.description}`)}
                      className="flex items-center justify-between rounded-[2px] px-1.5 py-[3px] text-left text-[10.5px] hover:bg-[#3a2829]"
                      style={{ background: active ? '#4a3330' : undefined, color: active ? GOLD : INK, fontFamily: SERIF }}
                    >
                      <span className="truncate">{i.name}</span>
                      <span className="ml-1 shrink-0 text-[8px]" style={{ color: '#9b8a6d' }}>
                        {i.arts.length > 1 ? `${i.arts.length} art` : ''}
                      </span>
                    </button>
                  )
                })}
          </div>
        </div>

        {/* main */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ArticulationBar p={p} primary={primary} art={art} />
          <LayerStrip p={p} data={data} setLayers={setLayers} />
          <div className="flex min-h-0 flex-1 gap-1">
            <Group title="Performance" className="flex-[3]">
              <Knob p={p} id="attack" label="Attack" />
              <Knob p={p} id="release" label="Release" />
              <Knob p={p} id="vibrato" label="Vibrato" color="#e2c98e" />
              <Knob p={p} id="vibRate" label="Rate" color="#e2c98e" size={24} />
              <Knob p={p} id="expr" label="Express." color="#e8a26a" />
              <Knob p={p} id="bright" label="Bright" color="#e8a26a" />
              <Knob p={p} id="velSens" label="Vel" size={24} />
            </Group>
            <Group title="Legato" className="w-[92px] shrink-0">
              <LegatoToggle p={p} />
              <Knob p={p} id="glide" label="Glide" size={26} />
            </Group>
          </div>
          <div className="flex h-[92px] shrink-0 gap-1">
            <Group title="Hall" className="w-[104px] shrink-0">
              <Knob p={p} id="reverb" label="Reverb" color="#9fc3d8" />
              <Knob p={p} id="size" label="Size" color="#9fc3d8" />
            </Group>
            <Group title="Stage" className="flex-1">
              <StagePlan p={p} data={data} />
              <div className="flex flex-col items-center gap-1">
                <SeatToggle p={p} />
                <div className="flex gap-1">
                  <Knob p={p} id="pan" label="Position" size={24} />
                  <Knob p={p} id="width" label="Width" size={24} />
                </div>
              </div>
            </Group>
          </div>
        </div>
      </div>

      <Keyboard p={p} data={data} />
    </div>
  )
}

function LoadLine({ statuses, names, dsp }: { statuses: LoadState[]; names: string[]; dsp: ConcertoStatus | null }) {
  const loading = statuses.map((s, i) => [s, names[i]] as const).find(([s]) => s.state === 'loading')
  if (loading) {
    const s = loading[0] as Extract<LoadState, { state: 'loading' }>
    const pct = s.total ? Math.round((100 * s.done) / s.total) : 0
    return (
      <div className="flex items-center gap-1.5 text-[9.5px]" style={{ color: '#d9c48f' }}>
        <span>Loading {loading[1]}… {s.done}/{s.total}</span>
        <span className="h-[4px] w-[90px] overflow-hidden rounded-full" style={{ background: '#3a2a22' }}>
          <span className="block h-full" style={{ width: `${pct}%`, background: GOLD }} />
        </span>
      </div>
    )
  }
  const bad = statuses.find((s) => s.state === 'error' || s.state === 'unavailable') as { message: string } | undefined
  if (bad) return <div className="truncate text-[9.5px] text-[#e2846f]" title={bad.message}>● {bad.message}</div>
  const files = statuses.reduce((a, s) => a + (s.state === 'ready' ? s.files : 0), 0)
  if (files) return <div className="text-[9.5px]" style={{ color: '#a9c98a' }}>● {files} samples ready{dsp ? ` · ${dsp.voices} voices` : ''}{dsp?.missing ? ` · ${dsp.missing} missing` : ''}</div>
  return <div className="text-[9.5px]" style={{ color: '#9b8a6d' }}>● waiting for the audio engine</div>
}

function TuningSelect({ p }: { p: PluginEditorProps }) {
  const def = p.manifest.params.find((x) => x.id === 'pitch')!
  const v = Math.round(p.instance.params.pitch ?? 0)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[8.5px] uppercase tracking-[0.18em]" style={{ color: GOLD_DIM }}>
        Pitch
      </span>
      <select
        value={v}
        onChange={(e) => p.setParam('pitch', Number(e.target.value))}
        onMouseEnter={() => p.hint('Tuning standard: modern A=440, Classical A=430, Baroque A=415')}
        className="h-[18px] rounded-[2px] border px-0.5 text-[10px] outline-none"
        style={{ background: '#1a1213', borderColor: EDGE, color: INK }}
      >
        {def.options!.map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

function ArticulationBar({ p, primary, art }: { p: PluginEditorProps; primary: InstrumentMeta | undefined; art: number }) {
  const arts = primary?.arts.slice(0, 5) ?? []
  return (
    <div className="flex h-[38px] shrink-0 items-center gap-1 rounded-[3px] border px-1.5" style={{ borderColor: EDGE, background: PANEL }}>
      <span className="mr-1 text-[9px] uppercase tracking-[0.2em]" style={{ color: GOLD_DIM, fontFamily: SERIF }}>
        Articulation
      </span>
      {arts.map((a, i) => (
        <button
          key={a.id}
          onClick={() => p.setParam('art', i)}
          onMouseEnter={() => p.hint(`${a.name} — keyswitch ${sciName(KS_BASE + i)} (MIDI ${KS_BASE + i})`)}
          className="flex h-[28px] min-w-[74px] flex-col items-center justify-center rounded-[3px] border px-2 leading-none"
          style={{
            borderColor: i === art ? GOLD : '#4a3637',
            background: i === art ? 'linear-gradient(#6b4c33, #4a3324)' : 'linear-gradient(#3a2a2b, #2b1f20)',
            color: i === art ? '#fff3d6' : INK,
            boxShadow: i === art ? `0 0 6px ${GOLD}55` : undefined
          }}
        >
          <span className="text-[11px]" style={{ fontFamily: SERIF }}>
            {a.name}
          </span>
          <span className="mt-0.5 text-[8px]" style={{ color: i === art ? GOLD : '#9b8a6d' }}>
            {arts.length > 1 ? `KS ${sciName(KS_BASE + i)}` : a.kind}
          </span>
        </button>
      ))}
      <span className="ml-auto max-w-[180px] truncate text-[9px]" style={{ color: '#9b8a6d' }} title={primary?.description}>
        {primary?.description}
      </span>
    </div>
  )
}

function LayerStrip({ p, data, setLayers }: { p: PluginEditorProps; data: ConcertoData; setLayers: (l: ConcertoData['layers']) => void }) {
  const upd = (i: number, patch: Partial<ConcertoData['layers'][number]>): void => setLayers(data.layers.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  return (
    <div className="flex shrink-0 flex-col gap-px rounded-[3px] border p-1" style={{ borderColor: EDGE, background: PANEL }}>
      {data.layers.map((l, i) => (
        <div key={i} className="flex h-[19px] items-center gap-1.5 text-[10px]">
          <span className="w-[14px] text-center text-[9px]" style={{ color: GOLD_DIM, fontFamily: SERIF }}>
            {['I', 'II', 'III'][i]}
          </span>
          <select
            value={l.inst}
            onChange={(e) => upd(i, { inst: e.target.value, art: undefined })}
            className="h-[17px] w-[136px] rounded-[2px] border px-0.5 text-[10px] outline-none"
            style={{ background: '#1a1213', borderColor: EDGE, color: INK }}
          >
            {INSTRUMENTS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <NoteField label="from" value={l.lo} onChange={(v) => upd(i, { lo: Math.min(v, l.hi) })} hint={p.hint} />
          <NoteField label="to" value={l.hi} onChange={(v) => upd(i, { hi: Math.max(v, l.lo) })} hint={p.hint} />
          <NumField label="gain" value={l.gain} min={-30} max={6} step={0.5} unit="dB" onChange={(v) => upd(i, { gain: v })} hint={p.hint} />
          <NumField label="oct" value={l.transpose / 12} min={-2} max={2} step={1} unit="" onChange={(v) => upd(i, { transpose: v * 12 })} hint={p.hint} />
          {data.layers.length > 1 && (
            <button onClick={() => setLayers(data.layers.filter((_, k) => k !== i))} className="ml-auto rounded-[2px] p-px hover:bg-[#4a3330]" onMouseEnter={() => p.hint('Remove this layer')}>
              <X size={11} color="#c9a07a" />
            </button>
          )}
        </div>
      ))}
      {data.layers.length < MAX_LAYERS && (
        <button
          onClick={() => setLayers([...data.layers, layer(data.layers[0].inst === 'choir' ? 'organ' : 'choir', { gain: -6 })])}
          onMouseEnter={() => p.hint('Add an instrument layer (up to 3), e.g. strings + choir')}
          className="flex h-[16px] items-center gap-1 self-start rounded-[2px] px-1 text-[9.5px] hover:bg-[#3a2829]"
          style={{ color: GOLD_DIM }}
        >
          <Plus size={10} /> add layer
        </button>
      )}
    </div>
  )
}

/** Drag up/down (or wheel) to change a note value. */
function NoteField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint: (t: string) => void }) {
  return <NumField label={label} value={value} min={0} max={127} step={1} unit="" format={sciName} onChange={onChange} hint={hint} />
}

function NumField({ label, value, min, max, step, unit, onChange, hint, format }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; hint: (t: string) => void; format?: (v: number) => string }) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const set = (v: number): void => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)))
  return (
    <span
      className="flex cursor-ns-resize select-none items-center gap-0.5"
      onMouseEnter={() => hint(`Layer ${label}: drag up/down or scroll`)}
      onWheel={(e) => set(value + (e.deltaY < 0 ? step : -step))}
      onPointerDown={(e) => {
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, v: value }
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        set(drag.current.v + ((drag.current.y - e.clientY) / 6) * step)
      }}
      onPointerUp={() => (drag.current = null)}
    >
      <span className="text-[8.5px]" style={{ color: '#9b8a6d' }}>
        {label}
      </span>
      <span className="min-w-[30px] rounded-[2px] px-1 text-center text-[10px]" style={{ background: '#1a1213', color: INK }}>
        {format ? format(value) : `${value > 0 && unit ? '+' : ''}${value}${unit ? ' ' + unit : ''}`}
      </span>
    </span>
  )
}

function LegatoToggle({ p }: { p: PluginEditorProps }) {
  const on = (p.instance.params.legato ?? 0) >= 0.5
  return (
    <button
      onClick={() => p.setParam('legato', on ? 0 : 1)}
      onMouseEnter={() => p.hint('Legato: monophonic; overlapping notes connect with a crossfade and glide')}
      className="mb-1 flex h-[30px] w-[34px] flex-col items-center justify-center rounded-[3px] border text-[8.5px] uppercase"
      style={{ borderColor: on ? GOLD : '#4a3637', background: on ? '#5a3f2a' : '#2b1f20', color: on ? '#fff3d6' : '#a08f73' }}
    >
      <span className="mb-0.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: on ? '#ffd27a' : '#4a3637', boxShadow: on ? '0 0 4px #ffd27a' : undefined }} />
      {on ? 'on' : 'off'}
    </button>
  )
}

function SeatToggle({ p }: { p: PluginEditorProps }) {
  const v = Math.round(p.instance.params.seat ?? 0)
  return (
    <div className="flex gap-px rounded-[2px] p-px" style={{ background: '#1a1213' }}>
      {['Orchestral', 'Centre'].map((o, i) => (
        <button key={o} onClick={() => p.setParam('seat', i)} onMouseEnter={() => p.hint('Seating: orchestral positions (violins left, cellos/basses right…) or everything centred')} className="rounded-[2px] px-1.5 text-[9px]" style={{ background: i === v ? '#5a3f2a' : 'transparent', color: i === v ? '#fff3d6' : '#a08f73' }}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** Seating plan seen from the audience: the layer instruments' positions on a semicircular stage. */
function StagePlan({ p, data }: { p: PluginEditorProps; data: ConcertoData }) {
  const W = 200, H = 70
  const seat = Math.round(p.instance.params.seat ?? 0)
  const ofs = (p.instance.params.pan ?? 0) / 100
  const width = (p.instance.params.width ?? 100) / 100
  const dots: { x: number; y: number; w: number; name: string; color: string }[] = []
  const placed = new Set<string>()
  const add = (id: string, pan: number, w: number): void => {
    const m = instMeta(id)
    if (!m) return
    const pos = Math.max(-1, Math.min(1, (seat === 0 ? pan : 0) + ofs))
    const depth = { Strings: 0.25, Plucked: 0.4, Keys: 0.45, Woodwinds: 0.6, Brass: 0.8, Percussion: 0.95, Choir: 1 }[m.section] ?? 0.5
    dots.push({ x: W / 2 + pos * (W / 2 - 14), y: H - 8 - depth * (H - 22), w: Math.max(4, (seat === 0 ? w : 1) * width * 38), name: m.name, color: SECTION_COLORS[m.section] ?? GOLD })
  }
  for (const l of data.layers) {
    if (placed.has(l.inst)) continue
    placed.add(l.inst)
    const m = instMeta(l.inst)
    if (!m) continue
    if (m.id === 'strings') {
      ;[['bass', 0.65], ['cellos', 0.42], ['violas', 0.12], ['violins', -0.5]].forEach(([id, pan]) => add(id as string, pan as number, 0.45))
    } else add(m.id, m.stage.pan, m.stage.width)
  }
  return (
    <svg width={W} height={H} className="shrink-0" onMouseEnter={() => p.hint('Stage (audience view): positions follow orchestral seating; Position shifts, Width narrows the image')}>
      <path d={`M 6 ${H - 4} A ${W / 2 - 6} ${H - 10} 0 0 1 ${W - 6} ${H - 4} Z`} fill="#2a1c1d" stroke={GOLD_DIM} strokeOpacity={0.5} />
      <path d={`M 40 ${H - 4} A ${W / 2 - 40} ${H - 30} 0 0 1 ${W - 40} ${H - 4}`} fill="none" stroke={GOLD_DIM} strokeOpacity={0.25} />
      <rect x={W / 2 - 5} y={H - 7} width={10} height={4} fill={GOLD_DIM} />
      {dots.map((d, i) => (
        <g key={i}>
          <rect x={d.x - d.w / 2} y={d.y - 2.5} width={d.w} height={5} rx={2.5} fill={d.color} opacity={0.35} />
          <circle cx={d.x} cy={d.y} r={3} fill={d.color} />
          {/* alternate labels above / below so neighbours don't collide */}
          <text x={d.x} y={i % 2 ? d.y + 11 : d.y - 5} fontSize={7.5} textAnchor="middle" fill={INK} style={{ fontFamily: SERIF }}>
            {d.name}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ─── keyboard ───

const KB_LO = 36 // C2
const KB_KEYS = 61
const BLACK = new Set([1, 3, 6, 8, 10])

function Keyboard({ p, data }: { p: PluginEditorProps; data: ConcertoData }) {
  const [shift, setShift] = useState(0)
  const [down, setDown] = useState<number | null>(null)
  const downRef = useRef<number | null>(null)
  const live = useHeldKeys(p)
  const lit = (k: number) => down === k || live.has(k)
  const lo = KB_LO + shift * 12
  const play = useCallback(
    (k: number | null, vel: number) => {
      const prev = downRef.current
      if (prev !== null && prev !== k) p.previewNote?.(prev, 0, false)
      if (k !== null && k !== prev) p.previewNote?.(k, vel, true)
      downRef.current = k
      setDown(k)
    },
    [p]
  )
  useEffect(() => () => {
    if (downRef.current !== null) p.previewNote?.(downRef.current, 0, false)
  }, [p])
  // playable range of all layers
  const inRange = (k: number): boolean =>
    data.layers.some((l) => {
      const m = instMeta(l.inst)
      const t = k + l.transpose
      return !!m && k >= l.lo && k <= l.hi && t >= m.range[0] && t <= m.range[1]
    })
  const whites: number[] = []
  for (let k = lo; k < lo + KB_KEYS; k++) if (!BLACK.has(k % 12)) whites.push(k)
  const W = EDITOR_W - 12 - 44
  const ww = W / whites.length
  const H = 62
  const keyAt = (e: React.PointerEvent<SVGSVGElement>): { k: number; vel: number } | null => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const vel = Math.max(0.15, Math.min(1, 0.25 + (0.75 * y) / H))
    if (y < H * 0.62) {
      for (let k = lo; k < lo + KB_KEYS; k++) {
        if (!BLACK.has(k % 12)) continue
        const wi = whites.findIndex((w) => w > k)
        const cx = wi * ww
        if (x >= cx - ww * 0.32 && x <= cx + ww * 0.32) return { k, vel }
      }
    }
    const wi = Math.floor(x / ww)
    return wi >= 0 && wi < whites.length ? { k: whites[wi], vel } : null
  }
  return (
    <div className="flex h-[66px] shrink-0 items-stretch gap-1">
      <div className="flex w-[40px] flex-col items-center justify-center gap-1 rounded-[3px] border" style={{ borderColor: EDGE, background: PANEL }}>
        <button onClick={() => setShift((s) => Math.min(2, s + 1))} className="h-[16px] w-[30px] rounded-[2px] text-[10px] hover:bg-[#3a2829]" style={{ color: GOLD }} onMouseEnter={() => p.hint('Keyboard octave up')}>
          ▲
        </button>
        <span className="text-[9px]" style={{ color: '#9b8a6d', fontFamily: SERIF }}>
          C{Math.floor(lo / 12) - 1}
        </span>
        <button onClick={() => setShift((s) => Math.max(-2, s - 1))} className="h-[16px] w-[30px] rounded-[2px] text-[10px] hover:bg-[#3a2829]" style={{ color: GOLD }} onMouseEnter={() => p.hint('Keyboard octave down')}>
          ▼
        </button>
      </div>
      <svg
        width={W}
        height={H + 2}
        className="rounded-[2px]"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
          const h = keyAt(e)
          if (h) play(h.k, h.vel)
        }}
        onPointerMove={(e) => {
          if (downRef.current === null) return
          const h = keyAt(e)
          if (h && h.k !== downRef.current) play(h.k, h.vel)
        }}
        onPointerUp={() => play(null, 0)}
        onPointerCancel={() => play(null, 0)}
        onMouseEnter={() => p.hint('Click / drag to audition (lower = louder); dimmed keys are outside the instrument range')}
      >
        <rect x={0} y={0} width={W} height={3} fill={GOLD_DIM} opacity={0.6} />
        {whites.map((k, i) => {
          const r = inRange(k)
          return (
            <g key={k}>
              <rect x={i * ww + 0.5} y={2} width={ww - 1} height={H} rx={2} fill={lit(k) ? '#e9c98a' : r ? '#f3ead8' : '#8c8478'} stroke="#2a1f1a" />
              {k % 12 === 0 && (
                <text x={i * ww + ww / 2} y={H - 4} fontSize={7.5} textAnchor="middle" fill="#6d5a45">
                  C{Math.floor(k / 12) - 1}
                </text>
              )}
            </g>
          )
        })}
        {Array.from({ length: KB_KEYS }, (_, j) => lo + j)
          .filter((k) => BLACK.has(k % 12))
          .map((k) => {
            const wi = whites.findIndex((w) => w > k)
            const r = inRange(k)
            return <rect key={k} x={wi * ww - ww * 0.31} y={2} width={ww * 0.62} height={H * 0.6} rx={1.5} fill={lit(k) ? '#b8925a' : r ? '#1c1414' : '#4a4440'} stroke="#000" />
          })}
      </svg>
    </div>
  )
}
