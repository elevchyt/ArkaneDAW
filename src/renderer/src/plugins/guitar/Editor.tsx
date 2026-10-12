// Guitar editor: guitar picker, a live fretboard (shows where every note is fingered; click a fret to play it),
// playing / string / amp / output sections and the keyswitch legend.
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ParamKnob } from '@/components/controls'
import type { PluginEditorProps } from '../sdk/module'
import { formatParam } from '../sdk/params'
import { AMP, ARTS, KS, MAX_FRET, MODELS, PICKUPS, PLAY_MODES, STRINGS, STRUM_DIRS, TUNINGS, isElectric } from './manifest'

export const EDITOR_W = 860
export const EDITOR_H = 440

type P = PluginEditorProps

const C = {
  bg: 'linear-gradient(180deg,#2d2620 0%,#241e19 100%)',
  panel: '#1c1815',
  border: '#3b3128',
  accent: '#e0a15a',
  dim: '#a8988a',
  text: '#efe4d6'
}

const def = (p: P, id: string) => p.manifest.params.find((d) => d.id === id)
const val = (p: P, id: string) => p.instance.params[id] ?? def(p, id)?.default ?? 0

function K({ p, id, label, disabled }: { p: P; id: string; label?: string; disabled?: boolean }) {
  const d = def(p, id)
  if (!d) return null
  return (
    <div className={cn('flex w-[50px] flex-col items-center', disabled && 'pointer-events-none opacity-35')}>
      <ParamKnob def={d} value={val(p, id)} onChange={(v) => p.setParam(id, v)} size={30} color={C.accent} label={label} labelPosition="below" />
    </div>
  )
}

function Seg({ p, id, options, labels, className, disabled }: { p: P; id: string; options: readonly string[]; labels?: string[]; className?: string; disabled?: boolean }) {
  const d = def(p, id)
  const v = Math.round(val(p, id))
  return (
    <div className={cn('flex flex-col gap-0.5', disabled && 'pointer-events-none opacity-35', className)} onMouseEnter={() => d && p.hint(`${d.name}: ${options[v]}`)}>
      <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: C.dim }}>
        {d?.name}
      </span>
      <div className="flex gap-px rounded-[3px] p-px" style={{ background: '#120f0d' }}>
        {options.map((o, i) => (
          <button
            key={o}
            onClick={() => p.setParam(id, i)}
            className={cn('flex-1 whitespace-nowrap rounded-[2px] px-1.5 py-[3px] text-[10px]', i === v ? 'font-semibold text-[#1b140e]' : 'hover:brightness-125')}
            style={{ background: i === v ? C.accent : '#3a3029', color: i === v ? undefined : C.text }}
          >
            {labels?.[i] ?? o}
          </button>
        ))}
      </div>
    </div>
  )
}

function Box({ title, children, className, body }: { title: string; children: React.ReactNode; className?: string; body?: string }) {
  return (
    <div className={cn('rounded-[5px] px-2 pb-1.5 pt-1', className)} style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div className="mb-1 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.dim }}>
        <span className="inline-block h-[5px] w-[5px] rotate-45" style={{ background: C.accent }} />
        {title}
      </div>
      <div className={body}>{children}</div>
    </div>
  )
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (k: number): string => `${NOTE_NAMES[k % 12]}${Math.floor(k / 12)}`
const INLAYS = [3, 5, 7, 9, 15, 17, 19, 21]

/** Fret x positions (real fret spacing, compressed a little so high frets stay clickable). */
function fretX(f: number, x0: number, w: number): number {
  const scale = 1 - Math.pow(2, -(MAX_FRET + 1) / 12)
  const real = (1 - Math.pow(2, -f / 12)) / scale
  return x0 + w * (0.55 * real + 0.45 * (f / (MAX_FRET + 1)))
}

function Fretboard({ p, frets }: { p: P; frets: number[] }) {
  const open = (TUNINGS[Math.round(val(p, 'tuning'))] ?? TUNINGS[0]).strings
  const W = EDITOR_W - 24
  const H = 132
  const x0 = 46
  const fw = W - x0 - 8
  const y0 = 14
  const sh = (H - 2 * y0) / (STRINGS - 1)
  // string 0 (low E) at the bottom, like looking down at the neck
  const sy = (s: number) => y0 + (STRINGS - 1 - s) * sh
  const held = useRef<number | null>(null)
  const play = (key: number | null) => {
    if (held.current !== null) p.previewNote?.(held.current, 0, false)
    held.current = key
    if (key !== null) p.previewNote?.(key, 0.8, true)
  }
  useEffect(() => () => play(null), []) // eslint-disable-line react-hooks/exhaustive-deps
  const hit = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const s = Math.max(0, Math.min(STRINGS - 1, STRINGS - 1 - Math.round((y - y0) / sh)))
    let f = 0
    for (let k = 1; k <= MAX_FRET; k++) if (x >= fretX(k - 1, x0, fw)) f = k
    return { s, f, key: open[s] + f }
  }
  return (
    <svg
      width={W}
      height={H}
      className="cursor-pointer select-none"
      onMouseDown={(e) => {
        const h = hit(e)
        play(h.key)
        p.hint(`String ${6 - h.s}, fret ${h.f}: ${noteName(h.key)}`)
      }}
      onMouseUp={() => play(null)}
      onMouseLeave={() => play(null)}
      onMouseMove={(e) => {
        const h = hit(e)
        p.hint(`String ${6 - h.s}, fret ${h.f}: ${noteName(h.key)}`)
        if (e.buttons & 1 && held.current !== h.key) play(h.key)
      }}
    >
      <defs>
        <linearGradient id="gt-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b2416" />
          <stop offset="0.5" stopColor="#4a2e1c" />
          <stop offset="1" stopColor="#35200f" />
        </linearGradient>
      </defs>
      <rect x={x0} y={y0 - 9} width={fw} height={H - 2 * y0 + 18} rx={3} fill="url(#gt-wood)" stroke="#1a110a" />
      {/* nut */}
      <rect x={x0 - 3} y={y0 - 9} width={5} height={H - 2 * y0 + 18} fill="#e8dcc0" />
      {INLAYS.map((f) => (
        <circle key={f} cx={(fretX(f - 1, x0, fw) + fretX(f, x0, fw)) / 2} cy={H / 2} r={4} fill="#d8cfbf" opacity={0.75} />
      ))}
      {[12].map((f) => {
        const cx = (fretX(f - 1, x0, fw) + fretX(f, x0, fw)) / 2
        return (
          <g key={f}>
            <circle cx={cx} cy={y0 + sh * 1.5} r={4} fill="#d8cfbf" opacity={0.75} />
            <circle cx={cx} cy={y0 + sh * 3.5} r={4} fill="#d8cfbf" opacity={0.75} />
          </g>
        )
      })}
      {Array.from({ length: MAX_FRET }, (_, i) => i + 1).map((f) => (
        <g key={f}>
          <line x1={fretX(f, x0, fw)} x2={fretX(f, x0, fw)} y1={y0 - 9} y2={H - y0 + 9} stroke="#b9b2a6" strokeWidth={1.6} />
          {[3, 5, 7, 9, 12, 15, 17, 19, 21].includes(f) && (
            <text x={(fretX(f - 1, x0, fw) + fretX(f, x0, fw)) / 2} y={H - 1} fontSize={8} fill={C.dim} textAnchor="middle">
              {f}
            </text>
          )}
        </g>
      ))}
      {open.map((k, s) => (
        <g key={s}>
          <line x1={x0} x2={x0 + fw} y1={sy(s)} y2={sy(s)} stroke={s < 3 ? '#c9b38a' : '#d9d6cf'} strokeWidth={0.8 + (STRINGS - 1 - s) * 0.32} />
          <text x={x0 - 22} y={sy(s) + 3} fontSize={9} fill={C.text} textAnchor="end">
            {noteName(k).replace(/\d+$/, '')}
          </text>
        </g>
      ))}
      {frets.map((f, s) => {
        if (f < 0) return null
        const x = f === 0 ? x0 - 11 : (fretX(f - 1, x0, fw) + fretX(f, x0, fw)) / 2
        return (
          <g key={s}>
            <circle cx={x} cy={sy(s)} r={6.5} fill={C.accent} stroke="#2a1a0c" style={{ filter: 'drop-shadow(0 0 4px rgba(224,161,90,.8))' }} />
            {f > 0 && (
              <text x={x} y={sy(s) + 3} fontSize={8} fontWeight={700} fill="#22160b" textAnchor="middle">
                {f}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

const KS_LEGEND: [number, string][] = [
  [KS.SUSTAIN, 'Sustain'],
  [KS.PALM, 'Palm mute'],
  [KS.MUTED, 'Muted'],
  [KS.HARMONIC, 'Harmonics'],
  [KS.STRUM_DOWN, 'Strum ↓'],
  [KS.STRUM_UP, 'Strum ↑'],
  [KS.STRUM_MUTE, 'Mute strum']
]

export function GuitarEditor(p: P) {
  const [frets, setFrets] = useState<number[]>(() => Array(STRINGS).fill(-1))
  const [liveArt, setLiveArt] = useState<number | null>(null)
  useEffect(
    () =>
      p.onDSPMessage((m) => {
        const msg = m as { type?: string; frets?: number[]; art?: number }
        if (msg?.type !== 'frets' || !msg.frets) return
        setFrets(msg.frets)
        if (typeof msg.art === 'number') setLiveArt(msg.art)
      }),
    [p]
  )
  useEffect(() => p.postToDSP({ type: 'sync' }), [p])
  const model = Math.round(val(p, 'model'))
  const electric = isElectric(model)
  const ampOn = Math.round(val(p, 'amp')) !== AMP.OFF
  const art = liveArt ?? Math.round(val(p, 'art'))
  const tuningDef = def(p, 'tuning')!
  return (
    <div className="flex h-full w-full flex-col gap-2 p-2.5 text-[11px]" style={{ background: C.bg, color: C.text }}>
      {/* header: guitars + tuning */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {MODELS.map((m, i) => (
            <button
              key={m}
              onClick={() => p.setParam('model', i)}
              onMouseEnter={() => p.hint(`Guitar: ${m}`)}
              className={cn('rounded-[4px] px-2.5 py-1 text-[10.5px] font-semibold tracking-wide', i === model ? 'text-[#1b140e]' : 'hover:brightness-125')}
              style={{ background: i === model ? C.accent : '#3a3029', color: i === model ? undefined : C.text, boxShadow: i === model ? '0 0 8px rgba(224,161,90,.45)' : undefined }}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: C.dim }}>
          Tuning
        </span>
        <select
          value={Math.round(val(p, 'tuning'))}
          onChange={(e) => p.setParam('tuning', Number(e.target.value))}
          onMouseEnter={() => p.hint(`Tuning: ${formatParam(tuningDef, val(p, 'tuning'))}`)}
          className="rounded-[3px] px-1.5 py-[3px] text-[10.5px] outline-none"
          style={{ background: '#120f0d', color: C.text, border: `1px solid ${C.border}` }}
        >
          {TUNINGS.map((t, i) => (
            <option key={t.name} value={i}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-[5px] px-1.5 py-1" style={{ background: '#15110e', border: `1px solid ${C.border}` }}>
        <Fretboard p={p} frets={frets} />
      </div>

      <div className="flex gap-2">
        <Box title="Playing" className="w-[262px]" body="flex flex-col gap-1.5">
          <Seg p={p} id="mode" options={PLAY_MODES} labels={['Poly', 'Solo', 'Strummer']} />
          <div className="flex flex-col gap-0.5" onMouseEnter={() => p.hint(`Articulation: ${ARTS[art]} (keyswitches C2–F2)`)}>
            <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: C.dim }}>
              Articulation
            </span>
            <div className="flex gap-px rounded-[3px] p-px" style={{ background: '#120f0d' }}>
              {ARTS.map((a, i) => (
                <button
                  key={a}
                  onClick={() => {
                    setLiveArt(i)
                    p.setParam('art', i)
                  }}
                  className={cn('flex-1 whitespace-nowrap rounded-[2px] px-1 py-[3px] text-[10px]', i === art ? 'font-semibold text-[#1b140e]' : 'hover:brightness-125')}
                  style={{ background: i === art ? C.accent : '#3a3029', color: i === art ? undefined : C.text }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-1">
            <Seg p={p} id="strum" options={STRUM_DIRS} labels={['Off', '↓', '↑', '↓↑']} className="w-[118px]" />
            <K p={p} id="strumTime" label="Strum" />
            <K p={p} id="human" label="Human" />
          </div>
        </Box>
        <Box title="Strings" className="flex-1" body="flex h-[118px] flex-col justify-between">
          <div className="flex flex-wrap gap-y-1">
            <K p={p} id="pickPos" label="Pick Pos" />
            <K p={p} id="attack" label="Attack" />
            <K p={p} id="tone" label="Tone" />
            <K p={p} id="sustain" label="Sustain" />
            {electric ? (
              <div className="w-[100px] pt-0.5">
                <Seg p={p} id="pickup" options={PICKUPS} />
              </div>
            ) : (
              <K p={p} id="body" label="Body" />
            )}
          </div>
          <div className="flex flex-wrap gap-y-1">
            <K p={p} id="noise" label="Fret Noise" />
            <K p={p} id="glide" label="Slide" />
            <K p={p} id="vibrato" label="Vibrato" />
            <K p={p} id="vibRate" label="Vib Rate" />
            <div className="flex-1 self-center pl-2 text-[9.5px] leading-[1.35]" style={{ color: C.dim }}>
              {Math.round(val(p, 'mode')) === 1
                ? 'Solo: overlap notes to hammer on / pull off; jumps over 5 semitones (or slide notes) slide.'
                : Math.round(val(p, 'mode')) === 2
                  ? 'Strummer: hold a chord, play the strum keys (G2 ↓, A2 ↑, B2 mute) for the rhythm.'
                  : 'Notes played together are voiced as a chord and strummed string by string.'}
            </div>
          </div>
        </Box>
      </div>

      <div className="flex gap-2">
        <Box title="Amp & Cab" className="flex-1" body="flex items-end gap-2">
          <div className="flex items-end gap-1">
            <Seg p={p} id="amp" options={['Off', 'Clean', 'Crunch', 'Lead', 'Metal']} className="w-[232px]" />
            <K p={p} id="gain" label="Gain" disabled={!ampOn} />
            <K p={p} id="bass" label="Bass" disabled={!ampOn} />
            <K p={p} id="mid" label="Mid" disabled={!ampOn} />
            <K p={p} id="treble" label="Treble" disabled={!ampOn} />
            <K p={p} id="gate" label="Gate" disabled={!ampOn} />
          </div>
        </Box>
        <Box title="Output" body="flex items-end gap-1">
          <div className="w-[70px]">
            <Seg p={p} id="double" options={['Off', 'On']} />
          </div>
          <K p={p} id="width" label="Width" />
          <K p={p} id="reverb" label="Room" />
          <K p={p} id="volume" label="Volume" />
        </Box>
      </div>

      <div className="flex items-center gap-3 text-[9.5px]" style={{ color: C.dim }}>
        <span className="uppercase tracking-[0.14em]">Keyswitches</span>
        {KS_LEGEND.map(([k, name]) => (
          <span key={k}>
            <b style={{ color: C.text }}>{noteName(k)}</b> {name}
          </span>
        ))}
        {electric && !ampOn && <span className="ml-auto">Amp off: direct pickup signal</span>}
      </div>
    </div>
  )
}
