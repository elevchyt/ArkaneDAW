import type { ParamDef } from './types'

/** Map a 0..1 knob position to a parameter value (honours curve, step, options). */
export function denormalize(p: ParamDef, x: number): number {
  x = Math.min(1, Math.max(0, x))
  if (p.options) return Math.round(x * (p.options.length - 1))
  let v: number
  if (p.curve === 'exp' && p.min > 0) v = p.min * Math.pow(p.max / p.min, x)
  else if (p.curve === 'exp') v = p.min + (p.max - p.min) * x * x
  else if (p.curve === 'log') v = p.min + (p.max - p.min) * Math.sqrt(x)
  else v = p.min + (p.max - p.min) * x
  if (p.step) v = Math.round(v / p.step) * p.step
  return Math.min(p.max, Math.max(p.min, v))
}

/** Inverse of denormalize. */
export function normalize(p: ParamDef, v: number): number {
  if (p.options) return p.options.length > 1 ? v / (p.options.length - 1) : 0
  if (p.max === p.min) return 0
  let x: number
  if (p.curve === 'exp' && p.min > 0) x = Math.log(v / p.min) / Math.log(p.max / p.min)
  else if (p.curve === 'exp') x = Math.sqrt(Math.max(0, (v - p.min) / (p.max - p.min)))
  else if (p.curve === 'log') {
    const y = (v - p.min) / (p.max - p.min)
    x = y * y
  } else x = (v - p.min) / (p.max - p.min)
  return Math.min(1, Math.max(0, x))
}

export function formatParam(p: ParamDef, v: number): string {
  if (p.options) return p.options[Math.round(v)] ?? String(v)
  const u = p.unit ?? ''
  if (u === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz`
  if (u === 'ms' && v >= 1000) return `${(v / 1000).toFixed(2)} s`
  if (u === '%') return `${Math.round(v * (p.max <= 1 ? 100 : 1))}%`
  if (u === 'dB') return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`
  const abs = Math.abs(v)
  const s = p.step && p.step >= 1 ? v.toFixed(0) : abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : v.toFixed(2)
  return u ? `${s} ${u}` : s
}

/** Linear 0..1 <-> dB helpers for DSP code. */
export const dbToGain = (db: number): number => Math.pow(10, db / 20)
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(1e-9, g))
