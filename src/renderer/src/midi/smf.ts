// Standard MIDI File (.mid) reader. Pure TS, no DOM: safe for tests and workers.
// Formats 0, 1 and 2, running status, SMPTE divisions, note-on velocity 0 as note-off.

export interface MidiNote {
  /** start in file ticks */
  tick: number
  /** length in file ticks (≥ 1) */
  len: number
  key: number
  /** 1..127 */
  vel: number
  /** 0..15 (9 = GM drums) */
  channel: number
}

export interface MidiTrack {
  /** Track name meta event (0x03), '' when missing. */
  name: string
  /** Instrument name meta event (0x04), '' when missing. */
  instrument: string
  /** First program change per MIDI channel. */
  programs: Partial<Record<number, number>>
  notes: MidiNote[]
}

export interface MidiTempo {
  tick: number
  bpm: number
}

export interface MidiFile {
  format: number
  /** Ticks per quarter note (SMPTE files are converted as if they were 120 BPM). */
  ppq: number
  tracks: MidiTrack[]
  tempos: MidiTempo[]
  timeSig: [number, number] | null
}

export class MidiParseError extends Error {}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const latin1 = new TextDecoder('latin1')
const text = (b: Uint8Array): string => {
  try {
    return utf8.decode(b).replace(/\0/g, '').trim() // UTF-8 when it is valid UTF-8
  } catch {
    return latin1.decode(b).replace(/\0/g, '').trim()
  }
}

export function parseMidi(input: ArrayBuffer | Uint8Array): MidiFile {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const id = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])

  // RIFF-wrapped MIDI (.rmi): skip to the embedded MThd.
  let start = 0
  if (buf.length >= 12 && id(0) === 'RIFF') {
    const at = findChunk(buf, 'MThd', 12)
    if (at < 0) throw new MidiParseError('Not a MIDI file')
    start = at
  }
  if (buf.length < start + 14 || id(start) !== 'MThd') throw new MidiParseError('Not a MIDI file')
  const hlen = dv.getUint32(start + 4)
  const format = dv.getUint16(start + 8)
  const ntrks = dv.getUint16(start + 10)
  const division = dv.getUint16(start + 12)
  let ppq: number
  if (division & 0x8000) {
    const fps = 256 - (division >> 8) // stored as negative two's complement
    const tpf = division & 0xff
    ppq = ((fps === 29 ? 29.97 : fps) * tpf) / 2 // ticks per second / 2 = ticks per quarter at 120 BPM
  } else ppq = division || 96

  const tracks: MidiTrack[] = []
  const tempos: MidiTempo[] = []
  let timeSig: [number, number] | null = null
  let o = start + 8 + hlen
  let trackOffset = 0 // format 2: tracks play one after another
  while (o + 8 <= buf.length && tracks.length < Math.max(ntrks, 1) + 64) {
    const cid = id(o)
    const clen = dv.getUint32(o + 4)
    const body = o + 8
    const end = Math.min(buf.length, body + clen)
    o = body + clen
    if (cid !== 'MTrk') continue
    const tr = readTrack(buf, body, end, format === 2 ? trackOffset : 0, tempos, (ts) => (timeSig ??= ts))
    if (format === 2) trackOffset = tr.endTick
    tracks.push(tr.track)
  }
  if (!tracks.length) throw new MidiParseError('MIDI file has no tracks')
  tempos.sort((a, b) => a.tick - b.tick)
  return { format, ppq, tracks, tempos, timeSig }
}

function findChunk(buf: Uint8Array, name: string, from: number): number {
  for (let i = from; i + 4 <= buf.length; i++)
    if (buf[i] === name.charCodeAt(0) && buf[i + 1] === name.charCodeAt(1) && buf[i + 2] === name.charCodeAt(2) && buf[i + 3] === name.charCodeAt(3)) return i
  return -1
}

function readTrack(
  buf: Uint8Array,
  from: number,
  end: number,
  tickOffset: number,
  tempos: MidiTempo[],
  onTimeSig: (ts: [number, number]) => void
): { track: MidiTrack; endTick: number } {
  const track: MidiTrack = { name: '', instrument: '', programs: {}, notes: [] }
  const open = new Map<number, { tick: number; vel: number }[]>() // (channel << 8 | key) → FIFO of note-ons
  let p = from
  let tick = tickOffset
  let status = 0

  const vlq = (): number => {
    let v = 0
    for (let i = 0; i < 4 && p < end; i++) {
      const b = buf[p++]
      v = (v << 7) | (b & 0x7f)
      if (!(b & 0x80)) break
    }
    return v
  }
  const close = (ch: number, key: number, at: number) => {
    const q = open.get((ch << 8) | key)
    const on = q?.shift()
    if (!on) return
    track.notes.push({ tick: on.tick, len: Math.max(1, at - on.tick), key, vel: on.vel, channel: ch })
  }

  while (p < end) {
    tick += vlq()
    if (p >= end) break
    let b = buf[p]
    if (b & 0x80) {
      p++
      if (b < 0xf0) status = b // running status only applies to channel messages
    } else {
      if (!status) {
        p++ // stray data byte without status: skip it
        continue
      }
      b = status
    }

    if (b === 0xff) {
      const type = buf[p++]
      const len = vlq()
      const data = buf.subarray(p, Math.min(end, p + len))
      p += len
      if (type === 0x2f) break
      if (type === 0x03 && !track.name) track.name = text(data)
      else if (type === 0x04 && !track.instrument) track.instrument = text(data)
      else if (type === 0x51 && data.length >= 3) {
        const us = (data[0] << 16) | (data[1] << 8) | data[2]
        if (us > 0) tempos.push({ tick, bpm: 60_000_000 / us })
      } else if (type === 0x58 && data.length >= 2) onTimeSig([data[0], 2 ** data[1]])
      continue
    }
    if (b === 0xf0 || b === 0xf7) {
      const len = vlq() // read first: `p += vlq()` would add to p's old value
      p += len
      continue
    }
    if (b >= 0xf1) {
      // system common / realtime inside a file: skip their data bytes
      p += b === 0xf2 ? 2 : b === 0xf1 || b === 0xf3 ? 1 : 0
      continue
    }

    const kind = b & 0xf0
    const ch = b & 0x0f
    const d1 = buf[p++] & 0x7f
    const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : buf[p++] & 0x7f
    if (kind === 0x90 && d2 > 0) {
      const k = (ch << 8) | d1
      const q = open.get(k)
      if (q) q.push({ tick, vel: d2 })
      else open.set(k, [{ tick, vel: d2 }])
    } else if (kind === 0x80 || kind === 0x90) close(ch, d1, tick)
    else if (kind === 0xc0 && track.programs[ch] === undefined) track.programs[ch] = d1
  }

  // Notes still held at the end of the track end there.
  for (const [k, q] of open) for (const on of q) track.notes.push({ tick: on.tick, len: Math.max(1, tick - on.tick), key: k & 0xff, vel: on.vel, channel: k >> 8 })
  track.notes.sort((a, b) => a.tick - b.tick || a.key - b.key)
  return { track, endTick: tick }
}
