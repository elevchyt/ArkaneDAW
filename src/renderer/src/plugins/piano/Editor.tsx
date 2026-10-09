// Piano editor: black-lacquer panel with walnut cheeks — patch browser, piano-focused knobs,
// sustain pedal and an 88-key keyboard over red felt.
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { ParamKnob } from '@/components/controls'
import type { PluginEditorProps } from '../sdk/module'
import { formatParam } from '../sdk/params'
import { PATCH_PRESETS } from './manifest'
import { CATEGORIES, PATCHES, type PatchCategory } from './patches'
import { Keyboard, type SoundingKeys } from './Keyboard'
import { CAT_COLORS, T } from './theme'

type P = PluginEditorProps

const W = 760
const H = 400
const BODY_H = 172

const def = (p: P, id: string) => p.manifest.params.find((d) => d.id === id)
const val = (p: P, id: string) => p.instance.params[id] ?? def(p, id)?.default ?? 0

function K({ p, id, label, size = 34, color = T.gold }: { p: P; id: string; label?: string; size?: number; color?: string }) {
  const d = def(p, id)
  if (!d) return null
  return (
    <div className="flex w-[54px] flex-col items-center">
      <ParamKnob def={d} value={val(p, id)} onChange={(v) => p.setParam(id, v)} size={size} color={color} label={label} labelPosition="below" />
    </div>
  )
}

/** Compact header knob: small dial + caption / value readout. */
function HK({ p, id, caption }: { p: P; id: string; caption: string }) {
  const d = def(p, id)
  if (!d) return null
  const v = val(p, id)
  return (
    <div className="flex items-center gap-1" onMouseEnter={() => p.hint(`${d.name}: ${formatParam(d, v)}`)}>
      <ParamKnob def={d} value={v} onChange={(x) => p.setParam(id, x)} size={24} color={T.gold} labelPosition="none" />
      <div className="flex w-[46px] flex-col leading-none">
        <span className="text-[8px] uppercase tracking-[0.16em]" style={{ color: T.dim }}>
          {caption}
        </span>
        <span className="mt-[2px] font-mono text-[10px] tabular-nums" style={{ color: '#f3dfae' }}>
          {formatParam(d, v)}
        </span>
      </div>
    </div>
  )
}

function Box({ title, children, className, hint, p }: { title: string; children: React.ReactNode; className?: string; hint?: string; p: P }) {
  return (
    <div
      className={cn('rounded-[5px] px-1.5 pb-1 pt-1', className)}
      style={{ background: T.section, border: `1px solid ${T.border}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)' }}
      onMouseEnter={() => hint && p.hint(hint)}
    >
      <div className="mb-0.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em]" style={{ color: T.dim }}>
        <span className="inline-block h-[5px] w-[5px] rotate-45" style={{ background: T.gold }} />
        {title}
      </div>
      <div className="flex items-start">{children}</div>
    </div>
  )
}

function PatchBrowser({ p, current }: { p: P; current: number }) {
  const [cat, setCat] = useState<PatchCategory>(PATCHES[current]?.category ?? 'Grand')
  useEffect(() => setCat(PATCHES[current]?.category ?? 'Grand'), [current])
  const list = PATCHES.map((m, i) => ({ m, i })).filter((x) => x.m.category === cat)
  const load = (i: number) => p.loadPreset(PATCH_PRESETS[(i + PATCHES.length) % PATCHES.length])
  return (
    <div className="flex h-full flex-col gap-1.5" style={{ width: 236 }}>
      <div className="flex h-full gap-1.5 overflow-hidden">
        <div className="flex w-[76px] flex-col gap-[3px]">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              onMouseEnter={() => p.hint(`${c} patches`)}
              className="flex h-[22px] items-center gap-1.5 rounded-[3px] px-1.5 text-left text-[10px] font-semibold uppercase tracking-normal"
              style={{
                background: c === cat ? 'rgba(216,180,106,.16)' : 'rgba(255,255,255,.03)',
                color: c === cat ? T.text : T.dim,
                border: `1px solid ${c === cat ? T.goldDim : T.border}`
              }}
            >
              <span className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: CAT_COLORS[c], boxShadow: c === cat ? `0 0 5px ${CAT_COLORS[c]}` : undefined }} />
              {c}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-[2px] overflow-y-auto rounded-[4px] p-[3px]" style={{ background: 'rgba(0,0,0,.35)', border: `1px solid ${T.border}` }}>
          {list.map(({ m, i }) => (
            <button
              key={m.name}
              onClick={() => load(i)}
              onMouseEnter={() => p.hint(`${m.name} — ${m.description}`)}
              className="flex h-[22px] shrink-0 items-center justify-between rounded-[3px] px-1.5 text-left text-[11px]"
              style={{
                background: i === current ? 'linear-gradient(90deg, rgba(216,180,106,.32), rgba(216,180,106,.08))' : 'transparent',
                color: i === current ? '#fff6e4' : T.text,
                borderLeft: `2px solid ${i === current ? T.gold : 'transparent'}`
              }}
            >
              <span className="truncate">{m.name}</span>
              <span className="text-[8.5px] uppercase tracking-wider" style={{ color: T.dim }}>
                {m.engine === 'ep' ? 'EP' : m.engine === 'toy' ? 'Toy' : ''}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PedalButton({ p }: { p: P }) {
  const down = val(p, 'sustain') >= 0.5
  const toggle = () => p.setParam('sustain', down ? 0 : 1)
  return (
    <button
      onClick={toggle}
      onMouseEnter={() => p.hint(down ? 'Sustain pedal: DOWN — dampers lifted, released notes keep ringing (click to lift)' : 'Sustain pedal: UP — click to press (dampers lift, notes ring after release)')}
      className="flex h-[32px] items-center gap-2 rounded-[5px] pl-1.5 pr-2.5"
      style={{
        background: down ? 'linear-gradient(#e7c67c, #a9833c)' : 'linear-gradient(#3a302a, #1f1915)',
        border: `1px solid ${down ? '#f2d797' : T.goldDim}`,
        boxShadow: down ? '0 0 10px rgba(216,180,106,.45), inset 0 1px 0 rgba(255,255,255,.4)' : 'inset 0 1px 0 rgba(255,255,255,.08)',
        color: down ? '#2a1c08' : T.text
      }}
    >
      {/* pedal glyph */}
      <svg width={22} height={24} viewBox="0 0 22 24">
        <rect x={9.5} y={1} width={3} height={8} rx={1} fill={down ? '#5a4220' : T.goldDim} />
        <path d={down ? 'M3 14 Q11 11 19 14 L18 21 Q11 23 4 21 Z' : 'M3 11 Q11 8 19 11 L18 19 Q11 21 4 19 Z'} fill={down ? '#3a2a12' : T.gold} stroke={down ? '#2a1c08' : '#5a4220'} strokeWidth={0.8} />
      </svg>
      <div className="flex flex-col items-start leading-none">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]">Sustain</span>
        <span className="text-[8.5px] uppercase tracking-wider opacity-80">{down ? 'pedal down' : 'pedal up'}</span>
      </div>
    </button>
  )
}

export function Editor(p: P) {
  const current = Math.max(0, Math.min(PATCHES.length - 1, Math.round(val(p, 'patch'))))
  const model = PATCHES[current]
  const [sounding, setSounding] = useState<SoundingKeys>({ held: [], sus: [] })
  useEffect(
    () =>
      p.onDSPMessage((msg) => {
        const m = msg as { type?: string; held?: number[]; sus?: number[] }
        if (m?.type === 'keys') setSounding({ held: m.held ?? [], sus: m.sus ?? [] })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onDSPMessage]
  )
  const persp = val(p, 'persp') >= 0.5
  const isEP = model.engine === 'ep'
  const step = (d: number) => p.loadPreset(PATCH_PRESETS[(current + d + PATCHES.length) % PATCHES.length])

  return (
    <div className="relative select-none overflow-hidden" style={{ width: W, height: H, background: `linear-gradient(180deg, ${T.lacquer1}, ${T.lacquer0} 60%)`, color: T.text }}>
      {/* walnut cheeks */}
      <div className="absolute left-0 top-0 h-full w-[7px]" style={{ background: `linear-gradient(90deg, ${T.wood1}, ${T.wood0} 60%, ${T.wood1})` }} />
      <div className="absolute right-0 top-0 h-full w-[7px]" style={{ background: `linear-gradient(90deg, ${T.wood1}, ${T.wood0} 40%, ${T.wood1})` }} />

      <div className="absolute inset-y-0 left-[7px] right-[7px] flex flex-col px-[6px] pt-[6px]">
        {/* header */}
        <div className="flex h-[38px] items-center gap-2.5">
          <div className="flex items-baseline gap-1.5" onMouseEnter={() => p.hint('Piano — modelled acoustic & electric pianos')}>
            <span style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontSize: 25, color: T.gold, letterSpacing: 0.5, textShadow: '0 1px 0 #000, 0 0 12px rgba(216,180,106,.25)' }}>Piano</span>
            <span className="text-[8px] uppercase tracking-[0.3em]" style={{ color: T.goldDim }}>
              Arkane
            </span>
          </div>
          <div className="flex h-[26px] flex-1 items-center gap-1 rounded-[4px] px-1" style={{ background: '#060505', border: `1px solid ${T.border}`, boxShadow: 'inset 0 1px 3px rgba(0,0,0,.8)' }}>
            <button className="h-[18px] w-[16px] rounded-[2px] text-[10px] hover:brightness-150" style={{ color: T.gold }} onClick={() => step(-1)} onMouseEnter={() => p.hint('Previous patch')}>
              ◀
            </button>
            <div className="flex flex-1 items-baseline gap-2 truncate px-1" onMouseEnter={() => p.hint(`Patch: ${model.name} — ${model.description}`)}>
              <span className="text-[13px] font-semibold" style={{ color: '#f3dfae' }}>
                {model.name}
              </span>
              <span className="text-[9px] uppercase tracking-[0.18em]" style={{ color: CAT_COLORS[model.category] }}>
                {model.category}
              </span>
            </div>
            <button className="h-[18px] w-[16px] rounded-[2px] text-[10px] hover:brightness-150" style={{ color: T.gold }} onClick={() => step(1)} onMouseEnter={() => p.hint('Next patch')}>
              ▶
            </button>
          </div>
          <HK p={p} id="tuning" caption="A4 Tune" />
          <HK p={p} id="volume" caption="Volume" />
          <PedalButton p={p} />
        </div>

        {/* body */}
        <div className="mt-[5px] flex gap-[6px]" style={{ height: BODY_H }}>
          <PatchBrowser p={p} current={current} />
          <div className="flex flex-1 flex-col gap-[5px]">
            <div className="flex gap-[5px]">
              <Box p={p} title="Tone" hint="Tone: hammer hardness, velocity response, lid opening and soundboard / cabinet resonance">
                <K p={p} id="bright" label="Bright" />
                <K p={p} id="dyn" label="Dynamic" />
                <K p={p} id="lid" label={isEP ? 'Tone' : 'Lid'} />
                <K p={p} id="body" label={isEP ? 'Cabinet' : 'Body'} />
              </Box>
              <Box p={p} title="Character" className="flex-1" hint="Character: hammer / damper / pedal noise, string detune & age, tape wobble">
                <K p={p} id="mech" label="Noise" />
                <K p={p} id="detune" label="Detune" />
                <K p={p} id="tape" label="Tape" />
              </Box>
            </div>
            <div className="flex gap-[5px]">
              <Box p={p} title="Space" hint="Space: reverb amount and room size, stereo width and listening perspective">
                <K p={p} id="rev" label="Reverb" />
                <K p={p} id="revSize" label="Size" />
                <K p={p} id="width" label="Width" />
                <div className="ml-0.5 flex flex-col gap-[3px] pt-[2px]">
                  {(['Player', 'Audience'] as const).map((o, i) => (
                    <button
                      key={o}
                      onClick={() => p.setParam('persp', i)}
                      onMouseEnter={() => p.hint(`Perspective: ${o} — ${i === 0 ? 'bass on the left (pianist seat)' : 'bass on the right (audience view)'}`)}
                      className="h-[17px] w-[56px] rounded-[3px] text-[9px] font-semibold uppercase tracking-wide"
                      style={{
                        background: persp === (i === 1) ? 'rgba(216,180,106,.22)' : 'rgba(255,255,255,.03)',
                        color: persp === (i === 1) ? T.text : T.dim,
                        border: `1px solid ${persp === (i === 1) ? T.goldDim : T.border}`
                      }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </Box>
              <Box p={p} title={isEP ? 'Amp · Chorus / Trem' : 'Chorus / Trem · Pad'} className="flex-1" hint="Modulation: chorus, amp tremolo (auto-pan on tine EPs) and a soft pad layer">
                <K p={p} id="chorus" label="Chorus" color={isEP ? '#e9a35e' : T.gold} />
                <K p={p} id="trem" label="Trem" color={isEP ? '#e9a35e' : T.gold} />
                <K p={p} id="tremRate" label="Rate" color={isEP ? '#e9a35e' : T.gold} />
                <K p={p} id="pad" label="Pad" />
              </Box>
            </div>
            <div
              className="flex flex-1 items-center truncate rounded-[4px] px-2 text-[10px]"
              style={{ background: 'rgba(0,0,0,.3)', border: `1px solid ${T.border}`, color: T.dim }}
              onMouseEnter={() => p.hint(`${model.name} — ${model.description}`)}
            >
              <span className="mr-1.5 font-semibold" style={{ color: CAT_COLORS[model.category] }}>
                {model.category}
              </span>
              <span className="truncate">{model.description}</span>
            </div>
          </div>
        </div>

        {/* felt + keyboard */}
        <div className="mt-[6px] h-[5px] rounded-t-[2px]" style={{ background: `linear-gradient(${T.felt0}, ${T.felt1})`, boxShadow: '0 1px 2px rgba(0,0,0,.6)' }} />
        <Keyboard p={p} width={W - 14 - 12} height={H - 6 - 38 - 5 - BODY_H - 6 - 5 - 6} sounding={sounding} />
      </div>
    </div>
  )
}
