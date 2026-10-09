// VocalTune DSP — pitch detection (YIN, see detector.ts) + causal TD-PSOLA pitch shifting.
//
// Shifter: pitch-synchronous overlap-add with zero lookahead.
//   * An "analysis lattice" ticks at the detected period Pa (phase anaPhase = time since the last
//     lattice point), a "synthesis clock" ticks at the target period Ps = Pa / ratio.
//   * At every synthesis tick a grain starts: a Hann window of half-width H = max(Pa, Ps) that reads
//     the input at a constant delay d = (time since the latest lattice point) ∈ [0, Pa). Consecutive
//     grains are therefore taken a whole number of input periods apart (coherent) but are laid down
//     Ps apart, so the output repeats every Ps: classic TD-PSOLA, formants preserved (no resampling).
//   * Output = Σ grain·w / max(Σ w, 0.5) (window-sum normalisation keeps the level constant).
//   * ratio = 1 (no correction / unvoiced) makes Ps = Pa and d constant: the Hann windows sum to one,
//     i.e. the input passes through unchanged (just delayed by d). Unvoiced or silent input therefore
//     glides back to ratio 1 within ~20 ms, so breaths and consonants are untouched.
//
// LATENCY (no host PDC API yet): the wet path has no lookahead. Fixed latency = 2 samples (cubic
// interpolation); on top of that the pitch-synchronous read offset wanders within 0..1 pitch period
// (≈2–5 ms for typical voices, ≤17 ms at 60 Hz). Pitch decisions lag the audio by about half the
// 20 ms analysis window + one 4 ms hop (≈15 ms), which is what makes fast note changes "scoop".
//
// CPU: ~30-70 µs per 128-frame stereo block at 48 kHz (1-2.6% of real time; see dsp.test.ts benchmark).
import type { DSPContext, DSPFactory, EffectDSP } from '../sdk/types'
import { Smoother, UiLink } from '../fx-common/dsp-util'
import { PitchDetector } from './detector'
import { freqToMidi, manifest, nearestNote, scaleMask } from './manifest'

const MAXG = 8
const BASE = 2 // fixed read delay so the 4-point interpolator never needs future samples
const HYST = 0.2 // semitones: a new note must be this much closer before the target switches
const UNVOICED_TAU = 0.02 // s: glide back to "no correction" when the input stops being pitched

function pow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

class VocalTuneDSP implements EffectDSP {
  private sr: number
  private post: (m: unknown) => void
  private ui: UiLink
  readonly det: PitchDetector
  private hopSec: number

  // input history (per channel)
  private bufL: Float32Array
  private bufR: Float32Array
  private mask: number
  private w = 0

  // grains (struct of arrays, fixed pool)
  private gDelay = new Float64Array(MAXG)
  private gRel = new Float64Array(MAXG)
  private gH = new Float64Array(MAXG)
  private gN = 0

  // PSOLA clocks
  private Pa: number
  private Ps: number
  private anaPhase = 0
  private synPhase = 0

  // tuning state
  private sMask = new Uint8Array(12)
  private key = 0
  private scale = 0
  private speed = 0.025
  private humanize = 0
  private mix: Smoother
  private target = -1
  private held = 0
  private corr = 0 // applied correction, semitones
  private hist = new Float64Array(3)
  private histN = 0
  private wasVoiced = false
  private voicedTime = 0
  private primed = false
  private lastMidi = 0
  private prevM = 0
  private slope = 0

  constructor(ctx: DSPContext) {
    this.sr = ctx.sampleRate
    this.post = ctx.post
    this.ui = new UiLink(this.sr, 30)
    this.det = new PitchDetector(this.sr)
    this.hopSec = this.det.hop / this.sr
    const n = pow2(Math.ceil(this.sr / 40) + 16)
    this.bufL = new Float32Array(n)
    this.bufR = new Float32Array(n)
    this.mask = n - 1
    this.Pa = this.Ps = Math.round(this.sr * 0.005)
    this.mix = new Smoother(this.sr, 1, 20)
    for (const p of manifest.params) this.setParam(p.id, p.default)
  }

  setParam(id: string, v: number): void {
    switch (id) {
      case 'key':
        this.key = Math.round(v)
        scaleMask(this.key, this.scale, this.sMask)
        break
      case 'scale':
        this.scale = Math.round(v)
        scaleMask(this.key, this.scale, this.sMask)
        break
      case 'speed':
        this.speed = Math.max(0, v) / 1000
        break
      case 'humanize':
        this.humanize = Math.min(1, Math.max(0, v))
        break
      case 'mix':
        if (this.primed) this.mix.set(Math.min(1, Math.max(0, v)))
        else this.mix.jump(Math.min(1, Math.max(0, v)))
        break
    }
  }

  onMessage(msg: unknown): void {
    this.ui.onMessage(msg)
  }

  reset(): void {
    this.bufL.fill(0)
    this.bufR.fill(0)
    this.w = 0
    this.gN = 0
    this.det.reset()
    this.Pa = this.Ps = Math.round(this.sr * 0.005)
    this.anaPhase = this.synPhase = 0
    this.target = -1
    this.held = 0
    this.corr = 0
    this.histN = 0
    this.wasVoiced = false
  }

  /** Runs once per detector hop (~4 ms): pick the target note and update the synthesis period. */
  private control(): void {
    const det = this.det
    const dt = this.hopSec
    if (det.voiced) {
      const m0 = freqToMidi(det.freq)
      // outlier guard: a single-hop jump far from the median of the last 3 (octave slip) is ignored
      if (!this.wasVoiced) {
        this.histN = 0
        this.voicedTime = 0
      } else this.voicedTime += dt
      this.hist[this.histN % 3] = m0
      this.histN++
      let m = m0
      if (this.histN >= 3) {
        const a = this.hist[0], b = this.hist[1], c = this.hist[2]
        const med = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
        if (Math.abs(m0 - med) > 0.7) m = med
      }
      this.lastMidi = m
      // pitch slope -> predict where the pitch is *now* (compensates the analysis lag on vibrato/scoops)
      if (this.voicedTime > 0) this.slope += ((m - this.prevM) / dt - this.slope) * 0.5
      else this.slope = 0
      this.prevM = m
      let ahead = this.slope * (det.lag + 0.5 * dt)
      if (ahead > 0.3) ahead = 0.3
      else if (ahead < -0.3) ahead = -0.3
      // target note: free choice for the first 40 ms of a phrase (onsets are unstable), then hysteresis
      const cand = nearestNote(m, this.sMask)
      const cur = this.target
      const sticky = this.voicedTime > 0.04 && cur >= 0 && this.sMask[cur % 12] === 1 && Math.abs(m - cur) < 1.5
      if (!sticky || (cand !== cur && Math.abs(m - cand) + HYST < Math.abs(m - cur))) {
        if (cand !== cur) this.held = 0
        else this.held += dt
        this.target = cand
      } else this.held += dt
      // retune speed (+ humanize: sustained notes are corrected more slowly -> vibrato survives)
      const sus = Math.min(1, Math.max(0, (this.held - 0.08) / 0.25))
      const hs = this.humanize * sus
      const tau = (this.speed * (1 + 3 * hs) + 0.15 * hs) / 3
      const want = this.target - (m + ahead)
      this.corr = tau <= 1e-5 ? want : this.corr + (want - this.corr) * (1 - Math.exp(-dt / tau))
      this.Pa = det.period
      this.wasVoiced = true
    } else {
      this.corr *= Math.exp(-dt / UNVOICED_TAU)
      if (Math.abs(this.corr) < 1e-4) this.corr = 0
      this.wasVoiced = false
    }
    let ratio = Math.pow(2, this.corr / 12)
    if (ratio < 0.5) ratio = 0.5
    else if (ratio > 2) ratio = 2
    this.Ps = this.Pa / ratio
  }

  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, start: number, end: number): void {
    const bufL = this.bufL
    const bufR = this.bufR
    const mask = this.mask
    const gDelay = this.gDelay
    const gRel = this.gRel
    const gH = this.gH
    const det = this.det
    this.primed = true
    for (let i = start; i < end; i++) {
      const l = inL[i]
      const r = inR[i]
      const w = this.w
      bufL[w] = l
      bufR[w] = r
      this.w = (w + 1) & mask
      if (det.push(0.5 * (l + r))) this.control()

      // clocks
      const Pa = this.Pa
      let ap = this.anaPhase + 1
      while (ap >= Pa) ap -= Pa
      this.anaPhase = ap
      let sp = this.synPhase + 1
      if (sp >= this.Ps) {
        while (sp >= this.Ps) sp -= this.Ps
        // new grain: true start time lies `sp` samples in the past
        let d = ap - sp
        if (d < 0) d += Pa
        let k = this.gN
        if (k >= MAXG) {
          // pool full (extreme ratios): recycle the oldest grain
          k = 0
          for (let g = 1; g < MAXG; g++) if (gRel[g] - 2 * gH[g] > gRel[k] - 2 * gH[k]) k = g
        } else this.gN++
        gDelay[k] = d + BASE
        gRel[k] = sp
        gH[k] = Pa > this.Ps ? Pa : this.Ps
      }
      this.synPhase = sp

      // overlap-add
      let sl = 0, sr = 0, sw = 0
      for (let g = 0; g < this.gN; ) {
        const H = gH[g]
        const rel = gRel[g]
        if (rel >= 2 * H) {
          const last = --this.gN
          gDelay[g] = gDelay[last]
          gRel[g] = gRel[last]
          gH[g] = gH[last]
          continue
        }
        const win = 0.5 - 0.5 * Math.cos((Math.PI * rel) / H)
        // 4-point Hermite read at (newest - delay)
        const pos = w - gDelay[g]
        const pf = Math.floor(pos)
        const t = pos - pf
        const i1 = pf & mask
        const i0 = (pf - 1) & mask
        const i2 = (pf + 1) & mask
        const i3 = (pf + 2) & mask
        let a0 = bufL[i0], a1 = bufL[i1], a2 = bufL[i2], a3 = bufL[i3]
        let c1 = 0.5 * (a2 - a0)
        let c2 = a0 - 2.5 * a1 + 2 * a2 - 0.5 * a3
        let c3 = 0.5 * (a3 - a0) + 1.5 * (a1 - a2)
        sl += win * (((c3 * t + c2) * t + c1) * t + a1)
        a0 = bufR[i0]; a1 = bufR[i1]; a2 = bufR[i2]; a3 = bufR[i3]
        c1 = 0.5 * (a2 - a0)
        c2 = a0 - 2.5 * a1 + 2 * a2 - 0.5 * a3
        c3 = 0.5 * (a3 - a0) + 1.5 * (a1 - a2)
        sr += win * (((c3 * t + c2) * t + c1) * t + a1)
        sw += win
        gRel[g] = rel + 1
        g++
      }
      const norm = 1 / (sw > 0.5 ? sw : 0.5)
      const m = this.mix.next()
      const dm = 1 - m
      outL[i] = l * dm + sl * norm * m
      outR[i] = r * dm + sr * norm * m
    }
    if (this.ui.tick(end - start)) {
      const v = det.voiced && this.wasVoiced
      this.post({ t: 'vt', v: v ? 1 : 0, det: this.lastMidi, tgt: this.target, out: this.lastMidi + this.corr, corr: this.corr })
    }
  }
}

export default { id: 'vocaltune', kind: 'effect', create: (ctx) => new VocalTuneDSP(ctx) } satisfies DSPFactory
