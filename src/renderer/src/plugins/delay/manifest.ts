import type { PluginManifest } from '../sdk/types'
import { DIVISION_NAMES, TEMPO_PARAM, divIndex } from '../fx-common/divisions'

export const MODES = ['Stereo', 'Ping-Pong', 'Mono']
export const MAX_DELAY_S = 5

/**
 * Delay: tempo-synced stereo / ping-pong delay with filtered, saturating feedback.
 * Sync uses the hidden `tempo` param (BPM). The editor keeps it equal to the project tempo; a host
 * may also set it directly (setParam('tempo', bpm)).
 */
export const manifest: PluginManifest = {
  id: 'delay',
  name: 'Delay',
  kind: 'effect',
  category: 'Reverb & Delay',
  description: 'Tempo-synced stereo / ping-pong delay with filtered, warm feedback.',
  color: '#4fc3f7',
  params: [
    { id: 'mode', name: 'Mode', min: 0, max: 2, default: 1, options: MODES },
    { id: 'sync', name: 'Tempo Sync', min: 0, max: 1, default: 1, step: 1 },
    { id: 'div', name: 'Time (sync)', min: 0, max: DIVISION_NAMES.length - 1, default: divIndex('1/8D'), options: DIVISION_NAMES },
    { id: 'time', name: 'Time', min: 1, max: 3000, default: 350, unit: 'ms', curve: 'exp' },
    { id: 'feedback', name: 'Feedback', min: 0, max: 1, default: 0.45, unit: '%' },
    { id: 'lowcut', name: 'Low Cut', min: 20, max: 2000, default: 120, unit: 'Hz', curve: 'exp' },
    { id: 'highcut', name: 'High Cut', min: 1000, max: 20000, default: 7000, unit: 'Hz', curve: 'exp' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.35, unit: '%' },
    { ...TEMPO_PARAM }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Quarter Note Echo', category: 'Sync', params: { mode: 0, div: divIndex('1/4'), feedback: 0.35, mix: 0.3 } },
    { name: 'Dotted Eighth Ping-Pong', category: 'Sync', params: { mode: 1, div: divIndex('1/8D'), feedback: 0.5, mix: 0.35 } },
    { name: 'Triplet Bounce', category: 'Sync', params: { mode: 1, div: divIndex('1/8T'), feedback: 0.45, highcut: 5000, mix: 0.3 } },
    { name: 'Slapback', category: 'Vintage', params: { mode: 2, sync: 0, time: 95, feedback: 0.1, lowcut: 150, highcut: 5000, mix: 0.3 } },
    { name: 'Tape Echo', category: 'Vintage', params: { mode: 2, div: divIndex('1/4'), feedback: 0.6, lowcut: 250, highcut: 3000, mix: 0.35 } },
    { name: 'Dub Space', category: 'Creative', params: { mode: 1, div: divIndex('1/4D'), feedback: 0.78, lowcut: 300, highcut: 2500, mix: 0.4 } },
    { name: 'Vocal Throw', category: 'Vocal', params: { mode: 1, div: divIndex('1/4'), feedback: 0.4, lowcut: 400, highcut: 6000, mix: 0.25 } },
    { name: 'Doubler', category: 'Vocal', params: { mode: 0, sync: 0, time: 22, feedback: 0, lowcut: 100, highcut: 12000, mix: 0.4 } },
    { name: 'Lo-Fi Telephone Echo', category: 'Creative', params: { mode: 1, div: divIndex('1/8'), feedback: 0.6, lowcut: 800, highcut: 2200, mix: 0.35 } },
    { name: 'Endless Feedback', category: 'Creative', params: { mode: 1, div: divIndex('1/2'), feedback: 0.98, lowcut: 200, highcut: 4000, mix: 0.4 } }
  ]
}
