// Classic one-bar grooves the editor can drop into the current pattern (via insertNotes).
// Step strings: 16 sixteenths; 'X' accent, 'x' normal, 'o' ghost, '.' rest.

export interface Groove {
  name: string
  steps: Record<number, string>
  /** swing amount 0..1 applied to even sixteenths */
  swing?: number
}

export const GROOVES: Groove[] = [
  {
    name: 'Electro (808)',
    steps: {
      36: 'X......x..X.....',
      38: '....X.......X...',
      39: '....x.......x...',
      42: 'x.x.x.x.x.x.x.xx',
      56: '..........o.....'
    }
  },
  {
    name: 'House (909)',
    steps: {
      36: 'X...X...X...X...',
      39: '....x.......x...',
      42: 'o.o.o.o.o.o.o.o.',
      46: '..x...x...x...x.',
      51: 'o...o...o...o...'
    }
  },
  {
    name: 'Techno',
    steps: {
      36: 'X...X...X...X...',
      37: '...o..o....o..o.',
      42: 'x.x.x.x.x.x.x.x.',
      46: '..x...x...x...x.',
      39: '....x.......x...'
    }
  },
  {
    name: 'Boom Bap',
    swing: 0.55,
    steps: {
      36: 'X.......X.x.....',
      38: '....X.......X..o',
      42: 'x.x.x.x.x.x.x.x.'
    }
  },
  {
    name: 'Trap',
    steps: {
      36: 'X.........X.....',
      35: '......x.........',
      39: '........X.......',
      42: 'x.x.x.xxx.x.xxxx',
      46: '..............x.'
    }
  },
  {
    name: '80s Pop (Linn)',
    steps: {
      36: 'X.......X.X.....',
      38: '....X.......X...',
      42: 'x.o.x.o.x.o.x.o.',
      54: '....x.......x...'
    }
  },
  {
    name: 'Bossa (CR-78)',
    steps: {
      36: 'X..x....X..x....',
      37: 'x..x..x...x..x..',
      42: 'xoxoxoxoxoxoxoxo',
      70: 'o.o.o.o.o.o.o.o.'
    }
  },
  {
    name: 'Tom Fill',
    steps: {
      36: 'X...............',
      48: '....x.x.........',
      45: '........x.x.....',
      43: '............x...',
      41: '..............x.',
      49: '...............o'
    }
  }
]

export interface GrooveNote {
  key: number
  pos: number
  len: number
  vel: number
}

/** Expand a groove to notes (ticks, PPQ 96 => a sixteenth is 24 ticks). */
export function grooveNotes(g: Groove, bars = 1, ppq = 96): GrooveNote[] {
  const s16 = ppq / 4
  const out: GrooveNote[] = []
  for (let b = 0; b < bars; b++) {
    for (const [k, str] of Object.entries(g.steps)) {
      for (let i = 0; i < 16; i++) {
        const c = str[i]
        if (!c || c === '.') continue
        const vel = c === 'X' ? 1 : c === 'x' ? 0.78 : 0.5
        const swing = g.swing && i % 2 === 1 ? Math.round(s16 * (g.swing - 0.5) * 2 * 0.5) : 0
        out.push({ key: Number(k), pos: b * 16 * s16 + i * s16 + swing, len: s16, vel })
      }
    }
  }
  return out.sort((a, b) => a.pos - b.pos || a.key - b.key)
}
