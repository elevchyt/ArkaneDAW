// Central animated display: aurora ribbons + drifting particle field + morphing wavetable stack.
// One rAF loop, all inputs read from refs so React re-renders never restart it.
import { useEffect, useRef } from 'react'
import { FRAMES, TABLE_NAMES, frameShapes } from './wavetables'
import { TEXTURE_NAMES } from './textures'

export interface VizState {
  params: Record<string, number>
  dsp: { voices: number; pos: number; ev: number; lfo1: number; lfo2: number; level: number; t: number }
  presetName?: string
}

const shapeCache = new Map<number, Float32Array[]>()
function shapes(t: number): Float32Array[] {
  let s = shapeCache.get(t)
  if (!s) {
    s = frameShapes(t, 80, 36)
    shapeCache.set(t, s)
  }
  return s
}

interface Particle {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  hue: number
}

export function Viz({ state, width, height }: { state: React.MutableRefObject<VizState>; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = width * dpr
    cv.height = height * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.scale(dpr, dpr)
    // glow sprite
    const spr = document.createElement('canvas')
    spr.width = spr.height = 32
    const sg = spr.getContext('2d')!
    const rg = sg.createRadialGradient(16, 16, 0, 16, 16, 16)
    rg.addColorStop(0, 'rgba(255,255,255,1)')
    rg.addColorStop(0.25, 'rgba(255,255,255,0.45)')
    rg.addColorStop(1, 'rgba(255,255,255,0)')
    sg.fillStyle = rg
    sg.fillRect(0, 0, 32, 32)
    const ps: Particle[] = Array.from({ length: 120 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      z: 0.3 + Math.random() * 0.7,
      vx: 0,
      vy: 0,
      hue: Math.random()
    }))
    let raf = 0
    let last = performance.now()
    let time = 0
    let smPos = 0.3
    let smLvl = 0
    let smEv = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      time += dt
      const st = state.current
      const p = st.params
      const d = st.dsp
      const fresh = performance.now() - d.t < 300
      const motion = p['macro.motion'] ?? 0.5
      const evolve = p['macro.evolve'] ?? 0.4
      const tone = p['macro.tone'] ?? 0.5
      const space = p['macro.space'] ?? 0.5
      const voices = fresh ? d.voices : 0
      const targetPos = fresh && d.pos >= 0 ? d.pos : (p['wave.pos'] ?? 0.3)
      smPos += (targetPos - smPos) * Math.min(1, dt * 8)
      smLvl += ((fresh ? Math.min(1, d.level * 2.5) : 0) - smLvl) * Math.min(1, dt * 6)
      smEv += ((fresh ? d.ev : 0) - smEv) * Math.min(1, dt * 3)
      const l1 = fresh ? d.lfo1 : Math.sin(time * 0.6)
      const l2 = fresh ? d.lfo2 : Math.cos(time * 0.37)
      // palette: tone 0 = deep cold violet/blue, 1 = warm amber/rose
      const hueA = tone < 0.5 ? 205 + tone * 110 : 260 + (tone - 0.5) * 260 // blue → violet → rose → amber
      const hueB = hueA - 85 // complementary line colour (teal at default)
      // background
      const bg = g.createLinearGradient(0, 0, 0, height)
      bg.addColorStop(0, `hsl(${hueA - 10}, 45%, ${7 + smLvl * 4}%)`)
      bg.addColorStop(1, `hsl(${hueA + 20}, 50%, 3%)`)
      g.globalCompositeOperation = 'source-over'
      g.fillStyle = bg
      g.fillRect(0, 0, width, height)
      // aurora ribbons
      g.globalCompositeOperation = 'lighter'
      for (let r = 0; r < 3; r++) {
        const base = height * (0.32 + r * 0.14)
        const amp = height * (0.06 + 0.1 * motion) * (1 + 0.3 * l1)
        const ph = time * (0.12 + motion * 0.35) * (r + 1) * 0.6 + r * 2.1
        g.beginPath()
        g.moveTo(0, height)
        for (let x = 0; x <= width; x += 12) {
          const u = x / width
          const y = base + Math.sin(u * 5 + ph) * amp + Math.sin(u * 11 - ph * 1.7 + smEv * 3) * amp * 0.35 * evolve + l2 * 8
          g.lineTo(x, y)
        }
        g.lineTo(width, height)
        g.closePath()
        const grd = g.createLinearGradient(0, base - amp, 0, base + height * 0.35)
        const a = 0.05 + 0.1 * smLvl + 0.04 * space
        grd.addColorStop(0, `hsla(${r === 1 ? hueB : hueA + r * 25}, 85%, 60%, ${a})`)
        grd.addColorStop(1, `hsla(${hueA}, 80%, 40%, 0)`)
        g.fillStyle = grd
        g.fill()
      }
      // particles
      const speed = 8 + motion * 40 + smLvl * 30
      for (const q of ps) {
        const fx = Math.sin(q.y * 0.02 + time * 0.3) + Math.cos(q.x * 0.013 - time * 0.21 + smEv)
        const fy = Math.cos(q.x * 0.017 + time * 0.25) - 0.6
        q.vx += (fx * speed * q.z - q.vx) * dt * 1.5
        q.vy += (fy * speed * 0.6 * q.z - q.vy) * dt * 1.5
        q.x += q.vx * dt
        q.y += q.vy * dt
        if (q.x < -10) q.x = width + 10
        if (q.x > width + 10) q.x = -10
        if (q.y < -10) {
          q.y = height + 10
          q.x = Math.random() * width
        }
        if (q.y > height + 10) q.y = -10
        const s = (3 + q.z * 9) * (0.7 + evolve * 0.6 + smLvl * 0.6)
        g.globalAlpha = (0.12 + 0.35 * q.z) * (0.5 + 0.5 * Math.sin(time * (0.5 + q.hue) + q.hue * 9) ** 2) * (0.6 + smLvl)
        g.drawImage(spr, q.x - s / 2, q.y - s / 2, s, s)
      }
      g.globalAlpha = 1
      // wavetable stack
      const tIdx = Math.round(p['wave.table'] ?? 0)
      const waveOn = (p['wave.on'] ?? 1) >= 0.5
      const sh = shapes(tIdx)
      const cx = width * 0.5
      const w = width * 0.46
      const h = height * 0.2
      const x0 = cx - w / 2 - 30
      const y0 = height * 0.66
      g.lineWidth = 1
      for (let k = FRAMES - 1; k >= 0; k--) {
        const ox = k * 9
        const oy = -k * 9
        const near = 1 - Math.min(1, Math.abs(k / (FRAMES - 1) - smPos) * 3)
        g.strokeStyle = `hsla(${hueB}, 70%, ${55 + near * 20}%, ${(waveOn ? 0.12 : 0.05) + near * 0.25})`
        g.beginPath()
        const a = sh[k]
        for (let i = 0; i < a.length; i++) {
          const x = x0 + ox + (i / (a.length - 1)) * w
          const y = y0 + oy - a[i] * h
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
      if (waveOn) {
        const fp = Math.max(0, Math.min(1, smPos)) * (FRAMES - 1)
        const fa = Math.floor(fp)
        const fb = Math.min(FRAMES - 1, fa + 1)
        const fr = fp - fa
        const A = sh[fa]
        const B = sh[fb]
        const ox = fp * 9
        const oy = -fp * 9
        g.shadowColor = `hsl(${hueB}, 90%, 70%)`
        g.shadowBlur = 10 + smLvl * 14
        g.strokeStyle = `hsla(${hueB}, 95%, 82%, 0.95)`
        g.lineWidth = 1.8
        g.beginPath()
        for (let i = 0; i < A.length; i++) {
          const v = A[i] + (B[i] - A[i]) * fr
          const x = x0 + ox + (i / (A.length - 1)) * w
          const y = y0 + oy - v * h * (1 + 0.08 * Math.sin(time * 2 + i * 0.2) * motion * smLvl)
          if (i === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
        g.shadowBlur = 0
      }
      // labels
      g.globalCompositeOperation = 'source-over'
      g.font = '600 15px ui-sans-serif, system-ui, sans-serif'
      g.fillStyle = 'rgba(235,230,255,0.85)'
      g.fillText('A T M O S', 12, 22)
      g.font = '10px ui-sans-serif, system-ui, sans-serif'
      g.fillStyle = 'rgba(200,200,230,0.55)'
      if (st.presetName) g.fillText(st.presetName.toUpperCase(), 12, 36)
      const layers: string[] = []
      if (waveOn) layers.push(TABLE_NAMES[tIdx] ?? '')
      if ((p['gran.on'] ?? 0) >= 0.5) layers.push(TEXTURE_NAMES[Math.round(p['gran.texture'] ?? 0)] ?? '')
      if ((p['noise.on'] ?? 0) >= 0.5) layers.push('Air')
      g.textAlign = 'right'
      g.fillText(layers.join('  ·  '), width - 12, 18)
      g.fillText(`${voices} voice${voices === 1 ? '' : 's'}`, width - 12, height - 10)
      if ((p['fx.freeze'] ?? 0) >= 0.5) {
        g.fillStyle = 'rgba(150,220,255,0.9)'
        g.fillText('❄ FREEZE', width - 12, height - 24)
      }
      g.textAlign = 'left'
      // level meter strip
      g.fillStyle = `hsla(${hueB}, 80%, 65%, 0.7)`
      g.fillRect(12, height - 12, (width * 0.25) * smLvl, 2)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [state, width, height])
  return <canvas ref={ref} style={{ width, height, display: 'block', borderRadius: 4 }} />
}
