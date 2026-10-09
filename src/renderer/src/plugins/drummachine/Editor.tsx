import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ParamKnob } from '@/components/controls'
import type { PluginEditorProps } from '../sdk/module'
import type { ParamDef } from '../sdk/types'
import { PK, PSelect, PluginPanel, Section } from '../sdk/ui'
import { BANK_A, BANK_B, DEFAULT_CHOKE, ROLE_BY_KEY } from './keymap'
import { KITS, KIT_BY_ID, getTweak, readData, withTweak, type PadTweak } from './data'
import { resolveKit } from './kits'
import { GROOVES, grooveNotes } from './grooves'

// ─── per-kit faceplate styling ────────────────────────────────────────────────

interface KitStyle {
  plate: string
  text: string
  accent: string
  pads: string[]
  padText?: string
  font?: React.CSSProperties
}

const S808: KitStyle = {
  plate: 'linear-gradient(180deg,#3a3634 0%,#262321 100%)',
  text: '#efe6d0',
  accent: '#f28a2e',
  pads: ['#e8412c', '#f28a2e', '#f2d03b', '#efe6d0'],
  padText: '#1d1a17',
  font: { fontStyle: 'italic', fontWeight: 800, letterSpacing: '-0.02em' }
}

const STYLES: Record<string, KitStyle> = {
  '808': S808,
  '909': { plate: 'linear-gradient(180deg,#c3c6c9,#8e9297)', text: '#1f2326', accent: '#f26b1d', pads: ['#d9dcdf', '#c6c9cc', '#f26b1d', '#d9dcdf'], padText: '#1f2326', font: { fontWeight: 800, letterSpacing: '0.04em' } },
  '606': { plate: 'linear-gradient(180deg,#b8bcc0,#7d8287)', text: '#141414', accent: '#d8322a', pads: ['#2a2a2a', '#3a3a3a', '#d8322a', '#2a2a2a'], padText: '#eee', font: { fontWeight: 700, letterSpacing: '0.12em' } },
  'CR-78': { plate: 'linear-gradient(180deg,#7a4a2a,#4e2d18)', text: '#f3e3c3', accent: '#e39b3d', pads: ['#efe0bf', '#e3c99a', '#e39b3d', '#efe0bf'], padText: '#3b2412', font: { fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700 } },
  Simmons: { plate: 'linear-gradient(180deg,#151515,#050505)', text: '#f5f5f5', accent: '#d62828', pads: ['#d62828', '#1f1f1f', '#2a2a2a', '#d62828'], padText: '#fff', font: { fontWeight: 900, letterSpacing: '0.2em' } },
  Linn: { plate: 'linear-gradient(180deg,#232323,#111)', text: '#e9e2d0', accent: '#e05a2b', pads: ['#e9e2d0', '#d9cfb8', '#e05a2b', '#3a6ea5'], padText: '#1a1a1a', font: { fontWeight: 800, fontStyle: 'italic' } },
  'LM-1': { plate: 'linear-gradient(180deg,#5a3f2d,#3a281c)', text: '#f0e2c8', accent: '#d9a441', pads: ['#efe2c6', '#d9c6a0', '#d9a441', '#efe2c6'], padText: '#2a1d12', font: { fontWeight: 700, letterSpacing: '0.08em' } },
  DMX: { plate: 'linear-gradient(180deg,#1a1d20,#0c0d0e)', text: '#dfe6ec', accent: '#4fa3d9', pads: ['#2b3238', '#3a434b', '#4fa3d9', '#2b3238'], padText: '#e8eef2', font: { fontWeight: 900, letterSpacing: '0.3em' } },
  Drumulator: { plate: 'linear-gradient(180deg,#34465a,#1f2b38)', text: '#f1e6c0', accent: '#e4c14b', pads: ['#e4c14b', '#c9d2dc', '#a9b6c3', '#e4c14b'], padText: '#1d2733', font: { fontWeight: 800, fontStyle: 'italic' } },
  '707': { plate: 'linear-gradient(180deg,#46494c,#2c2e30)', text: '#f0f0f0', accent: '#f39c12', pads: ['#f39c12', '#f4d03f', '#5dade2', '#d5d8dc'], padText: '#1c1c1c', font: { fontWeight: 800, letterSpacing: '0.06em' } },
  'SP-12': { plate: 'linear-gradient(180deg,#d3cdbd,#a9a292)', text: '#262320', accent: '#c0392b', pads: ['#3b3833', '#4a463f', '#c0392b', '#3b3833'], padText: '#eee', font: { fontWeight: 900 } },
  Studio: { plate: 'linear-gradient(180deg,#8a5a2b,#5b3a1b)', text: '#fbeacc', accent: '#e3b04b', pads: ['#e9d3a8', '#d8bc88', '#e3b04b', '#c9a46a'], padText: '#3a2611', font: { fontFamily: 'Georgia, serif', fontWeight: 700 } },
  Trap: { plate: 'linear-gradient(180deg,#311845,#160a20)', text: '#f3e6ff', accent: '#b44dff', pads: ['#b44dff', '#7a2bbf', '#ff4da6', '#3d2357'], padText: '#fff', font: { fontWeight: 900, letterSpacing: '0.1em' } },
  'Lo-fi': { plate: 'linear-gradient(180deg,#7a6650,#4f4131)', text: '#f4e4c9', accent: '#d9b38c', pads: ['#d9b38c', '#b89b78', '#8fa38a', '#d9b38c'], padText: '#2e2418', font: { fontFamily: 'Georgia, serif', fontStyle: 'italic' } },
  Techno: { plate: 'linear-gradient(180deg,#141414,#050505)', text: '#e8ffe0', accent: '#9fff3a', pads: ['#9fff3a', '#2a2a2a', '#363636', '#2a2a2a'], padText: '#0d0d0d', font: { fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.15em' } }
}

// ─── pad tweak knobs ──────────────────────────────────────────────────────────

const PAD_DEFS: Record<'tune' | 'decay' | 'level' | 'pan' | 'tone', ParamDef> = {
  tune: { id: 'tune', name: 'Tune', min: -24, max: 24, default: 0, unit: 'st' },
  decay: { id: 'decay', name: 'Decay', min: 0.1, max: 3, default: 1, curve: 'exp' },
  level: { id: 'level', name: 'Level', min: -40, max: 6, default: 0, unit: 'dB' },
  pan: { id: 'pan', name: 'Pan', min: -1, max: 1, default: 0 },
  tone: { id: 'tone', name: 'Tone', min: -1, max: 1, default: 0 }
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** FL Studio naming: key 60 = C5 */
const noteName = (k: number) => `${NOTE_NAMES[k % 12]}${Math.floor(k / 12)}`

export function Editor(p: PluginEditorProps) {
  const data = readData(p.instance.data)
  const kitId = data.kit
  const style = STYLES[kitId] ?? S808
  const kit = useMemo(() => resolveKit(kitId), [kitId])
  const padByKey = useMemo(() => Object.fromEntries(kit.pads.map((x) => [x.key, x])), [kit])
  const [sel, setSel] = useState(36)
  const [bank, setBank] = useState<'A' | 'B'>('A')
  const [lit, setLit] = useState<Record<number, number>>({})
  const held = useRef<number | null>(null)

  // pad LEDs from DSP hits
  useEffect(() => {
    return p.onDSPMessage((m) => {
      const key = (m as { hit?: number })?.hit
      if (typeof key !== 'number') return
      setLit((l) => ({ ...l, [key]: performance.now() }))
    })
  }, [p])
  useEffect(() => {
    if (!Object.keys(lit).length) return
    const t = setTimeout(() => setLit({}), 140)
    return () => clearTimeout(t)
  }, [lit])

  const selPad = padByKey[sel]
  const tw = getTweak(data, kitId, sel)
  const recipePan = selPad?.recipe.pan ?? 0
  const value = (k: keyof typeof PAD_DEFS): number => (k === 'pan' ? tw.pan ?? recipePan : (tw[k] as number | undefined) ?? PAD_DEFS[k].default)
  const setTweak = (patch: PadTweak) => p.setData(withTweak(data, kitId, sel, patch))
  const choke = tw.choke ?? DEFAULT_CHOKE[sel] ?? 0
  const role = ROLE_BY_KEY[sel]?.role ?? ''
  const toneLabel = /snare|clap/.test(role) ? 'Snappy' : 'Tone'

  const keys = bank === 'A' ? BANK_A : BANK_B
  const audition = (key: number, e: React.MouseEvent<HTMLDivElement>) => {
    setSel(key)
    const r = e.currentTarget.getBoundingClientRect()
    const vel = Math.max(0.25, Math.min(1, 1 - (e.clientY - r.top) / r.height + 0.25))
    held.current = key
    p.previewNote?.(key, vel, true)
    setLit((l) => ({ ...l, [key]: performance.now() }))
    p.hint(`${padByKey[key]?.name ?? key} - key ${key} (${noteName(key)}), velocity ${Math.round(vel * 100)}%`)
  }
  const release = () => {
    if (held.current !== null) p.previewNote?.(held.current, 0, false)
    held.current = null
  }

  return (
    <PluginPanel className="flex flex-col gap-1.5 select-none">
      {/* kit tabs */}
      <div className="flex gap-[3px]">
        {KITS.map((k) => {
          const st = STYLES[k.id] ?? S808
          const on = k.id === kitId
          return (
            <button
              key={k.id}
              onClick={() => p.setData({ ...data, kit: k.id })}
              onMouseEnter={() => p.hint(`Kit: ${k.name} - ${k.title} (${k.mode === 'analog' ? 'analog circuit synthesis' : 'sample-era ROM'})`)}
              className={cn('h-[22px] min-w-0 flex-1 truncate rounded-[3px] border px-0.5 text-[10px] leading-none', on ? 'border-white/70' : 'border-black/50 opacity-70 hover:opacity-100')}
              style={{ background: st.plate, color: st.text, boxShadow: on ? `0 0 0 1px ${st.accent}, 0 0 6px ${st.accent}` : undefined, ...st.font, letterSpacing: 0 }}
            >
              {k.name}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        {/* left: nameplate + pads */}
        <div className="flex w-[452px] shrink-0 flex-col gap-1.5">
          <div className="relative flex h-[46px] items-center overflow-hidden rounded-[4px] border border-black/60 px-3" style={{ background: style.plate }}>
            <div className="absolute inset-x-0 bottom-0 flex h-[5px]">
              {style.pads.map((c, i) => (
                <div key={i} className="flex-1" style={{ background: c }} />
              ))}
            </div>
            <div className="text-[30px] leading-none" style={{ color: style.text, ...style.font }}>
              {KIT_BY_ID[kitId]?.name}
            </div>
            <div className="ml-3 flex flex-col leading-tight" style={{ color: style.text }}>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-90">{KIT_BY_ID[kitId]?.title}</span>
              <span className="text-[9px] uppercase tracking-[0.2em] opacity-60">
                {KIT_BY_ID[kitId]?.mode === 'analog' ? 'Analog voice circuits' : `ROM ${kit.def.conv ? `${(kit.def.conv.rate / 1000).toFixed(1)} kHz ${kit.def.conv.bits ? `${kit.def.conv.bits}-bit${kit.def.conv.mu ? ' companded' : ''}` : 'float'}` : ''}`}
              </span>
            </div>
            <div className="ml-auto flex gap-1">
              {(['A', 'B'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBank(b)}
                  onMouseEnter={() => p.hint(`Pad bank ${b}`)}
                  className="h-6 w-7 rounded-[3px] border border-black/60 text-[11px] font-bold"
                  style={{ background: bank === b ? style.accent : 'rgba(0,0,0,0.35)', color: bank === b ? '#111' : style.text }}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-[5px] rounded-[4px] border border-black/60 bg-[#15191b] p-[5px]">
            {Array.from({ length: 20 }, (_, i) => {
              const key = keys[i]
              const pad = key !== undefined ? padByKey[key] : undefined
              if (!pad) return <div key={`e${i}`} className="h-[58px] rounded-[3px] bg-[#1d2225]" />
              const col = style.pads[Math.floor(i / 5) % style.pads.length]
              const isLit = lit[key] !== undefined
              const t = getTweak(data, kitId, key)
              const muted = (t.level ?? 0) <= -40
              return (
                <div
                  key={key}
                  onMouseDown={(e) => {
                    if (e.button === 0) audition(key, e)
                  }}
                  onMouseUp={release}
                  onMouseLeave={release}
                  onMouseEnter={() => p.hint(`${pad.name} - key ${key} (${noteName(key)}). Click to play (higher = louder)`)}
                  className={cn('relative flex h-[58px] cursor-pointer flex-col justify-between rounded-[3px] border px-1.5 py-1 transition-[filter] duration-75', sel === key ? 'border-white' : 'border-black/70')}
                  style={{
                    background: `linear-gradient(180deg, ${col} 0%, color-mix(in srgb, ${col} 72%, black) 100%)`,
                    color: style.padText ?? '#111',
                    filter: isLit ? 'brightness(1.45)' : muted ? 'brightness(0.5) saturate(0.4)' : undefined,
                    boxShadow: isLit ? `0 0 10px ${col}` : sel === key ? `0 0 0 1px ${style.accent}` : 'inset 0 -2px 0 rgba(0,0,0,0.25)'
                  }}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-[11px] font-bold leading-none">{ROLE_BY_KEY[key]?.short}</span>
                    <span className="text-[9px] leading-none opacity-70">
                      {key} {noteName(key)}
                    </span>
                  </div>
                  <span className="truncate text-[10px] font-semibold leading-tight">{pad.name}</span>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-2 text-[10px] text-fl-dim">
            {p.insertNotes && (
              <label className="flex items-center gap-1" onMouseEnter={() => p.hint('Write a classic groove into the current pattern (replaces this channel’s notes)')}>
                <span className="uppercase tracking-wide">Groove</span>
                <select
                  className="h-5 rounded-[3px] bg-fl-well px-1 text-[11px] text-[#cfe9b8] fl-inset"
                  value=""
                  onChange={(e) => {
                    const g = GROOVES[Number(e.target.value)]
                    if (g) p.insertNotes?.(grooveNotes(g, 1), 'replace')
                  }}
                >
                  <option value="">Insert into pattern…</option>
                  {GROOVES.map((g, i) => (
                    <option key={g.name} value={i}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="ml-auto">GM map: 36 kick, 38 snare, 39 clap, 42/46 hats (cut group)</span>
          </div>
        </div>

        {/* right: pad + global */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Section title={`Pad · ${selPad?.name ?? '-'} · ${sel}`} accent={style.accent}>
            <div className="flex justify-between">
              {(['tune', 'decay', 'level', 'pan', 'tone'] as const).map((k) => (
                <ParamKnob
                  key={`${kitId}:${sel}:${k}`}
                  def={k === 'tone' ? { ...PAD_DEFS.tone, name: toneLabel } : PAD_DEFS[k]}
                  value={value(k)}
                  onChange={(v) => setTweak({ [k]: v })}
                  size={34}
                  color={style.accent}
                />
              ))}
            </div>
            <div className="mt-1.5 flex items-center gap-1" onMouseEnter={() => p.hint('Cut group: pads in the same group silence each other (hats = 1)')}>
              <span className="mr-1 text-[10px] uppercase tracking-wide text-fl-dim">Cut</span>
              <div className="flex gap-px rounded-[3px] bg-[#1a1f22] p-px">
                {[0, 1, 2, 3, 4].map((g) => (
                  <button
                    key={g}
                    onClick={() => setTweak({ choke: g })}
                    className={cn('w-7 rounded-[2px] px-1 py-0.5 text-[10px]', g === choke ? 'bg-fl-orange font-semibold text-[#1b1f22]' : 'bg-[#3a454b] text-fl-text hover:bg-[#46535a]')}
                  >
                    {g === 0 ? 'Off' : g}
                  </button>
                ))}
              </div>
              <button
                className="ml-auto rounded-[3px] bg-[#3a454b] px-1.5 py-0.5 text-[10px] hover:bg-[#46535a]"
                onClick={() => {
                  const pads = { ...(data.pads[kitId] ?? {}) }
                  delete pads[String(sel)]
                  p.setData({ ...data, pads: { ...data.pads, [kitId]: pads } })
                }}
                onMouseEnter={() => p.hint('Reset this pad to the kit defaults')}
              >
                Reset pad
              </button>
            </div>
          </Section>
          <Section title="Machine" accent={style.accent} className="flex-1">
            <div className="grid grid-cols-3 gap-y-2">
              <PK p={p} id="tune" label="Tune" color={style.accent} />
              <PK p={p} id="character" label="Character" color={style.accent} />
              <PK p={p} id="vel" label="Vel Sens" color={style.accent} />
              <PK p={p} id="drive" label="Drive" color={style.accent} />
              <PK p={p} id="comp" label="Comp" color={style.accent} />
              <PK p={p} id="gain" label="Output" color={style.accent} />
            </div>
            <PSelect p={p} id="gate" className="mt-2" />
          </Section>
        </div>
      </div>
    </PluginPanel>
  )
}
