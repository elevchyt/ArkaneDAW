// FL Studio style "Rendering to <file>" dialog: project type, output format, quality, split options,
// progress bar and Start / Cancel.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { FolderOpen } from 'lucide-react'
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleButton } from '@/components/controls'
import { cn } from '@/lib/utils'
import { host } from '@/platform'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { useTransport } from '@/store/transport'
import { barTicks } from '@/audio/sequence'
import { usedMixerTracks } from '@/audio/engine'
import { CancelledError, MAX_TAIL_SECONDS, exportProject, projectSpan, type ExportProgress } from '@/audio/export'
import {
  MP3_BITRATES,
  OPUS_BITRATES,
  ditherApplies,
  encoderKey,
  estimateBytes,
  FFMPEG_ENCODER,
  fileExtension,
  formatBytes,
  formatDuration,
  formatLabel,
  needsFfmpeg,
  sanitizeSettings,
  splitPath,
  withExtension,
  type ExportFormat,
  type ExportSettings,
  type OggCodec
} from './core'
import { mixerStems, playlistStems } from './split'
import { detectFfmpeg, rendererChildProcess, type FfmpegInfo } from './ffmpeg'
import { closeExportWizard, useExportWizard } from './store'

const STORAGE_KEY = 'arkane.exportSettings'
const AUDIO_EXT = /\.(wav|mp3|ogg|oga|opus|flac)$/i

function loadSettings(): ExportSettings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return sanitizeSettings(null)
  }
}
function saveSettings(s: ExportSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable */
  }
}

let ffmpegProbe: Promise<FfmpegInfo | null> | null = null
function probeFfmpeg(): Promise<FfmpegInfo | null> {
  if (!host) return Promise.resolve(null)
  if (!ffmpegProbe) ffmpegProbe = detectFfmpeg(rendererChildProcess()).catch(() => null)
  return ffmpegProbe
}

const baseName = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1)

// ── small FL-look widgets ────────────────────────────────────────────────────

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[3px] border border-[#232b2f] bg-fl-panel-2 px-2.5 pb-2.5 pt-1.5 fl-bevel', className)}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fl-dim">{title}</div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

/** Orange radio LED (same look as components/controls Led). */
function LedDot({ on }: { on: boolean }) {
  return (
    <span
      className="inline-block h-[10px] w-[10px] shrink-0 rounded-full border border-[#141819]"
      style={{ background: on ? 'var(--fl-orange)' : '#4a3a2a', boxShadow: on ? '0 0 6px var(--fl-orange)' : 'inset 0 1px 1px rgba(0,0,0,.6)' }}
    />
  )
}

function Radio({ on, onClick, disabled, children, title, role = 'radio' }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode; title?: string; role?: 'radio' | 'switch' }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn('flex h-5 items-center gap-1.5 rounded-[2px] px-1 text-left text-[11px] outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-fl-orange disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent', on ? 'text-[#eef2f4]' : 'text-fl-text')}
    >
      <LedDot on={on} />
      <span className="truncate">{children}</span>
    </button>
  )
}

function Row({ label, children, disabled }: { label: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <div className={cn('flex min-h-5 items-center gap-2', disabled && 'opacity-35')}>
      <span className="w-[74px] shrink-0 text-[11px] text-fl-dim">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  )
}

function FlSelect<T extends string | number>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(options.find((o) => String(o.value) === v)!.value)} disabled={disabled}>
      <SelectTrigger size="sm" className="h-[20px] min-w-0 flex-1 rounded-[2px] border-[#151a1c] bg-fl-well px-1.5 py-0 text-[11px] text-fl-text fl-inset disabled:opacity-100 data-[size=sm]:h-[20px] dark:bg-fl-well dark:hover:bg-[#232a2e]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="z-[300001] max-h-[50vh] rounded-[3px] border-[#151a1c] bg-[#2b3337] text-[11px] text-fl-text">
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={String(o.value)} className="py-1 text-[11px]">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Slider({ value, min, max, step = 1, onChange, disabled, format, steps }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; disabled?: boolean; format: (v: number) => string; steps?: number[] }) {
  // `steps`: discrete allowed values (slider moves over their indices).
  const idx = steps ? Math.max(0, steps.indexOf(value)) : value
  return (
    <>
      <input
        type="range"
        disabled={disabled}
        min={steps ? 0 : min}
        max={steps ? steps.length - 1 : max}
        step={steps ? 1 : step}
        value={idx}
        onChange={(e) => onChange(steps ? steps[Number(e.target.value)] : Number(e.target.value))}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--fl-orange)] disabled:cursor-default"
      />
      <span className="w-[62px] shrink-0 text-right font-mono text-[10px] text-fl-text">{format(value)}</span>
    </>
  )
}

function DlgButton({ primary, onClick, disabled, children }: { primary?: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-6 min-w-[72px] rounded-[3px] border border-[#1e2427] px-3 text-[11px] fl-bevel disabled:opacity-40',
        primary ? 'bg-fl-orange font-semibold text-[#1b1f22] enabled:hover:brightness-110' : 'bg-[#46525a] text-fl-text enabled:hover:bg-[#515e66]'
      )}
    >
      {children}
    </button>
  )
}

// ── the dialog ───────────────────────────────────────────────────────────────

export function ExportWizard() {
  const open = useExportWizard((s) => s.open)
  const session = useExportWizard((s) => s.session)
  const preset = useExportWizard((s) => s.preset)
  const project = useProject((s) => s.project)
  const projectPath = useProject((s) => s.filePath)
  const currentPattern = useUI((s) => s.currentPattern)

  const [s, setS] = useState<ExportSettings>(loadSettings)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [ff, setFf] = useState<FfmpegInfo | null | undefined>(host ? undefined : null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Re-initialise on every open.
  useEffect(() => {
    if (!open) return
    const tm = useTransport.getState().mode
    setS((prev) => {
      const next = { ...prev, mode: tm === 'song' && useProject.getState().project.playlist.clips.length ? ('song' as const) : ('pattern' as const) }
      if (preset) next.format = preset
      if (next.mode === 'pattern' && next.split === 'playlist') next.split = 'none'
      return next
    })
    setProgress(null)
    setStatus(null)
    void probeFfmpeg().then(setFf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => saveSettings(s), [s])

  const set = (patch: Partial<ExportSettings>) => setS((p) => ({ ...p, ...patch }))
  const ext = fileExtension(s.format)

  // Keep the chosen file's extension in sync with the format.
  useEffect(() => {
    setFilePath((p) => (p && !p.toLowerCase().endsWith(`.${ext}`) ? withExtension(p, ext) : p))
  }, [ext])

  const available = useMemo(() => {
    const has = (k: keyof typeof FFMPEG_ENCODER) => !!ff && ff.encoders.has(FFMPEG_ENCODER[k])
    return { wav: true, mp3: has('mp3'), vorbis: has('vorbis'), opus: has('opus'), ogg: has('vorbis') || has('opus'), flac: has('flac') }
  }, [ff])

  // If the persisted/preset format can't be produced, fall back (WAV always works).
  useEffect(() => {
    if (ff === undefined) return
    if (s.format !== 'wav' && !available[s.format]) set({ format: 'wav' })
    else if (s.format === 'ogg' && !available[s.oggCodec]) set({ oggCodec: available.vorbis ? 'vorbis' : 'opus' })
  }, [ff, s.format, s.oggCodec, available])

  const formatOk = s.format === 'wav' || (s.format === 'ogg' ? available[s.oggCodec] : available[s.format])

  const span = projectSpan(project, s.mode, currentPattern)
  const bars = span.ticks / barTicks(project)
  const stems = useMemo(() => {
    if (s.split === 'playlist' && s.mode === 'song') return playlistStems(project)
    if (s.split === 'mixer') return mixerStems(project, usedMixerTracks(project))
    return null
  }, [project, s.split, s.mode])
  const fileCount = stems ? stems.length : 1
  const sizeSec = span.seconds + (s.tail === 'leave' ? 1 : 0)
  const size = estimateBytes(s, sizeSec)

  const displayName = filePath ? baseName(filePath) : `${project.name || 'Untitled'}.${ext}`
  const folderName = splitPath(displayName).base

  const chooseFile = async (): Promise<string | null> => {
    if (!host) return null
    const dir = filePath ? splitPath(filePath).dir : projectPath ? splitPath(projectPath).dir : ''
    const sep = filePath ? splitPath(filePath).sep : '/'
    const r = await host.dialog.save({
      title: `Render to ${formatLabel(s)} file`,
      defaultPath: dir ? `${dir}${sep}${displayName}` : displayName,
      filters: [{ name: formatLabel(s), extensions: [ext] }]
    })
    if (r.canceled || !r.filePath) return null
    let p = r.filePath
    if (!p.toLowerCase().endsWith(`.${ext}`)) p = AUDIO_EXT.test(p) ? p.replace(AUDIO_EXT, `.${ext}`) : `${p}.${ext}`
    setFilePath(p)
    return p
  }

  const start = async () => {
    if (running || !formatOk) return
    let target = filePath
    if (host && !target) {
      target = await chooseFile()
      if (!target) return
    }
    const ac = new AbortController()
    abortRef.current = ac
    setRunning(true)
    setStatus(null)
    setProgress({ fileIndex: 0, fileCount, fileName: displayName, phase: 'render', fraction: 0, fileFraction: 0 })
    const t0 = performance.now()
    try {
      const res = await exportProject({ settings: s, project: useProject.getState().project, patternId: useUI.getState().currentPattern, filePath: target, ffmpeg: ff ?? null, signal: ac.signal, onProgress: setProgress })
      const secs = ((performance.now() - t0) / 1000).toFixed(1)
      const skipped = res.skippedSilent.length ? ` (${res.skippedSilent.length} silent track${res.skippedSilent.length > 1 ? 's' : ''} skipped)` : ''
      const where = res.folder ? `${res.files.length} file${res.files.length === 1 ? '' : 's'} in ${res.folder}` : res.files[0] ? baseName(res.files[0]) : displayName
      setStatus({ text: `Done in ${secs}s: ${where}${skipped}` })
      useUI.getState().setHint(`Exported ${where}`)
      setProgress((p) => (p ? { ...p, fraction: 1, fileFraction: 1, phase: 'done' } : p))
    } catch (e) {
      if (e instanceof CancelledError) setStatus({ text: 'Rendering cancelled.' })
      else {
        console.error('[export]', e)
        setStatus({ text: e instanceof Error ? e.message : String(e), error: true })
      }
      setProgress(null)
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  const cancelOrClose = () => {
    if (running) abortRef.current?.abort()
    else closeExportWizard()
  }

  const dis = running
  const fmtDisabled = (f: ExportFormat) => dis || (f !== 'wav' && !(f === 'ogg' ? available.ogg : available[f]))
  const ffHint = !host
    ? 'Browser build: only WAV download is available.'
    : ff === undefined
      ? 'Detecting ffmpeg…'
      : ff === null
        ? 'Install ffmpeg to export MP3/OGG/FLAC.'
        : `ffmpeg ${ff.version}`

  const pct = progress ? Math.round(progress.fraction * 100) : 0
  const progressText = progress
    ? progress.phase === 'done'
      ? 'Done'
      : `${progress.fileCount > 1 ? `File ${progress.fileIndex + 1}/${progress.fileCount} · ` : ''}${progress.fileName} · ${progress.phase === 'encode' ? 'encoding' : 'rendering'} ${Math.round(progress.fileFraction * 100)}%`
    : status?.text ?? (formatOk ? 'Ready' : `${formatLabel(s)} needs ffmpeg with ${encoderKey(s) ? FFMPEG_ENCODER[encoderKey(s)!] : ''}`)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !running && closeExportWizard()}>
      <DialogPortal>
        <DialogOverlay className="z-[300000] bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => running && e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            // Keep Space/Ctrl+R/… from reaching the global shortcut handler.
            if (e.key !== 'Escape') e.stopPropagation()
          }}
          className="fixed left-1/2 top-1/2 z-[300000] flex w-[640px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[3px] border border-[#11161a] bg-fl-panel text-[11px] text-fl-text shadow-[0_10px_40px_rgba(0,0,0,.65)] outline-none"
        >
          {/* title bar */}
          <div className="flex h-[24px] shrink-0 items-center gap-2 bg-fl-title-active pl-2 pr-1 text-[#eef2f4]" style={{ boxShadow: 'inset 0 2px 0 var(--fl-orange)' }}>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-[11px] font-medium">
              Rendering to <span className="text-fl-orange">{displayName}</span>
              {stems && <span className="text-fl-dim"> → {folderName}/ ({fileCount} file{fileCount === 1 ? '' : 's'})</span>}
            </DialogPrimitive.Title>
            {host && (
              <ToggleButton title="Choose destination file…" className="h-[18px] min-w-[18px] px-1.5" onClick={() => !running && void chooseFile()}>
                <FolderOpen size={11} className="mr-1" />…
              </ToggleButton>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 p-2">
            <div className="flex flex-col gap-2">
              <Section title="Project type">
                <Row label="Mode">
                  <FlSelect
                    value={s.mode}
                    disabled={dis}
                    onChange={(v) => set({ mode: v, split: v === 'pattern' && s.split === 'playlist' ? 'none' : s.split })}
                    options={[
                      { value: 'song', label: 'Full song' },
                      { value: 'pattern', label: `Pattern${project.patterns.find((p) => p.id === currentPattern) ? ` (${project.patterns.find((p) => p.id === currentPattern)!.name})` : ''}` }
                    ]}
                  />
                </Row>
                <Row label="Tail">
                  <FlSelect
                    value={s.tail}
                    disabled={dis}
                    onChange={(v) => set({ tail: v })}
                    options={[
                      { value: 'leave', label: 'Leave remainder' },
                      { value: 'cut', label: 'Cut remainder' },
                      { value: 'wrap', label: 'Wrap remainder' }
                    ]}
                  />
                </Row>
                <div className="mt-0.5 grid grid-cols-3 gap-1 rounded-[2px] bg-fl-well px-1.5 py-1 font-mono text-[10px] fl-inset">
                  <span title="Length of the song/pattern">
                    <span className="text-fl-dim">Length </span>
                    {Number.isInteger(bars) ? bars : bars.toFixed(2)} bar{bars === 1 ? '' : 's'}
                  </span>
                  <span title={s.tail === 'leave' ? `Plus the decaying tail (up to ${MAX_TAIL_SECONDS}s)` : undefined}>
                    <span className="text-fl-dim">Time </span>
                    {formatDuration(span.seconds)}
                    {s.tail === 'leave' ? '+' : ''}
                  </span>
                  <span title="Estimated file size">
                    <span className="text-fl-dim">≈ </span>
                    {formatBytes(size)}
                    {fileCount > 1 ? ` ×${fileCount}` : ''}
                  </span>
                </div>
              </Section>

              <Section title="Output format">
                <div role="radiogroup" aria-label="Output format" className="grid grid-cols-4 gap-1">
                  {(['wav', 'mp3', 'ogg', 'flac'] as const).map((f) => (
                    <Radio key={f} on={s.format === f} disabled={fmtDisabled(f)} onClick={() => set({ format: f })} title={needsFfmpeg(f) && fmtDisabled(f) && !dis ? ffHint : undefined}>
                      {f.toUpperCase()}
                    </Radio>
                  ))}
                </div>
                <div className={cn('text-[10px]', host && ff === null ? 'text-fl-orange' : 'text-fl-dim')}>{ffHint}</div>
                <div className="my-0.5 h-px bg-[#283034]" />
                <Row label="WAV depth" disabled={s.format !== 'wav'}>
                  <FlSelect
                    value={s.wavBits}
                    disabled={dis || s.format !== 'wav'}
                    onChange={(v) => set({ wavBits: v })}
                    options={[
                      { value: 16, label: '16-bit int' },
                      { value: 24, label: '24-bit int' },
                      { value: 32, label: '32-bit float' }
                    ]}
                  />
                </Row>
                <Row label="MP3 bitrate" disabled={s.format !== 'mp3'}>
                  <Slider value={s.mp3Kbps} steps={MP3_BITRATES} disabled={dis || s.format !== 'mp3'} onChange={(v) => set({ mp3Kbps: v })} format={(v) => `${v} kbps`} />
                </Row>
                <Row label="OGG codec" disabled={s.format !== 'ogg'}>
                  <div role="radiogroup" aria-label="OGG codec" className="flex gap-2">
                    {(['vorbis', 'opus'] as OggCodec[]).map((c) => (
                      <Radio key={c} on={s.oggCodec === c} disabled={dis || s.format !== 'ogg' || !available[c]} onClick={() => set({ oggCodec: c })}>
                        {c === 'vorbis' ? 'Vorbis' : 'Opus'}
                      </Radio>
                    ))}
                  </div>
                </Row>
                <Row label={s.oggCodec === 'opus' ? 'OGG bitrate' : 'OGG quality'} disabled={s.format !== 'ogg'}>
                  {s.oggCodec === 'opus' ? (
                    <Slider value={s.opusKbps} steps={OPUS_BITRATES} disabled={dis || s.format !== 'ogg'} onChange={(v) => set({ opusKbps: v })} format={(v) => `${v} kbps`} />
                  ) : (
                    <Slider value={s.vorbisQuality} min={0} max={10} disabled={dis || s.format !== 'ogg'} onChange={(v) => set({ vorbisQuality: v })} format={(v) => `q${v}`} />
                  )}
                </Row>
                <Row label="FLAC depth" disabled={s.format !== 'flac'}>
                  <FlSelect
                    value={s.flacBits}
                    disabled={dis || s.format !== 'flac'}
                    onChange={(v) => set({ flacBits: v })}
                    options={[
                      { value: 16, label: '16-bit' },
                      { value: 24, label: '24-bit' }
                    ]}
                  />
                </Row>
                <Row label="Compression" disabled={s.format !== 'flac'}>
                  <Slider value={s.flacLevel} min={0} max={8} disabled={dis || s.format !== 'flac'} onChange={(v) => set({ flacLevel: v })} format={(v) => `level ${v}`} />
                </Row>
              </Section>
            </div>

            <div className="flex flex-col gap-2">
              <Section title="Quality">
                <Row label="Sample rate">
                  <FlSelect
                    value={s.sampleRate}
                    disabled={dis}
                    onChange={(v) => set({ sampleRate: v })}
                    options={[
                      { value: 44100, label: '44.1 kHz' },
                      { value: 48000, label: '48 kHz' },
                      { value: 96000, label: '96 kHz' }
                    ]}
                  />
                </Row>
                {s.format === 'ogg' && s.oggCodec === 'opus' && <div className="-mt-1 pl-[82px] text-[10px] text-fl-dim">Opus is always written at 48 kHz.</div>}
                {s.format === 'mp3' && s.sampleRate > 48000 && <div className="-mt-1 pl-[82px] text-[10px] text-fl-dim">MP3 is written at 48 kHz.</div>}
                <Row label="Channels">
                  <FlSelect
                    value={s.channels}
                    disabled={dis}
                    onChange={(v) => set({ channels: v })}
                    options={[
                      { value: 2, label: 'Stereo' },
                      { value: 1, label: 'Mono' }
                    ]}
                  />
                </Row>
                <Radio role="switch" on={s.dither && ditherApplies(s)} disabled={dis || !ditherApplies(s)} onClick={() => set({ dither: !s.dither })} title="TPDF dither when reducing to 16-bit">
                  Dithering (TPDF, 16-bit)
                </Radio>
                <Radio role="switch" on={s.normalize} disabled={dis} onClick={() => set({ normalize: !s.normalize })} title="Scale each file so its peak is -0.1 dBFS">
                  Normalize{stems ? ' (per file)' : ''}
                </Radio>
              </Section>

              <Section title="Miscellaneous" className="flex-1">
                <div className="text-[10px] text-fl-dim">Split tracks</div>
                <div role="radiogroup" aria-label="Split tracks" className="flex flex-col">
                  <Radio on={s.split === 'none'} disabled={dis} onClick={() => set({ split: 'none' })}>
                    None (one merged master file)
                  </Radio>
                  <Radio on={s.split === 'playlist'} disabled={dis || s.mode !== 'song'} onClick={() => set({ split: 'playlist' })} title={s.mode !== 'song' ? 'Needs Full song mode' : 'One file per playlist track with clips'}>
                    Split playlist tracks
                  </Radio>
                  <Radio on={s.split === 'mixer'} disabled={dis} onClick={() => set({ split: 'mixer' })} title="One file per used mixer insert, plus the master">
                    Split mixer tracks
                  </Radio>
                </div>
                <div className="my-0.5 h-px bg-[#283034]" />
                <Radio role="switch" on={s.masterFx} disabled={dis || s.split !== 'mixer'} onClick={() => set({ masterFx: !s.masterFx })} title="Pass each insert through the master track's effects when splitting mixer tracks">
                  Enable master effects
                </Radio>
                <Radio role="switch" on={s.trimSilence && s.split === 'none'} disabled={dis || s.split !== 'none'} onClick={() => set({ trimSilence: !s.trimSilence })} title={s.split !== 'none' ? 'Disabled when splitting (keeps stems aligned)' : 'Remove leading and trailing silence'}>
                  Trim silence
                </Radio>
                {stems && (
                  <div className="mt-0.5 max-h-[64px] overflow-auto rounded-[2px] bg-fl-well px-1.5 py-1 text-[10px] text-fl-dim fl-inset">
                    {stems.length === 0 ? 'No tracks to render.' : stems.map((x) => `${folderName}_${x.name}.${ext}`).join('  ·  ')}
                  </div>
                )}
              </Section>
            </div>
          </div>

          {/* progress + buttons */}
          <div className="flex items-center gap-2 border-t border-[#232b2f] bg-fl-panel-2 px-2 py-2">
            <div className="relative h-[20px] min-w-0 flex-1 overflow-hidden rounded-[2px] bg-fl-well fl-inset" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="absolute inset-y-0 left-0 bg-fl-orange/80 transition-[width] duration-150" style={{ width: `${progress ? pct : 0}%` }} />
              <div className={cn('relative truncate px-2 font-mono text-[10px] leading-[20px]', status?.error ? 'text-fl-red' : progress && pct > 45 ? 'text-[#1b1f22]' : 'text-fl-text')}>
                {progressText}
                {progress && progress.phase !== 'done' ? ` · ${pct}%` : ''}
              </div>
            </div>
            <DlgButton primary disabled={running || !formatOk || (stems !== null && stems.length === 0)} onClick={() => void start()}>
              Start
            </DlgButton>
            <DlgButton onClick={cancelOrClose}>{running ? 'Cancel' : 'Close'}</DlgButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
