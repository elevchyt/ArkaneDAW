import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { trackOneShot } from '@/audio/oneshots'
import { ChevronRight, ChevronsDownUp, File, Folder, FolderOpen, Music, Plug, Puzzle, Waves, Box } from 'lucide-react'
import { cn } from '@/lib/utils'
import { host } from '@/platform'
import { useUI } from '@/store/ui'
import { editProject, getProject, useProject } from '@/store/project'
import { allPlugins, type PluginEntry } from '@/plugins/catalog'
import { addInstrumentChannel, deleteChannels, deletePattern, deleteSample, renamePattern, updateChannel } from '@/store/actions'
import { guardPack } from '@/packs/guard'
import { PackBadge } from '@/packs/PackBadge'
import { usePacks } from '@/packs/store'
import { initAudio } from '@/audio/transport'
import { decode } from '@/audio/samples'
import { useVstCatalog } from '@/audio/vst'
import { openChannelPlugin } from '@/windows/plugin/open'
import { AUDIO_EXT } from '@/windows/channelrack/drop'
import { MIDI_EXT } from '@/midi/convert'
import { openMenu, type MenuItem } from '@/windows/playlist/PopupMenu'
import { confirmAction } from '@/system/ConfirmDialog'

interface Root {
  name: string
  path: string
}

const BROWSER_ROOTS_KEY = 'arkane.browserRoots'
const BASE_ROOTS = ['Packs', 'Music', 'Home']

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
      localStorage.setItem(BROWSER_ROOTS_KEY, JSON.stringify(r.filter((x) => !BASE_ROOTS.includes(x.name))))
    } catch {
      /* ignore */
    }
  }
  return [roots, save]
}

// ── tree state ────────────────────────────────────────────────────────────────
// Every folder row has a key; a child's key is its parent's key + SEP + name. Opening a folder closes every
// other folder except its ancestors, so only one branch is ever expanded.
const SEP = '\u0000'
const childKey = (parent: string, name: string) => `${parent}${SEP}${name}`

interface TreeState {
  open: ReadonlySet<string>
  /** key of the row being renamed inline */
  renaming: string | null
  /** bumped after a file operation so open folders re-read their contents */
  fsVersion: number
}

const useTree = create<TreeState>(() => ({ open: new Set(['project']), renaming: null, fsVersion: 0 }))

function toggleFolder(key: string): void {
  const open = useTree.getState().open
  const next = open.has(key)
    ? [...open].filter((k) => k !== key && !k.startsWith(key + SEP))
    : [...[...open].filter((k) => key.startsWith(k + SEP)), key]
  useTree.setState({ open: new Set(next) })
}

const collapseAll = () => useTree.setState({ open: new Set() })
const startRename = (key: string) => useTree.setState({ renaming: key })
const stopRename = () => useTree.setState({ renaming: null })
const fsChanged = () => useTree.setState((s) => ({ fsVersion: s.fsVersion + 1 }))

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
  trackOneShot(src)
  previewSrc = src
}

// ── context menu ──────────────────────────────────────────────────────────────
interface MenuSpec {
  /** file or folder to reveal in the OS file manager */
  reveal?: string | null
  rename?: () => void
  remove?: () => void
  removeLabel?: string
}

/** Same three entries everywhere in the browser; ones that don't apply are greyed out. */
function menuItems(m: MenuSpec): MenuItem[] {
  return [
    { label: 'Show in file manager', disabled: !m.reveal || !host, onSelect: () => m.reveal && void host?.shell.showItem(m.reveal) },
    { label: 'Rename', disabled: !m.rename, onSelect: m.rename },
    { separator: true },
    { label: m.removeLabel ?? 'Delete...', disabled: !m.remove, onSelect: m.remove }
  ]
}

function Row({
  depth,
  icon,
  label,
  open,
  onClick,
  onDoubleClick,
  draggable,
  onDragStart,
  active,
  menu,
  renameKey,
  renameValue,
  onRename,
  badge
}: {
  depth: number
  icon: React.ReactNode
  label: string
  open?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  active?: boolean
  menu?: MenuSpec
  /** tree key used to show the inline rename box */
  renameKey?: string
  /** text the rename box starts with (defaults to the label) */
  renameValue?: string
  onRename?: (name: string) => void
  badge?: React.ReactNode
}) {
  const setHint = useUI((s) => s.setHint)
  const renaming = useTree((s) => !!renameKey && s.renaming === renameKey)
  return (
    <div
      className={cn('flex h-[19px] cursor-pointer items-center gap-1 truncate pr-2 text-[11px] hover:bg-white/5', active && 'bg-white/10')}
      style={{ paddingLeft: 4 + depth * 12 }}
      onClick={renaming ? undefined : onClick}
      onDoubleClick={renaming ? undefined : onDoubleClick}
      draggable={draggable && !renaming}
      onDragStart={onDragStart}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu(e, menuItems(menu ?? {}), label)
      }}
      onMouseEnter={() => setHint(`${label} – right-click for options`)}
    >
      {open !== undefined ? <ChevronRight size={10} className={cn('shrink-0 text-fl-dim transition-transform', open && 'rotate-90')} /> : <span className="w-[10px] shrink-0" />}
      {icon}
      {renaming ? (
        <RenameBox
          value={renameValue ?? label}
          onDone={(v) => {
            stopRename()
            if (v && v !== (renameValue ?? label)) onRename?.(v)
          }}
        />
      ) : (
        <span className="truncate">{label}</span>
      )}
      {badge}
    </div>
  )
}

function RenameBox({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v?.trim() || null)
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // select the name without its extension, like file managers do
    const dot = value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : value.length)
  }, [value])
  return (
    <input
      ref={ref}
      defaultValue={value}
      className="h-[16px] min-w-0 flex-1 rounded-[2px] bg-fl-well px-1 text-[11px] text-white outline-none fl-inset"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish((e.target as HTMLInputElement).value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.target.value)}
    />
  )
}

// ── file system ───────────────────────────────────────────────────────────────
async function renamePath(full: string, name: string): Promise<void> {
  if (!host) return
  if (/[/\\]/.test(name)) {
    useUI.getState().setHint('A name cannot contain slashes')
    return
  }
  const to = host.path.join(host.path.dirname(full), name)
  if (host.fs.existsSync(to)) {
    useUI.getState().setHint(`"${name}" already exists`)
    return
  }
  try {
    await host.fsp.rename(full, to)
  } catch (e) {
    useUI.getState().setHint(`Rename failed: ${(e as Error).message}`)
    return
  }
  // keep project samples that point into the renamed file/folder working
  const sep = host.path.sep
  const moved = (p: string | null) => !!p && (p === full || p.startsWith(full + sep))
  if (getProject().samples.some((s) => moved(s.path))) {
    editProject('Rename sample file', (d) => {
      for (const s of d.samples) if (moved(s.path)) s.path = to + s.path!.slice(full.length)
    }, { undoable: false })
  }
  fsChanged()
}

async function trashPath(full: string, name: string, dir: boolean): Promise<void> {
  if (!host) return
  const ok = await confirmAction({
    title: dir ? 'Delete folder' : 'Delete file',
    message: (
      <>
        Delete <b className="text-white">{name}</b>
        {dir ? ' and everything in it' : ''}?
      </>
    ),
    detail: 'It is moved to the trash.',
    confirmLabel: 'Delete'
  })
  if (!ok) return
  try {
    await host.shell.trash(full)
    useUI.getState().setHint(`Moved "${name}" to the trash`)
  } catch (e) {
    useUI.getState().setHint(`Delete failed: ${(e as Error).message}`)
  }
  fsChanged()
}

function DirNode({ path, name, depth, nodeKey, root, onRemoveRoot, onRenameRoot }: { path: string; name: string; depth: number; nodeKey: string; root?: 'base' | 'user'; onRemoveRoot?: () => void; onRenameRoot?: (name: string) => void }) {
  const open = useTree((s) => s.open.has(nodeKey))
  const fsVersion = useTree((s) => s.fsVersion)
  const [entries, setEntries] = useState<{ name: string; dir: boolean }[] | null>(null)
  const [loaded, setLoaded] = useState(-1)
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    if (!open || loaded === fsVersion || !host) return
    setLoaded(fsVersion)
    void host.fsp
      .readdir(path, { withFileTypes: true })
      .then((list) =>
        setEntries(
          list
            .filter((d) => !d.name.startsWith('.') && (d.isDirectory() || AUDIO_EXT.test(d.name) || MIDI_EXT.test(d.name) || d.name.endsWith('.arkane')))
            .map((d) => ({ name: d.name, dir: d.isDirectory() }))
            .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
        )
      )
      .catch(() => setEntries([]))
  }, [open, loaded, fsVersion, path])
  const menu: MenuSpec =
    root === 'base'
      ? { reveal: path }
      : root === 'user'
        ? { reveal: path, rename: () => startRename(nodeKey), remove: onRemoveRoot, removeLabel: 'Remove from browser...' }
        : { reveal: path, rename: () => startRename(nodeKey), remove: () => void trashPath(path, name, true) }
  return (
    <>
      <Row
        depth={depth}
        open={open}
        icon={open ? <FolderOpen size={12} className="shrink-0 text-[#e3b35a]" /> : <Folder size={12} className="shrink-0 text-[#e3b35a]" />}
        label={name}
        onClick={() => toggleFolder(nodeKey)}
        menu={menu}
        renameKey={nodeKey}
        onRename={(v) => (root === 'user' ? onRenameRoot?.(v) : void renamePath(path, v))}
      />
      {open &&
        entries?.map((e) => {
          const full = host!.path.join(path, e.name)
          const key = childKey(nodeKey, e.name)
          return e.dir ? (
            <DirNode key={e.name} path={full} name={e.name} depth={depth + 1} nodeKey={key} />
          ) : (
            <Row
              key={e.name}
              depth={depth + 1}
              icon={
                e.name.endsWith('.arkane') ? (
                  <Box size={12} className="shrink-0 text-fl-orange" />
                ) : MIDI_EXT.test(e.name) ? (
                  <Music size={12} className="shrink-0 text-[#b6e38f]" />
                ) : (
                  <Waves size={12} className="shrink-0 text-[#8fd0e3]" />
                )
              }
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
              menu={{ reveal: full, rename: () => startRename(key), remove: () => void trashPath(full, e.name, false) }}
              renameKey={key}
              onRename={(v) => void renamePath(full, v)}
            />
          )
        })}
    </>
  )
}

// ── plugin database ───────────────────────────────────────────────────────────
function pluginMenu(m: PluginEntry, key: string): MenuSpec {
  if (!m.external) return {}
  const entry = useVstCatalog.getState().entries.find((e) => e.id === m.id)
  return {
    reveal: entry?.path,
    rename: () => startRename(key),
    removeLabel: 'Remove from database...',
    remove: () =>
      void confirmAction({
        title: 'Remove plugin',
        message: (
          <>
            Remove <b className="text-white">{m.name}</b> from the plugin database?
          </>
        ),
        detail: 'The plugin file stays on disk. Bring it back from the Plugin manager (unblock it and rescan).',
        confirmLabel: 'Remove'
      }).then((ok) => ok && entry && useVstCatalog.getState().setBlacklisted(entry.path, true))
  }
}

function PluginDatabase() {
  usePacks((s) => s.status) // re-render when a pack gets installed (badges)
  useVstCatalog((s) => s.entries) // and after scans / renames
  const open = useTree((s) => s.open)
  return (
    <>
      {(['Generators', 'Effects'] as const).map((g) => {
        const list = allPlugins(g === 'Generators' ? 'instrument' : 'effect')
        const key = childKey('plugins', g)
        return (
          <div key={g}>
            <Row depth={1} open={open.has(key)} icon={<Plug size={12} className="shrink-0 text-fl-green" />} label={g} onClick={() => toggleFolder(key)} />
            {open.has(key) &&
              list.map((m) => {
                const k = childKey(key, m.id)
                return (
                  <Row
                    key={m.id}
                    depth={2}
                    icon={<Puzzle size={12} className="shrink-0" style={{ color: m.color ?? (m.external ? 'var(--fl-orange)' : undefined) }} />}
                    label={m.external ? `${m.name} (${m.category.split(' ')[0]})` : m.name}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/x-arkane-plugin', m.id)}
                    onDoubleClick={() => g === 'Generators' && guardPack(m.id, () => addInstrumentChannel(m.id))}
                    badge={m.pack && <PackBadge packId={m.pack.id} />}
                    menu={pluginMenu(m, k)}
                    renameKey={k}
                    renameValue={m.name}
                    onRename={(v) => useVstCatalog.getState().rename(m.id, v)}
                  />
                )
              })}
          </div>
        )
      })}
    </>
  )
}

// ── current project ───────────────────────────────────────────────────────────
const confirmDelete = (what: string, name: string, detail?: string) =>
  confirmAction({
    title: `Delete ${what}`,
    message: (
      <>
        Delete {what} <b className="text-white">{name}</b>?
      </>
    ),
    detail: detail ?? 'You can undo this with Ctrl+Z.',
    confirmLabel: 'Delete'
  })

function CurrentProject() {
  const project = useProject((s) => s.project)
  const open = useTree((s) => s.open)
  const folder = (id: string, label: string) => {
    const key = childKey('project', id)
    return <Row depth={1} open={open.has(key)} icon={<Folder size={12} className="shrink-0 text-[#e3b35a]" />} label={label} onClick={() => toggleFolder(key)} />
  }
  const isOpen = (id: string) => open.has(childKey('project', id))
  const samplePath = (id: unknown) => (typeof id === 'string' ? project.samples.find((s) => s.id === id)?.path : null)
  return (
    <>
      {folder('gen', 'Generators')}
      {isOpen('gen') &&
        project.channels.map((c) => {
          const key = childKey('project', `ch:${c.id}`)
          return (
            <Row
              key={c.id}
              depth={2}
              icon={<Music size={12} className="shrink-0 text-fl-green" />}
              label={c.name}
              onClick={() => openChannelPlugin(c.id)}
              menu={{
                reveal: samplePath(c.sampler?.sampleId ?? (c.plugin?.data as { sampleId?: unknown } | undefined)?.sampleId),
                rename: () => startRename(key),
                remove: () => void confirmDelete('channel', c.name).then((ok) => ok && deleteChannels([c.id]))
              }}
              renameKey={key}
              onRename={(v) => updateChannel(c.id, { name: v }, 'Rename channel')}
            />
          )
        })}
      {folder('pat', 'Patterns')}
      {isOpen('pat') &&
        project.patterns.map((p) => {
          const key = childKey('project', `pat:${p.id}`)
          return (
            <Row
              key={p.id}
              depth={2}
              icon={<span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: p.color }} />}
              label={p.name}
              onClick={() => useUI.getState().set({ currentPattern: p.id })}
              menu={{ rename: () => startRename(key), remove: () => void confirmDelete('pattern', p.name).then((ok) => ok && deletePattern(p.id)) }}
              renameKey={key}
              onRename={(v) => renamePattern(p.id, v)}
            />
          )
        })}
      {folder('aud', 'Audio')}
      {isOpen('aud') &&
        project.samples.map((s) => {
          const key = childKey('project', `smp:${s.id}`)
          return (
            <Row
              key={s.id}
              depth={2}
              icon={<File size={12} className="shrink-0 text-[#8fd0e3]" />}
              label={s.name}
              menu={{
                reveal: s.path,
                rename: () => startRename(key),
                remove: () =>
                  void confirmDelete('sample', s.name, 'Its audio clips and the channels playing it are removed from the project too. The file on disk is kept. You can undo this with Ctrl+Z.').then(
                    (ok) => ok && deleteSample(s.id)
                  )
              }}
              renameKey={key}
              onRename={(v) => editProject('Rename sample', (d) => void (d.samples.find((x) => x.id === s.id)!.name = v))}
            />
          )
        })}
    </>
  )
}

/** FL-style left browser: current project, plugin database, packs and user folders. */
export function Browser() {
  const width = useUI((s) => s.browserWidth)
  const [roots, setRoots] = useRoots()
  const open = useTree((s) => s.open)
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
      <div className="flex h-[22px] shrink-0 items-center gap-2 bg-fl-title px-2 text-[11px] text-[#d4dadd]">
        <span className="flex-1 truncate">Browser - All</span>
        <button className="grid h-4 w-4 place-items-center text-fl-dim hover:text-white" onClick={collapseAll} title="Collapse all folders" onMouseEnter={() => useUI.getState().setHint('Collapse all folders')}>
          <ChevronsDownUp size={12} />
        </button>
        <button className="text-[10px] text-fl-dim hover:text-white" onClick={() => void addFolder()} title="Add a folder to the browser">
          + folder
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        <Row depth={0} open={open.has('project')} icon={<Box size={12} className="shrink-0 text-fl-orange" />} label="Current project" onClick={() => toggleFolder('project')} />
        {open.has('project') && <CurrentProject />}
        <Row depth={0} open={open.has('plugins')} icon={<Plug size={12} className="shrink-0 text-fl-green" />} label="Plugin database" onClick={() => toggleFolder('plugins')} />
        {open.has('plugins') && <PluginDatabase />}
        {roots.map((r) => (
          <DirNode
            key={r.path}
            path={r.path}
            name={r.name}
            depth={0}
            nodeKey={childKey('fs', r.path)}
            root={BASE_ROOTS.includes(r.name) ? 'base' : 'user'}
            onRenameRoot={(name) => !BASE_ROOTS.includes(name) && setRoots(roots.map((x) => (x.path === r.path ? { ...x, name } : x)))}
            onRemoveRoot={() =>
              void confirmAction({
                title: 'Remove folder',
                message: (
                  <>
                    Remove <b className="text-white">{r.name}</b> from the browser?
                  </>
                ),
                detail: 'The folder itself is not touched.',
                confirmLabel: 'Remove'
              }).then((ok) => ok && setRoots(roots.filter((x) => x.path !== r.path)))
            }
          />
        ))}
        {!host && <div className="px-3 py-2 text-[10px] text-fl-dim">File browsing is available in the desktop app.</div>}
      </div>
      <div className="absolute right-[-3px] top-0 h-full w-[6px] cursor-ew-resize" onPointerDown={resize} />
    </div>
  )
}
