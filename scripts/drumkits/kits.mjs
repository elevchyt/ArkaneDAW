// Kit definitions for Studio Drums: which upstream samples become which piece, how many velocity
// layers / round robins we keep, and the General-MIDI(+extras) key map of every kit.
//
// Piece source types
//   dg   – DrumGizmo instrument (multi-mic → stereo mixdown, layers/round-robins picked by the
//          instrument's power values)
//   zip  – files inside a downloaded zip (AVL Drumkits); `layers` = [[rr files…] per velocity layer]
//   vcsl – files from the VCSL repository (same layout)
//   sf2  – a stereo sample pair from FluidR3_GM.sf2
//   ref  – reuse a piece of another kit (no extra files on disk)

const range = (n, from = 1) => Array.from({ length: n }, (_, i) => i + from)

const dg = (src, instr, layers, rr, extra = {}) => ({ type: 'dg', src, instr, layers, rr, ...extra })
/** AVL piece with n velocity layers named `<prefix>-<n>.wav`. */
const avl = (src, prefix, n = 5) => ({ type: 'zip', src, layers: range(n).map((i) => [`${prefix}-${i}.wav`]), sfzPrefix: prefix })
const avlOne = (src, file) => ({ type: 'zip', src, layers: [[file]], sfzPrefix: file.replace(/\.wav$/, '') })
/** Buskman's Holiday: 10 layers per articulation, several articulations (LH/RH) used as round robins. */
const busk = (prefixes, pick = [2, 4, 6, 8, 10]) => ({ type: 'zip', src: 'avl-busk', layers: pick.map((k) => prefixes.map((p) => `${p}-${k}.wav`)), sfzPrefix: prefixes[0] })
const vcsl = (dir, layers) => ({ type: 'vcsl', layers: layers.map((l) => l.map((f) => `${dir}/${f}`)) })
const ref = (kit, piece) => ({ type: 'ref', kit, piece })

/**
 * Category defaults: target attack loudness (dB RMS of the first 60 ms at the plugin output, see
 * lib/audio.mjs attackLoudness) of a piece's loudest layer, and the max kept length in seconds.
 * Normalising every piece of every kit to the same per-category target keeps kits interchangeable;
 * the peak is capped at -0.3 dBFS.
 */
export const CATEGORIES = {
  kick: { loudDb: -7, maxLen: 1.0 },
  snare: { loudDb: -9.5, maxLen: 1.3 },
  side: { loudDb: -17, maxLen: 0.6 },
  sweep: { loudDb: -27, maxLen: 4.0 },
  tom: { loudDb: -10, maxLen: 2.2 },
  hat: { loudDb: -19.5, maxLen: 0.9 },
  hatopen: { loudDb: -19, maxLen: 3.0 },
  crash: { loudDb: -16, maxLen: 4.5 },
  ride: { loudDb: -21, maxLen: 4.0 },
  china: { loudDb: -17, maxLen: 4.0 },
  splash: { loudDb: -18.5, maxLen: 2.5 },
  choke: { loudDb: -20, maxLen: 1.0 },
  perc: { loudDb: -15, maxLen: 1.5 },
  /** shakers, scrapers, snaps: naturally softer */
  percsoft: { loudDb: -21, maxLen: 1.5 },
  perclong: { loudDb: -21, maxLen: 3.0 }
}

// ─── shared Latin / hand percussion (lives in the "latin" kit, referenced by every other kit) ───
const LATIN_PIECES = {
  clap: { name: 'Hand Clap', cat: 'perc', src: busk(['39-HandClaps']) },
  snap: { cat: 'percsoft', name: 'Finger Snap', src: busk(['37-FingerSnaps']) },
  tamb: { name: 'Tambourine', cat: 'perc', src: busk(['46-GP-Bump-Tambourine']) },
  tambshake: { cat: 'percsoft', name: 'Tambourine Shake', src: busk(['44-Shake-Tambourine']) },
  cowbell: { name: 'Cowbell (Mambo)', cat: 'perc', src: busk(['51-LP-Cowbell']) },
  cowbell2: { name: 'Cowbell (Cha-cha)', cat: 'perc', src: vcsl('Idiophones/Struck Idiophones/Cowbells', [['Cowbell2_Normal_v2_rr1_Mid.wav'], ['Cowbell2_Normal_v3_rr1_Mid.wav']]), pan: 0.3 },
  // stick on the timbale shell ("paila"/cascara). No free timbale-shell recording exists in the sources, so a
  // damped cowbell (stick on thin metal) is used, tuned up by the key map.
  paila: { name: 'Timbale Paila', cat: 'perc', src: vcsl('Idiophones/Struck Idiophones/Cowbells', [['Cowbell1_Muted_v2_rr1_Mid.wav', 'Cowbell2_Muted_v2_rr1_Mid.wav'], ['Cowbell1_Muted_v3_rr1_Mid.wav', 'Cowbell2_Muted_v3_rr1_Mid.wav']]), pan: 0.35 },
  vibraslap: { name: 'Vibraslap', cat: 'perclong', src: vcsl('Idiophones/Struck Idiophones/Vibraslap/Legacy', [['vibraslap_rr1.wav', 'vibraslap_rr2.wav', 'vibraslap_rr3.wav']]), pan: 0.2 },
  bongohi: { name: 'Bongo Hi', cat: 'perc', src: vcsl('Membranophones/Struck Membranophones/Bongos', range(3).map((v) => [`BongoH_Hit1_v${v}_rr1_Mid.wav`, `BongoH_Hit1_v${v}_rr2_Mid.wav`])), pan: -0.25 },
  bongolo: { name: 'Bongo Lo', cat: 'perc', src: vcsl('Membranophones/Struck Membranophones/Bongos', range(3).map((v) => [`BongoL_Hit1_v${v}_rr1_Mid.wav`, `BongoL_Hit1_v${v}_rr2_Mid.wav`])), pan: -0.1 },
  bongohimute: { name: 'Bongo Hi Muted', cat: 'perc', src: vcsl('Membranophones/Struck Membranophones/Bongos', range(3).map((v) => [`BongoH_HitMuted1_v${v}_rr1_Mid.wav`, `BongoH_HitMuted1_v${v}_rr2_Mid.wav`])), pan: -0.25 },
  congamute: { name: 'Conga Muted', cat: 'perc', src: vcsl('Membranophones/Struck Membranophones/Conga', range(2).map((v) => [`Conga_HitFM_v${v}_rr1_Sum.wav`, `Conga_HitFM_v${v}_rr2_Sum.wav`])), pan: 0.15 },
  congahi: { name: 'Conga Open', cat: 'perc', src: busk(['45-Meinl-Conga-Small-LH', '47-Meinl-Conga-Small-RH']) },
  congalo: { name: 'Tumbadora', cat: 'perc', src: busk(['41-Meinl-Conga-Large-LH', '43-Meinl-Conga-Large-RH']) },
  quinto: { name: 'Quinto', cat: 'perc', src: vcsl('Membranophones/Struck Membranophones/Conga', range(3).map((v) => [`Quinto_HitN_v${v}_rr1_Sum.wav`, `Quinto_HitN_v${v}_rr2_Sum.wav`])), pan: -0.15 },
  tumba: { name: 'Tumba', cat: 'perc', src: vcsl('Membranophones/Struck Membranophones/Conga', range(4).map((v) => [`Tumba_HitN_v${v}_rr1_Sum.wav`, `Tumba_HitN_v${v}_rr2_Sum.wav`])), pan: 0.35 },
  timbalehi: { name: 'Timbale Hi', cat: 'perc', src: { type: 'sf2', src: 'fluid', layers: [[['High Timbale(L)', 'High Timbale(R)']]] } },
  timbalelo: { name: 'Timbale Lo', cat: 'perc', src: { type: 'sf2', src: 'fluid', layers: [[['Low Timbale(L)', 'Low Timbale(R)']]] } },
  agogohi: { name: 'Agogo Hi', cat: 'perc', src: vcsl('Idiophones/Struck Idiophones/Agogo Bells', range(3).map((v) => [`Agogo_High_v${v}_rr1_Mid.wav`])), pan: 0.3 },
  agogolo: { name: 'Agogo Lo', cat: 'perc', src: vcsl('Idiophones/Struck Idiophones/Agogo Bells', range(2).map((v) => [`Agogo_Low_v${v}_rr1_Mid.wav`])), pan: 0.3 },
  cabasa: { cat: 'percsoft', name: 'Cabasa', src: vcsl('Idiophones/Struck Idiophones/Cabasa', [['Cabasa1_Hit_rr1_Mid.wav', 'Cabasa1_Hit_rr2_Mid.wav']]), pan: -0.3 },
  maracas: { cat: 'percsoft', name: 'Maracas', src: avl('avl-perc', '42-Maraca') },
  guiroshort: { cat: 'percsoft', name: 'Guiro Short', src: vcsl('Idiophones/Struck Idiophones/Guiro', [['Guiro_Hit_rr1_Mid.wav', 'Guiro_Hit_rr2_Mid.wav']]), pan: 0.25 },
  guirolong: { name: 'Guiro Long', cat: 'percsoft', src: vcsl('Idiophones/Struck Idiophones/Guiro', [['Guiro_Med_rr1_Mid.wav']]), pan: 0.25 },
  claves: { name: 'Claves', cat: 'perc', src: busk(['48-Claves']) },
  woodblock: { name: 'Woodblock', cat: 'perc', src: avl('avl-perc', '37-Woodblock') },
  trianglemute: { cat: 'percsoft', name: 'Triangle Muted', src: vcsl('Idiophones/Struck Idiophones/Triangles', [['Triangle1_HitM_v1_rr2_Mid.wav', 'Triangle1_HitM_v1_rr4_Mid.wav']]), pan: 0.4 },
  triangle: { name: 'Triangle Open', cat: 'perclong', src: vcsl('Idiophones/Struck Idiophones/Triangles', [['Triangle1_Hit_v1_rr1_Mid.wav', 'Triangle1_Hit_v1_rr2_Mid.wav'], ['Triangle1_Hit_v2_rr1_Mid.wav', 'Triangle1_Hit_v2_rr2_Mid.wav']]), pan: 0.4 },
  shaker: { cat: 'percsoft', name: 'Shaker', src: busk(['42-GonBops-Triple-Shaker']) },
  cajonbass: { name: 'Cajon Bass', cat: 'perc', src: busk(['36-Meinl-Cajon-Thump']) },
  cajonslap: { name: 'Cajon Slap', cat: 'perc', src: busk(['38-Meinl-Cajon-Slap-LH', '40-Meinl-Cajon-Slap-RH']) }
}

/** Percussion keys present in every kit (General MIDI positions + extras 84–91). */
const PERC_KEYS = {
  34: { piece: 'snap', name: 'Finger Snap' },
  39: { piece: 'clap', name: 'Hand Clap' },
  54: { piece: 'tamb', name: 'Tambourine' },
  56: { piece: 'cowbell', name: 'Cowbell' },
  58: { piece: 'vibraslap', name: 'Vibraslap' },
  60: { piece: 'bongohi', name: 'Bongo Hi' },
  61: { piece: 'bongolo', name: 'Bongo Lo' },
  62: { piece: 'congamute', name: 'Conga Mute' },
  63: { piece: 'congahi', name: 'Conga Open' },
  64: { piece: 'congalo', name: 'Conga Low' },
  65: { piece: 'timbalehi', name: 'Timbale Hi' },
  66: { piece: 'timbalelo', name: 'Timbale Lo' },
  67: { piece: 'agogohi', name: 'Agogo Hi' },
  68: { piece: 'agogolo', name: 'Agogo Lo' },
  69: { piece: 'cabasa', name: 'Cabasa' },
  70: { piece: 'maracas', name: 'Maracas' },
  73: { piece: 'guiroshort', name: 'Guiro Short' },
  74: { piece: 'guirolong', name: 'Guiro Long' },
  75: { piece: 'claves', name: 'Claves' },
  76: { piece: 'woodblock', name: 'Woodblock Hi' },
  77: { piece: 'woodblock', name: 'Woodblock Lo', tune: -5 },
  80: { piece: 'trianglemute', name: 'Triangle Mute', chokes: [4] },
  81: { piece: 'triangle', name: 'Triangle Open', choke: 4, chokes: [4] },
  82: { piece: 'shaker', name: 'Shaker' },
  83: { piece: 'tambshake', name: 'Tamb. Shake' },
  84: { piece: 'paila', name: 'Timbale Paila', tune: 4 },
  85: { piece: 'quinto', name: 'Quinto' },
  86: { piece: 'tumba', name: 'Tumba' },
  87: { piece: 'cajonbass', name: 'Cajon Bass' },
  88: { piece: 'cajonslap', name: 'Cajon Slap' },
  89: { piece: 'cowbell2', name: 'Cowbell Cha-cha' },
  90: { piece: 'bongohimute', name: 'Bongo Hi Mute' }
}

// ─── drum key slots ───
// group = piano-roll group, ch = mixer strip. Choke groups: 1 = hi-hat, 2 = crash 1, 3 = crash 2, 4 = triangle.
const HAT_CHOKER = { chokes: [1] }
export const SLOTS = {
  21: { name: 'Hat Foot Splash', group: 'Hats', ch: 'hihat', choke: 1, chokes: [1] },
  22: { name: 'Hat Closed Edge', group: 'Hats', ch: 'hihat', ...HAT_CHOKER },
  23: { name: 'Hat Half-Open', group: 'Hats', ch: 'hihat', choke: 1, chokes: [1] },
  24: { name: 'Hat Swish', group: 'Hats', ch: 'hihat', choke: 1, chokes: [1] },
  25: { name: 'Snare Flam', group: 'Snare', ch: 'snare', flam: true },
  26: { name: 'Snare Ghost', group: 'Snare', ch: 'snare', velScale: 0.32 },
  27: { name: 'Snare Muted', group: 'Snare', ch: 'snare' },
  28: { name: 'Brush Sweep', group: 'Snare', ch: 'snare' },
  29: { name: 'Crash 1 Choke', group: 'Cymbals', ch: 'crash', chokes: [2] },
  30: { name: 'Crash 2 Choke', group: 'Cymbals', ch: 'crash', chokes: [3] },
  31: { name: 'Sticks', group: 'Perc', ch: 'perc' },
  32: { name: 'Crash 3', group: 'Cymbals', ch: 'crash' },
  35: { name: 'Kick 2', group: 'Kick', ch: 'kick' },
  36: { name: 'Kick', group: 'Kick', ch: 'kick' },
  37: { name: 'Side Stick', group: 'Snare', ch: 'side' },
  38: { name: 'Snare', group: 'Snare', ch: 'snare' },
  40: { name: 'Snare Rimshot', group: 'Snare', ch: 'snare' },
  41: { name: 'Floor Tom Lo', group: 'Toms', ch: 'tom4' },
  42: { name: 'Closed Hat', group: 'Hats', ch: 'hihat', ...HAT_CHOKER },
  43: { name: 'Floor Tom Hi', group: 'Toms', ch: 'tom3' },
  44: { name: 'Pedal Hat', group: 'Hats', ch: 'hihat', ...HAT_CHOKER },
  45: { name: 'Tom Low', group: 'Toms', ch: 'tom2' },
  46: { name: 'Open Hat', group: 'Hats', ch: 'hihat', choke: 1, chokes: [1] },
  47: { name: 'Tom Low-Mid', group: 'Toms', ch: 'tom2' },
  48: { name: 'Tom Hi-Mid', group: 'Toms', ch: 'tom1' },
  49: { name: 'Crash 1', group: 'Cymbals', ch: 'crash', choke: 2 },
  50: { name: 'Tom High', group: 'Toms', ch: 'tom1' },
  51: { name: 'Ride', group: 'Cymbals', ch: 'ride' },
  52: { name: 'China', group: 'Cymbals', ch: 'fx' },
  53: { name: 'Ride Bell', group: 'Cymbals', ch: 'ride' },
  55: { name: 'Splash', group: 'Cymbals', ch: 'fx' },
  57: { name: 'Crash 2', group: 'Cymbals', ch: 'crash', choke: 3 },
  59: { name: 'Ride 2 (Edge)', group: 'Cymbals', ch: 'ride' }
}

const PERC_SLOT = { group: 'Perc', ch: 'perc' }

// ─── kits ───
// keys: { midiKey: pieceId | { piece, tune?, gain?, name? } } on top of SLOTS (+ PERC_KEYS for every kit).

const AVL_NAMES = {
  'avl-redzep': { sticks: '35-JojoMayer-2-StickClick', kick: '36-Ludwig-26-Kick', side: '37-Ludwig-14-SideStick', snare: '38-Ludwig-14-Snare', edge: '40-Ludwig-14-SnareEdge', ftom: '41-Ludwig-16-FloorTom', tom: '45-Ludwig-14-Tom', hatC: '42-Sabian-13-HatClosed', hatP: '44-Sabian-13-HatPedal', hatSemi: '46-Sabian-13-HatSemi', hatSwish: '48-Sabian-13-HatSwish', crash: '49-Zildjian-20-Crash', crashChoke1: '50-Zildjian-20-CrashChoke.wav', ride: '51-Zildjian-24-Ride', bell: '53-Zildjian-24-RideBell', splash: '55-Zildjian-10-Splash', crash2: '57-Zildjian-17-Crash', crash2Choke1: '58-Zildjian-17-CrashChoke.wav', rideShank: '59-Zildjian-24-RideShank', crash3: '60-Paiste-22-Crash', china: '62-Wuhan-18-ChinaCrash' },
  'avl-pearl': { sticks: '35-JojoMayer-2-StickClick', kick: '36-Pearl-22-Kick', side: '37-Pearl-14-SideStick', snare: '38-Pearl-14-Snare', edge: '40-Pearl-14-SnareEdge', ftom: '41-Pearl-16-FloorTom', tom: '45-Pearl-12-Tom', hatC: '42-Sabian-13-HatClosed', hatP: '44-Sabian-13-HatPedal', hatSemi: '46-Sabian-13-HatSemi', hatSwish: '48-Sabian-13-HatSwish', crash: '49-SabianAA-16-Crash', crashChoke1: '50-SabianAA-16-CrashChoke.wav', ride: '51-SabianAAX-20-Ride', bell: '53-SabianAAX-20-RideBell', splash: '55-Zildjian-10-Splash', crash2: '57-SabianAAX-17-Crash', crash2Choke1: '58-SabianAAX-17-CrashChoke.wav', rideShank: '59-SabianAAX-20-RideShank', crash3: '60-Paiste-22-Crash', china: '62-Wuhan-18-ChinaCrash' },
  'avl-bop': { sticks: '35-JojoMayer-2-StickClick', kick: '36-TAMA-18-Kick', side: '37-TAMA-13-SideStick', snare: '38-TAMA-13-Snare', edge: '40-TAMA-13-SnareEdge', ftom: '41-TAMA-14-FloorTom', tom: '45-TAMA-10-Tom', hatC: '42-Zildjian-13-HatClosed', hatP: '44-Zildjian-13-HatPedal', hatSemi: '46-Zildjian-13-HatSemi', hatSwish: '48-Zildjian-13-HatSwish', crash: '49-Paiste2002-16-Crash', crashChoke: '50-Paiste2002-16-CrashChoke', ride: '51-SabianAAX-20-RideTip', bell: '53-SabianAAX-20-RideBell', splash: '55-Zildjian-10-Splash', crash2: '57-SabianAAX-17-Crash2', crash2Choke: '58-SabianAAX-17-Crash2Choke', rideShank: '59-SabianAAX-20-RideShank', china: '60-Wuhan-18-ChinaCrash' },
  'avl-bophr': { sticks: '35-Hotrod-2-StickClick', kick: '36-TAMA-18-Kick-HR', side: '37-TAMA-13-SnareSidestick-HR', snare: '38-TAMA-13-SnareCenter-HR', edge: '40-TAMA-13-SnareEdge-HR', ftom: '41-TAMA-14-FloorTomCenter-HR', tom: '45-TAMA-10-TomCenter-HR', hatC: '42-Zildjian-13-HatClosed-HR', hatP: '44-Zildjian-13-HatPedal-HR', hatSemi: '46-Zildjian-12-HatSemi-HR', hatSwish: '48-Zildjian-13-HatSwish-HR', crash: '49-Paiste2002-16-Crash-HR', crashChoke: '50-Paiste2002-16-CrashChoke-HR', ride: '51-SabianAAX-20-RideTip-HR', bell: '53-SabianAAX-20-RideBell-HR', splash: '55-Zildjian-10-Splash-HR', crash2: '57-SabianAAX-17-Crash2-HR', crash2Choke: '58-SabianAAX-17-Crash2Choke-HR', rideShank: '59-SabianAAX-20-RideShank-HR', china: '60-Wuhan-18-ChinaCrash-HR' }
}

function avlKit(src, { openIsSemi = true } = {}) {
  const n = AVL_NAMES[src]
  const pieces = {
    kick: { name: 'Kick', cat: 'kick', src: avl(src, n.kick) },
    snare: { name: 'Snare', cat: 'snare', src: avl(src, n.snare) },
    edge: { name: 'Snare Edge', cat: 'snare', src: avl(src, n.edge) },
    side: { name: 'Side Stick', cat: 'side', src: avl(src, n.side) },
    tom: { name: 'Rack Tom', cat: 'tom', src: avl(src, n.tom) },
    ftom: { name: 'Floor Tom', cat: 'tom', src: avl(src, n.ftom) },
    hh: { name: 'Hi-Hat Closed', cat: 'hat', src: avl(src, n.hatC) },
    hhpedal: { name: 'Hi-Hat Pedal', cat: 'hat', src: avl(src, n.hatP) },
    hhsemi: { name: 'Hi-Hat Open', cat: 'hatopen', src: avl(src, n.hatSemi) },
    hhswish: { name: 'Hi-Hat Swish', cat: 'hatopen', src: avl(src, n.hatSwish) },
    crash: { name: 'Crash 1', cat: 'crash', src: avl(src, n.crash) },
    crashchoke: { name: 'Crash 1 Choke', cat: 'choke', src: n.crashChoke ? avl(src, n.crashChoke) : avlOne(src, n.crashChoke1) },
    crash2: { name: 'Crash 2', cat: 'crash', src: avl(src, n.crash2) },
    crash2choke: { name: 'Crash 2 Choke', cat: 'choke', src: n.crash2Choke ? avl(src, n.crash2Choke) : avlOne(src, n.crash2Choke1) },
    ride: { name: 'Ride', cat: 'ride', src: avl(src, n.ride) },
    bell: { name: 'Ride Bell', cat: 'ride', src: avl(src, n.bell) },
    rideshank: { name: 'Ride Shank', cat: 'ride', src: avl(src, n.rideShank) },
    splash: { name: 'Splash', cat: 'splash', src: avl(src, n.splash) },
    china: { name: 'China', cat: 'china', src: avl(src, n.china) },
    sticks: { name: 'Sticks', cat: 'side', src: avl(src, n.sticks) }
  }
  if (n.crash3) pieces.crash3 = { name: 'Crash 3', cat: 'crash', src: avl(src, n.crash3) }
  const keys = {
    21: { piece: 'hhpedal', gain: 2 },
    23: 'hhsemi',
    24: 'hhswish',
    25: 'snare',
    26: 'snare',
    29: 'crashchoke',
    30: 'crash2choke',
    31: 'sticks',
    35: 'kick',
    36: 'kick',
    37: 'side',
    38: 'snare',
    40: { piece: 'edge', name: 'Snare Edge' },
    // one rack tom + one floor tom, spread over the six GM tom keys by tuning
    50: { piece: 'tom', tune: 3 },
    48: { piece: 'tom', tune: 1 },
    47: { piece: 'tom', tune: -1 },
    45: { piece: 'tom', tune: -3 },
    43: { piece: 'ftom', tune: 2 },
    41: 'ftom',
    42: 'hh',
    44: 'hhpedal',
    46: openIsSemi ? 'hhsemi' : 'hhswish',
    49: 'crash',
    51: 'ride',
    52: 'china',
    53: 'bell',
    55: 'splash',
    57: 'crash2',
    59: 'rideshank'
  }
  if (pieces.crash3) keys[32] = 'crash3'
  return { pieces, keys }
}

const STUDIO = {
  pieces: {
    kick: { name: 'Kick', cat: 'kick', src: dg('drs', 'Kdrum_with_contact', 6, 3) },
    kick2: { name: 'Kick (open)', cat: 'kick', src: dg('drs', 'Kdrum_without_contact', 5, 3) },
    snare: { name: 'Snare', cat: 'snare', src: dg('drs', 'Snare', 6, 3) },
    snarerest: { name: 'Snare Muted', cat: 'snare', src: dg('drs', 'Snare_rest', 4, 2) },
    side: { name: 'Side Stick', cat: 'side', src: dg('drs', 'Snare_rim', 4, 3) },
    tom1: { name: 'Rack Tom', cat: 'tom', src: dg('drs', 'Tom1', 5, 3) },
    tom2: { name: 'Floor Tom 1', cat: 'tom', src: dg('drs', 'Tom2', 5, 3) },
    tom3: { name: 'Floor Tom 2', cat: 'tom', src: dg('drs', 'Tom3', 5, 3) },
    hh: { name: 'Hi-Hat Closed', cat: 'hat', src: dg('drs', 'Hihat_closed', 6, 3) },
    hhedge: { name: 'Hi-Hat Closed Edge', cat: 'hat', src: dg('drs', 'Hihat_closed_shank', 4, 3) },
    hhsemi: { name: 'Hi-Hat Half-Open', cat: 'hatopen', src: dg('drs', 'Hihat_semi_open', 4, 2, { maxLen: 1.8 }) },
    hhopen: { name: 'Hi-Hat Open', cat: 'hatopen', src: dg('drs', 'Hihat_open', 5, 2) },
    hhpedal: { name: 'Hi-Hat Pedal', cat: 'hat', src: dg('drs', 'Hihat_foot', 3, 2) },
    crash: { name: 'Crash L (Giant Beat)', cat: 'crash', src: dg('drs', 'Crash_left_shank', 5, 2) },
    crash2: { name: 'Crash R (602)', cat: 'crash', src: dg('drs', 'Crash_right_shank', 5, 2) },
    ride: { name: 'Ride', cat: 'ride', src: dg('drs', 'Ride_tip', 5, 3) },
    bell: { name: 'Ride Bell', cat: 'ride', src: dg('drs', 'Ride_shank_bell', 3, 2) },
    rideshank: { name: 'Ride Shank', cat: 'ride', src: dg('drs', 'Ride_shank', 3, 2) },
    china: { name: 'China', cat: 'china', src: ref('metal', 'china') },
    splash: { name: 'Splash', cat: 'splash', src: ref('metal', 'splash') },
    sticks: { name: 'Sticks', cat: 'side', src: ref('vintage', 'sticks') },
    crashchoke: { name: 'Crash Choke', cat: 'choke', src: ref('metal', 'crashchoke') },
    crash2choke: { name: 'Crash 2 Choke', cat: 'choke', src: ref('metal', 'crash2choke') }
  },
  keys: {
    21: { piece: 'hhpedal', gain: 2 },
    22: 'hhedge',
    29: 'crashchoke',
    30: 'crash2choke',
    23: 'hhsemi',
    25: 'snare',
    26: 'snare',
    27: 'snarerest',
    31: 'sticks',
    35: 'kick2',
    36: 'kick',
    37: 'side',
    38: 'snare',
    40: { piece: 'snarerest', name: 'Snare Muted' },
    50: { piece: 'tom1', tune: 1.5 },
    48: 'tom1',
    47: { piece: 'tom2', tune: 1.5 },
    45: 'tom2',
    43: { piece: 'tom3', tune: 1.5 },
    41: 'tom3',
    42: 'hh',
    44: 'hhpedal',
    46: 'hhopen',
    49: 'crash',
    51: 'ride',
    52: 'china',
    53: 'bell',
    55: 'splash',
    57: 'crash2',
    59: 'rideshank'
  }
}

const BRUSHES = {
  pieces: {
    kick: { name: 'Kick (feathered)', cat: 'kick', src: ref('studio', 'kick2') },
    snare: { name: 'Snare Brush Tap', cat: 'snare', src: dg('drs', 'Snare_whisker', 6, 3) },
    sweep: { name: 'Brush Sweep', cat: 'sweep', src: dg('drs', 'Snare_circle_whisker', 2, 2) },
    side: { name: 'Side Stick', cat: 'side', src: ref('studio', 'side') },
    tom1: { name: 'Rack Tom (brush)', cat: 'tom', src: dg('drs', 'Tom1_whisker', 4, 2) },
    tom2: { name: 'Floor Tom 1 (brush)', cat: 'tom', src: dg('drs', 'Tom2_whisker', 4, 2) },
    tom3: { name: 'Floor Tom 2 (brush)', cat: 'tom', src: dg('drs', 'Tom3_whisker', 4, 2) },
    hh: { name: 'Hi-Hat (brush)', cat: 'hat', src: dg('drs', 'Hihat_closed_whisker', 4, 3) },
    hhopen: { name: 'Hi-Hat Open (brush)', cat: 'hatopen', src: dg('drs', 'Hihat_open_whisker', 4, 2) },
    hhsemi: { name: 'Hi-Hat Half-Open', cat: 'hatopen', src: ref('studio', 'hhsemi') },
    hhpedal: { name: 'Hi-Hat Pedal', cat: 'hat', src: ref('studio', 'hhpedal') },
    ride: { name: 'Ride (brush)', cat: 'ride', src: dg('drs', 'Ride_whisker', 4, 2) },
    ridestick: { name: 'Ride (stick)', cat: 'ride', src: ref('studio', 'ride') },
    bell: { name: 'Ride Bell', cat: 'ride', src: ref('studio', 'bell') },
    crash: { name: 'Crash L (brush)', cat: 'crash', src: dg('drs', 'Crash_left_whisker', 3, 2) },
    crash2: { name: 'Crash R (brush)', cat: 'crash', src: dg('drs', 'Crash_right_whisker', 3, 2) },
    china: { name: 'China', cat: 'china', src: ref('metal', 'china') },
    splash: { name: 'Splash', cat: 'splash', src: ref('metal', 'splash') },
    sticks: { name: 'Sticks', cat: 'side', src: ref('vintage', 'sticks') },
    crashchoke: { name: 'Crash Choke', cat: 'choke', src: ref('metal', 'crashchoke') },
    crash2choke: { name: 'Crash 2 Choke', cat: 'choke', src: ref('metal', 'crash2choke') }
  },
  keys: {
    21: { piece: 'hhpedal', gain: 2 },
    23: 'hhsemi',
    25: 'snare',
    26: 'snare',
    28: 'sweep',
    29: 'crashchoke',
    30: 'crash2choke',
    31: 'sticks',
    35: 'kick',
    36: 'kick',
    37: 'side',
    38: 'snare',
    40: { piece: 'sweep', name: 'Brush Sweep' },
    50: { piece: 'tom1', tune: 1.5 },
    48: 'tom1',
    47: { piece: 'tom2', tune: 1.5 },
    45: 'tom2',
    43: { piece: 'tom3', tune: 1.5 },
    41: 'tom3',
    42: 'hh',
    44: 'hhpedal',
    46: 'hhopen',
    49: 'crash',
    51: 'ride',
    52: 'china',
    53: 'bell',
    55: 'splash',
    57: 'crash2',
    59: { piece: 'ridestick', name: 'Ride (stick)' }
  }
}

const METAL = {
  pieces: {
    kick: { name: 'Kick R', cat: 'kick', src: dg('crocell', 'KDrumR', 6, 3) },
    kick2: { name: 'Kick L', cat: 'kick', src: dg('crocell', 'KDrumL', 6, 3) },
    snare: { name: 'Snare', cat: 'snare', src: dg('crocell', 'Snare', 6, 3) },
    rimshot: { name: 'Snare Rimshot', cat: 'snare', src: dg('crocell', 'SnareRimShot', 4, 3) },
    side: { name: 'Side Stick', cat: 'side', src: dg('crocell', 'SnareRim', 4, 3) },
    snarerest: { name: 'Snare Muted', cat: 'snare', src: dg('crocell', 'SnareRest', 3, 1) },
    tom1: { name: 'Rack Tom 1', cat: 'tom', src: dg('crocell', 'Tom1', 6, 3) },
    tom2: { name: 'Rack Tom 2', cat: 'tom', src: dg('crocell', 'Tom2', 6, 3) },
    ftom1: { name: 'Floor Tom 1', cat: 'tom', src: dg('crocell', 'FTom1', 6, 3) },
    ftom2: { name: 'Floor Tom 2', cat: 'tom', src: dg('crocell', 'FTom2', 6, 3) },
    hh: { name: 'Hi-Hat Closed', cat: 'hat', src: dg('crocell', 'HihatClosed', 6, 3) },
    hhedge: { name: 'Hi-Hat Loose', cat: 'hat', src: dg('crocell', 'HihatClosedNoPedal', 4, 3, { maxLen: 1.2 }) },
    hhsemi: { name: 'Hi-Hat Half-Open', cat: 'hatopen', src: dg('crocell', 'HihatSemiOpen', 4, 2, { maxLen: 1.8 }) },
    hhopen: { name: 'Hi-Hat Open', cat: 'hatopen', src: dg('crocell', 'HihatOpen', 6, 2) },
    hhpedal: { name: 'Hi-Hat Pedal', cat: 'hat', src: dg('crocell', 'HihatPedal', 3, 2) },
    hhsplash: { name: 'Hi-Hat Foot Splash', cat: 'hatopen', src: dg('crocell', 'HihatPedalHit', 2, 2, { maxLen: 1.6 }) },
    crash: { name: 'Crash L', cat: 'crash', src: dg('crocell', 'CrashL', 5, 3) },
    crash2: { name: 'Crash R', cat: 'crash', src: dg('crocell', 'CrashR', 5, 2) },
    crashchoke: { name: 'Crash L Choke', cat: 'choke', src: dg('crocell', 'CrashLStopped', 2, 1) },
    crash2choke: { name: 'Crash R Choke', cat: 'choke', src: dg('crocell', 'CrashRStopped', 2, 1) },
    ride: { name: 'Ride', cat: 'ride', src: dg('crocell', 'RideR', 6, 3) },
    bell: { name: 'Ride Bell', cat: 'ride', src: dg('crocell', 'RideRBell', 3, 2) },
    china: { name: 'China', cat: 'china', src: dg('crocell', 'ChinaL', 4, 2) },
    splash: { name: 'Splash', cat: 'splash', src: dg('crocell', 'SplashL', 3, 1) },
    sticks: { name: 'Sticks', cat: 'side', src: ref('vintage', 'sticks') }
  },
  keys: {
    21: 'hhsplash',
    22: 'hhedge',
    23: 'hhsemi',
    25: 'snare',
    26: 'snare',
    27: 'snarerest',
    29: 'crashchoke',
    30: 'crash2choke',
    31: 'sticks',
    35: 'kick2',
    36: 'kick',
    37: 'side',
    38: 'snare',
    40: 'rimshot',
    50: { piece: 'tom1', tune: 1 },
    48: 'tom1',
    47: { piece: 'tom2', tune: 1 },
    45: 'tom2',
    43: 'ftom1',
    41: 'ftom2',
    42: 'hh',
    44: 'hhpedal',
    46: 'hhopen',
    49: 'crash',
    51: 'ride',
    52: 'china',
    53: 'bell',
    55: 'splash',
    57: 'crash2',
    59: { piece: 'ride', gain: -2, tune: -0.5 }
  }
}

/** Display order of the kit selector. `dir` = folder under resources/drumkits. */
export const KITS = [
  { id: 'studio', name: 'Studio Rock', description: 'DRSKit: hand-made Danish maple kit, Paiste 602 cymbals. Close mics + overheads + room, 6 layers × 3 round robins on kick/snare. Rock, pop, funk.', source: 'drs', ...STUDIO },
  { id: 'metal', name: 'Metal', description: 'CrocellKit: the kit of Danish metal band Crocell, sampled at JBOSound. Two kick drums, four toms, chinas. Tight & loud.', source: 'crocell', ...METAL },
  { id: 'vintage', name: 'Vintage Funk', description: 'AVL Red Zeppelin: Ludwig 26" kick & 14" snare, Zildjian/Sabian cymbals. Big classic-rock / funk sound.', source: 'avl-redzep', ...avlKit('avl-redzep') },
  { id: 'pearl', name: 'Pop Pearl', description: 'AVL Black Pearl: Pearl 22" kit, Sabian AA/AAX cymbals. Tight modern pop / rock kit.', source: 'avl-pearl', ...avlKit('avl-pearl') },
  { id: 'bop', name: 'Jazz Bop', description: 'AVL Blonde Bop: TAMA 18" bop kit with sticks, dark AAX ride. Jazz, swing, bossa.', source: 'avl-bop', ...avlKit('avl-bop') },
  { id: 'rods', name: 'Hot Rods', description: 'AVL Blonde Bop played with Hot Rods: soft, woody attack. Bossa, ballads, unplugged.', source: 'avl-bophr', ...avlKit('avl-bophr') },
  { id: 'brushes', name: 'Jazz Brushes', description: 'DRSKit played with brushes ("whiskers"): taps, sweeps, brushed ride. Jazz ballads & brush swing.', source: 'drs', ...BRUSHES },
  { id: 'latin', name: 'Latin Percussion', description: 'Congas, bongos, timbales, cowbells, claves, guiro, shakers, cajon… (AVL Buskman\'s Holiday, VCSL, FluidR3).', source: 'mixed', pieces: LATIN_PIECES, keys: {} }
]

export const PERC = { keys: PERC_KEYS, slot: PERC_SLOT, pieces: LATIN_PIECES }

/** Pad banks (4×4, rows top→bottom). Keys missing from a kit show an empty pad. */
export const PAD_BANKS = {
  drums: [
    { name: 'A', keys: [49, 57, 51, 53, 48, 45, 43, 41, 42, 44, 46, 23, 36, 38, 37, 40] },
    { name: 'B', keys: [52, 55, 29, 59, 35, 26, 25, 22, 39, 54, 56, 82, 63, 64, 75, 65] },
    { name: 'C', keys: [60, 61, 62, 63, 64, 85, 86, 90, 65, 66, 84, 89, 73, 74, 70, 69] }
  ],
  brushes: [
    { name: 'A', keys: [49, 57, 51, 53, 48, 45, 43, 41, 42, 44, 46, 23, 36, 38, 37, 28] },
    { name: 'B', keys: [52, 55, 59, 21, 35, 26, 25, 31, 39, 54, 56, 82, 63, 64, 75, 65] },
    { name: 'C', keys: [60, 61, 62, 63, 64, 85, 86, 90, 65, 66, 84, 89, 73, 74, 70, 69] }
  ],
  latin: [
    { name: 'A', keys: [65, 66, 84, 56, 60, 61, 90, 89, 62, 63, 64, 75, 85, 86, 87, 88] },
    { name: 'B', keys: [73, 74, 82, 70, 67, 68, 69, 54, 76, 77, 80, 81, 39, 34, 58, 83] }
  ]
}
