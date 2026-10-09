// Mosaic factory Performances. Each preset = global params (FX, quick edits) + up to 4 Parts + Super Knob.
import type { Preset } from '../sdk/types'
import type { EngineId, PartDef, SuperAssign, SuperDestId, WSData } from './model'

export const CATEGORIES = [
  'Piano',
  'Keyboard',
  'Organ',
  'Synth Lead',
  'Synth Pad',
  'Synth Comp',
  'Strings',
  'Brass',
  'Woodwind',
  'Choir',
  'Guitar/Plucked',
  'Bass',
  'Chromatic Perc',
  'Bells',
  'Split/Layer'
] as const

type PM = Record<string, number>

const part = (engine: EngineId, p: PM): PartDef => ({ on: true, engine, p })
const sk = (dest: SuperDestId, amt: number, part = -1): SuperAssign => ({ dest, amt, part })

function perf(name: string, category: (typeof CATEGORIES)[number], parts: PartDef[], params: PM = {}, superKnob: SuperAssign[] = []): Preset {
  const data: WSData = { v: 1, parts: [...parts], superKnob }
  while (data.parts.length < 4) data.parts.push({ on: false, engine: 'analog', p: {} })
  return { name, category, params, data }
}

// ─── engine helpers (sensible amp defaults per engine) ───────────────────────
const piano = (variant: number, p: PM = {}): PartDef => part('piano', { variant, 'amp.a': 0.0005, 'amp.d': 20, 'amp.s': 1, 'amp.r': 8, velSens: 0.65, ...p })
const ep = (variant: number, p: PM = {}): PartDef => part('epiano', { variant, 'amp.a': 0.0005, 'amp.d': 20, 'amp.s': 1, 'amp.r': 3, velSens: 0.6, ...p })
const mallet = (variant: number, p: PM = {}): PartDef => part('mallet', { variant, 'amp.a': 0.0005, 'amp.d': 20, 'amp.s': 1, 'amp.r': 15, velSens: 0.6, ...p })
const pluck = (variant: number, p: PM = {}): PartDef => part('pluck', { variant, 'amp.a': 0.0005, 'amp.d': 20, 'amp.s': 1, 'amp.r': 8, velSens: 0.6, ...p })
const bowed = (p: PM = {}): PartDef =>
  part('pluck', { variant: 6, 'amp.a': 0.12, 'amp.d': 2, 'amp.s': 0.9, 'amp.r': 0.5, 'flt.type': 1, 'flt.cut': 5500, 'lfo.pitch': 14, 'lfo.rate': 5.4, 'lfo.delay': 0.35, body: 0.8, bright: 0.5, velSens: 0.4, ...p })
const analog = (p: PM = {}): PartDef => part('analog', p)
const choir = (p: PM = {}): PartDef => part('choir', { 'amp.a': 0.25, 'amp.d': 1, 'amp.s': 1, 'amp.r': 0.9, velSens: 0.35, 'lfo.pitch': 0, ...p })

/** Organ with a drawbar registration string like "888000000". */
function organ(variant: number, reg: string, p: PM = {}): PartDef {
  const db: PM = {}
  for (let i = 0; i < 9; i++) db[`db${i + 1}`] = Number(reg[i] ?? 0)
  return part('organ', { variant, ...db, ...p })
}

/** FM operator: [ratio, level, attack, decay, sustain, release, velSens, keyScale, detune] */
type Op = [number, number, number?, number?, number?, number?, number?, number?, number?]
function fm(algo: number, ops: Op[], p: PM = {}): PartDef {
  const out: PM = { algo, 'amp.a': 0.0005, 'amp.d': 20, 'amp.s': 1, 'amp.r': 10, velSens: 0.5 }
  ops.forEach((o, i) => {
    const n = i + 1
    out[`o${n}.r`] = o[0]
    out[`o${n}.l`] = o[1]
    out[`o${n}.a`] = o[2] ?? 0.001
    out[`o${n}.dc`] = o[3] ?? 1.5
    out[`o${n}.s`] = o[4] ?? 0.5
    out[`o${n}.rl`] = o[5] ?? 0.3
    out[`o${n}.v`] = o[6] ?? 0.5
    out[`o${n}.k`] = o[7] ?? 0.3
    out[`o${n}.d`] = o[8] ?? 0
  })
  for (let n = ops.length + 1; n <= 6; n++) out[`o${n}.l`] = 0
  return part('fm', { ...out, ...p })
}

// ─── FX snippets ──────────────────────────────────────────────────────────────
const hall = (mix = 0.28, decay = 2.8): PM => ({ 'rev.on': 1, 'rev.mix': mix, 'rev.decay': decay, 'rev.size': 0.75, 'rev.pre': 20 })
const room = (mix = 0.18): PM => ({ 'rev.on': 1, 'rev.mix': mix, 'rev.decay': 1.2, 'rev.size': 0.4, 'rev.pre': 8 })
const cathedral: PM = { 'rev.on': 1, 'rev.mix': 0.42, 'rev.decay': 6.5, 'rev.size': 1, 'rev.pre': 35, 'rev.damp': 0.35 }
const chorus = (mix = 0.45, rate = 0.5, depth = 0.5): PM => ({ 'cho.on': 1, 'cho.mix': mix, 'cho.rate': rate, 'cho.depth': depth })
const delay = (time = 375, mix = 0.18, fb = 0.35): PM => ({ 'dly.on': 1, 'dly.time': time, 'dly.mix': mix, 'dly.fb': fb })
const phaser = (mix = 0.5, rate = 0.25): PM => ({ 'pha.on': 1, 'pha.mix': mix, 'pha.rate': rate })
const dry: PM = { 'rev.on': 0 }

const SK_PIANO = [sk('bright', 0.55), sk('reverb', 0.25), sk('eqHigh', 3)]
const SK_PAD = [sk('cutoff', 2.5), sk('reverb', 0.25), sk('delay', 0.15), sk('vibrato', 6)]
const SK_SYNTH = [sk('cutoff', 3), sk('reso', 0.25), sk('delay', 0.2), sk('drive', 0.3)]
const SK_ORGAN = [sk('rotary', 1), sk('drive', 0.45), sk('eqLow', 2)]

// ─── presets ──────────────────────────────────────────────────────────────────
export const PRESETS: Preset[] = [
  // Piano
  perf('Concert Grand', 'Piano', [piano(0, { hard: 0.5, body: 0.55, unison: 0.3 })], hall(0.22, 2.4), SK_PIANO),
  perf('Bright Pop Grand', 'Piano', [piano(1, { hard: 0.7, body: 0.45 })], { ...room(0.18), 'eq.high': 2.5 }, SK_PIANO),
  perf('Studio Grand', 'Piano', [piano(0, { hard: 0.55, body: 0.5, width: 0.75 })], room(0.14), SK_PIANO),
  perf('Ballad Grand', 'Piano', [piano(0, { hard: 0.32, decay: 1.3, body: 0.6 })], hall(0.32, 3.2), [sk('bright', 0.4), sk('reverb', 0.2), sk('release', 1)]),
  perf('Dark Jazz Grand', 'Piano', [piano(0, { hard: 0.25, body: 0.65, velSens: 0.75 })], { ...room(0.2), 'eq.high': -3 }, SK_PIANO),
  perf('Rock Piano', 'Piano', [piano(1, { hard: 0.85, body: 0.35, noise: 0.6 })], { ...room(0.12), 'eq.mid': 2, 'eq.midf': 2500, 'eq.low': -2 }, SK_PIANO),
  perf('Upright Felt', 'Piano', [piano(2, { hard: 0.12, noise: 0.55, damper: 0.7, body: 0.7, velSens: 0.55 })], { ...room(0.22), 'eq.high': -4 }, [sk('bright', 0.5), sk('reverb', 0.3)]),
  perf('Upright Parlor', 'Piano', [piano(2, { hard: 0.5, body: 0.6 })], room(0.2), SK_PIANO),
  perf('Honky-tonk Saloon', 'Piano', [piano(3, { hard: 0.6, unison: 0.6 })], room(0.16), [sk('detune', 0.6), sk('bright', 0.3)]),
  perf('Octave Grand', 'Piano', [piano(0, { hard: 0.55 }), piano(0, { hard: 0.45, transpose: 12, level: 0.5 })], hall(0.2, 2.2), [sk('level', 0.3, 1), sk('bright', 0.4), sk('reverb', 0.2)]),
  perf('Grand Hall Ambience', 'Piano', [piano(0, { hard: 0.45, decay: 1.4, width: 0.9 })], hall(0.42, 4.5), [sk('reverb', 0.3), sk('delay', 0.2), sk('bright', 0.3)]),

  // Keyboard
  perf('Suitcase Tines', 'Keyboard', [ep(0, { bark: 0.45, tine: 0.5, 'trem.mode': 1, 'trem.rate': 4.2, 'trem.depth': 0.45 })], room(0.16), [sk('tremolo', 0.5), sk('drive', 0.4), sk('chorus', 0.4)]),
  perf('Stage Tines Dry', 'Keyboard', [ep(0, { bark: 0.6, tine: 0.6, 'trem.depth': 0 })], room(0.1), [sk('bright', 0.5), sk('drive', 0.5)]),
  perf('Bark Tines Drive', 'Keyboard', [ep(0, { bark: 0.95, drive: 0.5, tine: 0.45, 'trem.depth': 0.15 })], { ...room(0.12), ...phaser(0.35, 0.4) }, [sk('drive', 0.4), sk('phaser', 0.4)]),
  perf('Wurly Grit', 'Keyboard', [ep(1, { bark: 0.75, drive: 0.35, 'trem.mode': 0, 'trem.rate': 5.5, 'trem.depth': 0.25 })], room(0.14), [sk('drive', 0.5), sk('tremolo', 0.4)]),
  perf('Soft Wurly', 'Keyboard', [ep(1, { level: 1, bark: 0.3, drive: 0.1, 'trem.mode': 0, 'trem.rate': 5, 'trem.depth': 0.35 })], { ...room(0.2), ...chorus(0.3) }, [sk('tremolo', 0.4), sk('chorus', 0.3)]),
  perf('FM Crystal EP', 'Keyboard', [ep(2, { bark: 0.6, tine: 0.6, 'trem.depth': 0 })], { ...chorus(0.4, 0.45), ...hall(0.2, 2) }, [sk('bright', 0.5), sk('chorus', 0.3), sk('reverb', 0.2)]),
  perf('DX Ballad EP', 'Keyboard', [ep(2, { bark: 0.4, tine: 0.45, decay: 1.4, 'trem.mode': 1, 'trem.depth': 0.15 })], { ...chorus(0.5, 0.35), ...hall(0.3, 3), ...delay(420, 0.12) }, [sk('bright', 0.4), sk('delay', 0.2), sk('reverb', 0.2)]),
  perf('Funk Clav', 'Keyboard', [fm(2, [[1, 1, 0.001, 0.9, 0.35, 0.04, 0.5, 0.2], [3, 0.55, 0.001, 0.25, 0.25, 0.04, 0.9, 0.3], [1.002, 0.55, 0.001, 0.6, 0.3, 0.04], [5, 0.35, 0.001, 0.12, 0.05, 0.04, 0.9]], { 'amp.r': 0.05, 'flt.type': 1, 'flt.cut': 5000, 'flt.vel': 1.5 })], { ...room(0.08), ...phaser(0.3, 0.6) }, [sk('cutoff', -2), sk('reso', 0.4), sk('phaser', 0.4)]),
  perf('Harpsichord', 'Keyboard', [pluck(1, { bright: 0.95, pos: 0.07, decay: 0.55, body: 0.6, velSens: 0.15 }), pluck(1, { bright: 0.9, pos: 0.05, decay: 0.45, transpose: 12, level: 0.45, fine: 3, body: 0.5, velSens: 0.15 })], room(0.2), [sk('level', 0.3, 1), sk('reverb', 0.25)]),

  // Organ
  perf('B3 Full Drawbars', 'Organ', [organ(0, '888888888', { vib: 6, drive: 0.3, click: 0.5 })], room(0.12), SK_ORGAN),
  perf('Gospel Perc Organ', 'Organ', [organ(0, '888800000', { perc: 2, percFast: 1, vib: 6, drive: 0.35, click: 0.6 })], room(0.14), SK_ORGAN),
  perf('Jazz Organ 888', 'Organ', [organ(0, '888000000', { level: 1, perc: 2, percFast: 1, percSoft: 0, vib: 6, drive: 0.12, click: 0.7, leak: 0.4 })], room(0.12), SK_ORGAN),
  perf('Rock Organ Overdrive', 'Organ', [organ(0, '888600000', { vib: 3, drive: 0.85, click: 0.6 })], { ...room(0.1), 'eq.low': 2 }, [sk('rotary', 1), sk('drive', 0.15), sk('eqHigh', 3)]),
  perf('Ballad Organ Soft', 'Organ', [organ(0, '008600000', { level: 1, vib: 6, drive: 0.05, click: 0.2 })], hall(0.24, 2.5), SK_ORGAN),
  perf('Soul Organ 838', 'Organ', [organ(0, '838000000', { level: 1, perc: 1, percFast: 0, vib: 5, drive: 0.25, click: 0.5 })], room(0.12), SK_ORGAN),
  perf('Cathedral Pipes', 'Organ', [organ(1, '868646048', { rotary: 0, drive: 0, click: 0.4 })], cathedral, [sk('reverb', 0.2), sk('eqLow', 4), sk('level', 0.15)]),
  perf('Chapel Flutes', 'Organ', [organ(1, '008080000', { rotary: 0, drive: 0, click: 0.2 })], { ...cathedral, 'rev.mix': 0.35, 'rev.decay': 4 }, [sk('reverb', 0.2)]),
  perf('Combo Organ 60s', 'Organ', [organ(2, '008800080', { rotary: 0, vib: 2, drive: 0.15, click: 0.3 })], room(0.15), [sk('drive', 0.4), sk('chorus', 0.4)]),

  // Synth Lead
  perf('Super Saw Lead', 'Synth Lead', [analog({ wave: 0, voices: 7, detune: 0.42, spread: 0.8, 'flt.type': 1, 'flt.cut': 6500, 'flt.res': 0.15, 'amp.a': 0.003, 'amp.s': 1, 'amp.r': 0.25, 'lfo.pitch': 8, 'lfo.delay': 0.4, mode: 2, porta: 0.03, velSens: 0.3 })], { ...delay(375, 0.22, 0.4), ...hall(0.2, 2) }, SK_SYNTH),
  perf('Square Lead', 'Synth Lead', [analog({ wave: 1, voices: 1, 'b.wave': 1, 'b.mix': 0.35, 'b.semi': 12, 'b.fine': 4, 'flt.type': 2, 'flt.cut': 3500, 'flt.res': 0.2, 'amp.r': 0.15, mode: 2, porta: 0.06, 'lfo.pitch': 15, 'lfo.delay': 0.45, velSens: 0.3 })], { ...delay(300, 0.18), ...room(0.15) }, SK_SYNTH),
  perf('Mono Saw Lead', 'Synth Lead', [analog({ wave: 0, voices: 2, detune: 0.15, 'flt.type': 2, 'flt.cut': 1800, 'flt.res': 0.35, 'flt.env': 2, 'flt.d': 0.5, 'flt.s': 0.4, 'amp.r': 0.12, mode: 2, porta: 0.08, velSens: 0.3 })], { ...delay(250, 0.15), ...room(0.12) }, SK_SYNTH),
  perf('Fat Mono Lead', 'Synth Lead', [analog({ wave: 0, voices: 1, sub: 0.6, 'b.wave': 1, 'b.mix': 0.6, 'b.semi': -12, 'b.fine': 5, drive: 0.35, 'flt.type': 2, 'flt.cut': 1500, 'flt.res': 0.4, 'flt.env': 2.5, 'flt.d': 0.4, 'flt.s': 0.5, level: 1, mode: 1, porta: 0.05, 'amp.r': 0.15, velSens: 0.25 })], room(0.12), SK_SYNTH),
  perf('Whistle Sine Lead', 'Synth Lead', [analog({ wave: 4, voices: 1, 'b.wave': 3, 'b.mix': 0.15, 'b.semi': 12, noise: 0.03, 'amp.a': 0.04, 'amp.r': 0.3, 'lfo.pitch': 22, 'lfo.rate': 5.2, 'lfo.delay': 0.35, mode: 2, porta: 0.1, transpose: 12 })], { ...delay(450, 0.25), ...hall(0.3, 3) }, [sk('vibrato', 20), sk('delay', 0.2), sk('reverb', 0.2)]),
  perf('Pulse Glide Lead', 'Synth Lead', [analog({ wave: 2, pw: 0.25, pwm: 0.6, voices: 1, 'flt.type': 1, 'flt.cut': 4000, 'flt.res': 0.25, mode: 2, porta: 0.15, 'amp.r': 0.2, 'lfo.pitch': 10, 'lfo.delay': 0.5 })], { ...delay(333, 0.2), ...chorus(0.3), ...room(0.12) }, SK_SYNTH),
  perf('FM Lead', 'Synth Lead', [fm(0, [[1, 1, 0.005, 2, 0.9, 0.2], [1, 0.55, 0.005, 1.5, 0.75, 0.2, 0.7], [2, 0.35, 0.01, 1, 0.6, 0.2, 0.7], [1, 0.25, 0.01, 1, 0.5, 0.2]], { fb: 0.3, mode: 2, porta: 0.04, 'lfo.pitch': 14, 'lfo.delay': 0.4, 'amp.r': 0.25 })], { ...delay(375, 0.2), ...room(0.15) }, [sk('bright', 0.6), sk('delay', 0.2), sk('vibrato', 10)]),

  // Synth Pad
  perf('Warm Pad', 'Synth Pad', [analog({ wave: 0, voices: 3, detune: 0.3, spread: 0.8, 'flt.type': 2, 'flt.cut': 1100, 'flt.res': 0.15, 'flt.env': 1.2, 'flt.a': 1.5, 'flt.d': 2, 'flt.s': 0.6, 'flt.r': 2, 'amp.a': 0.9, 'amp.d': 2, 'amp.s': 0.9, 'amp.r': 2.2, velSens: 0.3 })], { ...chorus(0.45, 0.35), ...hall(0.35, 4) }, SK_PAD),
  perf('Super Saw Pad', 'Synth Pad', [analog({ wave: 0, voices: 7, detune: 0.35, spread: 1, 'flt.type': 1, 'flt.cut': 4500, 'flt.res': 0.1, 'amp.a': 0.6, 'amp.s': 1, 'amp.r': 2, velSens: 0.2 })], { ...hall(0.38, 4), ...delay(500, 0.12) }, SK_PAD),
  perf('Glass Pad', 'Synth Pad', [fm(2, [[1, 1, 1.2, 4, 0.8, 2.5], [2, 0.3, 1.5, 4, 0.5, 2.5, 0.3], [1.005, 0.75, 1.6, 4, 0.8, 2.5], [4, 0.2, 2, 4, 0.4, 2.5, 0.3], [0.5, 0.5, 1.4, 4, 0.8, 2.5], [7, 0.15, 2.5, 3, 0.3, 2.5]], { 'amp.r': 3, velSens: 0.2 })], { ...chorus(0.4, 0.3), ...hall(0.4, 5) }, [sk('bright', 0.6), sk('reverb', 0.25), sk('attack', -2)]),
  perf('Sweep Pad', 'Synth Pad', [analog({ wave: 0, voices: 4, detune: 0.3, 'flt.type': 2, 'flt.cut': 700, 'flt.res': 0.55, 'lfo.flt': 2.2, 'lfo.rate': 0.12, 'lfo.shape': 1, 'lfo.delay': 0, 'amp.a': 0.7, 'amp.r': 2.5, velSens: 0.2 })], { ...phaser(0.5, 0.15), ...hall(0.35, 4) }, SK_PAD),
  perf('Choir Pad', 'Synth Pad', [choir({ variant: 1, vowel: 0.5, gender: 0.6, ens: 3, detune: 0.5, 'amp.a': 0.7, 'amp.r': 2.2 }), analog({ wave: 0, voices: 3, detune: 0.25, 'flt.type': 2, 'flt.cut': 900, 'amp.a': 1, 'amp.r': 2.5, level: 0.5, velSens: 0.2 })], { ...chorus(0.35, 0.3), ...hall(0.4, 4.5) }, [sk('level', 0.3, 1), sk('cutoff', 2), sk('reverb', 0.2)]),
  perf('Midnight Pad', 'Synth Pad', [analog({ wave: 1, voices: 3, detune: 0.25, 'b.wave': 0, 'b.mix': 0.5, 'b.semi': -12, 'flt.type': 2, 'flt.cut': 520, 'flt.res': 0.3, 'amp.a': 1.2, 'amp.r': 3, velSens: 0.2 })], { ...chorus(0.4, 0.25), ...hall(0.4, 5), ...delay(600, 0.15, 0.45) }, SK_PAD),
  perf('Shimmer Pad', 'Synth Pad', [fm(2, [[1, 1, 0.8, 5, 0.9, 3], [2, 0.25, 1, 5, 0.6, 3], [2, 0.6, 1.2, 5, 0.8, 3, 0.3, 0.3, 4], [6, 0.18, 1.2, 5, 0.4, 3], [4, 0.3, 1.5, 5, 0.6, 3, 0.3, 0.3, -5], [3, 0.12, 2, 4, 0.4, 3]], { 'amp.r': 4, velSens: 0.2 })], { ...delay(500, 0.25, 0.55), ...hall(0.5, 7) }, [sk('reverb', 0.2), sk('delay', 0.2), sk('bright', 0.5)]),
  perf('Evolving Pad', 'Synth Pad', [analog({ wave: 0, voices: 5, detune: 0.3, 'flt.type': 2, 'flt.cut': 800, 'flt.res': 0.3, 'lfo.flt': 1.5, 'lfo.rate': 0.08, 'amp.a': 1.5, 'amp.r': 3, velSens: 0.2 }), choir({ variant: 1, vowel: 3, gender: 0.3, 'amp.a': 2, 'amp.r': 3, level: 0.55 }), fm(2, [[1, 0.8, 2, 5, 0.7, 3], [3, 0.25, 3, 5, 0.6, 3]], { 'amp.r': 3, level: 0.4, transpose: 12 })], { ...phaser(0.3, 0.07), ...hall(0.45, 6) }, [sk('cutoff', 3, 0), sk('level', 0.3, 2), sk('reverb', 0.2), sk('phaser', 0.3)]),

  // Synth Comp
  perf('Poly Stab', 'Synth Comp', [analog({ level: 1, wave: 0, voices: 3, detune: 0.2, 'flt.type': 2, 'flt.cut': 900, 'flt.res': 0.25, 'flt.env': 3.5, 'flt.d': 0.3, 'flt.s': 0.1, 'amp.d': 0.5, 'amp.s': 0.4, 'amp.r': 0.2 })], { ...room(0.15), ...delay(250, 0.12) }, SK_SYNTH),
  perf('Trance Pluck', 'Synth Comp', [analog({ level: 1, wave: 0, voices: 7, detune: 0.4, spread: 0.9, 'flt.type': 2, 'flt.cut': 450, 'flt.res': 0.3, 'flt.env': 5, 'flt.d': 0.22, 'flt.s': 0, 'amp.d': 0.5, 'amp.s': 0, 'amp.r': 0.3 })], { ...delay(375, 0.3, 0.45), ...hall(0.25, 2.5) }, SK_SYNTH),
  perf('PWM Comp', 'Synth Comp', [analog({ wave: 2, pw: 0.35, pwm: 0.7, voices: 2, detune: 0.15, 'flt.type': 1, 'flt.cut': 2400, 'flt.env': 1.5, 'flt.d': 0.4, 'amp.d': 0.8, 'amp.s': 0.5, 'amp.r': 0.25 })], { ...chorus(0.4), ...room(0.15) }, SK_SYNTH),
  perf('House Organ Stab', 'Synth Comp', [fm(7, [[1, 0.9, 0.001, 0.4, 0.3, 0.1], [2, 0.6, 0.001, 0.4, 0.3, 0.1], [3, 0.45, 0.001, 0.3, 0.2, 0.1], [4, 0.3, 0.001, 0.25, 0.1, 0.1], [0.5, 0.5, 0.001, 0.5, 0.3, 0.1]], { level: 1, 'amp.r': 0.15 })], { ...room(0.14), ...delay(375, 0.12) }, [sk('cutoff', 2), sk('delay', 0.2), sk('reverb', 0.2)]),
  perf('Square Pluck', 'Synth Comp', [analog({ level: 1, wave: 1, voices: 1, 'flt.type': 1, 'flt.cut': 700, 'flt.res': 0.3, 'flt.env': 4, 'flt.d': 0.15, 'amp.d': 0.35, 'amp.s': 0, 'amp.r': 0.2 })], { ...delay(333, 0.25, 0.4), ...room(0.15) }, SK_SYNTH),
  perf('Detuned Keys', 'Synth Comp', [analog({ wave: 0, voices: 2, detune: 0.25, 'b.wave': 1, 'b.mix': 0.5, 'b.semi': 12, 'flt.type': 1, 'flt.cut': 2200, 'flt.env': 1.5, 'flt.d': 0.6, 'amp.d': 1.5, 'amp.s': 0.4, 'amp.r': 0.3 })], { ...chorus(0.35), ...room(0.16) }, SK_SYNTH),

  // Strings
  perf('Lush Strings', 'Strings', [analog({ wave: 0, voices: 5, detune: 0.32, spread: 0.9, 'flt.type': 1, 'flt.cut': 3200, 'flt.key': 0.6, 'amp.a': 0.35, 'amp.r': 1.2, 'lfo.pitch': 6, 'lfo.rate': 5, velSens: 0.4 }), bowed({ level: 0.55, 'amp.a': 0.25 })], { ...chorus(0.5, 0.45, 0.6), ...hall(0.32, 3.2) }, [sk('cutoff', 1.5), sk('attack', -1.5), sk('reverb', 0.2)]),
  perf('Slow Strings', 'Strings', [analog({ wave: 0, voices: 5, detune: 0.3, spread: 0.9, 'flt.type': 1, 'flt.cut': 2600, 'amp.a': 1.3, 'amp.r': 2, velSens: 0.3 }), bowed({ level: 0.5, 'amp.a': 1.1, 'amp.r': 1.8 })], { ...chorus(0.5, 0.4), ...hall(0.38, 4) }, [sk('attack', -2), sk('cutoff', 1.5), sk('reverb', 0.2)]),
  perf('Chamber Strings', 'Strings', [bowed({ fine: -6, pan: -0.4, level: 0.6 }), bowed({ fine: 5, pan: 0.4, 'lfo.rate': 5.9, level: 0.6 }), bowed({ transpose: -12, level: 0.45, 'lfo.rate': 4.8, keyHi: 72 })], hall(0.3, 2.6), [sk('cutoff', 1.5), sk('vibrato', 10), sk('reverb', 0.2)]),
  perf('Solo Violin', 'Strings', [bowed({ mode: 2, porta: 0.06, 'lfo.pitch': 22, bow: 0.4, 'amp.a': 0.09 })], hall(0.26, 2.4), [sk('vibrato', 15), sk('bright', 0.4)]),
  perf('Cello Section', 'Strings', [bowed({ transpose: -12, fine: -4, pan: -0.3, 'flt.cut': 3500 }), bowed({ transpose: -12, fine: 5, pan: 0.3, 'flt.cut': 3500, 'lfo.rate': 5.9 })], hall(0.3, 2.8), [sk('cutoff', 1.5), sk('vibrato', 10)]),
  perf('Pizzicato', 'Strings', [pluck(5, { pan: -0.3, fine: -5, body: 0.85 }), pluck(5, { pan: 0.3, fine: 5, body: 0.85, bright: 0.4 })], hall(0.3, 2.4), [sk('reverb', 0.2), sk('bright', 0.4)]),
  perf('Solina Strings', 'Strings', [analog({ wave: 0, voices: 3, detune: 0.2, 'b.wave': 0, 'b.mix': 0.5, 'b.semi': 12, 'flt.type': 1, 'flt.cut': 3000, 'amp.a': 0.25, 'amp.r': 1, velSens: 0.1 })], { ...chorus(0.7, 0.7, 0.7), ...phaser(0.35, 0.15), ...hall(0.25, 2.5) }, [sk('phaser', 0.4), sk('cutoff', 1.5)]),
  perf('Tremolo Strings', 'Strings', [analog({ wave: 0, voices: 5, detune: 0.3, 'flt.type': 1, 'flt.cut': 3000, 'amp.a': 0.15, 'amp.r': 0.9, 'lfo.amp': 0.65, 'lfo.rate': 8, 'lfo.delay': 0 }), bowed({ level: 0.5, 'lfo.amp': 0.5, 'lfo.rate': 8, 'lfo.delay': 0 })], hall(0.3, 3), [sk('tremolo', 0.3), sk('cutoff', 1.5)]),

  // Brass
  perf('Brass Section', 'Brass', [analog({ wave: 0, voices: 3, detune: 0.2, 'flt.type': 2, 'flt.cut': 850, 'flt.res': 0.1, 'flt.env': 2.8, 'flt.a': 0.06, 'flt.d': 0.6, 'flt.s': 0.45, 'flt.vel': 1.5, 'amp.a': 0.03, 'amp.s': 0.9, 'amp.r': 0.25, 'lfo.pitch': 6, velSens: 0.5 }), fm(3, [[1, 1, 0.03, 1, 0.9, 0.2], [1, 0.5, 0.07, 0.5, 0.45, 0.2, 0.8], [1.003, 0.6, 0.03, 1, 0.9, 0.2], [1, 0.35, 0.1, 0.5, 0.4, 0.2, 0.8]], { level: 0.5, 'amp.r': 0.3 })], hall(0.22, 2), [sk('cutoff', 1.5), sk('bright', 0.4), sk('reverb', 0.2)]),
  perf('Synth Brass 80s', 'Brass', [analog({ wave: 0, voices: 2, detune: 0.3, 'flt.type': 2, 'flt.cut': 600, 'flt.res': 0.2, 'flt.env': 4, 'flt.a': 0.08, 'flt.d': 0.8, 'flt.s': 0.35, 'amp.a': 0.05, 'amp.r': 0.35, velSens: 0.4 })], { ...chorus(0.4), ...hall(0.22, 2.2) }, SK_SYNTH),
  perf('Trumpet Solo', 'Brass', [fm(3, [[1, 1, 0.03, 1, 0.9, 0.12], [1, 0.62, 0.06, 0.4, 0.5, 0.12, 0.9, 0.4], [1.002, 0.5, 0.03, 1, 0.85, 0.12], [2, 0.28, 0.08, 0.3, 0.35, 0.12, 0.8], [1, 0.2, 0.05, 1, 0.5, 0.12], [1, 0.25, 0.05, 1, 0.6, 0.12]], { fb: 0.4, mode: 2, porta: 0.03, 'lfo.pitch': 14, 'lfo.delay': 0.4, 'amp.r': 0.15, 'flt.type': 1, 'flt.cut': 7000 })], hall(0.2, 2), [sk('bright', 0.5), sk('vibrato', 12)]),
  perf('French Horns', 'Brass', [analog({ wave: 0, voices: 2, detune: 0.12, 'flt.type': 2, 'flt.cut': 420, 'flt.env': 1.5, 'flt.a': 0.15, 'flt.d': 1, 'flt.s': 0.6, 'flt.key': 0.7, 'amp.a': 0.12, 'amp.r': 0.5, velSens: 0.5 }), choir({ vowel: 3, gender: 0.2, ens: 2, level: 0.35, 'amp.a': 0.15, 'amp.r': 0.5 })], hall(0.32, 3), [sk('cutoff', 1.2), sk('reverb', 0.2)]),
  perf('Brass Stabs', 'Brass', [analog({ level: 1, wave: 0, voices: 3, detune: 0.22, 'flt.type': 2, 'flt.cut': 1000, 'flt.env': 3, 'flt.a': 0.02, 'flt.d': 0.25, 'flt.s': 0.3, 'amp.a': 0.01, 'amp.d': 0.4, 'amp.s': 0.4, 'amp.r': 0.15, velSens: 0.5 })], room(0.16), SK_SYNTH),
  perf('Low Brass', 'Brass', [analog({ wave: 0, voices: 2, detune: 0.15, sub: 0.3, 'flt.type': 2, 'flt.cut': 350, 'flt.env': 2.5, 'flt.a': 0.07, 'flt.d': 0.7, 'flt.s': 0.5, 'amp.a': 0.05, 'amp.r': 0.3, transpose: -12, velSens: 0.5 })], hall(0.2, 2.2), [sk('cutoff', 1.5), sk('drive', 0.3)]),

  // Woodwind
  perf('Flute', 'Woodwind', [analog({ wave: 4, voices: 1, 'b.wave': 3, 'b.mix': 0.25, 'b.semi': 12, noise: 0.1, 'flt.type': 1, 'flt.cut': 2600, 'flt.key': 0.8, 'amp.a': 0.06, 'amp.r': 0.18, 'lfo.pitch': 12, 'lfo.rate': 5, 'lfo.delay': 0.3, 'lfo.amp': 0.08, mode: 2, porta: 0.02, velSens: 0.4 })], hall(0.25, 2.2), [sk('vibrato', 12), sk('reverb', 0.2)]),
  perf('Clarinet', 'Woodwind', [analog({ wave: 1, voices: 1, 'flt.type': 1, 'flt.cut': 1500, 'flt.key': 0.8, 'flt.vel': 1, noise: 0.02, 'amp.a': 0.04, 'amp.r': 0.12, 'lfo.pitch': 5, 'lfo.delay': 0.5, mode: 2, porta: 0.02, velSens: 0.4 })], hall(0.22, 2), [sk('cutoff', 1.5)]),
  perf('Oboe', 'Woodwind', [analog({ wave: 2, pw: 0.14, voices: 1, 'flt.type': 4, 'flt.cut': 1300, 'flt.res': 0.25, 'flt.key': 0.5, 'amp.a': 0.04, 'amp.r': 0.12, 'lfo.pitch': 9, 'lfo.delay': 0.35, mode: 2, porta: 0.02, velSens: 0.4 })], hall(0.22, 2), [sk('vibrato', 10), sk('cutoff', 1)]),
  perf('Pan Flute', 'Woodwind', [analog({ level: 0.55, wave: 4, voices: 1, noise: 0.14, 'flt.type': 1, 'flt.cut': 2200, 'flt.env': 1.5, 'flt.d': 0.08, 'flt.s': 0, 'amp.a': 0.03, 'amp.r': 0.3, 'lfo.pitch': 10, 'lfo.delay': 0.4, velSens: 0.4 })], { ...hall(0.35, 3), ...delay(400, 0.12) }, [sk('reverb', 0.25), sk('vibrato', 10)]),
  perf('Breathy Sax', 'Woodwind', [fm(1, [[1, 1, 0.04, 1, 0.9, 0.15], [1, 0.58, 0.05, 0.6, 0.65, 0.15, 0.9, 0.3], [3, 0.35, 0.05, 1, 0.6, 0.15], [1, 0.3, 0.05, 1, 0.5, 0.15], [0.5, 0.15, 0.05, 1, 0.5, 0.15]], { fb: 0.55, mode: 2, porta: 0.03, 'lfo.pitch': 12, 'lfo.delay': 0.45, 'flt.type': 1, 'flt.cut': 4500, 'amp.r': 0.15 }), analog({ wave: 4, noise: 0.5, 'b.mix': 0, 'flt.type': 4, 'flt.cut': 2500, 'flt.res': 0.2, 'flt.key': 1, level: 0.25, 'amp.a': 0.04, 'amp.r': 0.1, mode: 2 })], hall(0.22, 2), [sk('bright', 0.5), sk('vibrato', 12)]),
  perf('Recorder', 'Woodwind', [analog({ wave: 3, voices: 1, noise: 0.06, 'flt.type': 1, 'flt.cut': 3500, 'amp.a': 0.03, 'amp.r': 0.1, 'lfo.pitch': 6, 'lfo.delay': 0.4, transpose: 12, mode: 2, velSens: 0.3 })], room(0.22), [sk('vibrato', 10)]),

  // Choir
  perf('Aah Choir', 'Choir', [choir({ vowel: 0, gender: 0.5, ens: 4, detune: 0.45, breath: 0.2 })], hall(0.38, 3.8), [sk('reverb', 0.2), sk('bright', 0.4), sk('attack', -1.5)]),
  perf('Ooh Choir', 'Choir', [choir({ vowel: 3.6, gender: 0.45, ens: 4, detune: 0.4, breath: 0.15, bright: 0.35 })], hall(0.4, 4), [sk('reverb', 0.2), sk('bright', 0.4)]),
  perf('Female Voices', 'Choir', [choir({ vowel: 0.3, gender: 1, ens: 3, detune: 0.35, breath: 0.25, bright: 0.6 })], hall(0.36, 3.5), [sk('reverb', 0.2), sk('vibrato', 8)]),
  perf('Male Choir', 'Choir', [choir({ vowel: 3, gender: 0, ens: 4, detune: 0.4, breath: 0.12, bright: 0.4 })], cathedral, [sk('reverb', 0.15), sk('bright', 0.4)]),
  perf('Voice Pad Heaven', 'Choir', [choir({ variant: 1, vowel: 0.6, gender: 0.7, ens: 4, detune: 0.55, 'amp.a': 0.8, 'amp.r': 2.5 })], { ...chorus(0.35, 0.3), ...hall(0.45, 5) }, [sk('reverb', 0.2), sk('delay', 0.2), sk('bright', 0.4)]),
  perf('Breathy Voices', 'Choir', [choir({ variant: 2, vowel: 1.5, gender: 0.8, ens: 3, breath: 0.8, 'amp.a': 0.4, 'amp.r': 1.5 })], { ...hall(0.4, 4), ...delay(500, 0.12) }, [sk('reverb', 0.2)]),

  // Guitar / Plucked
  perf('Nylon Guitar', 'Guitar/Plucked', [pluck(0, { bright: 0.45, pos: 0.17, body: 0.7 })], room(0.2), [sk('bright', 0.4), sk('reverb', 0.2)]),
  perf('Steel Acoustic', 'Guitar/Plucked', [pluck(1, { bright: 0.6, pos: 0.12, body: 0.6 })], room(0.2), [sk('bright', 0.4), sk('chorus', 0.3)]),
  perf('12-String', 'Guitar/Plucked', [pluck(1, { bright: 0.6, pos: 0.12, body: 0.55, pan: -0.15 }), pluck(1, { bright: 0.7, pos: 0.1, body: 0.4, transpose: 12, fine: 4, level: 0.5, pan: 0.15 })], { ...room(0.22), ...chorus(0.2) }, [sk('level', 0.3, 1), sk('reverb', 0.2)]),
  perf('Clean Electric', 'Guitar/Plucked', [pluck(2, { bright: 0.5, pos: 0.2, body: 0.4 })], { ...room(0.16), ...delay(320, 0.1) }, [sk('chorus', 0.5), sk('delay', 0.2)]),
  perf('Chorus Electric', 'Guitar/Plucked', [pluck(2, { bright: 0.55, pos: 0.15, body: 0.4 })], { ...chorus(0.55, 0.8, 0.5), ...delay(380, 0.18), ...room(0.2) }, [sk('delay', 0.2), sk('reverb', 0.2)]),
  perf('Palm Muted Electric', 'Guitar/Plucked', [pluck(2, { bright: 0.3, pos: 0.2, decay: 0.12, body: 0.5, velSens: 0.5 })], room(0.12), [sk('bright', 0.4), sk('release', 1.5)]),
  perf('Harp Glissando', 'Guitar/Plucked', [pluck(3, { bright: 0.45, pos: 0.3, body: 0.5, decay: 1.2 })], hall(0.38, 3.5), [sk('reverb', 0.2), sk('bright', 0.3)]),
  perf('Koto', 'Guitar/Plucked', [pluck(4, { bright: 0.7, pos: 0.08, bend: 0.45, body: 0.6 })], hall(0.28, 2.6), [sk('bright', 0.3), sk('reverb', 0.2)]),

  // Bass
  perf('Upright Bass', 'Bass', [pluck(0, { bright: 0.3, pos: 0.28, decay: 1.4, body: 0.65, 'amp.r': 0.5, velSens: 0.55 })], room(0.12), [sk('bright', 0.4)]),
  perf('Finger Bass', 'Bass', [pluck(2, { bright: 0.35, pos: 0.22, decay: 1.6, body: 0.3, 'flt.type': 1, 'flt.cut': 2200, 'amp.r': 0.12 })], dry, [sk('cutoff', 1.5), sk('bright', 0.4)]),
  perf('FM Bass', 'Bass', [fm(2, [[1, 1, 0.001, 2, 0.5, 0.08], [1, 0.62, 0.001, 0.3, 0.25, 0.08, 0.8, 0], [0.5, 0.7, 0.001, 2, 0.6, 0.08], [1, 0.25, 0.001, 0.25, 0.1, 0.08, 0.8, 0]], { 'amp.r': 0.08 })], dry, [sk('bright', 0.6), sk('drive', 0.3)]),
  perf('Slap FM Bass', 'Bass', [fm(1, [[1, 1, 0.001, 1.2, 0.4, 0.06], [3, 0.6, 0.001, 0.12, 0.1, 0.06, 0.9, 0], [0.5, 0.7, 0.001, 1.5, 0.5, 0.06], [1, 0.3, 0.001, 0.4, 0.2, 0.06]], { 'amp.r': 0.06, velSens: 0.6 })], dry, [sk('bright', 0.6)]),
  perf('Moog-ish Bass', 'Bass', [analog({ wave: 0, voices: 1, sub: 0.5, 'b.wave': 1, 'b.mix': 0.4, 'b.semi': -12, 'flt.type': 2, 'flt.cut': 380, 'flt.res': 0.3, 'flt.env': 2.5, 'flt.d': 0.25, 'flt.s': 0.25, 'amp.r': 0.08, mode: 1, porta: 0.02, velSens: 0.4 })], dry, SK_SYNTH),
  perf('Acid Bass', 'Bass', [analog({ level: 1, wave: 0, voices: 1, 'flt.type': 2, 'flt.cut': 280, 'flt.res': 0.78, 'flt.env': 4.5, 'flt.d': 0.25, 'flt.s': 0, 'flt.vel': 1.5, drive: 0.35, 'amp.d': 0.5, 'amp.s': 0.7, 'amp.r': 0.06, mode: 2, porta: 0.06, velSens: 0.3 })], delay(375, 0.15, 0.3), [sk('cutoff', 2.5), sk('reso', 0.15), sk('drive', 0.4)]),
  perf('Sub Bass', 'Bass', [analog({ wave: 4, voices: 1, 'b.wave': 3, 'b.mix': 0.3, 'b.semi': 0, 'amp.a': 0.005, 'amp.r': 0.1, mode: 1, velSens: 0.3 })], dry, [sk('drive', 0.6)]),
  perf('Synth Pluck Bass', 'Bass', [analog({ wave: 1, voices: 1, sub: 0.4, 'flt.type': 2, 'flt.cut': 300, 'flt.res': 0.35, 'flt.env': 3.5, 'flt.d': 0.18, 'flt.s': 0, 'amp.d': 0.6, 'amp.s': 0.3, 'amp.r': 0.08 })], dry, SK_SYNTH),

  // Chromatic Perc
  perf('Marimba', 'Chromatic Perc', [mallet(0, { hard: 0.4 })], room(0.2), [sk('bright', 0.4), sk('reverb', 0.2)]),
  perf('Vibes Tremolo', 'Chromatic Perc', [mallet(1, { hard: 0.45, motor: 0.55, motorRate: 5.5, 'amp.r': 1.2 })], hall(0.26, 2.4), [sk('tremolo', 0.4), sk('reverb', 0.2)]),
  perf('Glockenspiel', 'Chromatic Perc', [mallet(2, { hard: 0.7, transpose: 24 })], hall(0.28, 2.4), [sk('bright', 0.3), sk('reverb', 0.2)]),
  perf('Xylophone', 'Chromatic Perc', [mallet(3, { level: 1, hard: 0.8, transpose: 12 })], room(0.2), [sk('bright', 0.3)]),
  perf('Kalimba', 'Chromatic Perc', [mallet(5, { hard: 0.5, transpose: 12 })], { ...room(0.18), ...delay(300, 0.12) }, [sk('delay', 0.2), sk('reverb', 0.2)]),
  perf('Steel Drum', 'Chromatic Perc', [mallet(6, { hard: 0.55 })], room(0.2), [sk('bright', 0.4), sk('delay', 0.2)]),
  perf('Celesta', 'Chromatic Perc', [mallet(7, { hard: 0.5, transpose: 12, 'amp.r': 1.5 })], hall(0.3, 2.6), [sk('reverb', 0.2)]),
  perf('Music Box', 'Chromatic Perc', [mallet(9, { hard: 0.7, transpose: 24 })], { ...hall(0.35, 3), ...chorus(0.2) }, [sk('reverb', 0.25), sk('delay', 0.2)]),

  // Bells
  perf('Tubular Bells', 'Bells', [mallet(4, { hard: 0.6 })], hall(0.3, 3.5), [sk('reverb', 0.2), sk('bright', 0.3)]),
  perf('Church Bell', 'Bells', [mallet(8, { hard: 0.6, transpose: -12, decay: 1.2 })], cathedral, [sk('reverb', 0.2)]),
  perf('FM Bell', 'Bells', [fm(2, [[1, 1, 0.001, 6, 0, 4], [3.5, 0.55, 0.001, 5, 0, 4, 0.6], [1.003, 0.8, 0.001, 5, 0, 4], [3.51, 0.5, 0.001, 4, 0, 4, 0.6], [2, 0.5, 0.001, 3, 0, 3], [5.19, 0.4, 0.001, 1.5, 0, 2]], { fb: 0.2, 'amp.r': 5 })], hall(0.32, 3.5), [sk('bright', 0.5), sk('reverb', 0.2)]),
  perf('Crystal Bells', 'Bells', [fm(2, [[1, 1, 0.001, 3, 0, 3], [7, 0.4, 0.001, 0.8, 0, 1, 0.7], [2, 0.6, 0.001, 2.5, 0, 3], [11, 0.3, 0.001, 0.4, 0, 0.5, 0.7], [4, 0.4, 0.001, 1.5, 0, 2], [13.3, 0.25, 0.001, 0.3, 0, 0.3]], { 'amp.r': 4 })], { ...hall(0.36, 4), ...delay(450, 0.18, 0.4) }, [sk('bright', 0.5), sk('delay', 0.2)]),
  perf('Bell Pad', 'Bells', [fm(2, [[1, 1, 0.001, 5, 0, 4], [3.5, 0.45, 0.001, 3, 0, 3]], { 'amp.r': 4, level: 0.7 }), analog({ wave: 0, voices: 4, detune: 0.3, 'flt.type': 2, 'flt.cut': 1300, 'amp.a': 1, 'amp.r': 2.5, level: 0.6, velSens: 0.2 })], { ...chorus(0.35), ...hall(0.42, 5) }, [sk('level', 0.3, 1), sk('cutoff', 2, 1), sk('reverb', 0.2)]),

  // Split / Layer
  perf('Piano + Strings', 'Split/Layer', [piano(0, { hard: 0.5 }), analog({ wave: 0, voices: 5, detune: 0.3, 'flt.type': 1, 'flt.cut': 2800, 'amp.a': 0.6, 'amp.r': 1.6, level: 0.55, velSens: 0.3 }), bowed({ level: 0.35, 'amp.a': 0.5, 'amp.r': 1.5 })], { ...chorus(0.25, 0.4), ...hall(0.3, 3) }, [sk('level', 0.35, 1), sk('level', 0.3, 2), sk('reverb', 0.15)]),
  perf('Split Bass/Piano', 'Split/Layer', [pluck(0, { bright: 0.3, pos: 0.28, decay: 1.4, body: 0.65, keyHi: 52, 'amp.r': 0.5 }), piano(0, { keyLo: 53 })], room(0.18), [sk('bright', 0.4, 1), sk('reverb', 0.2)]),
  perf('Jazz Split Bass/EP', 'Split/Layer', [pluck(0, { bright: 0.3, pos: 0.28, decay: 1.4, body: 0.65, keyHi: 52, 'amp.r': 0.5 }), ep(0, { keyLo: 53, bark: 0.4, 'trem.depth': 0.3 })], room(0.15), [sk('tremolo', 0.4, 1), sk('drive', 0.3, 1)]),
  perf('EP + Pad', 'Split/Layer', [ep(0, { bark: 0.45, 'trem.depth': 0.35 }), analog({ wave: 0, voices: 3, detune: 0.3, 'flt.type': 2, 'flt.cut': 1000, 'amp.a': 0.9, 'amp.r': 2, level: 0.5, velSens: 0.2 })], { ...chorus(0.3), ...hall(0.3, 3) }, [sk('level', 0.35, 1), sk('cutoff', 2, 1), sk('reverb', 0.2)]),
  perf('Organ + Piano', 'Split/Layer', [piano(1, { hard: 0.6 }), organ(0, '808000000', { level: 0.55, vib: 6, drive: 0.15 })], room(0.16), [sk('level', 0.3, 1), sk('rotary', 1)]),
  perf('Piano + Choir', 'Split/Layer', [piano(0, { hard: 0.45 }), choir({ vowel: 0.2, gender: 0.6, ens: 3, level: 0.5, 'amp.a': 0.5, 'amp.r': 1.8 })], hall(0.35, 3.5), [sk('level', 0.35, 1), sk('reverb', 0.2)]),
  perf('Strings + Brass', 'Split/Layer', [analog({ wave: 0, voices: 5, detune: 0.3, 'flt.type': 1, 'flt.cut': 3000, 'amp.a': 0.3, 'amp.r': 1.2, velSens: 0.3 }), analog({ wave: 0, voices: 3, detune: 0.2, 'flt.type': 2, 'flt.cut': 800, 'flt.env': 3, 'flt.a': 0.06, 'flt.d': 0.6, 'flt.s': 0.4, 'flt.vel': 2, 'amp.a': 0.03, 'amp.r': 0.3, level: 0.6, velLo: 90, velSens: 0.5 })], { ...chorus(0.35), ...hall(0.3, 3) }, [sk('cutoff', 1.5), sk('level', 0.3, 1)]),
  perf('Piano + Celesta', 'Split/Layer', [piano(0, { hard: 0.5 }), mallet(7, { hard: 0.5, transpose: 12, level: 0.4, 'amp.r': 1.5 })], hall(0.3, 3), [sk('level', 0.35, 1), sk('reverb', 0.2)]),
  perf('Bass + Pad Split', 'Split/Layer', [analog({ wave: 0, voices: 1, sub: 0.5, 'flt.type': 2, 'flt.cut': 400, 'flt.env': 2.5, 'flt.d': 0.25, 'flt.s': 0.25, 'amp.r': 0.08, keyHi: 47, mode: 1 }), analog({ wave: 0, voices: 5, detune: 0.3, 'flt.type': 2, 'flt.cut': 1600, 'amp.a': 0.5, 'amp.r': 2, keyLo: 48, velSens: 0.3 })], { ...chorus(0.3), ...hall(0.3, 3) }, [sk('cutoff', 2), sk('reverb', 0.2)])
]
