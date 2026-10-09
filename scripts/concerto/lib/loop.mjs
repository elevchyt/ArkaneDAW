// Sustain loop finder with a baked crossfade.
//
// For a sustained sample we locate the end of the attack and the end of the steady part, choose a long loop
// [ls, le) inside it (long loops keep vibrato / bow movement natural), fine-tune ls by waveform correlation,
// then crossfade the audio just before le into the audio just before ls. Playback can then jump from le-1 to
// ls without any discontinuity and without a runtime crossfade. The returned channels end at le + GUARD
// (guard samples repeat ls.. so interpolation across the wrap reads the right values).
import { SR, envelope, mono } from './audio.mjs'

export const GUARD = 4

function median(a) {
  const s = Array.from(a).sort((x, y) => x - y)
  return s.length ? s[s.length >> 1] : 0
}

/** Normalised correlation of windows ending at a and at b (length w, stride st). */
function ncc(x, a, b, w, st = 1) {
  let sab = 0, saa = 0, sbb = 0
  for (let i = 1; i <= w; i += st) {
    const p = x[a - i], q = x[b - i]
    sab += p * q
    saa += p * p
    sbb += q * q
  }
  return sab / Math.sqrt(saa * sbb + 1e-20)
}

/**
 * @param channels float channels at 48 kHz, already start-trimmed
 * @param opts { maxLen (s, file length cap), minLoop, maxLoop, xfade (s) }
 * @returns { channels, loop: [ls, le], ofs (legato start offset), corr, susLevel }
 */
export function makeLoop(channels, { maxLen = 3.2, minLoop = 0.45, maxLoop = 1.3, xfade = 0.2 } = {}) {
  const n = channels[0].length
  const { env, hop } = envelope(channels, 0.01)
  const peakEnv = Math.max(...env)
  let on = env.findIndex((v) => v > peakEnv * 0.1)
  if (on < 0) on = 0
  const tail = Math.max(on + 1, env.length - 30)
  const body = env.slice(Math.min(on + 25, tail - 1), tail)
  const sus = median(body.length ? body : env.slice(on))
  // attack end: first point at 70 % of the sustain level, + 80 ms
  let att = on
  while (att < env.length - 1 && env[att] < sus * 0.7) att++
  const ofs = Math.min(n - 1, (att + 8) * hop)
  // sustain end: last point still at -6 dB of the sustain level (before the natural release)
  let se = env.length - 1
  while (se > att && env[se] < sus * 0.5) se--
  let le = Math.min((se - 5) * hop, Math.round(maxLen * SR), n - GUARD - 1)
  let X = Math.round(xfade * SR)
  const minL = Math.round(minLoop * SR)
  const avail = le - ofs
  // short samples: shrink the crossfade and loop to what is there
  if (avail < minL + X) {
    X = Math.max(Math.round(0.02 * SR), Math.floor(avail * 0.35))
  }
  let loopLen = Math.min(Math.round(maxLoop * SR), Math.max(Math.min(minL, avail - X), Math.round((avail - X) * 0.7)))
  if (loopLen < X) X = Math.floor(loopLen * 0.9)
  if (loopLen < 64 || le - loopLen - X < 0) {
    // degenerate: loop the last part we have
    le = Math.max(256, Math.min(n - GUARD - 1, le))
    loopLen = Math.max(64, Math.floor(le * 0.4))
    X = Math.floor(loopLen * 0.5)
  }
  const m = mono(channels)
  // fine-tune ls by correlation (coarse stride 8, then exact ±8)
  const ls0 = le - loopLen
  const lo = Math.max(X + 1, ofs + X, ls0 - Math.round(0.08 * SR))
  const hi = Math.min(le - X - 1, ls0 + Math.round(0.08 * SR))
  const w = Math.min(2048, X)
  let best = Math.max(lo, Math.min(hi, ls0)), bestC = -2
  for (let ls = lo; ls <= hi; ls += 8) {
    const c = ncc(m, ls, le, w, 2)
    if (c > bestC) { bestC = c; best = ls }
  }
  for (let ls = Math.max(lo, best - 8); ls <= Math.min(hi, best + 8); ls++) {
    const c = ncc(m, ls, le, w, 1)
    if (c > bestC) { bestC = c; best = ls }
  }
  const ls = best
  // bake the crossfade: the X samples before le fade into the X samples before ls
  const linear = bestC > 0.6
  const out = channels.map((c) => {
    const o = new Float32Array(le + GUARD)
    o.set(c.subarray(0, le))
    for (let i = 0; i < X; i++) {
      const t = (i + 1) / X
      const gin = linear ? t : Math.sin((t * Math.PI) / 2)
      const gout = linear ? 1 - t : Math.cos((t * Math.PI) / 2)
      o[le - X + i] = c[le - X + i] * gout + c[ls - X + i] * gin
    }
    for (let g = 0; g < GUARD; g++) o[le + g] = c[ls + g]
    return o
  })
  return { channels: out, loop: [ls, le], ofs: Math.min(ofs, ls), corr: +bestC.toFixed(3), susLevel: sus, xfade: X }
}
