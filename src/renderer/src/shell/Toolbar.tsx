import { useEffect, useRef, useState } from 'react'
import {
  AudioWaveform,
  ChevronDown,
  Circle,
  FolderTree,
  Grid3x3,
  ListMusic,
  Magnet,
  Pause,
  Piano,
  Play,
  Plug,
  Plus,
  SlidersVertical,
  Square,
  Timer,
  Repeat,
  Hourglass,
  Keyboard
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProject, editProject } from '@/store/project'
import { useTransport, playhead } from '@/store/transport'
import { useUI, SNAP_LABELS, type Snap } from '@/store/ui'
import { PPQ, TICKS_PER_STEP } from '@/store/types'
import { transport, getEngine } from '@/audio/transport'
import { addPattern, selectPattern } from '@/store/actions'
import { Knob } from '@/components/controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MainMenu } from './MainMenu'
import { WindowControls } from './WindowControls'
import { openPianoRoll } from '@/windows/pianoroll/open'
import { togglePluginPicker } from './PluginPicker'

function Btn({ active, onClick, title, children, className, color }: { active?: boolean; onClick?: (e: React.MouseEvent) => void; title: string; children: React.ReactNode; className?: string; color?: string }) {
  const setHint = useUI((s) => s.setHint)
  return (
    <button
      title={title}
      onMouseEnter={() => setHint(title)}
      onClick={onClick}
      className={cn('grid h-[26px] w-[26px] place-items-center rounded-[3px] border border-[#20272a] fl-bevel', active ? 'text-[#1c2124]' : 'bg-[#46525a] text-[#d3dade] hover:bg-[#53616a]', className)}
      style={active ? { background: color ?? 'var(--fl-orange)' } : undefined}
    >
      {children}
    </button>
  )
}

function PatSong() {
  const mode = useTransport((s) => s.mode)
  const setHint = useUI((s) => s.setHint)
  return (
    <div
      className="flex h-[52px] w-max shrink-0 cursor-pointer flex-col justify-center gap-1 rounded-[3px] border border-[#20272a] bg-[#3a454b] px-1.5 fl-bevel"
      onClick={() => transport.setMode(mode === 'pattern' ? 'song' : 'pattern')}
      onMouseEnter={() => setHint('Pattern / Song mode (L)')}
    >
      {(['pattern', 'song'] as const).map((m) => (
        <div key={m} className="flex items-center gap-1 text-[10px] font-bold">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              background: m === 'pattern' ? 'var(--fl-orange)' : 'var(--fl-green)',
              opacity: mode === m ? 1 : 0.35,
              boxShadow: mode === m ? `0 0 4px ${m === 'pattern' ? 'var(--fl-orange)' : 'var(--fl-green)'}` : undefined
            }}
          />
          <span className={mode === m ? 'text-white' : 'text-fl-dim'}>{m === 'pattern' ? 'PATTERN' : 'SONG'}</span>
        </div>
      ))}
    </div>
  )
}

function TransportButtons() {
  const playing = useTransport((s) => s.playing)
  const recording = useTransport((s) => s.recording)
  const mode = useTransport((s) => s.mode)
  return (
    <div className="flex items-center gap-1">
      <Btn title="Play / pause (Space)" active={playing} color={mode === 'pattern' ? 'var(--fl-orange)' : 'var(--fl-green)'} onClick={() => transport.togglePause()} className="h-[34px] w-[34px]">
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </Btn>
      <Btn title="Stop" onClick={() => transport.stop()} className="h-[34px] w-[34px]">
        <Square size={13} fill="currentColor" />
      </Btn>
      <Btn title="Record (R)" active={recording} color="var(--fl-red)" onClick={() => useTransport.getState().set({ recording: !recording })} className="h-[34px] w-[34px]">
        <Circle size={14} fill="currentColor" className={recording ? 'text-[#2a0d0b]' : 'text-[#ff6a5f]'} />
      </Btn>
    </div>
  )
}

function TempoDisplay() {
  const tempo = useProject((s) => s.project.tempo)
  const setHint = useUI((s) => s.setHint)
  const drag = useRef<{ y: number; v: number; fine: boolean } | null>(null)
  return (
    <div
      className="flex h-[34px] w-[74px] cursor-ns-resize flex-col items-end justify-center rounded-[3px] bg-fl-well px-1.5 fl-inset"
      onMouseEnter={() => setHint(`Tempo: ${tempo.toFixed(3)} BPM – drag, or wheel`)}
      onPointerDown={(e) => {
        // Right of the decimal point = fractional part.
        const decimals = (e.currentTarget as HTMLElement).querySelector('[data-decimals]')
        const fine = decimals ? e.clientX >= decimals.getBoundingClientRect().left : false
        drag.current = { y: e.clientY, v: tempo, fine }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        // Left of the decimal point: whole BPM only. Right of it: the fraction only.
        const steps = Math.round((d.y - e.clientY) / 4)
        const whole = Math.floor(d.v)
        const frac = Math.round((d.v - whole) * 1000)
        const v = d.fine
          ? whole + Math.min(999, Math.max(0, frac + steps * 10)) / 1000
          : Math.min(522, Math.max(10, whole + steps)) + frac / 1000
        editProject('Tempo', (p) => void (p.tempo = v), { coalesceKey: 'tempo' })
      }}
      onPointerUp={() => (drag.current = null)}
      onWheel={(e) => editProject('Tempo', (p) => void (p.tempo = Math.min(522, Math.max(10, Math.floor(p.tempo) - Math.sign(e.deltaY))) + (p.tempo % 1)), { coalesceKey: 'tempo' })}
    >
      <span className="font-mono text-[17px] leading-none text-[#e9f3ff]">
        {Math.floor(tempo)}
        <span data-decimals className="text-[12px] text-[#9fb2bd]">.{(tempo % 1).toFixed(3).slice(2)}</span>
      </span>
      <span className="text-[8px] uppercase tracking-wider text-fl-dim">tempo</span>
    </div>
  )
}

function TimeDisplay() {
  const ref = useRef<HTMLSpanElement>(null)
  const [msMode, setMsMode] = useState(true)
  const timeSig = useProject((s) => s.project.timeSig)
  const tempo = useProject((s) => s.project.tempo)
  useEffect(() => {
    const render = (tick: number) => {
      if (!ref.current) return
      if (msMode) {
        const sec = (tick / PPQ) * (60 / tempo)
        const m = Math.floor(sec / 60)
        const s = Math.floor(sec % 60)
        const cs = Math.floor((sec * 100) % 100)
        ref.current.textContent = `${m}:${String(s).padStart(2, '0')}:${String(cs).padStart(2, '0')}`
      } else {
        const stepsPerBar = (16 * timeSig[0]) / timeSig[1]
        const step = Math.floor(tick / TICKS_PER_STEP)
        const bar = Math.floor(step / stepsPerBar) + 1
        const st = (step % stepsPerBar) + 1
        const tk = Math.floor(tick % TICKS_PER_STEP)
        ref.current.textContent = `${bar}:${String(st).padStart(2, '0')}:${String(tk).padStart(2, '0')}`
      }
    }
    render(playhead.tick)
    return playhead.subscribe(render)
  }, [msMode, timeSig, tempo])
  return (
    <div className="flex h-[34px] cursor-pointer items-center gap-1 rounded-[3px] bg-fl-well px-2 fl-inset" onClick={() => setMsMode(!msMode)} title="Song position – click to switch B:S:T / M:S:CS">
      <span ref={ref} className="min-w-[96px] text-right font-mono text-[22px] leading-none tracking-wide text-[#e9f3ff]" />
      <span className="flex flex-col text-[8px] leading-tight text-fl-dim">
        <span>{msMode ? 'M:S' : 'B:S'}</span>
        <span>{msMode ? 'CS' : 'T'}</span>
      </span>
    </div>
  )
}

/** Master output oscilloscope + peak meter (FL's top "wave" monitor). */
function Monitor() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    const data = new Float32Array(1024)
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = canvas.current
      const e = getEngine()
      if (!c) return
      const g = c.getContext('2d')!
      const w = c.width
      const h = c.height
      g.fillStyle = '#1a1f22'
      g.fillRect(0, 0, w, h)
      const m = e?.mixer[0]
      if (!m) return
      m.analyser.getFloatTimeDomainData(data)
      g.strokeStyle = '#8fe34a'
      g.lineWidth = 1
      g.beginPath()
      for (let x = 0; x < w; x++) {
        const v = data[Math.floor((x / w) * data.length)]
        const y = h / 2 - v * (h / 2) * 0.9
        if (x === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={canvas} width={110} height={34} className="rounded-[3px] fl-inset" title="Master output" />
}

function PeakMeter() {
  const l = useRef<HTMLDivElement>(null)
  const r = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let pl = 0
    let pr = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const m = getEngine()?.mixer[0]?.meter
      pl = Math.max((m?.peakL ?? 0), pl * 0.9)
      pr = Math.max((m?.peakR ?? 0), pr * 0.9)
      const toW = (p: number) => `${Math.min(100, Math.max(0, (1 + Math.log10(Math.max(p, 1e-4)) / 3) * 100))}%`
      if (l.current) l.current.style.width = toW(pl)
      if (r.current) r.current.style.width = toW(pr)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="flex h-[34px] w-[60px] flex-col justify-center gap-1 rounded-[3px] bg-fl-well px-1 fl-inset" title="Master peak">
      {[l, r].map((ref, i) => (
        <div key={i} className="h-[6px] w-full overflow-hidden rounded-[1px] bg-[#252c30]">
          <div ref={ref} className="h-full bg-gradient-to-r from-[#5fd13b] via-[#e3e34a] to-[#ff5d55]" style={{ width: 0 }} />
        </div>
      ))}
    </div>
  )
}

function CpuMem() {
  const [s, set] = useState({ cpu: 0, mem: 0 })
  useEffect(() => {
    const id = setInterval(() => {
      const proc = (globalThis as { process?: { getCPUUsage?: () => { percentCPUUsage: number }; memoryUsage?: () => { rss: number } } }).process
      const cpu = proc?.getCPUUsage?.().percentCPUUsage ?? 0
      const mem = proc?.memoryUsage ? proc.memoryUsage().rss / 1048576 : ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576
      set({ cpu, mem })
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex h-[34px] flex-col justify-center rounded-[3px] bg-fl-well px-1.5 font-mono text-[10px] leading-tight text-[#9fb2bd] fl-inset" title="CPU / memory">
      <span>{Math.round(s.mem)} MB</span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-1 w-8 overflow-hidden rounded-[1px] bg-[#252c30]">
          <span className="block h-full bg-fl-green" style={{ width: `${Math.min(100, s.cpu)}%` }} />
        </span>
        {Math.round(s.cpu)}
      </span>
    </div>
  )
}

function MasterKnobs() {
  const vol = useProject((s) => s.project.masterVolume)
  const pitch = useProject((s) => s.project.masterPitch)
  return (
    <div className="flex items-center gap-1 self-end pb-px">
      <Knob size={24} value={vol / 1.25} labelPosition="none" color="var(--fl-green)" hint={`Master volume: ${Math.round((vol / 0.8) * 100)}%`} onChange={(v) => editProject('Master volume', (d) => void (d.masterVolume = v * 1.25), { coalesceKey: 'mvol' })} onReset={() => editProject('Master volume', (d) => void (d.masterVolume = 0.8))} />
      <Knob size={24} value={(pitch + 1200) / 2400} bipolar labelPosition="none" color="var(--fl-orange)" hint={`Master pitch: ${pitch} cents`} onChange={(v) => editProject('Master pitch', (d) => void (d.masterPitch = Math.round(v * 2400 - 1200)), { coalesceKey: 'mpitch' })} onReset={() => editProject('Master pitch', (d) => void (d.masterPitch = 0))} />
    </div>
  )
}

function RecordingToggles() {
  const t = useTransport()
  const typing = useUI((s) => s.typingKeyboard)
  return (
    <div className="grid grid-cols-3 gap-px">
      <Btn title="Metronome (Ctrl+M)" active={t.metronome} onClick={() => t.set({ metronome: !t.metronome })} className="h-[17px] w-[22px]">
        <Timer size={11} />
      </Btn>
      <Btn title="Wait for input to start recording (Ctrl+I)" active={t.waitForInput} onClick={() => t.set({ waitForInput: !t.waitForInput })} className="h-[17px] w-[22px]">
        <Hourglass size={11} />
      </Btn>
      <Btn title="Countdown before recording (Ctrl+P)" active={t.precount} onClick={() => t.set({ precount: !t.precount })} className="h-[17px] w-[22px]">
        <span className="text-[9px] font-bold">3.2</span>
      </Btn>
      <Btn title="Loop recording" active={t.loopRecord} onClick={() => t.set({ loopRecord: !t.loopRecord })} className="h-[17px] w-[22px]">
        <Repeat size={11} />
      </Btn>
      <Btn title="Typing keyboard to piano keyboard (Ctrl+T)" active={typing} onClick={() => useUI.getState().set({ typingKeyboard: !typing })} className="h-[17px] w-[22px]">
        <Keyboard size={11} />
      </Btn>
      <Btn title="Step edit mode (Ctrl+E)" active={useUI.getState().stepEditMode} onClick={() => useUI.getState().set({ stepEditMode: !useUI.getState().stepEditMode })} className="h-[17px] w-[22px]">
        <span className="text-[9px] font-bold">S</span>
      </Btn>
    </div>
  )
}

function SnapSelector() {
  const snap = useUI((s) => s.globalSnap)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-[22px] items-center gap-1 rounded-[3px] border border-[#20272a] bg-[#3a454b] px-1.5 text-[11px] fl-bevel" title="Global snap">
        <Magnet size={11} className="text-fl-orange" />
        {SNAP_LABELS[snap]}
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {(Object.keys(SNAP_LABELS) as Snap[]).filter((s) => s !== 'main').map((s) => (
          <DropdownMenuItem key={s} onSelect={() => useUI.getState().set({ globalSnap: s })}>
            {SNAP_LABELS[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WindowButtons() {
  const w = useUI((s) => s.windows)
  const browser = useUI((s) => s.browserVisible)
  const ui = useUI.getState()
  const open = (id: string) => w[id]?.open && !w[id]?.minimized
  return (
    <div className="flex items-center gap-1">
      <Btn title="Playlist (F5)" active={open('playlist')} onClick={() => ui.toggleWindow('playlist', { kind: 'playlist', title: 'Playlist - Arrangement' })}>
        <ListMusic size={14} />
      </Btn>
      <Btn title="Piano roll (F7)" active={open('pianoRoll')} onClick={() => (open('pianoRoll') ? ui.closeWindow('pianoRoll') : openPianoRoll())}>
        <Piano size={14} />
      </Btn>
      <Btn title="Channel rack (F6)" active={open('channelRack')} onClick={() => ui.toggleWindow('channelRack', { kind: 'channelRack', title: 'Channel rack' })}>
        <Grid3x3 size={14} />
      </Btn>
      <Btn title="Mixer (F9)" active={open('mixer')} onClick={() => ui.toggleWindow('mixer', { kind: 'mixer', title: 'Mixer' })}>
        <SlidersVertical size={14} />
      </Btn>
      <Btn title="Browser (Alt+F8)" active={browser} onClick={() => ui.set({ browserVisible: !browser })}>
        <FolderTree size={14} />
      </Btn>
      <Btn title="Plugin picker (F8)" active={open('pluginPicker')} onClick={() => togglePluginPicker()}>
        <Plug size={14} />
      </Btn>
      <Btn title="Audio editor / recorder" onClick={() => ui.set({ hint: 'Audio clips: drag audio into the playlist' })}>
        <AudioWaveform size={14} />
      </Btn>
    </div>
  )
}

function HintBar() {
  const hint = useUI((s) => s.hint)
  return <div className="h-[18px] truncate rounded-[2px] bg-fl-well px-1.5 text-[11px] leading-[18px] text-[#d6dde0] fl-inset">{hint}</div>
}

/** The FL Studio header: menu + hint panel on the left, transport and tools to the right. */
export function Toolbar() {
  const name = useProject((s) => s.project.name)
  const dirty = useProject((s) => s.dirty)
  return (
    <div className="flex h-[62px] shrink-0 items-stretch gap-2 border-b border-[#14191b] bg-gradient-to-b from-[#435056] to-[#363f44] px-1.5 py-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex w-[310px] shrink-0 flex-col justify-between" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <MainMenu />
        <div className="flex items-center gap-1">
          <span className="truncate text-[10px] text-fl-dim">{name}{dirty ? ' *' : ''}</span>
        </div>
        <HintBar />
      </div>
      <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <MasterKnobs />
        <PatSong />
        <TransportButtons />
        <TempoDisplay />
        <TimeDisplay />
        <Monitor />
        <PeakMeter />
        <CpuMem />
        <RecordingToggles />
      </div>
      <div className="flex flex-col justify-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex items-center gap-1">
          <SnapSelector />
        </div>
        <WindowButtons />
      </div>
      <div className="flex-1" />
      <WindowControls />
    </div>
  )
}
