// Studio Drums editor (900×540): kit selector + global knobs, kit drawing, FPC-style 4×4 pad banks,
// groove browser (preview inside the plugin, "Send to pattern"), per-strip mixer and bus EQ/Punch/room.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Play, Send, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ParamKnob } from '@/components/controls'
import type { PluginEditorProps } from '../sdk/module'
import { formatParam } from '../sdk/params'
import { useHeldKeys } from '../sdk/ui'
import { KITS } from './kits.gen'
import { KitView } from './KitView'
import { DEFAULT_KIT } from './manifest'
import { kitStatus, subscribeKitStatus } from './loader'
import { GENRES, type Groove, type GrooveGenre } from './grooves'
import { BUSES, BUS_NAMES, STRIPS, STRIP_NAMES, type DrumsMessage, type DrumsStatus, type StudioDrumsData } from './types'

export const EDITOR_W = 900
export const EDITOR_H = 540

const ACCENT = '#e0a35a'
const GROUP_COLORS: Record<string, string> = { Kick: '#e2614f', Snare: '#e9a23b', Toms: '#d0c14a', Hats: '#7fcf62', Cymbals: '#56b8d8', Perc: '#b98ae0' }

function readData(d: unknown): StudioDrumsData {
  const o = (d && typeof d === 'object' ? d : {}) as Partial<StudioDrumsData>
  return { kit: typeof o.kit === 'string' ? o.kit : DEFAULT_KIT }
}

/** Knob bound to a param, compact. */
function PKnob({ p, id, size = 26, label, color = ACCENT }: { p: PluginEditorProps; id: string; size?: number; label?: string; color?: string }) {
  const def = p.manifest.params.find((x) => x.id === id)
  if (!def) return null
  return <ParamKnob def={def} value={p.instance.params[id] ?? def.default} onChange={(v) => p.setParam(id, v)} size={size} label={label} color={color} labelPosition={label === '' ? 'none' : 'below'} />
}

export function StudioDrumsEditor(p: PluginEditorProps) {
  const data = readData(p.instance.data)
  const kit = KITS.find((k) => k.id === data.kit) ?? KITS[0]
  const status = useSyncExternalStore(subscribeKitStatus, () => kitStatus(data.kit))
  const [bank, setBank] = useState(0)
  const [lower, setLower] = useState<'mixer' | 'buses'>('mixer')
  const banks = kit?.pads ?? []
  const padBank = banks[Math.min(bank, banks.length - 1)]

  const play = useCallback((key: number, vel: number, on: boolean) => p.previewNote?.(key, vel, on), [p])
  const live = useHeldKeys(p)

  return (
    <div className="flex h-full w-full flex-col gap-1.5 bg-gradient-to-b from-[#3a3f42] to-[#25292b] p-2 text-fl-text" style={{ fontSize: 11 }}>
      {/* header */}
      <div className="flex h-[46px] shrink-0 items-center gap-3 rounded-[4px] border border-[#1b2023] bg-[#1f2427] px-2 fl-bevel">
        <div className="flex flex-col leading-none">
          <span className="text-[15px] font-black tracking-[0.08em]" style={{ color: ACCENT }}>
            STUDIO DRUMS
          </span>
          <span className="mt-0.5 text-[9px] uppercase tracking-[0.2em] text-fl-dim">acoustic kits · grooves</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-fl-dim">Kit</span>
          <select
            className="h-[22px] w-[150px] rounded-[3px] border border-[#111] bg-[#2b3236] px-1 text-[11px] text-fl-text outline-none"
            value={kit?.id}
            onChange={(e) => p.setData({ ...data, kit: e.target.value })}
            onMouseEnter={() => p.hint(`Kit: ${kit?.name ?? ''} — ${kit?.description ?? ''}`)}
          >
            {KITS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-[230px] truncate text-[10px] text-fl-dim" title={kit?.description}>
          <KitStatusLine status={status} />
          <div className="truncate">{kit?.description}</div>
        </div>
        <div className="ml-auto flex items-end gap-2.5">
          <PKnob p={p} id="dyn" size={24} label="Dyn" />
          <PKnob p={p} id="humVel" size={24} label="Hum V" />
          <PKnob p={p} id="humTime" size={24} label="Hum T" />
          <PKnob p={p} id="room" size={24} label="Room" color="#6fb7e0" />
          <PKnob p={p} id="roomSize" size={24} label="Size" color="#6fb7e0" />
          <PKnob p={p} id="master" size={30} label="Master" />
        </div>
      </div>

      {/* middle: kit view · pads · grooves */}
      <div className="flex h-[262px] shrink-0 gap-1.5">
        <div className="w-[300px] shrink-0 overflow-hidden rounded-[4px] border border-[#1b2023] bg-[#1d2224]">
          <KitView kit={kit} onPlay={play} onHint={p.hint} live={live} />
        </div>
        <div className="flex w-[236px] shrink-0 flex-col gap-1 rounded-[4px] border border-[#1b2023] bg-[#1f2427] p-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fl-dim">Pads</span>
            <div className="ml-auto flex gap-px rounded-[3px] bg-[#14181a] p-px">
              {banks.map((b, i) => (
                <button key={b.name} onClick={() => setBank(i)} className={cn('h-[16px] w-[22px] rounded-[2px] text-[10px] font-bold', i === bank ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}>
                  {b.name}
                </button>
              ))}
            </div>
          </div>
          {padBank && <PadGrid keys={padBank.keys} kit={kit} play={play} hint={p.hint} />}
        </div>
        <GrooveBrowser p={p} />
      </div>

      {/* lower: mixer / buses */}
      <div className="flex min-h-0 flex-1 flex-col rounded-[4px] border border-[#1b2023] bg-[#1f2427] p-1.5">
        <div className="mb-1 flex items-center gap-1">
          {(['mixer', 'buses'] as const).map((t) => (
            <button key={t} onClick={() => setLower(t)} className={cn('h-[16px] rounded-[2px] px-2 text-[10px] font-semibold uppercase tracking-wider', lower === t ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}>
              {t === 'mixer' ? 'Kit Mixer' : 'Buses · EQ · Punch · Room'}
            </button>
          ))}
          <span className="ml-auto text-[9.5px] text-fl-dim">double-click a knob to reset · right side of a drum = rim / edge, ride centre = bell, Shift+hat = pedal</span>
        </div>
        {lower === 'mixer' ? <MixerStrips p={p} /> : <BusPanel p={p} />}
      </div>
    </div>
  )
}

function KitStatusLine({ status }: { status: ReturnType<typeof kitStatus> }) {
  if (status.state === 'loading') return <div className="text-[#9fe870]">Loading samples… {status.done}/{status.total}</div>
  if (status.state === 'ready') return <div className="text-[#9fe870]">● {status.files} samples loaded</div>
  if (status.state === 'error') return <div className="truncate text-fl-red" title={status.message}>● {status.message}</div>
  if (status.state === 'unavailable') return <div className="truncate text-fl-red" title={status.message}>● {status.message}</div>
  return <div className="text-fl-dim">● waiting for audio engine</div>
}

// ─── pads ───

function PadGrid({ keys, kit, play, hint }: { keys: number[]; kit: (typeof KITS)[number] | undefined; play: (k: number, v: number, on: boolean) => void; hint: (t: string) => void }) {
  const [down, setDown] = useState<{ key: number; vel: number } | null>(null)
  const release = () => {
    if (down) play(down.key, 0, false)
    setDown(null)
  }
  return (
    <div className="grid flex-1 grid-cols-4 grid-rows-4 gap-1" onPointerUp={release} onPointerLeave={release}>
      {keys.map((key, i) => {
        const info = kit?.keys[key]
        const color = info ? GROUP_COLORS[info.group] ?? '#888' : '#444'
        const active = down?.key === key
        return (
          <button
            key={`${i}-${key}`}
            disabled={!info}
            onPointerDown={(e) => {
              if (!info) return
              const r = e.currentTarget.getBoundingClientRect()
              // FPC-style: the higher you click on the pad, the harder the hit
              const vel = Math.max(0.12, Math.min(1, 1 - (e.clientY - r.top) / r.height + 0.12))
              setDown({ key, vel })
              play(key, vel, true)
              hint(`${info.name} (key ${key}) · velocity ${Math.round(vel * 127)}`)
            }}
            onMouseEnter={() => info && hint(`${info.name} · key ${key} · click higher on the pad for a harder hit`)}
            className={cn('relative flex flex-col justify-between overflow-hidden rounded-[3px] border p-1 text-left transition-[filter]', info ? 'border-[#0f1213] hover:brightness-125' : 'border-[#262c2f] opacity-30')}
            style={{ background: info ? `linear-gradient(180deg, ${color}${active ? 'ff' : '55'} 0%, #262d31 ${active ? 100 : 85}%)` : '#23292c', boxShadow: active ? `0 0 10px ${color}` : 'inset 0 1px 0 #ffffff14' }}
          >
            <span className="line-clamp-2 text-[9.5px] font-semibold leading-[1.1] text-[#eef2f3]">{info?.name ?? '—'}</span>
            <span className="text-[8.5px] text-[#ffffff80]">{key}</span>
            {active && down && <span className="absolute bottom-0 right-0 top-0 w-[3px] bg-white/60" style={{ top: `${(1 - down.vel) * 100}%` }} />}
          </button>
        )
      })}
    </div>
  )
}

// ─── groove browser ───

function GrooveBrowser({ p }: { p: PluginEditorProps }) {
  const [genreId, setGenreId] = useState(GENRES[0].id)
  const genre = GENRES.find((g) => g.id === genreId) ?? GENRES[0]
  const [grooveId, setGrooveId] = useState(genre.grooves[1]?.id ?? genre.grooves[0].id)
  const groove = genre.grooves.find((g) => g.id === grooveId) ?? genre.grooves[0]
  const [playing, setPlaying] = useState(false)
  const [tick, setTick] = useState(0)
  const playingRef = useRef(false)
  playingRef.current = playing
  const tempo = Math.round(p.instance.params.tempo ?? 100)

  useEffect(
    () =>
      p.onDSPMessage((m) => {
        const s = m as DrumsStatus
        if (s?.type === 'groovePos') {
          setTick(s.tick)
          if (!s.playing) setPlaying(false)
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onDSPMessage]
  )
  // never leave a preview running when the editor closes (props change on every param edit: use a ref)
  const postRef = useRef(p.postToDSP)
  postRef.current = p.postToDSP
  useEffect(() => () => postRef.current({ type: 'grooveStop' } satisfies DrumsMessage), [])

  const start = useCallback(
    (g: Groove) => {
      p.postToDSP({ type: 'groove', events: g.notes.map((n) => ({ t: n.t, k: n.k, v: n.v })), lengthTicks: g.length, loops: g.part === 'Ending' ? 1 : 8 } satisfies DrumsMessage)
      setPlaying(true)
      setTick(0)
    },
    [p]
  )
  const stop = useCallback(() => {
    p.postToDSP({ type: 'grooveStop' } satisfies DrumsMessage)
    setPlaying(false)
  }, [p])

  const selectGenre = (g: GrooveGenre) => {
    setGenreId(g.id)
    const first = g.grooves.find((x) => x.part === 'Groove A') ?? g.grooves[0]
    setGrooveId(first.id)
    p.setParam('tempo', g.tempo)
    if (playingRef.current) start(first)
  }
  const selectGroove = (g: Groove) => {
    setGrooveId(g.id)
    if (playingRef.current) start(g)
  }

  const send = (mode: 'replace' | 'merge') => {
    if (!p.insertNotes) return
    p.insertNotes(groove.notes.map((n) => ({ key: n.k, pos: n.t, len: n.d, vel: n.v / 127 })), mode)
    p.hint(`${genre.name} · ${groove.name} → pattern (${mode === 'replace' ? 'replaced' : 'merged'}) · ${groove.notes.length} notes`)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-[4px] border border-[#1b2023] bg-[#1f2427] p-1.5">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fl-dim">Grooves</span>
        <span className="ml-auto truncate text-[9.5px] text-fl-dim">
          {genre.name}: ~{genre.tempo} BPM · kit “{KITS.find((k) => k.id === genre.kit)?.name ?? genre.kit}”
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-1">
        <div className="w-[96px] shrink-0 overflow-y-auto rounded-[3px] bg-[#15191b] py-0.5">
          {GENRES.map((g) => (
            <button key={g.id} onClick={() => selectGenre(g)} onMouseEnter={() => p.hint(`${g.name}: ${g.description}`)} className={cn('block w-full truncate px-1.5 py-[1px] text-left text-[10.5px]', g.id === genre.id ? 'bg-fl-orange/90 text-[#1b1f22] font-semibold' : 'text-fl-text hover:bg-white/5')}>
              {g.name}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="min-h-0 flex-1 overflow-y-auto rounded-[3px] bg-[#15191b] py-0.5">
            {genre.grooves.map((g) => (
              <div
                key={g.id}
                draggable
                onDragStart={(e) => {
                  const notes = g.notes.map((n) => ({ key: n.k, pos: n.t, len: n.d, vel: n.v / 127 }))
                  e.dataTransfer.setData('application/x-arkane-notes', JSON.stringify({ name: `${genre.name} ${g.name}`, notes }))
                  e.dataTransfer.setData('text/plain', `${genre.name} – ${g.name}`)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => selectGroove(g)}
                onDoubleClick={() => start(g)}
                onMouseEnter={() => p.hint(`${g.part}: ${g.name} · ${g.bars} bar${g.bars > 1 ? 's' : ''} ${g.timeSig.join('/')} · double-click to preview`)}
                className={cn('flex cursor-pointer items-center gap-1 px-1.5 py-[1px] text-[10.5px]', g.id === groove.id ? 'bg-[#3d4b52] text-white' : 'text-fl-text hover:bg-white/5')}
              >
                <span className="w-[52px] shrink-0 text-[9px] uppercase tracking-wide text-fl-dim">{g.part}</span>
                <span className="truncate">{g.name}</span>
                <span className="ml-auto shrink-0 text-[9px] text-fl-dim">
                  {g.timeSig.join('/')} · {g.bars}b
                </span>
              </div>
            ))}
          </div>
          <MiniRoll groove={groove} tick={playing ? tick : -1} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => (playing ? stop() : start(groove))}
          onMouseEnter={() => p.hint(playing ? 'Stop preview' : 'Preview this groove (plays inside the plugin at the groove tempo)')}
          className={cn('flex h-[20px] items-center gap-1 rounded-[3px] px-2 text-[10.5px] font-semibold', playing ? 'bg-fl-red/80 text-white' : 'bg-[#4b5a33] text-[#d9f7b8] hover:bg-[#5a6b3d]')}
        >
          {playing ? <Square size={11} /> : <Play size={11} />}
          {playing ? 'Stop' : 'Preview'}
        </button>
        <TempoField value={tempo} onChange={(v) => p.setParam('tempo', v)} hint={p.hint} />
        <div className="ml-auto flex gap-1">
          <button disabled={!p.insertNotes} onClick={() => send('replace')} onMouseEnter={() => p.hint('Send to pattern: replace this channel’s notes in the current pattern')} className="flex h-[20px] items-center gap-1 rounded-[3px] bg-[#3a454b] px-2 text-[10.5px] font-semibold hover:bg-[#4a575e] disabled:opacity-40">
            <Send size={11} /> Send to pattern
          </button>
          <button disabled={!p.insertNotes} onClick={() => send('merge')} onMouseEnter={() => p.hint('Merge the groove into the current pattern (keeps existing notes)')} className="h-[20px] rounded-[3px] bg-[#3a454b] px-2 text-[10.5px] hover:bg-[#4a575e] disabled:opacity-40">
            Merge
          </button>
        </div>
      </div>
    </div>
  )
}

function TempoField({ value, onChange, hint }: { value: number; onChange: (v: number) => void; hint: (t: string) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const v = Math.round(Number(text))
    if (Number.isFinite(v) && v >= 40 && v <= 250) onChange(v)
    else setText(String(value))
  }
  return (
    <label className="flex items-center gap-1 text-[10px] text-fl-dim" onMouseEnter={() => hint('Preview tempo (BPM) — wheel to change')}>
      <input
        className="fl-lcd h-[20px] w-[40px] bg-transparent px-1 text-center text-[11px] text-[#9fe870] outline-none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        onWheel={(e) => onChange(Math.max(40, Math.min(250, value - Math.sign(e.deltaY) * (e.shiftKey ? 1 : 5))))}
      />
      BPM
    </label>
  )
}

/** Small piano-roll style preview of the selected groove (one row per key). */
function MiniRoll({ groove, tick }: { groove: Groove; tick: number }) {
  const keys = useMemo(() => [...new Set(groove.notes.map((n) => n.k))].sort((a, b) => b - a), [groove])
  const W = 100
  const rows = Math.max(1, keys.length)
  const beats = (groove.length / 96) | 0
  return (
    <svg viewBox={`0 0 ${W} ${rows * 4}`} preserveAspectRatio="none" className="h-[58px] w-full shrink-0 rounded-[3px] bg-[#15191b]">
      {Array.from({ length: beats }, (_, b) => (
        <rect key={b} x={(b * 96 * W) / groove.length} y={0} width={0.15} height={rows * 4} fill={b % groove.timeSig[0] === 0 ? '#ffffff30' : '#ffffff12'} />
      ))}
      {groove.notes.map((n, i) => {
        const r = keys.indexOf(n.k)
        return <rect key={i} x={(n.t * W) / groove.length} y={r * 4 + 0.6} width={Math.max(0.6, (n.d * W) / groove.length - 0.2)} height={2.8} fill={`rgba(143,227,74,${0.35 + (n.v / 127) * 0.65})`} />
      })}
      {tick >= 0 && <rect x={(tick * W) / groove.length} y={0} width={0.4} height={rows * 4} fill="var(--fl-orange)" />}
    </svg>
  )
}

// ─── mixer ───

function MixerStrips({ p }: { p: PluginEditorProps }) {
  return (
    <div className="flex min-h-0 flex-1 gap-1">
      {STRIPS.map((s) => {
        const muted = (p.instance.params[`${s}.mute`] ?? 0) >= 0.5
        const lvl = p.manifest.params.find((x) => x.id === `${s}.level`)!
        return (
          <div key={s} className={cn('flex w-[69px] flex-col items-center gap-0.5 rounded-[3px] border border-[#15191b] bg-[#262d31] px-0.5 pt-1', muted && 'opacity-60')}>
            <div className="w-full truncate text-center text-[10px] font-semibold uppercase tracking-wide" style={{ color: ACCENT }} onMouseEnter={() => p.hint(`${STRIP_NAMES[s]} strip`)}>
              {STRIP_NAMES[s]}
            </div>
            <PKnob p={p} id={`${s}.level`} size={30} label="" />
            <div className="fl-lcd w-[56px] text-center text-[9.5px] text-[#9fe870]">{formatParam(lvl, p.instance.params[`${s}.level`] ?? 0)}</div>
            <div className="flex gap-0.5">
              <PKnob p={p} id={`${s}.pan`} size={20} label="Pan" color="#9fd27a" />
              <PKnob p={p} id={`${s}.tune`} size={20} label="Tune" color="#6fb7e0" />
            </div>
            <div className="flex items-end gap-1">
              <PKnob p={p} id={`${s}.decay`} size={20} label="Dec" color="#d0c14a" />
              <button
                onClick={() => p.setParam(`${s}.mute`, muted ? 0 : 1)}
                onMouseEnter={() => p.hint(`${STRIP_NAMES[s]} mute: ${muted ? 'On' : 'Off'}`)}
                className={cn('mb-[11px] h-[16px] w-[22px] rounded-[2px] text-[9px] font-bold', muted ? 'bg-fl-red text-white' : 'bg-[#3a454b] text-fl-dim hover:bg-[#46535a]')}
              >
                M
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BusPanel({ p }: { p: PluginEditorProps }) {
  return (
    <div className="flex min-h-0 flex-1 gap-1.5">
      {BUSES.map((b) => (
        <div key={b} className="flex flex-1 flex-col items-center gap-1 rounded-[3px] border border-[#15191b] bg-[#262d31] p-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: ACCENT }}>
            {BUS_NAMES[b]}
          </div>
          <div className="flex gap-2">
            <PKnob p={p} id={`bus.${b}.low`} size={28} label="Low" color="#e2614f" />
            <PKnob p={p} id={`bus.${b}.high`} size={28} label="High" color="#56b8d8" />
          </div>
          <div className="flex gap-2">
            <PKnob p={p} id={`bus.${b}.punch`} size={28} label="Punch" />
            <PKnob p={p} id={`bus.${b}.room`} size={28} label="Room" color="#6fb7e0" />
          </div>
        </div>
      ))}
    </div>
  )
}
