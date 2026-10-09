import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown, Power } from 'lucide-react'
import { MdiWindow } from '@/shell/MdiWindow'
import { useProject } from '@/store/project'
import { useUI } from '@/store/ui'
import { getPlugin } from '@/plugins/registry'
import { GenericEditor } from '@/plugins/sdk/ui'
import type { PluginEditorProps } from '@/plugins/sdk/module'
import type { Preset } from '@/plugins/sdk/types'
import { getEngine, initAudio } from '@/audio/transport'
import {
  loadChannelPreset,
  loadFxPreset,
  setChannelData,
  setChannelParam,
  setFxData,
  setFxParam,
  updateMixerTrack
} from '@/store/actions'
import { editProject } from '@/store/project'
import { defaultNote } from '@/store/factory'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { WindowProps } from '../types'
import { getExternalEditor } from '@/audio/vst'

/** Generic plugin wrapper window (FL's "plugin wrapper"): preset strip + the plugin's editor. */
export default function PluginWindow({ win, bounds }: WindowProps) {
  const isFx = win.mixerTrack !== undefined
  const channel = useProject((s) => (win.channelId ? s.project.channels.find((c) => c.id === win.channelId) : undefined))
  const slot = useProject((s) => (isFx ? s.project.mixer[win.mixerTrack!]?.slots[win.slot!] : undefined))
  const state = isFx ? slot?.plugin : channel?.plugin
  const mod = state ? getPlugin(state.pluginId) : undefined
  const setHint = useUI((s) => s.setHint)
  const notesDown = useRef(new Map<number, number>())

  // Close the window if its target disappeared.
  useEffect(() => {
    if (!state) useUI.getState().closeWindow(win.id)
  }, [state, win.id])

  const node = useCallback(() => {
    const e = getEngine()
    if (!e) return null
    return isFx ? e.fxPlugin(win.mixerTrack!, win.slot!) : e.channelPlugin(win.channelId!)
  }, [isFx, win.channelId, win.mixerTrack, win.slot])

  const props: PluginEditorProps | null = useMemo(() => {
    if (!state || !mod) return null
    return {
      manifest: mod.manifest,
      instance: { params: state.params, data: state.data, presetName: state.presetName },
      setParam: (id, v) => (isFx ? setFxParam(win.mixerTrack!, win.slot!, id, v) : setChannelParam(win.channelId!, id, v)),
      setParams: (values) =>
        editProject('Change parameters', (d) => {
          const target = isFx ? d.mixer[win.mixerTrack!]?.slots[win.slot!]?.plugin : d.channels.find((c) => c.id === win.channelId)?.plugin
          if (target) Object.assign(target.params, values)
        }, { coalesceKey: `pp:${win.id}` }),
      setData: (data) => (isFx ? setFxData(win.mixerTrack!, win.slot!, data) : setChannelData(win.channelId!, data)),
      loadPreset: (p: Preset) => (isFx ? loadFxPreset(win.mixerTrack!, win.slot!, p) : loadChannelPreset(win.channelId!, p)),
      onDSPMessage: (cb) => {
        // The engine may replace the plugin node (plugin swap, project reload): re-bind when it changes.
        let off: (() => void) | null = null
        let bound: unknown = null
        let cancelled = false
        const bind = () => {
          if (cancelled) return
          const n = node()
          if (n === bound) return
          off?.()
          bound = n
          off = n?.onMessage(cb) ?? null
        }
        void initAudio().then(bind)
        const timer = window.setInterval(bind, 500)
        return () => {
          cancelled = true
          clearInterval(timer)
          off?.()
        }
      },
      postToDSP: (msg) => node()?.post(msg),
      previewNote: isFx
        ? undefined
        : (key, vel, on) => {
            void initAudio().then((e) => {
              if (on) notesDown.current.set(key, e.noteOn(win.channelId!, key, vel))
              else {
                const id = notesDown.current.get(key)
                if (id !== undefined) e.noteOff(win.channelId!, id, key)
                notesDown.current.delete(key)
              }
            })
          },
      hint: setHint,
      insertNotes: isFx
        ? undefined
        : (notes, mode = 'replace') =>
            editProject('Insert notes', (d) => {
              const patId = useUI.getState().currentPattern ?? d.patterns[0]?.id
              const pat = d.patterns.find((x) => x.id === patId)
              if (!pat) return
              const list = mode === 'replace' ? [] : [...(pat.notes[win.channelId!] ?? [])]
              for (const n of notes) list.push(defaultNote({ key: n.key, pos: Math.round(n.pos), len: Math.max(1, Math.round(n.len)), vel: n.vel ?? 100 / 128, pan: n.pan ?? 0 }))
              list.sort((a, b) => a.pos - b.pos)
              pat.notes[win.channelId!] = list
            })
    }
  }, [state, mod, isFx, win.channelId, win.mixerTrack, win.slot, win.id, node, setHint])

  if (!state) return null
  const presets = mod?.manifest.presets ?? []
  const idx = presets.findIndex((p) => p.name === state.presetName)
  const step = (d: number) => {
    if (!presets.length || !props) return
    const next = presets[(idx + d + presets.length) % presets.length]
    props.loadPreset(next)
  }
  const categories = [...new Set(presets.map((p) => p.category ?? ''))]
  const Editor = mod?.Editor ?? GenericEditor
  const External = mod ? undefined : getExternalEditor(state.pluginId) // VST/CLAP: audio/vst/VstEditorPanel

  return (
    <MdiWindow win={win} bounds={bounds} resizable={!mod?.editorSize} minW={300} minH={160} accent={mod?.manifest.color}>
      <div className="flex h-full flex-col">
        <div className="flex h-[26px] shrink-0 items-center gap-1 border-b border-[#1b2124] bg-[#2d3539] px-1">
          {isFx && slot && (
            <button
              title="Effect on/off"
              className="grid h-5 w-5 place-items-center rounded-sm hover:bg-white/10"
              onClick={() =>
                updateMixerTrack(win.mixerTrack!, {
                  slots: (useProject.getState().project.mixer[win.mixerTrack!].slots.map((s, i) => (i === win.slot && s ? { ...s, enabled: !s.enabled } : s)))
                })
              }
            >
              <Power size={12} className={slot.enabled ? 'text-fl-green' : 'text-fl-dim'} />
            </button>
          )}
          <button className="grid h-5 w-5 place-items-center rounded-sm hover:bg-white/10" onClick={() => step(-1)} title="Previous preset">
            <ChevronLeft size={13} />
          </button>
          <button className="grid h-5 w-5 place-items-center rounded-sm hover:bg-white/10" onClick={() => step(1)} title="Next preset">
            <ChevronRight size={13} />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex h-5 min-w-0 flex-1 items-center gap-1 rounded-sm bg-fl-well px-2 text-left text-[11px] text-[#cfe9b8] fl-inset">
              <span className="truncate">{state.presetName ?? (mod ? 'Default' : state.pluginId)}</span>
              <ChevronDown size={11} className="ml-auto shrink-0 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-[60vh] overflow-auto">
              {categories.map((cat) => (
                <div key={cat || '_'}>
                  {cat && <DropdownMenuLabel>{cat}</DropdownMenuLabel>}
                  {presets
                    .filter((p) => (p.category ?? '') === cat)
                    .map((p) => (
                      <DropdownMenuItem key={p.name} onSelect={() => props?.loadPreset(p)}>
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                </div>
              ))}
              {presets.length === 0 && <DropdownMenuLabel>No presets</DropdownMenuLabel>}
            </DropdownMenuContent>
          </DropdownMenu>
          {isFx && slot && (
            <div className="flex items-center gap-1 pl-1 text-[10px] text-fl-dim" title="Mix (dry/wet)">
              MIX
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={slot.mix}
                className="h-1 w-16 accent-[var(--fl-orange)]"
                onChange={(e) => {
                  const mix = Number(e.target.value)
                  editProject('Effect mix', (d) => {
                    const s = d.mixer[win.mixerTrack!].slots[win.slot!]
                    if (s) s.mix = mix
                  }, { coalesceKey: `mix:${win.id}` })
                }}
              />
            </div>
          )}
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {props ? (
            <Editor {...props} />
          ) : External ? (
            <External
              pluginId={state.pluginId}
              params={state.params}
              getNode={node}
              setParam={(id, v) => (isFx ? setFxParam(win.mixerTrack!, win.slot!, id, v) : setChannelParam(win.channelId!, id, v))}
              hint={setHint}
            />
          ) : (
            <div className="p-4 text-fl-dim">Plugin "{state.pluginId}" is not available.</div>
          )}
        </div>
      </div>
    </MdiWindow>
  )
}
