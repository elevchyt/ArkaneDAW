// Hexa editor: DX7-inspired panel (maroon body, green LCD, membrane-style buttons) inside the FL plugin frame.
import { useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ParamKnob } from '@/components/controls'
import type { PluginEditorProps } from '../sdk/module'
import type { Preset } from '../sdk/types'
import { FACTORY_PRESETS } from './manifest'
import { FACTORY } from './factory'
import { ALGORITHMS, bpToNote, noteName } from './tables'
import { MASTER_IDS, paramsToVoice, voiceName } from './voice'
import { cartVoices, exportCart, exportVoice, newCart, readData, readSysexFile, voicePreset, type HexaData } from './cart'
import { AlgoDiagram, C, CURVE_SHORT, CycleCell, EnvGraph, MiniKeys, NumCell, Wheel, def, val } from './widgets'

type P = PluginEditorProps

function Box({ title, children, className, style, right }: { title?: string; children: React.ReactNode; className?: string; style?: React.CSSProperties; right?: React.ReactNode }) {
  return (
    <div className={cn('rounded-[4px] p-1.5', className)} style={{ background: C.section, border: `1px solid ${C.border}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05)', ...style }}>
      {(title || right) && (
        <div className="mb-1 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: C.label }}>
          <span>{title}</span>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

/** Membrane-style DX7 button. */
function Btn({ children, onClick, active, title, color, className, hint, p }: { children: React.ReactNode; onClick: () => void; active?: boolean; title?: string; color?: string; className?: string; hint?: string; p: P }) {
  return (
    <button
      title={title}
      onClick={onClick}
      onMouseEnter={() => hint && p.hint(hint)}
      className={cn('h-[18px] rounded-[2px] px-1.5 text-[9.5px] font-semibold uppercase tracking-wide hover:brightness-125 active:brightness-90', className)}
      style={{
        background: active ? (color ?? C.global) : '#6d3b33',
        color: active ? '#1a0d0b' : '#f2dccd',
        border: `1px solid ${C.border}`,
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12)'
      }}
    >
      {children}
    </button>
  )
}

function K({ p, id, size = 22, label, color = C.op }: { p: P; id: string; size?: number; label?: string; color?: string }) {
  const d = def(p, id)
  if (!d) return null
  return (
    <ParamKnob
      def={d}
      value={val(p, id)}
      onChange={(v) => p.setParam(id, v)}
      size={size}
      color={color}
      label={label}
      labelPosition={label ? 'below' : 'none'}
    />
  )
}

function Toggle({ p, id, on, off, color = C.global }: { p: P; id: string; on: string; off: string; color?: string }) {
  const v = val(p, id) >= 0.5
  const d = def(p, id)
  return (
    <Btn p={p} active={v} color={color} onClick={() => p.setParam(id, v ? 0 : 1)} hint={`${d?.name}: ${v ? on : off}`}>
      {v ? on : off}
    </Btn>
  )
}

const pad2 = (n: number) => String(n).padStart(2, '0')

function freqText(p: P, n: number): string {
  const coarse = val(p, `op${n}.coarse`)
  const fine = val(p, `op${n}.fine`)
  if (val(p, `op${n}.mode`) >= 0.5) {
    const hz = Math.pow(10, (coarse & 3) + fine / 100)
    return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)}kHz` : `${hz.toFixed(hz >= 100 ? 0 : hz >= 10 ? 1 : 2)}Hz`
  }
  return `×${((coarse === 0 ? 0.5 : coarse) * (1 + fine / 100)).toFixed(2)}`
}

// ─── operator table ──────────────────────────────────────────────────────────

const COLS: [string, number][] = [
  ['OP', 44], ['MODE', 30], ['FREQ', 50], ['CRS', 24], ['FINE', 24], ['DET', 24], ['LEVEL', 30], ['ENVELOPE (drag)', 150],
  ['RATE / LEVEL', 88], ['BRK PT', 32], ['L SCALE', 32], ['R SCALE', 32], ['RS', 24], ['AMS', 24], ['VEL', 24]
]

function OpRow({ p, n, carrier }: { p: P; n: number; carrier: boolean }) {
  const on = val(p, `op${n}.on`) >= 0.5
  const fixed = val(p, `op${n}.mode`) >= 0.5
  const id = (k: string) => `op${n}.${k}`
  return (
    <div className={cn('flex items-center gap-1 rounded-[3px] px-1', !on && 'opacity-45')} style={{ height: 35, background: n % 2 ? 'rgba(0,0,0,.12)' : 'rgba(0,0,0,.2)' }}>
      <div style={{ width: COLS[0][1] }} className="flex items-center gap-1">
        <button
          onClick={() => p.setParam(id('on'), on ? 0 : 1)}
          onMouseEnter={() => p.hint(`OP${n}: ${on ? 'On' : 'Off'} (click to toggle)`)}
          className="h-2.5 w-2.5 rounded-full border border-[#140806]"
          style={{ background: on ? '#ff6b4a' : '#4a2420', boxShadow: on ? '0 0 6px #ff6b4a' : undefined }}
        />
        <span className="font-mono text-[15px] font-bold" style={{ color: carrier ? C.global : C.op }}>
          {n}
        </span>
        <span className="text-[8px]" style={{ color: C.dim }}>
          {carrier ? 'CAR' : 'MOD'}
        </span>
      </div>
      <div style={{ width: COLS[1][1] }}>
        <Btn p={p} active={fixed} color={C.op} onClick={() => p.setParam(id('mode'), fixed ? 0 : 1)} hint={`OP${n} Osc Mode: ${fixed ? 'Fixed' : 'Ratio'}`} className="w-full px-0">
          {fixed ? 'FIX' : 'RAT'}
        </Btn>
      </div>
      <div style={{ width: COLS[2][1] }} className="font-mono text-[10px] tabular-nums" onMouseEnter={() => p.hint(`OP${n} frequency: ${freqText(p, n)}`)}>
        <span style={{ color: '#f3c99a' }}>{freqText(p, n)}</span>
      </div>
      <div style={{ width: COLS[3][1] }}><K p={p} id={id('coarse')} /></div>
      <div style={{ width: COLS[4][1] }}><K p={p} id={id('fine')} /></div>
      <div style={{ width: COLS[5][1] }}><K p={p} id={id('det')} /></div>
      <div style={{ width: COLS[6][1] }}><K p={p} id={id('ol')} size={28} color={carrier ? C.global : C.op} /></div>
      <div style={{ width: COLS[7][1] }}><EnvGraph p={p} prefix={`op${n}`} width={150} height={31} color={carrier ? C.global : C.op} /></div>
      <div style={{ width: COLS[8][1] }} className="flex flex-col gap-px">
        <div className="flex gap-px">{[1, 2, 3, 4].map((i) => <NumCell key={i} p={p} id={id(`r${i}`)} width={21} />)}</div>
        <div className="flex gap-px">{[1, 2, 3, 4].map((i) => <NumCell key={i} p={p} id={id(`l${i}`)} width={21} className="!text-[#9fe0d4]" />)}</div>
      </div>
      <div style={{ width: COLS[9][1] }}>
        <NumCell p={p} id={id('bp')} width={30} format={(v) => noteName(bpToNote(v))} />
      </div>
      <div style={{ width: COLS[10][1] }} className="flex flex-col gap-px">
        <NumCell p={p} id={id('ld')} width={30} />
        <CycleCell p={p} id={id('lc')} width={30} labels={CURVE_SHORT} />
      </div>
      <div style={{ width: COLS[11][1] }} className="flex flex-col gap-px">
        <NumCell p={p} id={id('rd')} width={30} />
        <CycleCell p={p} id={id('rc')} width={30} labels={CURVE_SHORT} />
      </div>
      <div style={{ width: COLS[12][1] }}><K p={p} id={id('rs')} size={20} /></div>
      <div style={{ width: COLS[13][1] }}><K p={p} id={id('ams')} size={20} /></div>
      <div style={{ width: COLS[14][1] }}><K p={p} id={id('kvs')} size={20} /></div>
    </div>
  )
}

// ─── editor ──────────────────────────────────────────────────────────────────

export function Editor(p: P) {
  const data = readData(p.instance.data)
  const voices = cartVoices(data)
  const params = p.instance.params
  const name = p.instance.presetName ?? FACTORY_PRESETS[0].name
  const [view, setView] = useState<'voice' | 'cart'>('voice')
  const [src, setSrc] = useState<'cart' | 'factory'>(voices ? 'cart' : 'factory')
  const [status, setStatus] = useState('')
  const [renaming, setRenaming] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const algo = Math.round(val(p, 'algo')) - 1
  const alg = ALGORITHMS[algo] ?? ALGORITHMS[0]
  const opOn = [1, 2, 3, 4, 5, 6].map((n) => val(p, `op${n}.on`) >= 0.5)

  // Where does the current voice come from?
  const inCart = !!voices && voiceName(voices[data.cartIndex]) === name.trimEnd()
  const facIdx = FACTORY_PRESETS.findIndex((x) => x.name === name)
  const current = useMemo(() => paramsToVoice(params, name), [params, name])
  const source = inCart ? voices![data.cartIndex] : facIdx >= 0 ? FACTORY[facIdx].voice : null
  const edited = !!source && current.some((b, i) => b !== source[i])
  const slot = inCart ? `CRT ${pad2(data.cartIndex + 1)}` : facIdx >= 0 ? `INT ${pad2(facIdx + 1)}` : 'VOICE '

  const keepMasters = (): Record<string, number> => {
    const keep: Record<string, number> = {}
    for (const id of MASTER_IDS) if (params[id] !== undefined) keep[id] = params[id]
    return keep
  }
  const loadFactory = (i: number) => {
    const pr = FACTORY_PRESETS[(i + FACTORY_PRESETS.length) % FACTORY_PRESETS.length]
    p.loadPreset({ name: pr.name, category: pr.category, params: { ...keepMasters(), ...pr.params } })
  }
  const loadCart = (i: number, d: HexaData = data, vs = voices) => {
    if (!vs) return
    const k = (i + 32) % 32
    p.loadPreset(voicePreset(vs[k], params, { ...d, cartIndex: k }))
  }
  const step = (dir: number) => {
    if (voices && (inCart || (facIdx < 0 && src === 'cart'))) loadCart(data.cartIndex + dir)
    else loadFactory((facIdx < 0 ? 0 : facIdx) + dir)
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const r = await readSysexFile(file)
      const warn = r.checksumOk ? '' : ' (checksum mismatch – loaded anyway)'
      if (r.kind === 'bulk') {
        const cart = newCart(file.name.replace(/\.syx$/i, ''), r.voices)
        const d: HexaData = { cartIndex: 0, cart }
        setSrc('cart')
        setView('cart')
        loadCart(0, d, r.voices)
        setStatus(`Loaded cartridge "${cart!.name}"${warn}`)
      } else {
        p.loadPreset(voicePreset(r.voice, params))
        setStatus(`Loaded voice "${r.name}"${warn}`)
      }
    } catch (err) {
      setStatus(String((err as Error).message ?? err))
    }
  }

  const store = () => {
    const vs: Uint8Array[] = (voices ?? FACTORY.slice(0, 32).map((f) => f.voice)).map((v) => v.slice())
    const idx = voices ? data.cartIndex : 0
    vs[idx] = current
    const cart = newCart(data.cart?.name ?? 'USER CART', vs)
    p.setData({ ...data, cart, cartIndex: idx })
    setSrc('cart')
    setStatus(`Stored "${voiceName(current)}" to cartridge slot ${idx + 1}`)
  }

  const rename = (nm: string) => {
    setRenaming(false)
    const n = nm.toUpperCase().slice(0, 10).trim()
    if (!n) return
    const pr: Preset = { name: n, params: { ...params } }
    p.loadPreset(pr)
  }

  const lcdName = name.slice(0, 10)

  return (
    <div className="relative flex h-full w-full select-none flex-col gap-1.5 p-1.5 text-[10px]" style={{ background: C.panel, color: '#f2dccd' }}>
      <input ref={fileRef} type="file" accept=".syx,.SYX,application/octet-stream" className="hidden" onChange={onFile} />
      {/* ── header ── */}
      <div className="flex gap-1.5" style={{ height: 112 }}>
        <Box className="flex flex-col gap-1" style={{ width: 268 }}>
          <div
            className="relative rounded-[3px] px-2 py-1 font-mono"
            style={{ background: C.lcdBg, color: C.lcdText, boxShadow: 'inset 0 2px 4px rgba(0,0,0,.45), 0 0 0 2px #1a0b09', height: 48 }}
            onMouseEnter={() => p.hint('Voice display — double-click the name to rename')}
          >
            <div className="flex justify-between text-[11px] font-bold leading-[14px]">
              <span>{slot}{edited ? '*' : ' '}</span>
              <span>ALG {pad2(algo + 1)} FB {val(p, 'fb')}</span>
            </div>
            {renaming ? (
              <input
                autoFocus
                defaultValue={lcdName}
                maxLength={10}
                onBlur={(e) => rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename((e.target as HTMLInputElement).value)
                  if (e.key === 'Escape') setRenaming(false)
                  e.stopPropagation()
                }}
                className="w-full bg-transparent font-mono text-[20px] font-bold uppercase leading-[26px] outline-none"
                style={{ color: C.lcdText }}
              />
            ) : (
              <div className="cursor-text text-[20px] font-bold leading-[26px] tracking-[0.12em]" onDoubleClick={() => setRenaming(true)}>
                {lcdName.padEnd(10, ' ')}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Btn p={p} onClick={() => step(-1)} hint="Previous voice">◀</Btn>
            <Btn p={p} onClick={() => step(1)} hint="Next voice">▶</Btn>
            <Btn p={p} onClick={() => fileRef.current?.click()} hint="Load a DX7 .syx cartridge (32 voices) or single voice">Load cart…</Btn>
            <Btn p={p} onClick={store} hint="Store the current voice into the selected cartridge slot (creates a user cartridge if none)">Store</Btn>
          </div>
          <div className="flex items-center gap-1">
            <Btn p={p} onClick={() => exportVoice(current)} hint="Export the current voice as a DX7 single-voice .syx">Exp voice</Btn>
            <Btn
              p={p}
              onClick={() => (voices ? exportCart(voices, data.cart?.name ?? 'cart') : exportCart(FACTORY.slice(0, 32).map((f) => f.voice), 'HEXA FACTORY'))}
              hint={voices ? 'Export the loaded cartridge as a 32-voice .syx' : 'Export factory voices 1–32 as a 32-voice .syx'}
            >
              Exp cart
            </Btn>
            <div className="ml-auto flex gap-px">
              <Btn p={p} active={view === 'voice'} onClick={() => setView('voice')} hint="Voice editor">Voice</Btn>
              <Btn p={p} active={view === 'cart'} onClick={() => setView('cart')} hint="Cartridge / factory voice browser">Cart</Btn>
            </div>
          </div>
        </Box>
        <Box title="Algorithm" style={{ width: 236 }} right={<span style={{ color: C.dim }}>{alg.carriers.filter(Boolean).length} carriers</span>}>
          <div className="flex items-start gap-1">
            <AlgoDiagram algo={algo} opOn={opOn} fb={val(p, 'fb')} width={168} height={86} onOpClick={(op) => p.setParam(`op${op + 1}.on`, opOn[op] ? 0 : 1)} />
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-0.5">
                <Btn p={p} className="px-1" onClick={() => p.setParam('algo', algo === 0 ? 32 : algo)} hint="Previous algorithm">◀</Btn>
                <Btn p={p} className="px-1" onClick={() => p.setParam('algo', algo === 31 ? 1 : algo + 2)} hint="Next algorithm">▶</Btn>
              </div>
              <NumCell p={p} id="algo" width={40} />
              <K p={p} id="fb" size={26} label="FB" color={C.global} />
            </div>
          </div>
        </Box>
        <Box title="Global" className="flex-1">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <K p={p} id="transpose" size={26} label="Trans" color={C.global} />
            <K p={p} id="master.gain" size={26} label="Vol" color={C.global} />
            <K p={p} id="master.porta" size={26} label="Porta" color={C.global} />
            <K p={p} id="master.bendRange" size={26} label="PB Rng" color={C.global} />
            <div className="flex flex-col gap-1">
              <Toggle p={p} id="master.vintage" on="Vintage" off="Clean" color={C.op} />
              <Toggle p={p} id="master.mono" on="Mono" off="Poly" />
            </div>
            <div className="flex flex-col gap-1">
              <Toggle p={p} id="master.poly" on="32 voc" off="16 voc" />
              <Toggle p={p} id="oks" on="Key sync" off="Free run" />
            </div>
          </div>
        </Box>
      </div>

      {/* ── middle: operators or cartridge browser ── */}
      {view === 'voice' ? (
        <Box className="flex flex-col gap-[3px]" style={{ height: 256 }}>
          <div className="flex gap-1 px-1 text-[8.5px] font-semibold uppercase tracking-wider" style={{ color: C.dim }}>
            {COLS.map(([t, w]) => (
              <div key={t} style={{ width: w }} className="truncate">
                {t}
              </div>
            ))}
          </div>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <OpRow key={n} p={p} n={n} carrier={alg.carriers[n - 1]} />
          ))}
        </Box>
      ) : (
        <Box
          style={{ height: 256 }}
          title={src === 'cart' ? `Cartridge: ${data.cart?.name ?? '(none loaded)'}` : 'Factory voices'}
          right={
            <div className="flex gap-px normal-case tracking-normal">
              <Btn p={p} active={src === 'cart'} onClick={() => setSrc('cart')} hint="Loaded cartridge">Cartridge</Btn>
              <Btn p={p} active={src === 'factory'} onClick={() => setSrc('factory')} hint="Hexa factory bank">Factory</Btn>
            </div>
          }
        >
          {src === 'cart' && !voices ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2" style={{ color: C.dim }}>
              <div>No cartridge loaded. Load a DX7 32-voice bulk dump (.syx, 4104 bytes) or a single voice.</div>
              <Btn p={p} onClick={() => fileRef.current?.click()}>Load cart…</Btn>
            </div>
          ) : (
            <div className="grid grid-flow-col gap-x-1 gap-y-px" style={{ gridTemplateRows: `repeat(${src === 'cart' ? 8 : 10}, minmax(0, 1fr))`, gridTemplateColumns: 'repeat(4, minmax(0,1fr))', height: 218 }}>
              {(src === 'cart' ? voices!.map((v) => voiceName(v)) : FACTORY_PRESETS.map((x) => x.name)).map((nm, i) => {
                const sel = src === 'cart' ? inCart && data.cartIndex === i : facIdx === i
                return (
                  <button
                    key={i}
                    onClick={() => (src === 'cart' ? loadCart(i) : loadFactory(i))}
                    onMouseEnter={() => p.hint(`${src === 'cart' ? 'Cartridge' : 'Factory'} voice ${i + 1}: ${nm}`)}
                    className="flex items-center gap-1.5 rounded-[2px] px-1.5 text-left font-mono text-[11px] hover:brightness-125"
                    style={{ background: sel ? C.lcdBg : 'rgba(0,0,0,.25)', color: sel ? C.lcdText : '#f2dccd', border: `1px solid ${C.border}` }}
                  >
                    <span style={{ color: sel ? C.lcdText : C.dim }}>{pad2(i + 1)}</span>
                    <span className="truncate">{nm || '—'}</span>
                    {src === 'factory' && <span className="ml-auto text-[8.5px]" style={{ color: sel ? C.lcdText : C.dim }}>{FACTORY_PRESETS[i].category}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </Box>
      )}

      {/* ── bottom: pitch EG, LFO, controllers, keyboard ── */}
      <div className="flex min-h-0 flex-1 gap-1.5">
        <Box title="Pitch EG" style={{ width: 214 }}>
          <div className="flex gap-1.5">
            <EnvGraph p={p} prefix="peg" width={110} height={64} color={C.global} pitch />
            <div className="flex flex-col gap-px">
              <span className="text-[8.5px]" style={{ color: C.dim }}>RATE</span>
              <div className="grid grid-cols-2 gap-px">{[1, 2, 3, 4].map((i) => <NumCell key={i} p={p} id={`peg.r${i}`} width={21} />)}</div>
              <span className="text-[8.5px]" style={{ color: C.dim }}>LEVEL</span>
              <div className="grid grid-cols-2 gap-px">{[1, 2, 3, 4].map((i) => <NumCell key={i} p={p} id={`peg.l${i}`} width={21} className="!text-[#9fe0d4]" />)}</div>
            </div>
          </div>
        </Box>
        <Box title="LFO" style={{ width: 236 }} right={<div className="flex gap-1 normal-case tracking-normal"><CycleCell p={p} id="lfo.wave" width={58} /><Toggle p={p} id="lfo.sync" on="Sync" off="Free" /></div>}>
          <div className="flex gap-1.5">
            <K p={p} id="lfo.speed" size={26} label="Speed" color={C.global} />
            <K p={p} id="lfo.delay" size={26} label="Delay" color={C.global} />
            <K p={p} id="lfo.pmd" size={26} label="PMD" color={C.global} />
            <K p={p} id="lfo.amd" size={26} label="AMD" color={C.global} />
            <K p={p} id="lfo.pms" size={26} label="PMS" color={C.global} />
          </div>
        </Box>
        <Box title="Wheels" style={{ width: 128 }}>
          <div className="flex gap-1.5">
            <Wheel p={p} id="master.bend" spring label="Bend" />
            <Wheel p={p} id="mw.wheel" label="Mod" />
            <div className="flex flex-col items-center gap-1">
              <K p={p} id="mw.range" size={24} label="Range" color={C.global} />
              <CycleCell p={p} id="mw.dest" width={44} />
            </div>
          </div>
        </Box>
        <Box title="Keyboard" className="flex-1">
          <MiniKeys p={p} low={48} octaves={3} width={236} height={64} />
        </Box>
      </div>
      {status && (
        <div className="pointer-events-none absolute bottom-2 left-3 rounded-[2px] px-2 py-0.5 text-[10px]" style={{ background: '#1a0d0bdd', color: '#f3c99a' }}>
          {status}
        </div>
      )}
    </div>
  )
}
