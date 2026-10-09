import { useEffect, useState } from 'react'
import { ChevronRight, File, Folder, FolderOpen, Music, Plug, Puzzle, Waves, Box } from 'lucide-react'
import { cn } from '@/lib/utils'
import { host } from '@/platform'
import { useUI } from '@/store/ui'
import { useProject } from '@/store/project'
import { listPlugins } from '@/plugins/registry'
import { addInstrumentChannel } from '@/store/actions'
import { initAudio } from '@/audio/transport'
import { decode } from '@/audio/samples'
import { openChannelPlugin } from '@/windows/plugin/open'
import { AUDIO_EXT } from '@/windows/channelrack/drop'

interface Root {
  name: string
  path: string
}

const BROWSER_ROOTS_KEY = 'arkane.browserRoots'

function useRoots(): [Root[], (r: Root[]) => void] {
  const [roots, setRoots] = useState<Root[]>([])
  useEffect(() => {
    if (!host) return
    void host.paths().then((p) => {
      let extra: Root[] = []
      try {
        extra = JSON.parse(localStorage.getItem(BROWSER_ROOTS_KEY) ?? '[]') as Root[]
      } catch {
        /* ignore */
      }
      const base: Root[] = [
        { name: 'Packs', path: host!.path.join(p.resources, 'packs') },
        { name: 'Music', path: p.music },
        { name: 'Home', path: p.home }
      ]
      setRoots([...base.filter((r) => host!.fs.existsSync(r.path)), ...extra])
    })
  }, [])
  const save = (r: Root[]) => {
    setRoots(r)
    try {
      localStorage.setItem(BROWSER_ROOTS_KEY, JSON.stringify(r.filter((x) => !['Packs', 'Music', 'Home'].includes(x.name))))
    } catch {
      /* ignore */
    }
  }
  return [roots, save]
}

let previewSrc: AudioBufferSourceNode | null = null
async function preview(path: string): Promise<void> {
  if (!host) return
  const engine = await initAudio()
  previewSrc?.stop()
  const file = await host.fsp.readFile(path)
  const buf = await decode(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)
  const src = engine.ctx.createBufferSource()
  src.buffer = buf
  src.connect(engine.masterOut)
  src.start()
  previewSrc = src
}

function Row({ depth, icon, label, open, onClick, onDoubleClick, draggable, onDragStart, active, onContextMenu }: { depth: number; icon: React.ReactNode; label: string; open?: boolean; onClick?: () => void; onDoubleClick?: () => void; draggable?: boolean; onDragStart?: (e: React.DragEvent) => void; active?: boolean; onContextMenu?: (e: React.MouseEvent) => void }) {
  const setHint = useUI((s) => s.setHint)
  return (
    <div
      className={cn('flex h-[19px] cursor-pointer items-center gap-1 truncate pr-2 text-[11px] hover:bg-white/5', active && 'bg-white/10')}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHint(label)}
    >
      {open !== undefined ? <ChevronRight size={10} className={cn('shrink-0 text-fl-dim transition-transform', open && 'rotate-90')} /> : <span className="w-[10px]" />}
      {icon}
      <span className="truncate">{label}</span>
    </div>
  )
}

function DirNode({ path, name, depth }: { path: string; name: string; depth: number }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<{ name: string; dir: boolean }[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    if (!open || entries || !host) return
    void host.fsp
      .readdir(path, { withFileTypes: true })
      .then((list) =>
        setEntries(
          list
            .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || AUDIO_EXT.test(d.name) || d.name.endsWith('.arkane')))
            .map((d) => ({ name: d.name, dir: d.isDirectory() }))
            .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
        )
      )
      .catch(() => setEntries([]))
  }, [open, entries, path])
  return (
    <>
      <Row depth={depth} open={open} icon={open ? <FolderOpen size={12} className="text-[#e3b35a]" /> : <Folder size={12} className="text-[#e3b35a]" />} label={name} onClick={() => setOpen(!open)} />
      {open &&
        entries?.map((e) => {
          const full = host!.path.join(path, e.name)
          return e.dir ? (
            <DirNode key={e.name} path={full} name={e.name} depth={depth + 1} />
          ) : (
            <Row
              key={e.name}
              depth={depth + 1}
              icon={e.name.endsWith('.arkane') ? <Box size={12} className="text-fl-orange" /> : <Waves size={12} className="text-[#8fd0e3]" />}
              label={e.name}
              active={sel === e.name}
              onClick={() => {
                setSel(e.name)
                if (AUDIO_EXT.test(e.name)) void preview(full)
              }}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData('application/x-arkane-paths', JSON.stringify([full]))
                ev.dataTransfer.effectAllowed = 'copy'
              }}
            />
          )
        })}
    </>
  )
}

function PluginDatabase() {
  const [open, setOpen] = useState<Record<string, boolean>>({ Generators: false, Effects: false })
  return (
    <>
      {(['Generators', 'Effects'] as const).map((g) => {
        const list = listPlugins(g === 'Generators' ? 'instrument' : 'effect')
        return (
          <div key={g}>
            <Row depth={1} open={open[g]} icon={<Plug size={12} className="text-fl-green" />} label={g} onClick={() => setOpen({ ...open, [g]: !open[g] })} />
            {open[g] &&
              list.map((m) => (
                <Row
                  key={m.manifest.id}
                  depth={2}
                  icon={<Puzzle size={12} style={{ color: m.manifest.color }} />}
                  label={m.manifest.name}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-arkane-plugin', m.manifest.id)}
                  onDoubleClick={() => g === 'Generators' && addInstrumentChannel(m.manifest.id)}
                />
              ))}
          </div>
        )
      })}
    </>
  )
}

function CurrentProject() {
  const project = useProject((s) => s.project)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setOpen({ ...open, [k]: !open[k] })
  return (
    <>
      <Row depth={1} open={!!open.gen} icon={<Folder size={12} className="text-[#e3b35a]" />} label="Generators" onClick={() => toggle('gen')} />
      {open.gen && project.channels.map((c) => <Row key={c.id} depth={2} icon={<Music size={12} className="text-fl-green" />} label={c.name} onClick={() => openChannelPlugin(c.id)} />)}
      <Row depth={1} open={!!open.pat} icon={<Folder size={12} className="text-[#e3b35a]" />} label="Patterns" onClick={() => toggle('pat')} />
      {open.pat && project.patterns.map((p) => <Row key={p.id} depth={2} icon={<span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: p.color }} />} label={p.name} onClick={() => useUI.getState().set({ currentPattern: p.id })} />)}
      <Row depth={1} open={!!open.aud} icon={<Folder size={12} className="text-[#e3b35a]" />} label="Audio" onClick={() => toggle('aud')} />
      {open.aud && project.samples.map((s) => <Row key={s.id} depth={2} icon={<File size={12} className="text-[#8fd0e3]" />} label={s.name} />)}
    </>
  )
}

/** FL-style left browser: current project, plugin database, packs and user folders. */
export function Browser() {
  const width = useUI((s) => s.browserWidth)
  const [roots, setRoots] = useRoots()
  const [open, setOpen] = useState<Record<string, boolean>>({ project: true })
  const resize = (e: React.PointerEvent) => {
    const sx = e.clientX
    const sw = width
    const move = (ev: PointerEvent) => useUI.getState().set({ browserWidth: Math.min(500, Math.max(150, sw + ev.clientX - sx)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const addFolder = async () => {
    if (!host) return
    const r = await host.dialog.open({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return
    setRoots([...roots, { name: host.path.basename(r.filePaths[0]), path: r.filePaths[0] }])
  }
  return (
    <div className="relative flex shrink-0 flex-col border-r border-[#14191b] bg-[#2b3337]" style={{ width }}>
      <div className="flex h-[22px] shrink-0 items-center justify-between bg-fl-title px-2 text-[11px] text-[#d4dadd]">
        <span>Browser - All</span>
        <button className="text-[10px] text-fl-dim hover:text-white" onClick={() => void addFolder()} title="Add a folder to the browser">
          + folder
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <Row depth={0} open={!!open.project} icon={<Box size={12} className="text-fl-orange" />} label="Current project" onClick={() => setOpen({ ...open, project: !open.project })} />
        {open.project && <CurrentProject />}
        <Row depth={0} open={!!open.plugins} icon={<Plug size={12} className="text-fl-green" />} label="Plugin database" onClick={() => setOpen({ ...open, plugins: !open.plugins })} />
        {open.plugins && <PluginDatabase />}
        {roots.map((r) => (
          <DirNode key={r.path} path={r.path} name={r.name} depth={0} />
        ))}
        {!host && <div className="px-3 py-2 text-[10px] text-fl-dim">File browsing is available in the desktop app.</div>}
      </div>
      <div className="absolute right-[-3px] top-0 h-full w-[6px] cursor-ew-resize" onPointerDown={resize} />
    </div>
  )
}
