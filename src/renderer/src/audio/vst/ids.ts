// External plugin ids: "vst:<format>:<path>[:<uid>]"
//   vst:clap:/home/me/.clap/Surge XT.clap:org.surge-synth-team.surge-xt
//   vst:vst3:/usr/lib/vst3/Dexed.vst3:<32 hex chars class id>
//   vst:vst2:/home/me/.vst/Kabee-vst.so[:<uniqueID>]
export type PluginFormat = 'clap' | 'vst3' | 'vst2'

export interface ExternalPluginRef {
  format: PluginFormat
  path: string
  uid: string
}

export const VST_PREFIX = 'vst:'

const EXT: Record<PluginFormat, RegExp> = {
  clap: /\.clap$/i,
  vst3: /\.vst3\/?$/i,
  vst2: /\.so$/i
}

export function isExternalPluginId(id: string | undefined | null): boolean {
  return !!id && id.startsWith(VST_PREFIX)
}

export function formatPluginId(ref: ExternalPluginRef): string {
  return `${VST_PREFIX}${ref.format}:${ref.path}${ref.uid ? `:${ref.uid}` : ''}`
}

export function parsePluginId(id: string): ExternalPluginRef | null {
  if (!id.startsWith(VST_PREFIX)) return null
  const rest = id.slice(VST_PREFIX.length)
  const c = rest.indexOf(':')
  if (c < 0) return null
  const format = rest.slice(0, c) as PluginFormat
  if (!(format in EXT)) return null
  const tail = rest.slice(c + 1)
  // The path may itself contain ':' — the uid is the part after the last ':' that follows the bundle extension.
  const last = tail.lastIndexOf(':')
  if (last > 0 && EXT[format].test(tail.slice(0, last))) return { format, path: tail.slice(0, last), uid: tail.slice(last + 1) }
  return { format, path: tail, uid: '' }
}

export function formatFromPath(path: string): PluginFormat | null {
  if (EXT.clap.test(path)) return 'clap'
  if (EXT.vst3.test(path)) return 'vst3'
  if (EXT.vst2.test(path)) return 'vst2'
  return null
}
