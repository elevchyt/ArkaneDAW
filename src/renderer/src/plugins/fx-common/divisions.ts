// Tempo-synced note divisions shared by time-based effects (pure data: safe for DSP + UI).

export const DIVISIONS: { name: string; beats: number }[] = [
  { name: '1/64', beats: 1 / 16 },
  { name: '1/32', beats: 1 / 8 },
  { name: '1/16T', beats: 1 / 6 },
  { name: '1/16', beats: 1 / 4 },
  { name: '1/16D', beats: 3 / 8 },
  { name: '1/8T', beats: 1 / 3 },
  { name: '1/8', beats: 1 / 2 },
  { name: '1/8D', beats: 3 / 4 },
  { name: '1/4T', beats: 2 / 3 },
  { name: '1/4', beats: 1 },
  { name: '1/4D', beats: 3 / 2 },
  { name: '1/2T', beats: 4 / 3 },
  { name: '1/2', beats: 2 },
  { name: '1/2D', beats: 3 },
  { name: '1 bar', beats: 4 },
  { name: '2 bars', beats: 8 }
]

export const DIVISION_NAMES = DIVISIONS.map((d) => d.name)
export const divIndex = (name: string): number => Math.max(0, DIVISION_NAMES.indexOf(name))

/** Length of a division in milliseconds at `bpm`. */
export function divisionMs(index: number, bpm: number): number {
  const d = DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, Math.round(index)))]
  return (d.beats * 60000) / Math.max(20, bpm)
}

/** Hidden 'tempo' param: the host calls setParam('tempo', bpm) on creation and on every tempo change. */
export const TEMPO_PARAM = { id: 'tempo', name: 'Tempo', min: 20, max: 400, default: 120, unit: 'BPM', hidden: true } as const
