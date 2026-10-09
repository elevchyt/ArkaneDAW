// FL "Settings – Audio / MIDI" window (OPTIONS > Audio settings). Tabs: Audio · Recording · MIDI.
import { useCallback, useEffect, useState } from 'react'
import { Activity, Mic, Music2, Play, RefreshCw, Volume2 } from 'lucide-react'
import { MdiWindow } from '@/shell/MdiWindow'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Led } from '@/components/controls/LedButton'
import { cn } from '@/lib/utils'
import { useUI } from '@/store/ui'
import { useProject } from '@/store/project'
import { useTransport } from '@/store/transport'
import type { WindowProps } from '../types'
import { useAudioSettings, type AudioSettings } from './settings-store'
import { applyOutputDevice, audioInfo, canSelectOutput, listDevices, playTestTone, requestDeviceLabels, type AudioInfo, type DeviceInfo } from './devices'
import { calibrateLatency, isTrackMonitoring, setTrackMonitoring, useAudioInputs } from '@/audio/audio-recording'
import { initMidi, midiPanic, rescanMidi, setMidiInputEnabled, useMidi } from '@/audio/midi'

const DEFAULT = '__default__'
const hint = (s: string) => useUI.getState().setHint(s)

// ── small FL-styled primitives ────────────────────────────────────────────────

function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mb-2 rounded-[3px] border border-[#1f2629] bg-fl-panel-2">
      <div className="flex h-[18px] items-center gap-1.5 border-b border-[#1f2629] bg-[#2b3337] px-2 text-[10px] font-semibold uppercase tracking-wide text-fl-dim">
        {icon}
        {title}
      </div>
      <div className="flex flex-col gap-1.5 p-2">{children}</div>
    </div>
  )
}

function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex min-h-[22px] items-center gap-2" title={title} onPointerEnter={() => title && hint(title)}>
      <span className="w-[130px] shrink-0 text-fl-dim">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

function FlSelect({ value, onChange, options, className, hintText }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string; hintText?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className={cn('h-[20px] data-[size=sm]:h-[20px] min-w-0 flex-1 rounded-[2px] border-[#151a1c] bg-fl-well px-1.5 py-0 text-[11px] text-fl-text fl-inset dark:bg-fl-well dark:hover:bg-[#232a2e]', className)}
        onPointerEnter={() => hintText && hint(hintText)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="z-[300000] max-h-[50vh] rounded-[3px] border-[#151a1c] bg-[#2b3337] text-[11px] text-fl-text">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="py-1 text-[11px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Check({ checked, onChange, label, title }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string }) {
  return (
    <button
      className="flex items-center gap-1.5 text-left text-fl-text hover:text-white"
      title={title}
      onPointerEnter={() => hint(title ?? label)}
      onClick={() => onChange(!checked)}
    >
      <LedDot on={checked} />
      <span>{label}</span>
    </button>
  )
}

/** Non-interactive LED (Led itself is a <button>, which can't nest in another button). */
function LedDot({ on, color = 'var(--fl-green)', size = 9 }: { on: boolean; color?: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full border border-[#141819]"
      style={{ width: size, height: size, background: on ? color : 'var(--fl-led-off)', boxShadow: on ? `0 0 6px ${color}` : 'inset 0 1px 1px rgba(0,0,0,.6)' }}
    />
  )
}

function Btn({ children, onClick, title, disabled, active }: { children: React.ReactNode; onClick: () => void; title?: string; disabled?: boolean; active?: boolean }) {
  return (
    <button
      disabled={disabled}
      title={title}
      onPointerEnter={() => title && hint(title)}
      onClick={onClick}
      className={cn(
        'flex h-[20px] shrink-0 items-center gap-1 rounded-[3px] border border-[#1e2427] px-2 text-[11px] fl-bevel disabled:opacity-40',
        active ? 'bg-fl-orange text-[#1b1f22]' : 'bg-[#46525a] text-fl-text hover:bg-[#515e66]'
      )}
    >
      {children}
    </button>
  )
}

function Slider({ value, min, max, step, onChange, fmt, title }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; title: string }) {
  return (
    <div className="flex flex-1 items-center gap-2" onPointerEnter={() => hint(`${title}: ${fmt(value)}`)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          onChange(v)
          hint(`${title}: ${fmt(v)}`)
        }}
        className="h-1 flex-1 cursor-pointer accent-[var(--fl-orange)]"
      />
      <span className="w-[56px] shrink-0 rounded-[2px] px-1 text-right fl-lcd">{fmt(value)}</span>
    </div>
  )
}

function NumberField({ value, onChange, min, max, step = 1, suffix, title }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string; title: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const v = Number(text)
    if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
    else setText(String(value))
  }
  return (
    <div className="flex items-center gap-1" onPointerEnter={() => hint(title)}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            onChange(Math.max(min, Math.min(max, value + (e.key === 'ArrowUp' ? step : -step))))
          }
        }}
        className="h-[20px] w-[64px] rounded-[2px] px-1 text-right outline-none fl-lcd"
      />
      {suffix && <span className="text-fl-dim">{suffix}</span>}
    </div>
  )
}

function LevelBar({ level }: { level: number }) {
  const db = level > 0 ? 20 * Math.log10(level) : -90
  const pct = Math.max(0, Math.min(1, (db + 60) / 60)) * 100
  return (
    <div className="relative h-[6px] w-[80px] overflow-hidden rounded-[1px] bg-fl-well fl-inset" title={`${db.toFixed(1)} dBFS`}>
      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: db > -1 ? 'var(--fl-red)' : db > -12 ? 'var(--fl-orange)' : 'var(--fl-green)' }} />
    </div>
  )
}

// ── tabs ─────────────────────────────────────────────────────────────────────

function useDevices() {
  const [dev, setDev] = useState<{ outputs: DeviceInfo[]; inputs: DeviceInfo[]; labelled: boolean }>({ outputs: [], inputs: [], labelled: true })
  const refresh = useCallback(() => void listDevices().then(setDev), [])
  useEffect(() => {
    refresh()
    const md = navigator.mediaDevices
    md?.addEventListener?.('devicechange', refresh)
    return () => md?.removeEventListener?.('devicechange', refresh)
  }, [refresh])
  return { ...dev, refresh }
}

function AudioTab({ s, update }: { s: AudioSettings; update: (p: Partial<AudioSettings>) => void }) {
  const { outputs, inputs, labelled, refresh } = useDevices()
  const [info, setInfo] = useState<AudioInfo | null>(audioInfo())
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => setInfo(audioInfo()), 1000)
    return () => clearInterval(id)
  }, [])
  const ms = (x: number) => `${(x * 1000).toFixed(1)} ms`
  return (
    <>
      <Section title="Output" icon={<Volume2 size={10} />}>
        <Row label="Device" title="Audio output device (PulseAudio / PipeWire sink)">
          <FlSelect
            value={s.outputDeviceId || DEFAULT}
            onChange={(v) => {
              const id = v === DEFAULT ? '' : v
              update({ outputDeviceId: id })
              void applyOutputDevice(id).then((e) => {
                setErr(e)
                if (e) hint(e)
              })
            }}
            options={[{ value: DEFAULT, label: 'System default' }, ...outputs.map((d) => ({ value: d.id, label: d.label }))]}
            hintText="Audio output device"
          />
          <Btn onClick={() => void playTestTone()} title="Play a short 440 Hz test tone">
            <Play size={10} /> Test
          </Btn>
        </Row>
        {!canSelectOutput() && <div className="text-[10px] text-fl-dim">Output device selection is not supported by this runtime — the system default is used.</div>}
        {err && <div className="text-[10px] text-[var(--fl-red)]">{err}</div>}
        <Row label="Status">
          {info ? (
            <span className="rounded-[2px] px-1.5 py-[1px] fl-lcd">
              {info.sampleRate} Hz · base {ms(info.baseLatency)} · output {ms(info.outputLatency)} · {info.state}
            </span>
          ) : (
            <span className="text-fl-dim">Audio not started (click anywhere / press play)</span>
          )}
        </Row>
      </Section>
      <Section title="Input" icon={<Mic size={10} />}>
        <Row label="Default input" title="Input used by mixer tracks without their own input device">
          <FlSelect
            value={s.inputDeviceId || DEFAULT}
            onChange={(v) => update({ inputDeviceId: v === DEFAULT ? '' : v })}
            options={[{ value: DEFAULT, label: 'System default' }, ...inputs.map((d) => ({ value: d.id, label: d.label }))]}
            hintText="Default recording input"
          />
          <Btn onClick={refresh} title="Rescan audio devices">
            <RefreshCw size={10} />
          </Btn>
        </Row>
        {!labelled && (
          <Row label="">
            <Btn onClick={() => void requestDeviceLabels().then((e) => (e ? hint(`Input permission: ${e}`) : refresh()))} title="Allow audio input to see device names">
              Show device names…
            </Btn>
          </Row>
        )}
        <Row label="Channels" title="Requested input channel count">
          <FlSelect value={String(s.inputChannels)} onChange={(v) => update({ inputChannels: v === '1' ? 1 : 2 })} options={[{ value: '2', label: 'Stereo (2)' }, { value: '1', label: 'Mono (1)' }]} />
        </Row>
        <Row label="Processing">
          <Check
            checked={!s.inputProcessing}
            onChange={(v) => update({ inputProcessing: !v })}
            label="Raw input (no echo cancellation / noise suppression / AGC)"
            title="Disable the browser's voice processing — keep on for music"
          />
        </Row>
      </Section>
      <Section title="Metronome" icon={<Activity size={10} />}>
        <Row label="Volume" title="Count-in click volume">
          <Slider value={s.metronomeVolume} min={0} max={1} step={0.01} onChange={(v) => update({ metronomeVolume: v })} fmt={(v) => `${Math.round(v * 100)}%`} title="Metronome volume" />
        </Row>
      </Section>
    </>
  )
}

function RecordingTab({ s, update }: { s: AudioSettings; update: (p: Partial<AudioSettings>) => void }) {
  const mixer = useProject((st) => st.project.mixer)
  const levels = useAudioInputs((st) => st.levels)
  const inputError = useAudioInputs((st) => st.error)
  const recording = useAudioInputs((st) => st.recordingTracks)
  const precount = useTransport((t) => t.precount)
  const waitForInput = useTransport((t) => t.waitForInput)
  const loopRecord = useTransport((t) => t.loopRecord)
  const [cal, setCal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const armed = mixer.filter((t) => t.armed && t.index > 0)
  const info = audioInfo()
  const est = info ? (info.baseLatency + info.outputLatency) * 1000 : null
  return (
    <>
      <Section title="Notes" icon={<Music2 size={10} />}>
        <Row label="Quantize" title="Quantize recorded notes to the global snap (Step / Beat / Bar…; Line and none keep timing as played)">
          <Check checked={s.quantizeStart} onChange={(v) => update({ quantizeStart: v })} label="Start time" />
          <Check checked={s.quantizeEnd} onChange={(v) => update({ quantizeEnd: v })} label="End time" />
        </Row>
        <Row label="Countdown" title="Bars of metronome count-in before recording (toolbar countdown button / Ctrl+P)">
          <FlSelect value={String(s.precountBars)} onChange={(v) => update({ precountBars: Number(v) })} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} bar${n > 1 ? 's' : ''}` }))} className="max-w-[90px]" />
          <Check checked={precount} onChange={(v) => useTransport.getState().set({ precount: v })} label="Enabled" />
        </Row>
        <Row label="Start" title="Wait for input: with record armed, playback starts on the first note you play (Ctrl+I)">
          <Check checked={waitForInput} onChange={(v) => useTransport.getState().set({ waitForInput: v })} label="Wait for input to start" />
        </Row>
        <Row label="Mode" title="Loop recording ON = overdub (notes accumulate each pass); OFF = replace notes under the recorded range">
          <Check checked={loopRecord} onChange={(v) => useTransport.getState().set({ loopRecord: v })} label={loopRecord ? 'Loop record — overdub' : 'Replace'} />
        </Row>
      </Section>
      <Section title="Audio" icon={<Mic size={10} />}>
        <Row label="Latency comp." title="Shift recordings earlier by the device latency (or the calibrated loopback value)">
          <Check checked={s.autoLatencyComp} onChange={(v) => update({ autoLatencyComp: v })} label="Automatic" />
          <span className="text-[10px] text-fl-dim">
            {s.calibratedLatencyMs != null ? `calibrated ${s.calibratedLatencyMs} ms` : est != null ? `reported ≈ ${est.toFixed(1)} ms + input` : ''}
          </span>
        </Row>
        <Row label="Offset" title="Extra manual offset in ms (positive = move recordings earlier)">
          <NumberField value={s.latencyOffsetMs} onChange={(v) => update({ latencyOffsetMs: v })} min={-500} max={500} step={0.5} suffix="ms" title="Recording offset (ms)" />
        </Row>
        <Row label="Calibrate" title="Plays 4 clicks and listens for them on the default input. Use a loopback cable (output → input), or hold the mic near a speaker.">
          <Btn
            disabled={busy}
            active={busy}
            onClick={() => {
              setBusy(true)
              setCal('Listening…')
              void calibrateLatency((m) => setCal(m))
                .then((ms) => {
                  if (ms != null) update({ calibratedLatencyMs: ms })
                })
                .catch((e) => setCal(String(e)))
                .finally(() => setBusy(false))
            }}
            title="Measure round-trip latency with a loopback"
          >
            Loopback test…
          </Btn>
          {s.calibratedLatencyMs != null && (
            <Btn onClick={() => update({ calibratedLatencyMs: null })} title="Forget the measured latency (use reported device latency)">
              Clear
            </Btn>
          )}
          {cal && <span className="truncate text-[10px] text-fl-dim">{cal}</span>}
        </Row>
        <Row label="Pattern mode" title="FL makes an audio clip channel; also put the clip at the song start in the playlist">
          <Check checked={s.patternAudioToPlaylist} onChange={(v) => update({ patternAudioToPlaylist: v })} label="Also place clips in playlist (bar 1)" />
        </Row>
        <div className="mt-1 text-[10px] text-fl-dim">Armed mixer tracks (arm in the Mixer, then press record + play):</div>
        {inputError && <div className="text-[10px] text-[var(--fl-red)]">{inputError}</div>}
        {armed.length === 0 && <div className="pl-2 text-[10px] text-fl-dim">— none —</div>}
        {armed.map((t) => (
          <div key={t.index} className="flex items-center gap-2 pl-2">
            <span className={cn('w-[120px] truncate', recording.includes(t.index) && 'text-[var(--fl-red)]')}>
              {t.index}. {t.name}
            </span>
            <LevelBar level={levels[t.index] ?? 0} />
            <Check checked={isTrackMonitoring(t.index) && !s.monitorOff[t.index]} onChange={(v) => setTrackMonitoring(t.index, v)} label="Monitor" title="Hear the input through this insert's effects" />
            <span className="truncate text-[10px] text-fl-dim">{t.inputChannel}</span>
          </div>
        ))}
      </Section>
    </>
  )
}

function MidiTab({ s, update }: { s: AudioSettings; update: (p: Partial<AudioSettings>) => void }) {
  const { status, inputs, error, lastEvent, activity } = useMidi()
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    if (status === 'idle') void initMidi()
  }, [status])
  const selected = inputs.find((i) => i.id === sel) ?? inputs[0]
  return (
    <>
      <Section title="Input" icon={<Music2 size={10} />}>
        <div className="min-h-[70px] rounded-[2px] bg-fl-well fl-inset">
          {inputs.length === 0 && (
            <div className="p-2 text-[10px] text-fl-dim">
              {status === 'unsupported' ? 'Web MIDI is not available in this runtime.' : status === 'denied' ? `MIDI access denied${error ? `: ${error}` : ''}` : status === 'pending' ? 'Connecting…' : 'No MIDI inputs found. Plug in a controller and press Rescan.'}
            </div>
          )}
          {inputs.map((i) => {
            const on = s.midiEnabled[i.id] !== false
            return (
              <div
                key={i.id}
                className={cn('flex h-[20px] cursor-default items-center gap-2 px-2', selected?.id === i.id && 'bg-[#3d4a51]')}
                onClick={() => setSel(i.id)}
              >
                <Led on={on} size={9} onClick={(e) => (e.stopPropagation(), setMidiInputEnabled(i.id, !on))} title="Enable" />
                <span className={cn('flex-1 truncate', !on && 'text-fl-dim')}>{i.name}</span>
                <span className="truncate text-[10px] text-fl-dim">{i.manufacturer}</span>
                {i.state !== 'connected' && <span className="text-[10px] text-[var(--fl-red)]">offline</span>}
              </div>
            )
          })}
        </div>
        {selected && (
          <Row label="Controller type" title="Controller script — generic handles notes, pitch bend, mod wheel and sustain">
            <FlSelect
              value={s.midiControllerType[selected.id] ?? 'generic'}
              onChange={(v) => update({ midiControllerType: { ...s.midiControllerType, [selected.id]: v } })}
              options={[{ value: 'generic', label: '(generic controller)' }]}
            />
            <Check checked={s.midiEnabled[selected.id] !== false} onChange={(v) => setMidiInputEnabled(selected.id, v)} label="Enable" />
          </Row>
        )}
        <Row label="">
          <Btn
            onClick={rescanMidi}
            title="Rescan MIDI devices"
          >
            <RefreshCw size={10} /> Rescan
          </Btn>
          <Btn onClick={midiPanic} title="Release all MIDI notes and the sustain pedal">
            All notes off
          </Btn>
          <span className="flex items-center gap-1 text-[10px] text-fl-dim">
            <LedDot on={activity % 2 === 1} size={7} color="var(--fl-orange)" /> {lastEvent || 'no events yet'}
          </span>
        </Row>
      </Section>
      <Section title="Routing">
        <Row label="MIDI channel" title="Omni: every MIDI channel plays the selected channel. Per channel: MIDI ch N plays rack channel N">
          <FlSelect
            value={s.midiChannelMode}
            onChange={(v) => update({ midiChannelMode: v as AudioSettings['midiChannelMode'] })}
            options={[
              { value: 'omni', label: 'Omni → selected channel' },
              { value: 'perChannel', label: 'MIDI channel N → rack channel N' }
            ]}
          />
        </Row>
        <Row label="Foot pedal" title="Sustain pedal (CC64) holds note-offs until released">
          <Check checked={s.midiSustain} onChange={(v) => update({ midiSustain: v })} label="Foot pedal controls note off" />
        </Row>
        <Row label="Pitch bend range" title="Pitch wheel range in semitones">
          <NumberField value={s.midiBendRange} onChange={(v) => update({ midiBendRange: v })} min={1} max={48} suffix="st" title="Pitch bend range" />
        </Row>
        <Row label="Mod wheel" title="CC1 sets Mod X (filter cutoff on native synths) of new notes">
          <Check checked={s.midiModWheelToModX} onChange={(v) => update({ midiModWheelToModX: v })} label="Link to note Mod X" />
        </Row>
        <Row label="Velocity curve" title="Link note-on velocity: curve (soft ↔ hard)">
          <Slider value={s.midiVelocityCurve} min={-1} max={1} step={0.05} onChange={(v) => update({ midiVelocityCurve: v })} fmt={(v) => (Math.abs(v) < 0.01 ? 'linear' : v.toFixed(2))} title="Velocity curve" />
        </Row>
      </Section>
    </>
  )
}

export default function AudioSettingsWindow({ win, bounds }: WindowProps) {
  const s = useAudioSettings()
  const update = s.update
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem('arkane.audioSettings.tab') ?? 'audio'
    } catch {
      return 'audio'
    }
  })
  const pick = (v: string) => {
    setTab(v)
    try {
      localStorage.setItem('arkane.audioSettings.tab', v)
    } catch {
      /* ignore */
    }
  }
  const trig = '!h-[18px] flex-none rounded-[2px] px-3 text-[11px] text-fl-dim data-[state=active]:bg-fl-orange data-[state=active]:text-[#1b1f22] dark:data-[state=active]:bg-fl-orange dark:data-[state=active]:text-[#1b1f22] dark:data-[state=active]:border-transparent'
  return (
    <MdiWindow win={win} bounds={bounds} minW={440} minH={300}>
      <Tabs value={tab} onValueChange={pick} className="flex h-full flex-col gap-0 text-[11px] text-fl-text">
        <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-[#1d2326] bg-[#2a3236] px-2">
          <TabsList className="!h-[22px] gap-0.5 rounded-[3px] bg-fl-well p-[1px] fl-inset">
            <TabsTrigger value="audio" className={trig}>
              Audio
            </TabsTrigger>
            <TabsTrigger value="recording" className={trig}>
              Recording
            </TabsTrigger>
            <TabsTrigger value="midi" className={trig}>
              MIDI
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          <Btn onClick={() => s.reset()} title="Reset audio / MIDI settings to defaults">
            Reset
          </Btn>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <TabsContent value="audio">
            <AudioTab s={s} update={update} />
          </TabsContent>
          <TabsContent value="recording">
            <RecordingTab s={s} update={update} />
          </TabsContent>
          <TabsContent value="midi">
            <MidiTab s={s} update={update} />
          </TabsContent>
        </div>
      </Tabs>
    </MdiWindow>
  )
}
