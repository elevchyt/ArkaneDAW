// Layout of the DX7 algorithm diagrams (pure, shared by the editor and tests).
import { ALGORITHMS } from './tables'

export interface Node { x: number; y: number }
export function algoLayout(a: number): { nodes: Node[]; cols: number; rows: number } {
  const alg = ALGORITHMS[a]
  const targets: number[][] = [[], [], [], [], [], []]
  alg.mods.forEach((ms, t) => ms.forEach((m) => targets[m].push(t)))
  const primary = targets.map((t) => (t.length ? Math.min(...t) : -1))
  const children = (op: number) => alg.mods[op].filter((m) => primary[m] === op).sort((x, y) => x - y)
  const width = (op: number): number => Math.max(1, children(op).reduce((s, c) => s + width(c), 0))
  const nodes: Node[] = Array.from({ length: 6 }, () => ({ x: 0, y: 0 }))
  let rows = 1
  const place = (op: number, x0: number, depth: number): void => {
    rows = Math.max(rows, depth + 1)
    const ch = children(op)
    let x = x0
    for (const c of ch) {
      place(c, x, depth + 1)
      x += width(c)
    }
    nodes[op] = { x: ch.length ? (nodes[ch[0]].x + nodes[ch[ch.length - 1]].x) / 2 : x0, y: depth }
  }
  let x = 0
  for (let op = 0; op < 6; op++) {
    if (primary[op] !== -1) continue
    place(op, x, 0)
    x += width(op)
  }
  for (let op = 0; op < 6; op++) if (targets[op].length > 1) nodes[op].x = targets[op].reduce((s, t) => s + nodes[t].x, 0) / targets[op].length
  return { nodes, cols: x, rows }
}
