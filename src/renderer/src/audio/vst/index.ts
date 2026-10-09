// Third-party plugin hosting (CLAP / VST3 / VST2, bridged out-of-process). Imported once from main.tsx.
//
// Public API for other parts of the app:
//   listExternalPlugins(kind?) / useExternalPlugins(kind?)   → catalogue entries for pickers (id = pluginId)
//   getExternalPluginInfo(pluginId)                         → { name, vendor, kind, ... } for titles
//   getExternalEditor(pluginId)                             → editor component for the plugin wrapper window
//   isExternalPluginId(pluginId)                            → "vst:..." ids
//   flushVstStates()                                        → write every live plugin's state chunk into the project
//                                                             (call before saving / offline export)
//   useVstCatalog                                           → zustand store behind the Plugin manager window
import type { ComponentType } from 'react'
import { registerHostNodeFactory } from '../plugin-node'
import { VstHostNode, hookTransport } from './host-node'
import { useVstCatalog } from './catalog'
import { VST_PREFIX, isExternalPluginId } from './ids'
import { VstEditorPanel, type ExternalEditorProps } from './VstEditorPanel'

registerHostNodeFactory(VST_PREFIX, (ctx, state, kind) => new VstHostNode(ctx, state, kind))
hookTransport()
void useVstCatalog.getState().load()

export function getExternalEditor(pluginId: string): ComponentType<ExternalEditorProps> | undefined {
  return isExternalPluginId(pluginId) ? VstEditorPanel : undefined
}

export { listExternalPlugins, useExternalPlugins, getExternalPluginInfo, useVstCatalog } from './catalog'
export type { ExternalPluginInfo, CatalogEntry } from './catalog'
export { flushVstStates, liveVstNodes, VstHostNode } from './host-node'
export { isExternalPluginId, parsePluginId, formatPluginId } from './ids'
export type { ExternalEditorProps } from './VstEditorPanel'
