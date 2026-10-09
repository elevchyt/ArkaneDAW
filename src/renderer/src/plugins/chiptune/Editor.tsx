// Chiptune editor: pixel-art / NES flavoured panel inside the FL-style plugin window (800 x 460).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PluginEditorProps } from '../sdk/module'
import { PK } from '../sdk/ui'
import { Knob } from '@/components/controls'
import { ChipOsc, DUTIES, W, WAVE_NAMES, WAVE_SHORT, isNoise, waveTable } from './chip'
import { normalizeData, WAVE_PRESETS, type ChipData, type DrumTweak, type SeqKind } from './data'
import { DRUM_KITS, KIT_MAPS, type DrumDef } from './drumkeys'
import { Box, NES, PixButton, PixSeg, PixSelect, PixelText, PixToggle, WaveIcon, keyName, monoFont } from './pixel'
import { SeqCanvas, WaveDrawer, resizeSeq } from './SeqEditor'

const K = 34 // knob size

const GROUP_COLOR: Record<DrumDef['group'], string> = {
  Kick: NES.red,
  Snare: NES.orange,
  Hat: NES.yellow,
  Cymbal: NES.cyan,
  Tom: NES.purple,
  Perc: NES.green,
  SFX: NES.pink
}

function Row({ children, gap = 6, style }: { children: React.ReactNode; gap?: number; style?: React.CSSProperties }) {
  return <div style={{ display: 'flex', alignItems: 'flex-end', gap, ...style }}>{children}</div>
}

function useChipData(p: PluginEditorProps): [ChipData, (fn: (d: ChipData) => ChipData) => void] {
  const data = useMemo(() => normalizeData(p.instance.data), [p.instance.data])
  const ref = useRef(data)
  ref.current = data
  const update = (fn: (d: ChipData) => ChipData): void => {
    const next = fn(ref.current)
    ref.current = next
    p.setData(next)
  }
  return [data, update]
}

// ─── header ──────────────────────────────────────────────────────────────────
function Header({ p }: { p: PluginEditorProps }) {
  const drums = (p.instance.params.mode ?? 0) >= 0.5
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 30, padding: '0 4px', borderBottom: `2px solid ${NES.black}`, background: 'linear-gradient(#262a33,#1b1e25)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }} onMouseEnter={() => p.hint('Chiptune — Magical 8bit Plug homage')}>
        <PixelText text="CHIPTUNE" scale={3} color={NES.red} shadow={NES.white} />
        <PixelText text="8-BIT" scale={1.5} color={NES.yellow} />
      </div>
      <div style={{ display: p.manifest.id === 'chiptunedrums' ? 'none' : 'flex', gap: 2, marginLeft: 8 }}>
        <PixButton active={!drums} color={NES.cyan} style={{ padding: '4px 10px' }} onClick={() => p.setParam('mode', 0)} onHover={() => p.hint('Mode: Synth (pulse / triangle / noise / GB wave)')}>
          ♪ Synth
        </PixButton>
        <PixButton active={drums} color={NES.pink} style={{ padding: '4px 10px' }} onClick={() => p.setParam('mode', 1)} onHover={() => p.hint('Mode: Drums (each key plays a retro drum / SFX)')}>
          ▦ Drums
        </PixButton>
      </div>
      <div style={{ display: 'flex', gap: 12, marginLeft: 'auto', alignItems: 'center' }}>
        <PixToggle p={p} id="osc.authentic" label="Authentic" color={NES.red} />
        <PixToggle p={p} id="env.quant" label="4-bit Vol" color={NES.yellow} />
        <PixToggle p={p} id="out.dac" label="NES DAC" color={NES.orange} />
      </div>
    </div>
  )
}


// ─── synth mode ──────────────────────────────────────────────────────────────
function OscBox({ p }: { p: PluginEditorProps }) {
  const wave = Math.round(p.instance.params['osc.wave'] ?? 1)
  return (
    <Box title="Oscillator" color={NES.red}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 2, marginBottom: 4 }}>
        {WAVE_NAMES.map((n, i) => (
          <PixButton key={n} active={wave === i} color={i <= 2 ? NES.yellow : i <= 4 ? NES.cyan : i <= 7 ? NES.ltgray : NES.green} onClick={() => p.setParam('osc.wave', i)} onHover={() => p.hint(`Wave: ${n}`)} style={{ padding: '2px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <WaveIcon wave={i} color={wave === i ? NES.black : NES.white} />
            <span style={{ fontSize: 7 }}>{WAVE_SHORT[i]}</span>
          </PixButton>
        ))}
      </div>
      <Row gap={8}>
        <PK p={p} id="osc.coarse" size={K} color={NES.red} />
        <PK p={p} id="osc.fine" size={K} color={NES.red} />
        <PK p={p} id="osc.pwm" size={K} color={NES.yellow} />
        <PK p={p} id="osc.pwmRate" size={K} color={NES.yellow} />
      </Row>
    </Box>
  )
}

function BendBox({ p }: { p: PluginEditorProps }) {
  return (
    <Box title="Bend + Vibrato" color={NES.cyan}>
      <Row gap={8}>
        <PK p={p} id="bend.amt" size={K} color={NES.cyan} />
        <PK p={p} id="bend.time" size={K} color={NES.cyan} />
        <PK p={p} id="bend.sweep" size={K} color={NES.cyan} />
        <div style={{ width: 1, alignSelf: 'stretch', background: '#ffffff12' }} />
        <PK p={p} id="vib.depth" size={K} color={NES.purple} />
        <PK p={p} id="vib.rate" size={K} color={NES.purple} />
        <PK p={p} id="vib.delay" size={K} color={NES.purple} />
      </Row>
    </Box>
  )
}

function EnvBox({ p }: { p: PluginEditorProps }) {
  const seqVol = (p.instance.params['seq.vol'] ?? 0) >= 0.5
  return (
    <Box title="Envelope" color={NES.dkgreen} right={seqVol ? <span style={{ ...monoFont, fontSize: 8, color: NES.yellow }}>VOL SEQ ACTIVE</span> : undefined}>
      <Row gap={8}>
        <PK p={p} id="env.attack" size={K} color={NES.green} />
        <PK p={p} id="env.decay" size={K} color={NES.green} />
        <PK p={p} id="env.sustain" size={K} color={NES.green} />
        <PK p={p} id="env.release" size={K} color={NES.green} />
        <PK p={p} id="voice.vel" size={K} color={NES.green} />
      </Row>
    </Box>
  )
}

function VoiceBox({ p }: { p: PluginEditorProps }) {
  return (
    <Box title="Voice + Arp" color={NES.blue}>
      <Row gap={8}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <PixSeg p={p} id="voice.poly" color={NES.cyan} />
          <PixToggle p={p} id="voice.legato" />
        </div>
        <PK p={p} id="voice.limit" size={K} color={NES.cyan} />
        <PK p={p} id="voice.glide" size={K} color={NES.cyan} />
        <div style={{ width: 1, alignSelf: 'stretch', background: '#ffffff12' }} />
        <PK p={p} id="arp.speed" size={K} color={NES.pink} />
        <PK p={p} id="arp.oct" size={K} color={NES.pink} />
        <div style={{ paddingBottom: 4 }}>
          <PixToggle p={p} id="arp.retrig" label="Retrig" color={NES.pink} />
        </div>
      </Row>
      <PixSeg p={p} id="arp.mode" color={NES.pink} labels={['Off', 'Up', 'Down', 'Up/Dn', 'Rand', 'Played']} style={{ marginTop: 5 }} btnStyle={{ flex: 1 }} />
    </Box>
  )
}

function OutBox({ p }: { p: PluginEditorProps }) {
  return (
    <Box title="Output" color={NES.gray}>
      <Row gap={8}>
        <PK p={p} id="out.gain" size={K} color={NES.white} />
        <PK p={p} id="out.lpf" size={K} color={NES.white} />
        <PK p={p} id="out.stereo" size={K} color={NES.white} />
        <PixSelect p={p} id="out.rate" width={66} />
      </Row>
    </Box>
  )
}


/** Static scope: two cycles of the current oscillator (incl. the drawn GB wave and duty sequence step 0). */
function ScopeBox({ p }: { p: PluginEditorProps }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [data] = useChipData(p)
  const wave = Math.round(p.instance.params['osc.wave'] ?? 1)
  const dutySeq = (p.instance.params['seq.duty'] ?? 0) >= 0.5
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const w = c.clientWidth
    const h = c.clientHeight
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = NES.well
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#58d85418'
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 1, h)
    g.fillRect(0, Math.round(h / 2), w, 1)
    const osc = new ChipOsc()
    const table = waveTable(data.wave)
    const duty = dutySeq ? DUTIES[data.duty.values[0] & 3] : wave === W.P12 ? 0.125 : wave === W.P25 ? 0.25 : 0.5
    const dt = isNoise(wave) ? (wave === W.N4 ? 0.12 : 0.45) : 2 / w
    g.strokeStyle = NES.green
    g.lineWidth = 2
    g.shadowColor = NES.green
    g.shadowBlur = 6
    g.beginPath()
    const amp = (h / 2 - 5) / 1.75
    for (let x = 0; x < w; x++) {
      const v = osc.next(wave === W.NS && dutySeq && !(data.duty.values[0] & 1) ? W.NL : wave, dt, duty, false, table)
      const y = h / 2 - v * amp
      if (x === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }, [wave, data.wave, data.duty, dutySeq])
  return (
    <Box title="Scope" color={NES.dkgreen} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }} right={<span style={{ ...monoFont, fontSize: 8, color: NES.green }}>{WAVE_NAMES[wave]}</span>}>
      <canvas ref={ref} style={{ width: '100%', flex: 1, minHeight: 0, display: 'block', border: `2px solid ${NES.black}` }} onMouseEnter={() => p.hint(`Oscillator: ${WAVE_NAMES[wave]}`)} />
    </Box>
  )
}

const SEQ_TABS: { kind: SeqKind | 'wave'; label: string; param?: string; color: string }[] = [
  { kind: 'vol', label: 'Volume', param: 'seq.vol', color: NES.green },
  { kind: 'pitch', label: 'Pitch', param: 'seq.pitch', color: NES.cyan },
  { kind: 'duty', label: 'Duty', param: 'seq.duty', color: NES.yellow },
  { kind: 'wave', label: 'GB Wave', color: NES.blue }
]

function SeqBox({ p }: { p: PluginEditorProps }) {
  const [tab, setTab] = useState<SeqKind | 'wave'>('vol')
  const [data, update] = useChipData(p)
  const cur = SEQ_TABS.find((t) => t.kind === tab)!
  const W_ = 370
  const H_ = 224
  return (
    <Box title="Sequencer" color={NES.purple}>
      <div style={{ display: 'flex', gap: 2, marginBottom: 4, alignItems: 'center' }}>
        {SEQ_TABS.map((t) => {
          const on = t.param ? (p.instance.params[t.param] ?? 0) >= 0.5 : (p.instance.params['osc.wave'] ?? 0) === 8
          return (
            <PixButton key={t.kind} active={tab === t.kind} color={t.color} onClick={() => setTab(t.kind)} onHover={() => p.hint(`${t.label} ${t.kind === 'wave' ? 'table' : 'sequence'}${on ? ' (active)' : ''}`)} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                onClick={(e) => {
                  if (!t.param) return
                  e.stopPropagation()
                  p.setParam(t.param, on ? 0 : 1)
                  setTab(t.kind)
                }}
                title={t.param ? 'Enable / disable' : undefined}
                style={{ width: 7, height: 7, display: 'inline-block', background: on ? NES.green : '#3a3e46', border: `1px solid ${NES.black}` }}
              />
              {t.label}
            </PixButton>
          )
        })}
        <div style={{ marginLeft: 'auto' }}>
          <PixSelect p={p} id="seq.rate" width={92} />
        </div>
      </div>
      {tab === 'wave' ? (
        <>
          <WaveDrawer wave={data.wave} width={W_} height={H_} hint={p.hint} onChange={(w) => update((d) => ({ ...d, wave: w }))} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 4 }}>
            {Object.keys(WAVE_PRESETS).map((name) => (
              <PixButton key={name} color={NES.blue} onClick={() => update((d) => ({ ...d, wave: WAVE_PRESETS[name].slice() }))} onHover={() => p.hint(`Load wave: ${name}`)}>
                {name}
              </PixButton>
            ))}
            <PixButton color={NES.blue} onClick={() => update((d) => ({ ...d, wave: d.wave.map(() => Math.floor(Math.random() * 16)) }))} onHover={() => p.hint('Random wave')}>
              Rnd
            </PixButton>
            <PixButton color={NES.blue} onClick={() => update((d) => ({ ...d, wave: d.wave.map((_, i) => Math.round((d.wave[(i + 31) % 32] + 2 * d.wave[i] + d.wave[(i + 1) % 32]) / 4)) }))} onHover={() => p.hint('Smooth wave')}>
              Smooth
            </PixButton>
          </div>
        </>
      ) : (
        <>
          <SeqCanvas
            kind={tab}
            value={data[tab]}
            width={W_}
            height={H_}
            color={cur.color}
            enabled={(p.instance.params[cur.param!] ?? 0) >= 0.5}
            hint={p.hint}
            onChange={(s) => update((d) => ({ ...d, [tab]: s }))}
          />
          <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
            <span style={{ ...monoFont, fontSize: 9, color: NES.gray }}>LEN</span>
            <PixButton color={NES.purple} onClick={() => update((d) => ({ ...d, [tab]: resizeSeq(d[tab], d[tab].values.length - 1, tab) }))} onHover={() => p.hint('Shorter sequence')}>
              −
            </PixButton>
            <span style={{ ...monoFont, fontSize: 10, color: NES.green, minWidth: 16, textAlign: 'center' }}>{data[tab].values.length}</span>
            <PixButton color={NES.purple} onClick={() => update((d) => ({ ...d, [tab]: resizeSeq(d[tab], d[tab].values.length + 1, tab) }))} onHover={() => p.hint('Longer sequence')}>
              +
            </PixButton>
            <PixButton color={NES.purple} onClick={() => update((d) => ({ ...d, [tab]: { ...d[tab], loop: -1, release: -1 } }))} onHover={() => p.hint('Clear loop & release points')}>
              Clr L/R
            </PixButton>
            {tab === 'pitch' && <PixSeg p={p} id="seq.pitchMode" color={NES.cyan} labels={['Abs', 'Rel']} />}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ ...monoFont, fontSize: 9, color: NES.gray }}>SPEED</span>
              <PixButton color={NES.purple} onClick={() => p.setParam('seq.div', Math.max(1, (p.instance.params['seq.div'] ?? 1) - 1))} onHover={() => p.hint('Frames per step (slower <-> faster)')}>
                −
              </PixButton>
              <span style={{ ...monoFont, fontSize: 10, color: NES.green, minWidth: 26, textAlign: 'center' }}>{Math.round(p.instance.params['seq.div'] ?? 1)}FR</span>
              <PixButton color={NES.purple} onClick={() => p.setParam('seq.div', Math.min(16, (p.instance.params['seq.div'] ?? 1) + 1))} onHover={() => p.hint('Frames per step')}>
                +
              </PixButton>
            </div>
          </div>
        </>
      )}
    </Box>
  )
}

function SynthView({ p }: { p: PluginEditorProps }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: 6, height: 'calc(100% - 30px)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 384 }}>
        <OscBox p={p} />
        <BendBox p={p} />
        <EnvBox p={p} />
        <OutBox p={p} />
        <ScopeBox p={p} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
        <SeqBox p={p} />
        <VoiceBox p={p} />
      </div>
    </div>
  )
}

// ─── drum mode ───────────────────────────────────────────────────────────────
function DrumView({ p }: { p: PluginEditorProps }) {
  const kit = Math.round(p.instance.params['drum.kit'] ?? 0)
  const map = KIT_MAPS[kit] ?? KIT_MAPS[0]
  const defs = [...map.values()].sort((a, b) => a.key - b.key)
  const [sel, setSel] = useState(36)
  const [hit, setHit] = useState<number | null>(null)
  const [data, update] = useChipData(p)
  const def = map.get(sel)
  const tw: DrumTweak = data.drums[String(sel)] ?? { tune: 0, decay: 1, level: 1 }
  const setTw = (t: Partial<DrumTweak>): void =>
    update((d) => ({ ...d, drums: { ...d.drums, [String(sel)]: { ...(d.drums[String(sel)] ?? { tune: 0, decay: 1, level: 1 }), ...t } } }))
  const down = useRef<number | null>(null)
  const release = (): void => {
    if (down.current !== null) p.previewNote?.(down.current, 0.8, false)
    down.current = null
    setHit(null)
  }
  return (
    <div style={{ display: 'flex', gap: 8, padding: 6, height: 'calc(100% - 30px)' }}>
      <Box title={`Pads - ${DRUM_KITS[kit]}`} color={NES.pink} style={{ width: 556 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(11, 1fr)', gap: 3 }}>
          {defs.map((d) => {
            const c = GROUP_COLOR[d.group]
            const active = sel === d.key
            return (
              <button
                key={d.key}
                onMouseDown={(e) => {
                  e.preventDefault()
                  setSel(d.key)
                  if (e.button !== 0) return
                  down.current = d.key
                  setHit(d.key)
                  p.previewNote?.(d.key, 0.85, true)
                }}
                onMouseUp={release}
                onMouseLeave={() => down.current === d.key && release()}
                onMouseEnter={() => p.hint(`${keyName(d.key)} (${d.key}) — ${d.name} [${d.group}]`)}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  height: 64,
                  background: hit === d.key ? c : active ? '#3a3f4b' : '#262a33',
                  border: `2px solid ${NES.black}`,
                  boxShadow: `inset 0 -5px 0 ${c}${hit === d.key ? 'ff' : '99'}, inset 0 0 0 1px ${active ? NES.white : '#ffffff10'}`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                <span style={{ ...monoFont, fontSize: 8, color: hit === d.key ? NES.black : NES.gray }}>{keyName(d.key)}</span>
                <PixelText text={d.short} scale={1.5} color={hit === d.key ? NES.black : NES.white} shadow={null} />
              </button>
            )
          })}
        </div>
      </Box>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <Box title="Kit" color={NES.pink}>
          <PixSeg p={p} id="drum.kit" color={NES.pink} labels={['NES', 'Game Boy', 'Arcade']} btnStyle={{ flex: 1 }} />
          <Row gap={10} style={{ marginTop: 6 }}>
            <PK p={p} id="drum.tune" size={K} color={NES.pink} />
            <PK p={p} id="drum.decay" size={K} color={NES.pink} />
            <PK p={p} id="voice.vel" size={K} color={NES.pink} />
          </Row>
        </Box>
        <Box title="Selected Pad" color={def ? GROUP_COLOR[def.group] : NES.gray} style={{ flex: 1 }}>
          {def ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <PixelText text={def.name} scale={2} color={GROUP_COLOR[def.group]} />
              </div>
              <div style={{ ...monoFont, fontSize: 9, color: NES.gray, marginBottom: 6 }}>
                {keyName(def.key)} · KEY {def.key} · {def.group}
                <br />
                {def.layers.map((l) => WAVE_NAMES[l.wave]).join(' + ')}
              </div>
              <Row gap={10}>
                <Knob size={K} color={NES.white} label="Tune" bipolar value={(tw.tune + 24) / 48} onChange={(x) => setTw({ tune: Math.round(x * 48 - 24) })} onReset={() => setTw({ tune: 0 })} hint={`${def.name} tune: ${tw.tune > 0 ? '+' : ''}${tw.tune} st`} />
                <Knob size={K} color={NES.white} label="Decay" value={Math.log(tw.decay / 0.25) / Math.log(16)} onChange={(x) => setTw({ decay: 0.25 * Math.pow(16, x) })} onReset={() => setTw({ decay: 1 })} hint={`${def.name} decay: x${tw.decay.toFixed(2)}`} />
                <Knob size={K} color={NES.white} label="Level" value={tw.level / 1.5} onChange={(x) => setTw({ level: x * 1.5 })} onReset={() => setTw({ level: 1 })} hint={`${def.name} level: ${Math.round(tw.level * 100)}%`} />
              </Row>
              <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                <PixButton color={NES.yellow} onClick={() => update((d) => { const drums = { ...d.drums }; delete drums[String(sel)]; return { ...d, drums } })} onHover={() => p.hint('Reset this pad')}>
                  Reset Pad
                </PixButton>
                <PixButton color={NES.yellow} onClick={() => update((d) => ({ ...d, drums: {} }))} onHover={() => p.hint('Reset all pad tweaks')}>
                  Reset All
                </PixButton>
              </div>
            </>
          ) : (
            <span style={{ ...monoFont, fontSize: 9, color: NES.gray }}>NO DRUM ON THIS KEY</span>
          )}
        </Box>
        <Box title="Output" color={NES.gray}>
          <Row gap={8}>
            <PK p={p} id="out.gain" size={K} color={NES.white} />
            <PK p={p} id="out.lpf" size={K} color={NES.white} />
            <PixSelect p={p} id="out.rate" width={60} />
          </Row>
        </Box>
      </div>
    </div>
  )
}

export function ChiptuneEditor(p: PluginEditorProps) {
  const drums = (p.instance.params.mode ?? 0) >= 0.5
  return (
    <div
      style={{ width: '100%', height: '100%', background: `repeating-linear-gradient(0deg, #ffffff03 0 1px, transparent 1px 3px), ${NES.bg}`, color: NES.white, userSelect: 'none', overflow: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Header p={p} />
      {drums ? <DrumView p={p} /> : <SynthView p={p} />}
    </div>
  )
}
