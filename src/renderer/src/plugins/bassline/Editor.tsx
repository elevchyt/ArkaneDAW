import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { PluginEditorProps } from '../sdk/module'
import { PK, PluginPanel, PSelect, Readout, useHeldKeys } from '../sdk/ui'
import { formatParam } from '../sdk/params'
import { ENG, ENGINES, FM_ALGOS } from './params'

export const EDITOR_W = 760
export const EDITOR_H = 420

const ENGINE_COLORS = ['#f79a2e', '#b9e34a', '#6cc6ff', '#c58bff', '#ff6b6b', '#e8c07a']
const ENGINE_HINTS = [
  'Analog: two oscillators with unison, noise, Moog-style ladder filter',
  'Acid 303: diode ladder, accent circuit (velocity ≥ threshold), slide on overlapping or FL slide notes',
  'FM: 4-operator FM with feedback (DX / TX81Z style basses)',
  'Growl: morphing / sync / fold oscillator through a formant filter with tempo-synced wobble',
  '808 / Sub: sine or triangle with pitch envelope, click and long glide',
  'Physical: modelled bass strings - finger, pick, slap, fretless, upright'
]
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (k: number) => `${NOTE_NAMES[k % 12]}${Math.floor(k / 12)}`

/** Small titled group, tighter than sdk Section. */
function Group({ title, color, children, className, right }: { title: string; color: string; children: React.ReactNode; className?: string; right?: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col rounded-[4px] border border-[#1d2326] bg-[#2a3236]/85 px-1.5 pb-1 pt-1 fl-bevel', className)}>
      <div className="mb-1 flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.13em] text-fl-dim">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        {title}
        {right && <span className="ml-auto normal-case tracking-normal">{right}</span>}
      </div>
      {children}
    </div>
  )
}

/** Compact enum stepper (LCD + arrows, wheel to change) for params with many options. */
function Stepper({ p, id, width = 56 }: { p: PluginEditorProps; id: string; width?: number }) {
  const def = p.manifest.params.find((d) => d.id === id)
  if (!def?.options) return null
  const v = Math.round(p.instance.params[id] ?? def.default)
  const n = def.options.length
  const set = (nv: number) => {
    const x = ((nv % n) + n) % n
    p.setParam(id, x)
    p.hint(`${def.name}: ${def.options![x]}`)
  }
  return (
    <div className="flex flex-col items-center gap-0.5" onMouseEnter={() => p.hint(`${def.name}: ${def.options![v]} (wheel / arrows to change)`)}>
      <div className="flex items-center gap-px" onWheel={(e) => set(v - Math.sign(e.deltaY))}>
        <button className="h-4 w-3 rounded-l-[2px] bg-[#3a454b] text-[9px] text-fl-text hover:bg-[#46535a]" onClick={() => set(v - 1)}>
          ‹
        </button>
        <Readout className="h-4 truncate text-center text-[10px] leading-[14px]">
          <span style={{ display: 'inline-block', width }}>{def.options[v]}</span>
        </Readout>
        <button className="h-4 w-3 rounded-r-[2px] bg-[#3a454b] text-[9px] text-fl-text hover:bg-[#46535a]" onClick={() => set(v + 1)}>
          ›
        </button>
      </div>
      <span className="text-[9.5px] uppercase leading-none tracking-wide text-fl-dim">{def.name}</span>
    </div>
  )
}

// ── oscilloscope ─────────────────────────────────────────────────────────────
function Scope({ p, color }: { p: PluginEditorProps; color: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState('')
  const colorRef = useRef(color)
  colorRef.current = color
  useEffect(() => {
    const draw = (data: Float32Array | null, peak: number) => {
      const c = canvas.current
      if (!c) return
      const g = c.getContext('2d')
      if (!g) return
      const w = c.width
      const h = c.height
      g.fillStyle = '#121719'
      g.fillRect(0, 0, w, h)
      g.strokeStyle = '#1f2a2e'
      g.lineWidth = 1
      for (let i = 1; i < 8; i++) {
        g.beginPath()
        g.moveTo((i * w) / 8 + 0.5, 0)
        g.lineTo((i * w) / 8 + 0.5, h)
        g.stroke()
      }
      for (let i = 1; i < 4; i++) {
        g.beginPath()
        g.moveTo(0, (i * h) / 4 + 0.5)
        g.lineTo(w, (i * h) / 4 + 0.5)
        g.stroke()
      }
      if (!data) return
      const scale = (h * 0.45) / Math.max(0.25, peak)
      g.strokeStyle = colorRef.current
      g.shadowColor = colorRef.current
      g.shadowBlur = 6
      g.lineWidth = 1.6
      g.beginPath()
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w
        const y = h / 2 - data[i] * scale
        if (i === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
      g.shadowBlur = 0
    }
    draw(null, 1)
    return p.onDSPMessage((m) => {
      const msg = m as { type?: string; data?: Float32Array; freq?: number; peak?: number }
      if (msg?.type !== 'scope' || !msg.data) return
      const peak = msg.peak ?? 0
      draw(peak > 1e-4 ? msg.data : null, peak)
      if (peak > 1e-4 && msg.freq) {
        const midi = Math.round(69 + 12 * Math.log2(msg.freq / 440))
        setInfo(`${noteName(midi)} · ${msg.freq.toFixed(1)} Hz · ${(20 * Math.log10(peak)).toFixed(1)} dB`)
      } else setInfo('')
    })
  }, [p])
  return (
    <div className="relative" onMouseEnter={() => p.hint('Oscilloscope: live output, trigger-aligned (~2 cycles)')}>
      <canvas ref={canvas} width={196} height={112} className="block rounded-[3px] border border-[#0d1112] fl-inset" />
      <div className="pointer-events-none absolute bottom-0.5 left-1 font-mono text-[9px] text-[#9fe870]/80">{info}</div>
    </div>
  )
}

// ── mini keyboard (2 octaves) ─────────────────────────────────────────────────
const KB_LO = 24
const KB_HI = 48
function MiniKeyboard({ p, color }: { p: PluginEditorProps; color: string }) {
  const down = useRef<number | null>(null)
  const [held, setHeld] = useState<number | null>(null)
  const live = useHeldKeys(p)
  const lit = (k: number) => held === k || live.has(k)
  const whites: number[] = []
  for (let k = KB_LO; k <= KB_HI; k++) if (![1, 3, 6, 8, 10].includes(k % 12)) whites.push(k)
  const WW = 19
  const H = 50
  const stop = () => {
    if (down.current !== null) p.previewNote?.(down.current, 0, false)
    down.current = null
    setHeld(null)
  }
  useEffect(() => stop, []) // eslint-disable-line react-hooks/exhaustive-deps
  const press = (k: number, e: React.MouseEvent, h: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const vel = Math.min(1, Math.max(0.3, 0.35 + (0.65 * (e.clientY - r.top)) / h))
    stop()
    down.current = k
    setHeld(k)
    p.previewNote?.(k, vel, true)
    p.hint(`${noteName(k)} · velocity ${Math.round(vel * 100)}% (click lower on a key = harder / accent)`)
  }
  const enter = (k: number, e: React.MouseEvent, h: number) => {
    if (e.buttons & 1 && down.current !== null && down.current !== k) press(k, e, h)
    else p.hint(`${noteName(k)} (click lower = louder / accent)`)
  }
  return (
    <div className="relative select-none" style={{ width: whites.length * WW, height: H }} onMouseLeave={stop} onMouseUp={stop}>
      {whites.map((k, i) => (
        <div
          key={k}
          onMouseDown={(e) => press(k, e, H)}
          onMouseEnter={(e) => enter(k, e, H)}
          className="absolute top-0 rounded-b-[3px] border border-[#1a1f22]"
          style={{ left: i * WW, width: WW - 1, height: H, background: lit(k) ? color : 'linear-gradient(#e9eef0,#c9d0d3)' }}
        >
          {k % 12 === 0 && <span className="absolute bottom-0.5 left-0 right-0 text-center text-[8px] text-[#3a454b]">{noteName(k)}</span>}
        </div>
      ))}
      {whites.map((k, i) => {
        const b = k + 1
        if (b > KB_HI || ![1, 3, 6, 8, 10].includes(b % 12)) return null
        return (
          <div
            key={b}
            onMouseDown={(e) => press(b, e, H * 0.6)}
            onMouseEnter={(e) => enter(b, e, H * 0.6)}
            className="absolute top-0 z-10 rounded-b-[2px] border border-[#0d1012]"
            style={{ left: i * WW + WW * 0.62, width: WW * 0.72, height: H * 0.6, background: lit(b) ? color : 'linear-gradient(#3a4448,#15191b)' }}
          />
        )
      })}
    </div>
  )
}

// ── engine panels ────────────────────────────────────────────────────────────
function AnalogPanel({ p, c, acid }: { p: PluginEditorProps; c: string; acid?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <PSelect p={p} id="osc1.wave" />
        <PK p={p} id="osc1.pw" size={28} color={c} />
        <PK p={p} id="osc1.level" size={28} color={c} label="Level" />
      </div>
      {acid ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-end gap-2.5 rounded-[3px] border border-[#b9e34a]/30 bg-[#1f2629] px-1.5 py-1">
            <span className="mr-0.5 self-center text-[10px] font-bold leading-tight tracking-wider text-[#b9e34a]">
              TB
              <br />
              303
            </span>
            <PK p={p} id="flt.env" size={30} color={c} label="Env Mod" />
            <PK p={p} id="fenv.d" size={30} color={c} label="Decay" />
            <PK p={p} id="acid.accent" size={30} color={c} label="Accent" />
            <PK p={p} id="glide" size={30} color={c} label="Slide" />
            <PK p={p} id="acid.thr" size={30} color={c} label="Acc Vel" />
          </div>
          <div className="text-[9.5px] leading-tight text-fl-dim">
            Accent: velocity ≥ Acc Vel. Slide: overlap notes (Legato) or use FL slide notes. Filter fixed to the 18 dB diode ladder.
          </div>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <PSelect p={p} id="osc2.wave" />
          <PK p={p} id="osc2.level" size={28} color={c} label="Level" />
          <PK p={p} id="osc2.semi" size={28} color={c} />
          <PK p={p} id="osc2.detune" size={28} color={c} />
        </div>
      )}
      {!acid && (
        <div className="flex items-end gap-2.5">
          <PK p={p} id="osc.uni" size={28} color={c} />
          <PK p={p} id="osc.spread" size={28} color={c} />
          <PK p={p} id="noise.level" size={28} color={c} />
        </div>
      )}
    </div>
  )
}

function FMPanel({ p, c }: { p: PluginEditorProps; c: string }) {
  const algo = Math.round(p.instance.params['fm.algo'] ?? 0)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        <PSelect p={p} id="fm.algo" />
      </div>
      <div className="flex gap-1" onMouseEnter={() => p.hint(`FM algorithm ${FM_ALGOS[algo]}: op1 is always a carrier; op4 has feedback`)}>
        <div className="flex flex-col items-center gap-1 rounded-[3px] bg-[#1f2629] px-1 py-1">
          <span className="text-[9px] text-fl-dim">OP1</span>
          <PK p={p} id="fm.r1" size={26} color={c} label="Ratio" />
          <PK p={p} id="fm.fb" size={26} color={c} label="FB 4" />
        </div>
        {[2, 3, 4].map((o) => (
          <div key={o} className="flex flex-col items-center gap-1 rounded-[3px] bg-[#1f2629] px-1 py-1">
            <span className="text-[9px] text-fl-dim">
              OP{o}
              {algo === 1 && o === 3 ? ' (car)' : ''}
            </span>
            <div className="flex gap-1">
              <PK p={p} id={`fm.r${o}`} size={26} color={c} label="Ratio" />
              <PK p={p} id={`fm.i${o}`} size={26} color={c} label={algo === 1 && o === 3 ? 'Level' : 'Index'} />
            </div>
            <PK p={p} id={`fm.d${o}`} size={26} color={c} label="Decay" />
          </div>
        ))}
        <div className="flex flex-col items-center gap-1 rounded-[3px] bg-[#1f2629] px-1 py-1">
          <span className="text-[9px] text-fl-dim">MOD</span>
          <PK p={p} id="fm.sus" size={26} color={c} label="Sus" />
          <PK p={p} id="fm.vel" size={26} color={c} label="Vel" />
        </div>
      </div>
    </div>
  )
}

function GrowlPanel({ p, c }: { p: PluginEditorProps; c: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-3">
        <PK p={p} id="wt.morph" size={34} color={c} />
        <PK p={p} id="wt.sync" size={34} color={c} />
        <PK p={p} id="wt.fm" size={34} color={c} />
        <PK p={p} id="wt.fold" size={34} color={c} />
      </div>
      <div className="flex items-end gap-3">
        <PK p={p} id="wt.vowel" size={34} color={c} />
        <PK p={p} id="wt.formant" size={34} color={c} />
        <PK p={p} id="lfo.wt" size={34} color={c} label="Wobble Tmb" />
        <Stepper p={p} id="lfo.sync" width={36} />
      </div>
      <div className="text-[9.5px] text-fl-dim">Morph: sine › tri › saw › square. Vowel U-O-A-E-I. The LFO sweeps timbre + cutoff.</div>
    </div>
  )
}

function SubPanel({ p, c }: { p: PluginEditorProps; c: string }) {
  return (
    <div className="flex flex-col gap-2">
      <PSelect p={p} id="s8.wave" />
      <div className="flex items-end gap-3">
        <PK p={p} id="s8.pitch" size={38} color={c} />
        <PK p={p} id="s8.ptime" size={38} color={c} />
        <PK p={p} id="s8.click" size={38} color={c} />
        <PK p={p} id="glide" size={38} color={c} />
      </div>
      <div className="text-[9.5px] text-fl-dim">Tip: Legato voicing + Glide for 808 slides; set Amp Sustain 0 and a long Decay for boom.</div>
    </div>
  )
}

function PhysPanel({ p, c }: { p: PluginEditorProps; c: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <PSelect p={p} id="ph.model" />
      <div className="flex items-end gap-2">
        <PK p={p} id="ph.pickup" size={28} color={c} />
        <PK p={p} id="ph.pluck" size={28} color={c} />
        <PK p={p} id="ph.bright" size={28} color={c} />
        <PK p={p} id="ph.decay" size={28} color={c} />
        <PK p={p} id="ph.damp" size={28} color={c} />
        <PK p={p} id="amp.r" size={28} color={c} label="Mute" />
      </div>
      <div className="flex items-end gap-2">
        <PK p={p} id="ph.buzz" size={28} color={c} />
        <PK p={p} id="ph.pop" size={28} color={c} />
        <PK p={p} id="ph.body" size={28} color={c} />
        <PK p={p} id="ph.mwah" size={28} color={c} />
      </div>
    </div>
  )
}

// ── editor ───────────────────────────────────────────────────────────────────
export default function BasslineEditor(p: PluginEditorProps) {
  const prm = p.instance.params
  const eng = Math.round(prm.engine ?? 0)
  const c = ENGINE_COLORS[eng] ?? '#f79a2e'
  const acid = eng === ENG.ACID
  const phys = eng === ENG.PHYS
  const show = (id: string) => {
    const d = p.manifest.params.find((x) => x.id === id)
    return d ? formatParam(d, prm[id] ?? d.default) : ''
  }
  return (
    <PluginPanel className="flex flex-col gap-1.5 overflow-hidden !p-1.5" style={{ width: EDITOR_W, height: EDITOR_H, background: 'linear-gradient(#3a4247,#262d31)' }}>
      {/* header: logo + engine tabs + voicing */}
      <div className="flex h-[26px] shrink-0 items-center gap-2">
        <div className="flex items-baseline gap-1 pl-0.5" onMouseEnter={() => p.hint('Bassline: every kind of bass')}>
          <span className="text-[15px] font-black italic tracking-tight" style={{ color: c, textShadow: `0 0 8px ${c}55` }}>
            BASSLINE
          </span>
        </div>
        <div className="flex gap-px rounded-[3px] bg-[#161b1d] p-px">
          {ENGINES.map((name, i) => (
            <button
              key={name}
              onClick={() => p.setParam('engine', i)}
              onMouseEnter={() => p.hint(ENGINE_HINTS[i])}
              className={cn('rounded-[2px] px-2 py-[3px] text-[10.5px] font-semibold', i === eng ? 'text-[#15191b]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}
              style={i === eng ? { background: ENGINE_COLORS[i], boxShadow: `0 0 6px ${ENGINE_COLORS[i]}88` } : undefined}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <PSelect p={p} id="voice.mode" className="[&>span]:hidden" />
          <PK p={p} id="master.gain" size={22} color={c} label="" />
        </div>
      </div>

      {/* main row: engine | filter | scope */}
      <div className="flex h-[184px] shrink-0 gap-1.5">
        <Group title={`${ENGINES[eng]} engine`} color={c} className="w-[318px]">
          {eng === ENG.ANALOG || acid ? <AnalogPanel p={p} c={c} acid={acid} /> : eng === ENG.FM ? <FMPanel p={p} c={c} /> : eng === ENG.GROWL ? <GrowlPanel p={p} c={c} /> : eng === ENG.SUB808 ? <SubPanel p={p} c={c} /> : <PhysPanel p={p} c={c} />}
        </Group>
        <Group title="Filter" color={c} className="w-[218px]" right={<span className="text-[9.5px] text-fl-dim">{acid ? 'Diode 303' : show('flt.type')}</span>}>
          <div className="flex items-end justify-between px-0.5">
            <PK p={p} id="flt.cutoff" size={50} color={c} />
            <PK p={p} id="flt.res" size={50} color={c} />
            <PK p={p} id="flt.env" size={50} color={c} label={acid ? 'Env Mod' : 'Env'} />
          </div>
          <div className="mt-1.5 flex items-end justify-between px-0.5">
            <PK p={p} id="flt.drive" size={30} color={c} label="Drive" />
            <PK p={p} id="flt.key" size={30} color={c} label="Key" />
            <PK p={p} id="flt.vel" size={30} color={c} label="Vel" />
            {!acid && <Stepper p={p} id="flt.type" width={52} />}
          </div>
        </Group>
        <Group title="Scope" color={c} className="flex-1">
          <Scope p={p} color={c} />
          <div className="mt-1 flex items-end justify-around">
            <PK p={p} id="glide" size={24} color={c} />
            <PK p={p} id="vel.sens" size={24} color={c} />
            <PK p={p} id="drive" size={24} color={c} />
            <Stepper p={p} id="drv.mode" width={30} />
          </div>
        </Group>
      </div>

      {/* envelopes / LFO / sub */}
      <div className="flex h-[98px] shrink-0 gap-1.5">
        <Group title={phys ? 'Amp (string decays naturally)' : 'Amp Envelope'} color={c} className="w-[170px]">
          <div className={cn('flex items-end justify-between', phys && 'opacity-40')}>
            <PK p={p} id="amp.a" size={28} color={c} label="A" />
            <PK p={p} id="amp.d" size={28} color={c} label="D" />
            <PK p={p} id="amp.s" size={28} color={c} label="S" />
            <PK p={p} id="amp.r" size={28} color={c} label="R" />
          </div>
        </Group>
        <Group title={acid ? 'Filter Env (303)' : 'Filter Envelope'} color={c} className="w-[170px]">
          <div className={cn('flex items-end justify-between', acid && 'opacity-40')}>
            <PK p={p} id="fenv.a" size={28} color={c} label="A" />
            <PK p={p} id="fenv.d" size={28} color={c} label="D" />
            <PK p={p} id="fenv.s" size={28} color={c} label="S" />
            <PK p={p} id="fenv.r" size={28} color={c} label="R" />
          </div>
        </Group>
        <Group title="LFO" color={c} className="flex-1" right={<span className="text-[9.5px] text-fl-dim">{Math.round(prm['lfo.sync'] ?? 0) > 0 ? `${Math.round(prm.tempo ?? 140)} BPM` : show('lfo.rate')}</span>}>
          <div className="flex items-end justify-between">
            <Stepper p={p} id="lfo.wave" width={34} />
            <Stepper p={p} id="lfo.sync" width={30} />
            <PK p={p} id="lfo.rate" size={26} color={c} label="Rate" />
            <PK p={p} id="lfo.cutoff" size={26} color={c} label="Cut" />
            <PK p={p} id="lfo.pitch" size={26} color={c} label="Pitch" />
            <PK p={p} id="lfo.amp" size={26} color={c} label="Amp" />
            <PK p={p} id="lfo.wt" size={26} color={c} label="Timbre" />
          </div>
        </Group>
        <Group title="Sub Layer" color={c} className="w-[118px]">
          <div className="flex items-end justify-between">
            <PK p={p} id="sub.level" size={28} color={c} label="Level" />
            <div className="flex flex-col gap-1">
              <Stepper p={p} id="sub.wave" width={34} />
            </div>
          </div>
          <div className="mt-0.5 flex justify-end">
            <Stepper p={p} id="sub.oct" width={34} />
          </div>
        </Group>
      </div>

      {/* FX strip + keyboard */}
      <div className="flex min-h-0 flex-1 gap-1.5">
        <Group title="Output" color={c} className="flex-1">
          <div className="flex items-end justify-between">
            <PK p={p} id="eq.low" size={26} color={c} />
            <PK p={p} id="eq.mid" size={26} color={c} />
            <PK p={p} id="eq.high" size={26} color={c} />
            <PK p={p} id="punch" size={26} color={c} />
            <PK p={p} id="chorus" size={26} color={c} />
            <PK p={p} id="chorus.rate" size={26} color={c} label="Rate" />
          </div>
        </Group>
        <div className="flex items-end rounded-[4px] border border-[#1d2326] bg-[#20272a] px-1.5 py-1 fl-bevel">
          <MiniKeyboard p={p} color={c} />
        </div>
      </div>
    </PluginPanel>
  )
}
