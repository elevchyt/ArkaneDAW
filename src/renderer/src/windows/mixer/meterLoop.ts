// Stereo peak meters for mixer strips. One shared requestAnimationFrame loop draws every mounted
// meter canvas, reading the engine's per-strip meter values (no React re-renders).
import { getEngine } from '@/audio/transport'

export interface MeterState {
  index: number
  canvas: HTMLCanvasElement
  disp: [number, number] // displayed level, dB
  hold: [number, number] // peak hold, dB
  holdT: [number, number] // time the hold was set
  clip: boolean
  lastPeak: number // linear, max of L/R for hints
}

export const FLOOR = -70
const FALL_DB_S = 26 // display falloff
const HOLD_S = 1.4
const HOLD_FALL_DB_S = 18
const meters = new Set<MeterState>()
let raf = 0
let last = 0

/** Same law as the fader so 0 dB sits at the fader's unity mark (80 %). */
export function dbToNorm(db: number): number {
  if (db <= FLOOR) return 0
  const amp = Math.pow(10, db / 20)
  return Math.min(1, 0.8 * Math.pow(amp, 1 / 1.6))
}

const toDb = (a: number): number => (a <= 0.0000316 ? FLOOR : 20 * Math.log10(a))

/** Draw every mounted meter once (also usable for tests while rAF is throttled). */
export function drawMeters(now = performance.now()): void {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016
  last = now
  const eng = getEngine()
  for (const m of meters) draw(m, eng?.mixer[m.index]?.meter ?? null, dt, now / 1000)
}

// Dev hook: rAF is paused in hidden tabs, so tests can force a meter repaint.
if (import.meta.env.DEV) (globalThis as { __arkaneDrawMeters?: () => void }).__arkaneDrawMeters = () => drawMeters()

function frame(now: number): void {
  drawMeters(now)
  raf = meters.size ? requestAnimationFrame(frame) : 0
}

function draw(m: MeterState, meter: { peakL: number; peakR: number } | null, dt: number, t: number): void {
  const c = m.canvas
  const dpr = window.devicePixelRatio || 1
  const w = c.clientWidth
  const h = c.clientHeight
  if (!w || !h) return
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const g = c.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  const peaks = [meter?.peakL ?? 0, meter?.peakR ?? 0]
  m.lastPeak = Math.max(peaks[0], peaks[1])
  g.fillStyle = '#121618'
  g.fillRect(0, 0, w, h)
  const gap = 1
  const bw = (w - gap) / 2
  const grad = g.createLinearGradient(0, h, 0, 0)
  grad.addColorStop(0, '#2f8f2a')
  grad.addColorStop(0.4, '#6fd23c')
  grad.addColorStop(0.6, '#c9e23a')
  grad.addColorStop(0.72, '#f2b233')
  grad.addColorStop(0.8, '#f0612e')
  grad.addColorStop(1, '#ff2a2a')
  for (let ch = 0; ch < 2; ch++) {
    const db = toDb(peaks[ch])
    if (peaks[ch] >= 1) m.clip = true
    m.disp[ch] = Math.max(db, m.disp[ch] - FALL_DB_S * dt)
    if (db >= m.hold[ch]) {
      m.hold[ch] = db
      m.holdT[ch] = t
    } else if (t - m.holdT[ch] > HOLD_S) m.hold[ch] = Math.max(FLOOR, m.hold[ch] - HOLD_FALL_DB_S * dt)
    const x = ch * (bw + gap)
    const lv = dbToNorm(m.disp[ch]) * h
    if (lv > 0) {
      g.fillStyle = grad
      g.fillRect(x, h - lv, bw, lv)
    }
    const hy = h - dbToNorm(m.hold[ch]) * h
    if (m.hold[ch] > FLOOR + 1) {
      g.fillStyle = m.hold[ch] >= 0 ? '#ff4b3e' : '#e8f0c8'
      g.fillRect(x, Math.max(0, hy - 1), bw, 1.5)
    }
  }
  // segment lines + 0 dB tick
  g.fillStyle = 'rgba(0,0,0,.35)'
  for (let y = h - 3; y > 0; y -= 3) g.fillRect(0, y, w, 1)
  g.fillStyle = 'rgba(255,255,255,.18)'
  g.fillRect(0, Math.round(h - 0.8 * h), w, 1)
  if (m.clip) {
    g.fillStyle = '#ff2a2a'
    g.fillRect(0, 0, w, 3)
  }
}

export function registerMeter(m: MeterState): () => void {
  meters.add(m)
  if (!raf) {
    last = 0
    raf = requestAnimationFrame(frame)
  }
  return () => {
    meters.delete(m)
    if (!meters.size && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
}
