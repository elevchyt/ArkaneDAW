import type { ComponentType } from 'react'
import type { WindowKind } from '@/store/ui'
import type { WindowProps } from './types'
import Playlist from './playlist/Playlist'
import PianoRoll from './pianoroll/PianoRoll'
import Mixer from './mixer/Mixer'
import ChannelRack from './channelrack/ChannelRack'
import PluginWindow from './plugin/PluginWindow'
import PluginPicker from '@/shell/PluginPicker'

export const windowComponents: Partial<Record<WindowKind, ComponentType<WindowProps>>> = {
  playlist: Playlist,
  pianoRoll: PianoRoll,
  mixer: Mixer,
  channelRack: ChannelRack,
  plugin: PluginWindow,
  pluginPicker: PluginPicker
}
