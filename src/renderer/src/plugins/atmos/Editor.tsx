import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PK, useHeldKeys } from '../sdk/ui'
import type { PluginEditorProps } from '../sdk/module'
import { formatParam } from '../sdk/params'
import { Viz, type VizState } from './Viz'

export const EDITOR_W = 820
export const EDITOR_H = 480

const C = {
  violet: '#9b88ff',
  teal: '#5fd4d0',
  rose: '#f08aa8',
  amber: '#f0b45a',
  sky: '#7fb8f0',
  green: '#8fe0a0'
}

// ─── small building blocks ────────────────────────────────────────────────────
function Panel({ title, accent, children, className, right, power }: { title: string; accent: string; children: React.ReactNode; className?: string; right?: React.ReactNode; power?: React.ReactNode }) {
  return (
    <div
      className={cn('relative flex flex-col rounded-[5px] border border-[#0d0f1a] px-2 pb-1.5 pt-1', className)}
      style={{ background: 'linear-gradient(180deg, rgba(40,38,66,0.92), rgba(24,24,40,0.94))', boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px ${accent}18` }}
    >
      <div className="mb-1 flex h-[16px] items-center gap-1.5">
        {power}
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ color: accent }}>
          {title}
        </span>
        <div className="ml-auto flex items-center gap-1">{right}</div>
      </div>
      {children}
    </div>
  )
}

function Power({ p, id, color }: { p: PluginEditorProps; id: string; color: string }) {
  const on = (p.instance.params[id] ?? 0) >= 0.5
  const def = p.manifest.params.find((d) => d.id === id)
  return (
    <button
      onClick={() => p.setParam(id, on ? 0 : 1)}
      onMouseEnter={() => p.hint(`${def?.name ?? id}: ${on ? 'On' : 'Off'}`)}
      className="h-[10px] w-[10px] rounded-full border border-[#0b0c14]"
      style={{ background: on ? color : '#2c2b40', boxShadow: on ? `0 0 6px ${color}` : 'inset 0 1px 1px rgba(0,0,0,.6)' }}
    />
  )
}

/** Compact dropdown for enumerated params. */
function Pick({ p, id, width = 96, label }: { p: PluginEditorProps; id: string; width?: number; label?: string }) {
  const def = p.manifest.params.find((d) => d.id === id)
  if (!def?.options) return null
  const v = Math.round(p.instance.params[id] ?? def.default)
  return (
    <label className="flex items-center gap-1" onMouseEnter={() => p.hint(`${def.name}: ${def.options![v]}`)}>
      {label && <span className="text-[9px] uppercase tracking-wide text-[#8d8aa8]">{label}</span>}
      <select
        value={v}
        onChange={(e) => p.setParam(id, Number(e.target.value))}
        className="h-[16px] cursor-pointer rounded-[3px] border border-[#0b0c14] bg-[#141424] px-1 text-[10px] text-[#d9d4ff] outline-none hover:bg-[#1c1c32]"
        style={{ width }}
      >
        {def.options.map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

function Tabs({ tabs, value, onChange, color }: { tabs: string[]; value: number; onChange: (i: number) => void; color: string }) {
  return (
    <div className="flex gap-px rounded-[3px] bg-[#0f0f1c] p-px">
      {tabs.map((t, i) => (
        <button
          key={t}
          onClick={() => onChange(i)}
          className="rounded-[2px] px-1.5 text-[9px] font-semibold uppercase leading-[13px] tracking-wide"
          style={i === value ? { background: color, color: '#14121f' } : { color: '#9a96b8' }}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex items-start justify-between gap-1', className)}>{children}</div>
}

/** Big macro knob with value readout. */
function Macro({ p, id, color, sub }: { p: PluginEditorProps; id: string; color: string; sub: string }) {
  const def = p.manifest.params.find((d) => d.id === id)!
  const v = p.instance.params[id] ?? def.default
  return (
    <div className="flex flex-col items-center" onMouseEnter={() => p.hint(`${def.name} macro (${sub}): ${formatParam(def, v)}`)}>
      <PK p={p} id={id} size={54} color={color} label=" " />
      <span className="-mt-2 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color }}>
        {def.name}
      </span>
      <span className="text-[9px] text-[#8d8aa8]">{sub}</span>
    </div>
  )
}

// ─── mini keyboard ────────────────────────────────────────────────────────────
const LO = 36
const HI = 84
const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(k % 12)

function Keyboard({ p, width }: { p: PluginEditorProps; width: number }) {
  const [held, setHeld] = useState<Set<number>>(new Set())
  const [latch, setLatch] = useState(false)
  const live = useHeldKeys(p)
  const lit = (k: number) => held.has(k) || live.has(k)
  const down = useRef<number | null>(null)
  const heldRef = useRef(held)
  heldRef.current = held
  const play = p.previewNote
  const on = useCallback(
    (k: number) => {
      play?.(k, 0.8, true)
      setHeld((s) => new Set(s).add(k))
    },
    [play]
  )
  const off = useCallback(
    (k: number) => {
      play?.(k, 0, false)
      setHeld((s) => {
        const n = new Set(s)
        n.delete(k)
        return n
      })
    },
    [play]
  )
  useEffect(() => {
    const up = () => {
      if (down.current !== null && !latch) off(down.current)
      down.current = null
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [latch, off])
  // release everything on unmount
  useEffect(() => () => heldRef.current.forEach((k) => play?.(k, 0, false)), [play])
  const whites: number[] = []
  for (let k = LO; k <= HI; k++) if (!isBlack(k)) whites.push(k)
  const ww = width / whites.length
  const press = (k: number) => {
    if (!play) return
    if (latch) {
      if (heldRef.current.has(k)) off(k)
      else on(k)
      return
    }
    down.current = k
    on(k)
  }
  const enter = (k: number) => {
    if (latch || down.current === null || down.current === k) return
    off(down.current)
    down.current = k
    on(k)
  }
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          if (latch) heldRef.current.forEach((k) => off(k))
          setLatch(!latch)
        }}
        onMouseEnter={() => p.hint('Hold: latch preview notes (click keys to toggle)')}
        className="h-[26px] rounded-[3px] border border-[#0b0c14] px-1.5 text-[9px] font-semibold uppercase tracking-wider"
        style={latch ? { background: C.violet, color: '#14121f' } : { background: '#1d1c30', color: '#9a96b8' }}
      >
        Hold
      </button>
      <div className="relative h-[26px] select-none" style={{ width }} onMouseEnter={() => p.hint('Preview keyboard')}>
        {whites.map((k, i) => (
          <div
            key={k}
            onMouseDown={() => press(k)}
            onMouseEnter={() => enter(k)}
            className="absolute top-0 h-full rounded-b-[2px] border-r border-[#2a2840]"
            style={{ left: i * ww, width: ww, background: lit(k) ? C.violet : k === 60 ? '#d8d4ec' : '#c8c5dc' }}
          />
        ))}
        {(() => {
          const out: React.ReactNode[] = []
          let wi = 0
          for (let k = LO; k <= HI; k++) {
            if (!isBlack(k)) {
              wi++
              continue
            }
            out.push(
              <div
                key={k}
                onMouseDown={() => press(k)}
                onMouseEnter={() => enter(k)}
                className="absolute top-0 z-10 rounded-b-[2px]"
                style={{ left: wi * ww - ww * 0.3, width: ww * 0.6, height: 16, background: lit(k) ? C.teal : '#1a1828' }}
              />
            )
          }
          return out
        })()}
      </div>
    </div>
  )
}

// ─── editor ───────────────────────────────────────────────────────────────────
export function Editor(p: PluginEditorProps) {
  const [envTab, setEnvTab] = useState(0)
  const [modTab, setModTab] = useState(0)
  const [fxTab, setFxTab] = useState(0)
  const viz = useRef<VizState>({ params: p.instance.params, dsp: { voices: 0, pos: -1, ev: 0, lfo1: 0, lfo2: 0, level: 0, t: 0 }, presetName: p.instance.presetName })
  viz.current.params = p.instance.params
  viz.current.presetName = p.instance.presetName

  const { onDSPMessage, postToDSP } = p
  useEffect(() => {
    postToDSP({ type: 'viz', on: true })
    const offMsg = onDSPMessage((m) => {
      const msg = m as { type?: string; voices: number; pos: number; ev: number; lfo1: number; lfo2: number; level: number }
      if (msg?.type !== 'viz') return
      viz.current.dsp = { voices: msg.voices, pos: msg.pos, ev: msg.ev, lfo1: msg.lfo1, lfo2: msg.lfo2, level: msg.level, t: performance.now() }
    })
    return () => {
      offMsg()
      postToDSP({ type: 'viz', on: false })
    }
  }, [onDSPMessage, postToDSP])

  const K = 28
  const lfoN = modTab + 1
  return (
    <div
      className="flex h-full w-full flex-col gap-[6px] p-[6px] text-[#d9d4ff] select-none"
      style={{ background: 'radial-gradient(120% 90% at 50% 0%, #2a2547 0%, #17162a 55%, #0e0d19 100%)' }}
    >
      {/* top: macros + visual */}
      <div className="flex gap-[6px]" style={{ height: 186 }}>
        <div className="flex w-[112px] flex-col items-center justify-around rounded-[5px] border border-[#0d0f1a] bg-[#151427]/80">
          <Macro p={p} id="macro.evolve" color={C.violet} sub="slow change" />
          <Macro p={p} id="macro.motion" color={C.teal} sub="animation" />
        </div>
        <div className="overflow-hidden rounded-[5px] border border-[#0d0f1a]" style={{ boxShadow: '0 0 18px rgba(120,100,255,0.12)' }}>
          <Viz state={viz} width={572} height={184} />
        </div>
        <div className="flex w-[112px] flex-col items-center justify-around rounded-[5px] border border-[#0d0f1a] bg-[#151427]/80">
          <Macro p={p} id="macro.space" color={C.sky} sub="reverb & delay" />
          <Macro p={p} id="macro.tone" color={C.amber} sub="dark ↔ bright" />
        </div>
      </div>

      {/* layers */}
      <div className="flex gap-[6px]" style={{ height: 112 }}>
        <Panel title="Wave" accent={C.violet} className="w-[300px]" power={<Power p={p} id="wave.on" color={C.violet} />} right={<Pick p={p} id="wave.table" width={110} />}>
          <Row>
            <PK p={p} id="wave.pos" size={K} color={C.violet} label="Pos" />
            <PK p={p} id="wave.level" size={K} color={C.violet} label="Level" />
            <PK p={p} id="wave.unison" size={K} color={C.violet} label="Unison" />
            <PK p={p} id="wave.detune" size={K} color={C.violet} label="Detune" />
            <PK p={p} id="wave.spread" size={K} color={C.violet} label="Spread" />
          </Row>
          <Row className="mt-1">
            <PK p={p} id="wave.envAmt" size={K} color={C.violet} label="Pos Env" />
            <PK p={p} id="wave.sub" size={K} color={C.violet} label="Sub" />
            <PK p={p} id="wave.octave" size={K} color={C.violet} label="Oct" />
            <PK p={p} id="wave.semi" size={K} color={C.violet} label="Semi" />
            <div style={{ width: K }} />
          </Row>
        </Panel>
        <Panel title="Grain" accent={C.teal} className="w-[318px]" power={<Power p={p} id="gran.on" color={C.teal} />} right={<Pick p={p} id="gran.texture" width={110} />}>
          <Row>
            <PK p={p} id="gran.pos" size={K} color={C.teal} label="Pos" />
            <PK p={p} id="gran.level" size={K} color={C.teal} label="Level" />
            <PK p={p} id="gran.size" size={K} color={C.teal} label="Size" />
            <PK p={p} id="gran.density" size={K} color={C.teal} label="Density" />
            <PK p={p} id="gran.spray" size={K} color={C.teal} label="Spray" />
            <PK p={p} id="gran.scan" size={K} color={C.teal} label="Scan" />
          </Row>
          <Row className="mt-1">
            <PK p={p} id="gran.pitchRand" size={K} color={C.teal} label="P.Rnd" />
            <PK p={p} id="gran.reverse" size={K} color={C.teal} label="Rev" />
            <PK p={p} id="gran.shimmer" size={K} color={C.teal} label="Oct Up" />
            <PK p={p} id="gran.octave" size={K} color={C.teal} label="Oct" />
            <PK p={p} id="gran.width" size={K} color={C.teal} label="Width" />
            <PK p={p} id="gran.keytrack" size={K} color={C.teal} label="Key" />
          </Row>
        </Panel>
        <Panel title="Air" accent={C.green} className="flex-1" power={<Power p={p} id="noise.on" color={C.green} />} right={<Pick p={p} id="noise.bank" width={78} />}>
          <Row>
            <PK p={p} id="noise.level" size={K} color={C.green} label="Level" />
            <PK p={p} id="noise.color" size={K} color={C.green} label="Color" />
            <PK p={p} id="noise.tune" size={K} color={C.green} label="Tuned" />
          </Row>
          <Row className="mt-1">
            <PK p={p} id="noise.q" size={K} color={C.green} label="Reso" />
            <PK p={p} id="noise.octave" size={K} color={C.green} label="Oct" />
            <div style={{ width: K }} />
          </Row>
        </Panel>
      </div>

      {/* filter / env / mod / fx */}
      <div className="flex gap-[6px]" style={{ height: 112 }}>
        <Panel title="Filter" accent={C.rose} className="w-[164px]" right={<Pick p={p} id="filter.mode" width={64} />}>
          <Row>
            <PK p={p} id="filter.cutoff" size={34} color={C.rose} label="Cutoff" />
            <PK p={p} id="filter.res" size={K} color={C.rose} label="Reso" />
            <PK p={p} id="filter.envAmt" size={K} color={C.rose} label="Env" />
          </Row>
          <Row className="mt-0.5 justify-start gap-3">
            <PK p={p} id="filter.keytrack" size={24} color={C.rose} label="Key" />
            <PK p={p} id="filter.vowel" size={24} color={C.rose} label="Vowel" />
          </Row>
        </Panel>
        <Panel title="Env" accent={C.amber} className="w-[206px]" right={<Tabs tabs={['Amp', 'Mod']} value={envTab} onChange={setEnvTab} color={C.amber} />}>
          {envTab === 0 ? (
            <>
              <Row>
                <PK p={p} id="amp.attack" size={K} color={C.amber} label="Att" />
                <PK p={p} id="amp.decay" size={K} color={C.amber} label="Dec" />
                <PK p={p} id="amp.sustain" size={K} color={C.amber} label="Sus" />
                <PK p={p} id="amp.release" size={K} color={C.amber} label="Rel" />
              </Row>
              <Row className="mt-1 justify-start">
                <PK p={p} id="amp.velSens" size={24} color={C.amber} label="Vel" />
              </Row>
            </>
          ) : (
            <>
              <Row>
                <PK p={p} id="fenv.attack" size={K} color={C.amber} label="Att" />
                <PK p={p} id="fenv.decay" size={K} color={C.amber} label="Dec" />
                <PK p={p} id="fenv.sustain" size={K} color={C.amber} label="Sus" />
                <PK p={p} id="fenv.release" size={K} color={C.amber} label="Rel" />
              </Row>
              <Row className="mt-1 justify-start gap-2">
                <PK p={p} id="fenv.pitch" size={24} color={C.amber} label="Pitch" />
                <span className="self-center text-[9px] leading-tight text-[#8d8aa8]">→ cutoff (Filter Env),
                  <br />position (Pos Env), pitch</span>
              </Row>
            </>
          )}
        </Panel>
        <Panel title="Mod" accent={C.sky} className="w-[190px]" right={<Tabs tabs={['LFO 1', 'LFO 2', 'Drift']} value={modTab} onChange={setModTab} color={C.sky} />}>
          {modTab < 2 ? (
            <>
              <Row>
                <PK p={p} id={`lfo${lfoN}.rate`} size={K} color={C.sky} label="Rate" />
                <PK p={p} id={`lfo${lfoN}.depth`} size={K} color={C.sky} label="Depth" />
                <div className="flex flex-col gap-1 pt-0.5">
                  <Pick p={p} id={`lfo${lfoN}.shape`} width={72} />
                  <Pick p={p} id={`lfo${lfoN}.dest`} width={72} />
                </div>
              </Row>
              <div className="mt-1 text-[9px] leading-tight text-[#8d8aa8]">Motion macro scales LFO speed & depth.</div>
            </>
          ) : (
            <>
              <Row>
                <PK p={p} id="drift.amount" size={K} color={C.sky} label="Drift" />
                <PK p={p} id="drift.rate" size={K} color={C.sky} label="Rate" />
                <PK p={p} id="evolve.rate" size={K} color={C.violet} label="Evo Rate" />
              </Row>
              <div className="mt-1 text-[9px] leading-tight text-[#8d8aa8]">Per-voice random wander; Evolve macro sets depth.</div>
            </>
          )}
        </Panel>
        <Panel title="FX" accent={C.sky} className="flex-1" right={<Tabs tabs={['Verb', 'Delay', 'Chorus', 'Out']} value={fxTab} onChange={setFxTab} color={C.sky} />}>
          {fxTab === 0 && (
            <>
              <Row>
                <PK p={p} id="fx.reverb" size={K} color={C.sky} label="Mix" />
                <PK p={p} id="fx.revDecay" size={K} color={C.sky} label="Decay" />
                <PK p={p} id="fx.revSize" size={K} color={C.sky} label="Size" />
                <PK p={p} id="fx.revDamp" size={K} color={C.sky} label="Damp" />
                <PK p={p} id="fx.revMod" size={K} color={C.sky} label="Mod" />
              </Row>
              <Row className="mt-1 items-center">
                <PK p={p} id="fx.shimmer" size={24} color={C.violet} label="Shimmer" />
                <Pick p={p} id="fx.shimInterval" width={66} />
                <PK p={p} id="fx.predelay" size={24} color={C.sky} label="Pre" />
                <Freeze p={p} />
              </Row>
            </>
          )}
          {fxTab === 1 && (
            <Row>
              <PK p={p} id="fx.delay" size={K} color={C.sky} label="Mix" />
              <PK p={p} id="fx.delayTime" size={K} color={C.sky} label="Time" />
              <PK p={p} id="fx.delayFb" size={K} color={C.sky} label="Feedbk" />
              <div style={{ width: 60 }} className="self-center text-[9px] leading-tight text-[#8d8aa8]">Ping-pong, damped repeats</div>
            </Row>
          )}
          {fxTab === 2 && (
            <Row>
              <PK p={p} id="fx.chorus" size={K} color={C.sky} label="Mix" />
              <PK p={p} id="fx.chorusRate" size={K} color={C.sky} label="Rate" />
              <PK p={p} id="fx.chorusDepth" size={K} color={C.sky} label="Depth" />
              <div style={{ width: 60 }} className="self-center text-[9px] leading-tight text-[#8d8aa8]">3-voice ensemble</div>
            </Row>
          )}
          {fxTab === 3 && (
            <Row>
              <PK p={p} id="fx.drive" size={K} color={C.rose} label="Drive" />
              <PK p={p} id="fx.width" size={K} color={C.sky} label="Width" />
              <PK p={p} id="master.gain" size={K} color={C.amber} label="Volume" />
              <div style={{ width: 40 }} />
            </Row>
          )}
        </Panel>
      </div>

      {/* keyboard */}
      <div className="flex items-center justify-between rounded-[5px] border border-[#0d0f1a] bg-[#121122] px-2" style={{ height: 34 }}>
        <Keyboard p={p} width={700} />
        <div className="text-right text-[9px] leading-tight text-[#6f6b8c]">
          16 voices
          <br />
          {p.manifest.presets?.length ?? 0} presets
        </div>
      </div>
    </div>
  )
}

function Freeze({ p }: { p: PluginEditorProps }) {
  const on = (p.instance.params['fx.freeze'] ?? 0) >= 0.5
  return (
    <button
      onClick={() => p.setParam('fx.freeze', on ? 0 : 1)}
      onMouseEnter={() => p.hint(`Freeze (infinite hold): ${on ? 'On' : 'Off'}`)}
      className="h-[18px] rounded-[3px] border border-[#0b0c14] px-1.5 text-[9px] font-semibold uppercase tracking-wider"
      style={on ? { background: '#9fdcff', color: '#10202c', boxShadow: '0 0 8px #9fdcff' } : { background: '#1d1c30', color: '#9a96b8' }}
    >
      Freeze
    </button>
  )
}
