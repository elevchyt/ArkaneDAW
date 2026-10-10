// Polygon editor: a 90s rack-module front panel (JV-1080 / SC-88 flavour) inside the FL plugin wrapper.
// Dot-matrix LCD, VALUE dial, category jump buttons, tone switch/select, edit pages and a mini keyboard.
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Knob } from '@/components/controls'
import type { PluginEditorProps } from '../sdk/module'
import type { ParamDef } from '../sdk/types'
import { PK, PSelect, PToggle, useHeldKeys } from '../sdk/ui'
import { formatParam, normalize, denormalize } from '../sdk/params'
import { WAVES } from './waves'
import { CATEGORIES } from './presets'
import { toneParams } from './params'
import { getMultiByIndex, multiIndexFor } from './rom'
import { lcdFont } from './lcdfont'

const TEAL = '#5fd0c0'
const AMBER = '#f7b23e'
const TABS = ['WAVE', 'PITCH', 'TVF', 'TVA', 'LFO', 'COMMON', 'FX'] as const
type Tab = (typeof TABS)[number]
const CAT_SHORT: Record<string, string> = {
  'Piano/Keys': 'PIANO', Organ: 'ORGAN', Pad: 'PAD', Strings: 'STRINGS', Brass: 'BRASS', 'Choir/Vox': 'CHOIR',
  Bass: 'BASS', Lead: 'LEAD', 'Bell/Mallet': 'BELL', Ethnic: 'ETHNIC', 'Orchestral/Hit': 'ORCH', 'SFX/Atmos': 'SFX'
}
const TONE_SUFFIXES = toneParams(1).map((d) => d.id.slice(3))

// ─── Dot-matrix LCD ───────────────────────────────────────────────────────────

const COLS = 24
const DOT = 3

function Lcd({ lines }: { lines: [string, string] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = COLS * 6 * DOT + 6
  const h = 2 * 9 * DOT + 6
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    cv.width = w * dpr
    cv.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    for (let row = 0; row < 2; row++) {
      const text = (lines[row] ?? '').padEnd(COLS).slice(0, COLS)
      for (let c = 0; c < COLS; c++) {
        const g = lcdFont(text[c])
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 5; x++) {
            const on = g[y * 5 + x]
            ctx.fillStyle = on ? 'rgba(18,30,8,0.92)' : 'rgba(40,60,10,0.10)'
            ctx.fillRect(3 + (c * 6 + x) * DOT, 3 + (row * 9 + y) * DOT, DOT - 0.6, DOT - 0.6)
          }
      }
    }
  }, [lines, w, h])
  return (
    <div
      className="rounded-[3px] p-[5px]"
      style={{ background: '#111', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.08)' }}
    >
      <div className="rounded-[2px]" style={{ background: 'linear-gradient(180deg,#c3dc4a 0%,#a9c933 55%,#98b82a 100%)', boxShadow: 'inset 0 0 12px rgba(60,80,0,.45)' }}>
        <canvas ref={ref} style={{ width: w, height: h, display: 'block' }} />
      </div>
    </div>
  )
}

// ─── small widgets ────────────────────────────────────────────────────────────

function PanelButton({ active, onClick, children, className, led, title }: { active?: boolean; onClick?: () => void; children: React.ReactNode; className?: string; led?: boolean; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1 rounded-[2px] border border-[#0d0f10] px-1.5 text-[9.5px] font-semibold tracking-[0.08em] transition-colors',
        active ? 'text-[#121516]' : 'text-[#b9c3c7] hover:text-white',
        className
      )}
      style={{
        background: active ? `linear-gradient(180deg, ${AMBER}, #c9821e)` : 'linear-gradient(180deg,#4a5257,#363c40)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12), 0 1px 1px rgba(0,0,0,.5)'
      }}
    >
      {led !== undefined && (
        <span className="inline-block h-[6px] w-[6px] rounded-full" style={{ background: led ? '#ff4b3a' : '#4a1d18', boxShadow: led ? '0 0 4px #ff4b3a' : undefined }} />
      )}
      {children}
    </button>
  )
}

function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('relative rounded-[3px] border border-[#15181a] bg-[#262b2e] px-2 pb-1.5 pt-3', className)} style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)' }}>
      <span className="absolute -top-[1px] left-2 bg-[#262b2e] px-1 text-[8.5px] font-bold tracking-[0.18em] text-[#8fa3aa]" style={{ transform: 'translateY(-45%)' }}>
        {title}
      </span>
      {children}
    </div>
  )
}

/** Small low-poly logo mark. */
function PolyMark() {
  return (
    <svg width="34" height="30" viewBox="0 0 34 30">
      <polygon points="17,1 33,12 27,29 7,29 1,12" fill="#1c3a40" stroke={TEAL} strokeWidth="1" />
      <path d="M17,1 L17,16 L1,12 M17,16 L33,12 M17,16 L27,29 M17,16 L7,29" fill="none" stroke={TEAL} strokeWidth="0.8" opacity="0.8" />
      <polygon points="17,1 33,12 17,16" fill={TEAL} opacity="0.35" />
      <polygon points="17,16 27,29 7,29" fill="#e06cc0" opacity="0.35" />
    </svg>
  )
}

/** JV-style time/level envelope graph. */
function EnvGraph({ T, L, color = TEAL, bipolar }: { T: number[]; L: number[]; color?: string; bipolar?: boolean }) {
  const W = 220
  const H = 74
  const sx = (t: number) => Math.sqrt(Math.max(0, t)) * 22 + 2
  const pts: [number, number][] = [[0, 0]]
  let x = 0
  const lv = [L[0], L[1], L[2]]
  for (let i = 0; i < 3; i++) {
    x += sx(T[i])
    pts.push([x, lv[i]])
  }
  x += 26
  pts.push([x, lv[2]])
  x += sx(T[3])
  pts.push([x, 0])
  const scale = Math.min(1, (W - 10) / Math.max(1, x))
  const y = (l: number) => (bipolar ? H / 2 - l * (H / 2 - 4) : H - 4 - l * (H - 10))
  const d = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${(4 + px * scale).toFixed(1)},${y(py).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} className="rounded-[2px]" style={{ background: '#101516', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.8)' }}>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={W} y1={y(g)} y2={y(g)} stroke="#1f2a2c" />
      ))}
      <path d={d + ` L${(4 + x * scale).toFixed(1)},${y(0)} Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
      {pts.slice(1, 4).map(([px, py], i) => (
        <g key={i}>
          <circle cx={4 + px * scale} cy={y(py)} r={2.5} fill="#101516" stroke={color} />
          <text x={4 + px * scale} y={y(py) - 5} fontSize={7} fill="#7f9aa0" textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
      <text x={W - 4} y={10} fontSize={8} fill="#5f777c" textAnchor="end">
        SUSTAIN · RELEASE
      </text>
    </svg>
  )
}

/** Waveform thumbnail from the virtual ROM (attack + loop). */
function WavePreview({ wave, keyNum }: { wave: number; keyNum: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const W = 236
  const H = 70
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const m = getMultiByIndex(wave, multiIndexFor(wave, keyNum))
    const ctx = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    cv.width = W * dpr
    cv.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0d1213'
    ctx.fillRect(0, 0, W, H)
    const n = m.loopEnd
    const per = n / W
    const ls = m.oneShot ? W : m.loopStart / per
    ctx.fillStyle = 'rgba(95,208,192,0.08)'
    if (!m.oneShot) ctx.fillRect(ls, 0, W - ls, H)
    for (let x = 0; x < W; x++) {
      let lo = 0, hi = 0
      const a = Math.floor(x * per), b = Math.min(n, Math.floor((x + 1) * per))
      for (let i = a; i < b; i += Math.max(1, Math.floor((b - a) / 64))) {
        const v = m.data[i]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      ctx.fillStyle = x < ls ? AMBER : TEAL
      ctx.fillRect(x, H / 2 - hi * (H / 2 - 3), 1, Math.max(1, (hi - lo) * (H / 2 - 3)))
    }
    if (!m.oneShot) {
      ctx.strokeStyle = '#e06cc0'
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(ls + 0.5, 0)
      ctx.lineTo(ls + 0.5, H)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.fillStyle = '#7f9aa0'
    ctx.font = '8px monospace'
    ctx.fillText(m.oneShot ? 'ONE-SHOT' : 'ATTACK | LOOP', 4, 10)
    ctx.fillText(`${(n / 32000).toFixed(2)}s @32k`, W - 70, 10)
  }, [wave, keyNum])
  return <canvas ref={ref} style={{ width: W, height: H, display: 'block', borderRadius: 2, boxShadow: 'inset 0 1px 3px rgba(0,0,0,.8)' }} />
}

/** 3-octave mini keyboard auditioning through previewNote. */
function MiniKeys({ p, octave, setOctave }: { p: PluginEditorProps; octave: number; setOctave: (o: number) => void }) {
  const down = useRef<number | null>(null)
  const [held, setHeld] = useState<number | null>(null)
  const live = useHeldKeys(p)
  const lit = (k: number) => held === k || live.has(k)
  const base = 12 * (octave + 1)
  const whites: number[] = []
  const blacks: { key: number; x: number }[] = []
  const KW = 32
  for (let k = base; k < base + 36 + 1; k++) {
    const pc = k % 12
    if ([1, 3, 6, 8, 10].includes(pc)) blacks.push({ key: k, x: whites.length * KW - 9 })
    else whites.push(k)
  }
  const press = (k: number) => {
    if (down.current === k) return
    if (down.current !== null) p.previewNote?.(down.current, 0, false)
    down.current = k
    setHeld(k)
    p.previewNote?.(k, 0.8, true)
  }
  const release = () => {
    if (down.current !== null) p.previewNote?.(down.current, 0, false)
    down.current = null
    setHeld(null)
  }
  useEffect(() => {
    window.addEventListener('pointerup', release)
    return () => {
      window.removeEventListener('pointerup', release)
      release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const keyProps = (k: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      press(k)
    },
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.buttons & 1 && down.current !== null) press(k)
    },
    onMouseEnter: () => p.hint(`Key ${noteName(k)}`)
  })
  return (
    <div className="flex items-stretch gap-1.5">
      <div className="flex flex-col justify-center gap-1">
        <PanelButton onClick={() => setOctave(Math.min(6, octave + 1))} title="Octave up" className="h-4 w-8">OCT+</PanelButton>
        <div className="text-center text-[9px] text-[#8fa3aa]">C{octave}</div>
        <PanelButton onClick={() => setOctave(Math.max(0, octave - 1))} title="Octave down" className="h-4 w-8">OCT-</PanelButton>
      </div>
      <div className="relative h-[52px] select-none" style={{ width: whites.length * KW }}>
        {whites.map((k, i) => (
          <div
            key={k}
            {...keyProps(k)}
            className="absolute top-0 h-full rounded-b-[3px] border border-[#1a1d1f]"
            style={{ left: i * KW, width: KW - 1, background: lit(k) ? `linear-gradient(180deg,#d8f5ef,${TEAL})` : 'linear-gradient(180deg,#e8ecec,#c9cfd0)' }}
          >
            {k % 12 === 0 && <span className="absolute bottom-0.5 left-1 text-[8px] text-[#5c6669]">{noteName(k)}</span>}
          </div>
        ))}
        {blacks.map(({ key, x }) => (
          <div
            key={key}
            {...keyProps(key)}
            className="absolute top-0 z-10 h-[32px] rounded-b-[2px] border border-[#000]"
            style={{ left: x, width: 18, background: lit(key) ? TEAL : 'linear-gradient(180deg,#2a2f31,#121516)' }}
          />
        ))}
      </div>
    </div>
  )
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteName(k: number): string {
  return `${NOTE_NAMES[k % 12]}${Math.floor(k / 12) - 1}`
}

// ─── Editor ───────────────────────────────────────────────────────────────────

export default function PolygonEditor(p: PluginEditorProps) {
  const [tab, setTab] = useState<Tab>('WAVE')
  const [sel, setSel] = useState(1)
  const [focus, setFocus] = useState<string>('patch')
  const [octave, setOctave] = useState(3)
  const presets = p.manifest.presets ?? []
  const idx = presets.findIndex((x) => x.name === p.instance.presetName)
  const cur = idx >= 0 ? presets[idx] : undefined
  const prm = p.instance.params
  const def = (id: string): ParamDef | undefined => p.manifest.params.find((d) => d.id === id)
  const val = (id: string): number => prm[id] ?? def(id)?.default ?? 0

  // knobs/selectors report focus so the LCD + VALUE dial follow the last touched parameter
  const pp: PluginEditorProps = useMemo(
    () => ({
      ...p,
      setParam: (id: string, v: number) => {
        setFocus(id)
        p.setParam(id, v)
      }
    }),
    [p]
  )

  const loadIdx = (i: number) => {
    const n = presets.length
    if (!n) return
    const pr = presets[((i % n) + n) % n]
    p.loadPreset(pr)
    setFocus('patch')
    p.hint(`Patch ${String(((i % n) + n) % n + 1).padStart(3, '0')}: ${pr.name}`)
  }

  // LCD text
  const toneMap = [1, 2, 3, 4].map((n) => (val(`t${n}.on`) >= 0.5 ? String(n) : '-')).join('')
  const line1 = `${idx >= 0 ? 'PR-A:' + String(idx + 1).padStart(3, '0') : 'USER:---'} ${(cur?.name ?? (p.instance.presetName && p.instance.presetName !== 'Default' ? p.instance.presetName : 'Init Patch')).slice(0, 15)}`
  let line2: string
  const fdef = focus !== 'patch' ? def(focus) : undefined
  if (fdef) {
    const prefix = focus.startsWith('t') ? `T${focus[1]} ` : focus.startsWith('fx.') ? 'FX ' : 'CM '
    const name = (prefix + fdef.name).slice(0, 14)
    const v = formatParam(fdef, val(focus)).slice(0, 24 - name.length - 1)
    line2 = name + ' '.repeat(Math.max(1, 24 - name.length - v.length)) + v
  } else {
    const cat = (CAT_SHORT[cur?.category ?? ''] ?? 'USER').padEnd(8)
    line2 = `${cat}T:${toneMap} ${sel}\u25b6${WAVES[Math.round(val(`t${sel}.wave`))]?.name.slice(0, 7) ?? ''}`
  }

  // VALUE dial
  const dialValue = fdef ? normalize(fdef, val(focus)) : presets.length > 1 ? Math.max(0, idx) / (presets.length - 1) : 0
  const onDial = (x: number) => {
    if (fdef) p.setParam(focus, denormalize(fdef, x))
    else {
      const i = Math.round(x * (presets.length - 1))
      if (i !== idx) loadIdx(i)
    }
  }
  const step = (d: number) => {
    if (!fdef) return loadIdx(Math.max(0, idx) + d)
    if (fdef.options || fdef.step) p.setParam(focus, Math.min(fdef.max, Math.max(fdef.min, val(focus) + d * (fdef.step ?? 1))))
    else p.setParam(focus, denormalize(fdef, normalize(fdef, val(focus)) + d * 0.01))
  }

  const jumpCategory = (cat: string) => {
    const list = presets.map((x, i) => [x, i] as const).filter(([x]) => x.category === cat)
    if (!list.length) return
    const pos = list.findIndex(([, i]) => i === idx)
    loadIdx(list[(pos + 1) % list.length][1])
  }

  const copyTone = (to: number) => {
    if (to === sel) return
    const values: Record<string, number> = {}
    for (const s of TONE_SUFFIXES) values[`t${to}.${s}`] = val(`t${sel}.${s}`)
    p.setParams(values)
    p.hint(`Copied tone ${sel} to tone ${to}`)
  }

  const t = (s: string) => `t${sel}.${s}`
  const knob = (id: string, label?: string, color: string = TEAL) => <PK key={id} p={pp} id={id} size={34} color={color} label={label} />

  const page = (() => {
    switch (tab) {
      case 'WAVE': {
        const cur = Math.round(val(t('wave')))
        return (
          <div className="flex h-full gap-2">
            <Group title={`TONE ${sel} WAVEFORM`} className="flex-1">
              <div className="grid grid-cols-5 gap-[3px]">
                {WAVES.map((w, i) => (
                  <button
                    key={w.name}
                    onClick={() => pp.setParam(t('wave'), i)}
                    onMouseEnter={() => p.hint(`Wave ${String(i + 1).padStart(3, '0')}: ${w.name} (${w.group})`)}
                    className={cn('truncate rounded-[2px] px-1 py-[1px] text-left text-[9px]', i === cur ? 'font-bold text-[#101314]' : 'text-[#aebcc1] hover:bg-[#3a4246]')}
                    style={{ background: i === cur ? TEAL : '#1b2023' }}
                  >
                    <span className="opacity-50">{String(i + 1).padStart(2, '0')} </span>
                    {w.name}
                  </button>
                ))}
              </div>
            </Group>
            <div className="flex w-[252px] flex-col gap-2">
              <Group title="ROM PREVIEW">
                <WavePreview wave={cur} keyNum={60 + val(t('coarse'))} />
              </Group>
              <Group title="TONE">
                <div className="flex justify-between">
                  {knob(t('level'), 'Level')}
                  {knob(t('pan'), 'Pan')}
                  {knob(t('velSens'), 'Vel')}
                  {knob(t('keyLo'), 'Key Lo', AMBER)}
                  {knob(t('keyHi'), 'Key Hi', AMBER)}
                </div>
              </Group>
            </div>
          </div>
        )
      }
      case 'PITCH':
        return (
          <div className="flex h-full gap-2">
            <Group title={`TONE ${sel} PITCH`}>
              <div className="flex gap-3">
                {knob(t('coarse'), 'Coarse')}
                {knob(t('fine'), 'Fine')}
              </div>
            </Group>
            <Group title="PITCH ENVELOPE">
              <div className="flex items-center gap-3">
                {knob(t('pDepth'), 'Depth', AMBER)}
                {knob(t('pTime'), 'Time', AMBER)}
                <EnvGraph T={[0.001, val(t('pTime')), 0, 0]} L={[val(t('pDepth')) / 36, 0, 0]} color={AMBER} bipolar />
              </div>
            </Group>
            <Group title="PORTAMENTO / MONO" className="flex-1">
              <div className="flex items-center gap-3">
                {knob('com.porta', 'Time')}
                <div className="flex flex-col gap-1.5">
                  <PToggle p={pp} id="com.mono" />
                  <PToggle p={pp} id="com.legato" />
                </div>
              </div>
            </Group>
          </div>
        )
      case 'TVF':
        return (
          <div className="flex h-full flex-col gap-2">
            <div className="flex gap-2">
              <Group title={`TONE ${sel} TVF`} className="flex-1">
                <div className="flex items-end gap-3">
                  <PSelect p={pp} id={t('fType')} />
                  {knob(t('cutoff'), 'Cutoff')}
                  {knob(t('res'), 'Reso')}
                  {knob(t('fKey'), 'Key F')}
                  {knob(t('fVel'), 'Vel')}
                  {knob(t('fEnv'), 'Env', AMBER)}
                </div>
              </Group>
            </div>
            <Group title="TVF ENVELOPE  (T1-T4 / L1-L3)">
              <div className="flex items-center gap-3">
                <EnvGraph T={[val(t('fT1')), val(t('fT2')), val(t('fT3')), val(t('fT4'))]} L={[val(t('fL1')), val(t('fL2')), val(t('fL3'))]} color={AMBER} />
                {['fT1', 'fT2', 'fT3', 'fT4'].map((s) => knob(t(s), s.slice(1), AMBER))}
                {['fL1', 'fL2', 'fL3'].map((s) => knob(t(s), s.slice(1)))}
              </div>
            </Group>
          </div>
        )
      case 'TVA':
        return (
          <div className="flex h-full flex-col gap-2">
            <Group title={`TONE ${sel} TVA`}>
              <div className="flex gap-3">
                {knob(t('level'), 'Level')}
                {knob(t('pan'), 'Pan')}
                {knob(t('velSens'), 'Vel Sens')}
                {knob('com.level', 'Patch Lvl', AMBER)}
              </div>
            </Group>
            <Group title="TVA ENVELOPE  (T1-T4 / L1-L3)">
              <div className="flex items-center gap-3">
                <EnvGraph T={[val(t('aT1')), val(t('aT2')), val(t('aT3')), val(t('aT4'))]} L={[val(t('aL1')), val(t('aL2')), val(t('aL3'))]} />
                {['aT1', 'aT2', 'aT3', 'aT4'].map((s) => knob(t(s), s.slice(1), AMBER))}
                {['aL1', 'aL2', 'aL3'].map((s) => knob(t(s), s.slice(1)))}
              </div>
            </Group>
          </div>
        )
      case 'LFO':
        return (
          <div className="flex h-full flex-col gap-2">
            <Group title={`TONE ${sel} LFO`}>
              <div className="flex items-end gap-3">
                <PSelect p={pp} id={t('lfoWave')} />
                {knob(t('lfoRate'), 'Rate')}
                {knob(t('lfoDelay'), 'Delay')}
                {knob(t('lfoFade'), 'Fade')}
              </div>
            </Group>
            <Group title="LFO DESTINATIONS">
              <div className="flex gap-4">
                {knob(t('lfoPitch'), 'Pitch', AMBER)}
                {knob(t('lfoFilter'), 'Filter', AMBER)}
                {knob(t('lfoAmp'), 'Amp', AMBER)}
              </div>
            </Group>
          </div>
        )
      case 'COMMON':
        return (
          <div className="flex h-full gap-2">
            <Group title="PATCH COMMON">
              <div className="flex items-center gap-3">
                {knob('com.level', 'Level')}
                {knob('com.porta', 'Porta')}
                {knob('com.drift', 'Analog')}
                <div className="flex flex-col gap-1.5">
                  <PToggle p={pp} id="com.mono" />
                  <PToggle p={pp} id="com.legato" />
                </div>
              </div>
            </Group>
            <Group title="ROM / DAC CHARACTER" className="flex-1">
              <div className="flex flex-col gap-2">
                <PSelect p={pp} id="com.bits" />
                <PSelect p={pp} id="com.dac" />
              </div>
            </Group>
            <Group title={`COPY TONE ${sel} TO`}>
              <div className="grid grid-cols-2 gap-1">
                {[1, 2, 3, 4].map((n) => (
                  <PanelButton key={n} onClick={() => copyTone(n)} className={cn('h-6 w-12', n === sel && 'opacity-30')}>
                    TONE {n}
                  </PanelButton>
                ))}
              </div>
            </Group>
          </div>
        )
      case 'FX':
        return (
          <div className="flex h-full gap-2">
            <Group title="CHORUS">
              <div className="flex flex-col gap-2">
                <PSelect p={pp} id="fx.chType" />
                <div className="flex gap-3">
                  {knob('fx.chorus', 'Level')}
                  {knob('fx.chRate', 'Rate')}
                  {knob('fx.chDepth', 'Depth')}
                </div>
              </div>
            </Group>
            <Group title="DELAY">
              <div className="flex gap-3 pt-[22px]">
                {knob('fx.delay', 'Level', AMBER)}
                {knob('fx.dlyTime', 'Time', AMBER)}
                {knob('fx.dlyFb', 'Fdbk', AMBER)}
              </div>
            </Group>
            <Group title="REVERB" className="flex-1">
              <div className="flex flex-col gap-2">
                <PSelect p={pp} id="fx.revType" />
                <div className="flex gap-3">
                  {knob('fx.reverb', 'Level')}
                  {knob('fx.revTime', 'Time')}
                  {knob('fx.revTone', 'HF Damp')}
                </div>
              </div>
            </Group>
          </div>
        )
    }
  })()

  return (
    <div
      className="flex h-full w-full select-none flex-col gap-1.5 p-2 text-[#c5cdd1]"
      style={{ background: 'linear-gradient(180deg,#30363a 0%,#24292c 40%,#1f2326 100%)' }}
    >
      {/* ── front panel header ── */}
      <div className="flex h-[78px] shrink-0 items-center gap-3 rounded-[3px] border border-[#111416] px-3" style={{ background: 'linear-gradient(180deg,#1d2124,#15181a)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05)' }}>
        <div className="flex w-[168px] flex-col">
          <div className="flex items-center gap-2">
            <PolyMark />
            <div>
              <div className="text-[21px] font-black italic leading-none tracking-[0.12em]" style={{ background: `linear-gradient(180deg,#fff,${TEAL})`, WebkitBackgroundClip: 'text', color: 'transparent' }}>
                POLYGON
              </div>
              <div className="mt-0.5 text-[7.5px] font-semibold tracking-[0.2em] text-[#7f9aa0]">DIGITAL ROM SYNTHESIZER</div>
            </div>
          </div>
          <div className="mt-1.5 flex gap-1 text-[7.5px] font-bold tracking-[0.12em]">
            <span className="rounded-[2px] border border-[#3a4a4e] px-1 text-[#9ab]">32 VOICE</span>
            <span className="rounded-[2px] border border-[#3a4a4e] px-1 text-[#9ab]">4 TONE</span>
            <span className="rounded-[2px] border border-[#3a4a4e] px-1" style={{ color: AMBER }}>16-BIT PCM</span>
          </div>
        </div>
        <div onMouseEnter={() => p.hint('Display: patch / last edited parameter')}>
          <Lcd lines={[line1, line2]} />
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <div className="flex flex-col gap-1">
            <PanelButton onClick={() => step(1)} className="h-5 w-11" title="INC">INC ▲</PanelButton>
            <PanelButton onClick={() => step(-1)} className="h-5 w-11" title="DEC">DEC ▼</PanelButton>
            <PanelButton onClick={() => setFocus('patch')} active={focus === 'patch'} className="h-5 w-11" title="Patch select mode">PATCH</PanelButton>
          </div>
          <Knob value={dialValue} onChange={onDial} size={58} color={AMBER} label="VALUE" hint={fdef ? `${fdef.name}: ${formatParam(fdef, val(focus))}` : `Patch: ${cur?.name ?? ''}`} />
        </div>
      </div>

      {/* ── category jump ── */}
      <div className="flex h-[20px] shrink-0 gap-[3px]">
        {CATEGORIES.map((c) => (
          <PanelButton key={c} active={cur?.category === c} onClick={() => jumpCategory(c)} className="h-full flex-1" title={`${c}: jump / next patch`}>
            {CAT_SHORT[c]}
          </PanelButton>
        ))}
      </div>

      {/* ── tone switch / select + edit tabs ── */}
      <div className="flex h-[24px] shrink-0 items-center gap-1.5">
        <span className="text-[8.5px] font-bold tracking-[0.15em] text-[#8fa3aa]">TONE</span>
        {[1, 2, 3, 4].map((n) => {
          const on = val(`t${n}.on`) >= 0.5
          return (
            <div key={n} className="flex h-full overflow-hidden rounded-[2px]" onMouseEnter={() => p.hint(`Tone ${n}: ${on ? 'On' : 'Off'} · ${WAVES[Math.round(val(`t${n}.wave`))]?.name}`)}>
              <PanelButton led={on} onClick={() => pp.setParam(`t${n}.on`, on ? 0 : 1)} className="h-full w-[22px] rounded-none" title={`Tone ${n} switch`}>
                {''}
              </PanelButton>
              <PanelButton active={sel === n} onClick={() => setSel(n)} className="h-full w-[30px] rounded-none" title={`Select tone ${n} for editing`}>
                {n}
              </PanelButton>
            </div>
          )
        })}
        <div className="mx-1 h-4 w-px bg-[#3a4246]" />
        {TABS.map((tb) => (
          <PanelButton key={tb} active={tab === tb} onClick={() => setTab(tb)} className="h-full flex-1">
            {tb}
          </PanelButton>
        ))}
      </div>

      {/* ── edit page ── */}
      <div className="min-h-0 flex-1 overflow-hidden pt-1.5">{page}</div>

      {/* ── keyboard ── */}
      <div className="flex h-[58px] shrink-0 items-center justify-center rounded-[3px] border border-[#111416] bg-[#15181a] px-2">
        <MiniKeys p={p} octave={octave} setOctave={setOctave} />
      </div>
    </div>
  )
}
