import type { PluginManifest } from '../sdk/types'

export const MODES = ['Room', 'Hall', 'Plate']

/** Reverb: 8-line feedback-delay-network reverb with Room / Hall / Plate voicings. */
export const manifest: PluginManifest = {
  id: 'reverb',
  name: 'Reverb',
  kind: 'effect',
  category: 'Reverb & Delay',
  description: 'Lush, stable algorithmic reverb (8x8 FDN) with Room, Hall and Plate modes.',
  color: '#8f8cff',
  params: [
    { id: 'mode', name: 'Mode', min: 0, max: 2, default: 1, options: MODES },
    { id: 'size', name: 'Size', min: 0, max: 1, default: 0.5, unit: '%' },
    { id: 'decay', name: 'Decay', min: 0.1, max: 20, default: 2.2, unit: 's', curve: 'exp' },
    { id: 'predelay', name: 'Pre-delay', min: 0, max: 250, default: 12, unit: 'ms', curve: 'exp' },
    { id: 'damp', name: 'High Cut', min: 1000, max: 20000, default: 7000, unit: 'Hz', curve: 'exp' },
    { id: 'lowcut', name: 'Low Cut', min: 20, max: 1000, default: 120, unit: 'Hz', curve: 'exp' },
    { id: 'width', name: 'Width', min: 0, max: 1, default: 1, unit: '%' },
    { id: 'mix', name: 'Mix', min: 0, max: 1, default: 0.25, unit: '%' }
  ],
  presets: [
    { name: 'Default', params: {} },
    { name: 'Small Room', category: 'Room', params: { mode: 0, size: 0.35, decay: 0.6, predelay: 3, damp: 6000, lowcut: 150, mix: 0.22 } },
    { name: 'Drum Room', category: 'Room', params: { mode: 0, size: 0.7, decay: 1.0, predelay: 6, damp: 8000, lowcut: 200, mix: 0.25 } },
    { name: 'Vocal Plate', category: 'Plate', params: { mode: 2, size: 0.55, decay: 1.8, predelay: 30, damp: 9000, lowcut: 250, mix: 0.25 } },
    { name: 'Bright Plate', category: 'Plate', params: { mode: 2, size: 0.7, decay: 2.6, predelay: 15, damp: 14000, lowcut: 300, mix: 0.3 } },
    { name: 'Snare Plate', category: 'Plate', params: { mode: 2, size: 0.4, decay: 1.2, predelay: 0, damp: 11000, lowcut: 200, mix: 0.3 } },
    { name: 'Concert Hall', category: 'Hall', params: { mode: 1, size: 0.6, decay: 2.6, predelay: 20, damp: 6500, lowcut: 100, mix: 0.25 } },
    { name: 'Big Hall', category: 'Hall', params: { mode: 1, size: 0.85, decay: 4, predelay: 35, damp: 5500, lowcut: 90, mix: 0.3 } },
    { name: 'Cathedral', category: 'Hall', params: { mode: 1, size: 1, decay: 8, predelay: 60, damp: 4500, lowcut: 80, mix: 0.35 } },
    { name: 'Ambient Wash', category: 'Creative', params: { mode: 1, size: 1, decay: 14, predelay: 90, damp: 3500, lowcut: 200, mix: 0.5 } },
    { name: 'Dark Chamber', category: 'Room', params: { mode: 0, size: 0.9, decay: 1.6, predelay: 10, damp: 2500, lowcut: 60, mix: 0.25 } },
    { name: 'Infinite Pad', category: 'Creative', params: { mode: 2, size: 1, decay: 20, predelay: 0, damp: 5000, lowcut: 150, mix: 0.6 } }
  ]
}
