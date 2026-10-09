// Concert-hall reverb for Concerto: pre-delay, early reflections, input diffusion and an 8-line feedback delay
// network (Householder matrix, per-line damping, slow modulation against metallic ringing). Allocation-free
// after construction; `size` (0..1) scales room dimensions, pre-delay and RT60 (≈1.1 s … 4.3 s).

const N = 8
// base line lengths (ms) — mutually prime-ish, hall-sized
const LINES_MS = [43.7, 51.1, 58.3, 66.7, 73.1, 81.9, 90.7, 101.3]
const MOD_RATE = [0.13, 0.17, 0.21, 0.11, 0.19, 0.23, 0.15, 0.09]
// early reflections (ms, gain) per side, at size 1
const ER_L: [number, number][] = [[7.1, 0.55], [13.3, 0.42], [21.7, 0.36], [29.9, 0.28], [41.3, 0.22], [55.1, 0.16]]
const ER_R: [number, number][] = [[8.9, 0.52], [15.7, 0.44], [19.9, 0.33], [33.1, 0.27], [45.7, 0.2], [59.3, 0.15]]
const AP_MS = [4.7, 6.1, 3.9, 5.3]

class Ring {
  buf: Float32Array
  mask: number
  w = 0
  constructor(len: number) {
    let n = 1
    while (n < len + 2) n <<= 1
    this.buf = new Float32Array(n)
    this.mask = n - 1
  }
  push(x: number): void {
    this.buf[this.w] = x
    this.w = (this.w + 1) & this.mask
  }
  /** sample written `d` pushes ago (d ≥ 1) */
  tap(d: number): number {
    return this.buf[(this.w - d) & this.mask]
  }
  tapFrac(d: number): number {
    const i = Math.floor(d)
    const f = d - i
    const a = this.buf[(this.w - i) & this.mask]
    const b = this.buf[(this.w - i - 1) & this.mask]
    return a + (b - a) * f
  }
  clear(): void {
    this.buf.fill(0)
  }
}

export class Hall {
  private sr: number
  private pre: Ring
  private preLen = 1
  private erL: Ring
  private erR: Ring
  private erTapsL = new Float32Array(ER_L.length)
  private erTapsR = new Float32Array(ER_R.length)
  private ap: Ring[]
  private apLen = new Float32Array(4)
  private lines: Ring[]
  private len = new Float32Array(N)
  private g = new Float32Array(N)
  private lp = new Float32Array(N)
  private damp = 0.3
  private phase = new Float32Array(N)
  private modDepth: number
  private hpL = 0
  private hpR = 0
  private hpC: number
  private x = new Float32Array(N)

  constructor(sr: number) {
    this.sr = sr
    const ms = (v: number): number => Math.ceil((v / 1000) * sr)
    this.pre = new Ring(ms(60))
    this.erL = new Ring(ms(80))
    this.erR = new Ring(ms(80))
    this.ap = AP_MS.map((m) => new Ring(ms(m * 1.6) + 4))
    this.lines = LINES_MS.map((m) => new Ring(ms(m * 1.5) + 16))
    this.modDepth = 0.0012 * sr
    this.hpC = Math.exp((-2 * Math.PI * 90) / sr)
    for (let i = 0; i < N; i++) this.phase[i] = i / N
    this.setSize(0.6)
  }

  setSize(size: number): void {
    const s = Math.min(1, Math.max(0, size))
    const sr = this.sr
    const scale = 0.55 + 0.9 * s
    const rt60 = 1.1 + 3.2 * s
    this.preLen = Math.max(1, Math.round(((8 + 34 * s) / 1000) * sr))
    for (let i = 0; i < ER_L.length; i++) this.erTapsL[i] = Math.max(1, Math.round(((ER_L[i][0] * scale) / 1000) * sr))
    for (let i = 0; i < ER_R.length; i++) this.erTapsR[i] = Math.max(1, Math.round(((ER_R[i][0] * scale) / 1000) * sr))
    for (let i = 0; i < 4; i++) this.apLen[i] = Math.max(1, Math.round(((AP_MS[i] * (0.7 + 0.8 * s)) / 1000) * sr))
    for (let i = 0; i < N; i++) {
      this.len[i] = Math.max(16, Math.round(((LINES_MS[i] * scale) / 1000) * sr))
      this.g[i] = Math.pow(10, (-3 * (this.len[i] / sr)) / rt60)
    }
    // bigger halls: darker tails
    this.damp = 0.42 - 0.2 * s
  }

  clear(): void {
    this.pre.clear()
    this.erL.clear()
    this.erR.clear()
    for (const a of this.ap) a.clear()
    for (const l of this.lines) l.clear()
    this.lp.fill(0)
    this.hpL = this.hpR = 0
  }

  /** ADD the reverb of in[0..n) to out[o..o+n), scaled by `wet`. */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, o: number, n: number, wet: number): void {
    const { pre, erL, erR, ap, lines, len, g, lp, x, apLen } = this
    const hpC = this.hpC
    const damp = this.damp
    const dPhase = 1 / this.sr
    const md = this.modDepth
    for (let i = 0; i < n; i++) {
      // high-passed mono-ish input into the pre-delay (keeps the stereo difference for the ERs)
      this.hpL = hpC * this.hpL + (1 - hpC) * inL[i]
      this.hpR = hpC * this.hpR + (1 - hpC) * inR[i]
      const l = inL[i] - this.hpL
      const r = inR[i] - this.hpR
      pre.push(l + r)
      const p = pre.tap(this.preLen) * 0.5
      erL.push(l)
      erR.push(r)
      let eL = 0, eR = 0
      for (let k = 0; k < ER_L.length; k++) eL += erL.tap(this.erTapsL[k]) * ER_L[k][1]
      for (let k = 0; k < ER_R.length; k++) eR += erR.tap(this.erTapsR[k]) * ER_R[k][1]
      // input diffusion (series allpasses)
      let d = p
      for (let k = 0; k < 4; k++) {
        const z = ap[k].tap(apLen[k])
        const v = d + 0.62 * z
        ap[k].push(v)
        d = z - 0.62 * v
      }
      // FDN: read, damp
      let sum = 0
      for (let k = 0; k < N; k++) {
        let ph = this.phase[k] + MOD_RATE[k] * dPhase
        if (ph >= 1) ph -= 1
        this.phase[k] = ph
        const mod = (k & 1 ? 1 : -1) * md * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph)
        const y = lines[k].tapFrac(len[k] + mod + 2)
        lp[k] += (y - lp[k]) * (1 - damp)
        x[k] = lp[k] * g[k]
        sum += x[k]
      }
      // Householder feedback + input injection (alternating ER sides for stereo spread)
      const h = (2 / N) * sum
      for (let k = 0; k < N; k++) lines[k].push(x[k] - h + d + (k & 1 ? eR : eL) * 0.25)
      const tl = x[0] - x[2] + x[4] - x[6] + eL * 0.6
      const tr = x[1] - x[3] + x[5] - x[7] + eR * 0.6
      outL[o + i] += tl * wet
      outR[o + i] += tr * wet
    }
  }
}
