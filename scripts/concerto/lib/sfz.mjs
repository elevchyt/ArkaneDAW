// Minimal SFZ parser (enough for the VSCO 2 CE mappings): <control> default_path, <global>/<group>/<region>
// opcode inheritance. Returns one object per region with all inherited opcodes as strings.

export function parseSfz(text) {
  const clean = text.replace(/\/\/[^\n]*/g, '').replace(/\r/g, '')
  const tokens = clean.split(/(<[a-z]+>)/)
  const regions = []
  let control = {}, global = {}, group = {}, cur = null, section = null
  const assign = (target, body) => {
    // opcodes: key=value, values may contain spaces (sample=...) up to the next key=
    const re = /([a-zA-Z0-9_]+)=([^=]*?)(?=\s+[a-zA-Z0-9_]+=|\s*$)/gs
    for (const m of body.matchAll(re)) target[m[1]] = m[2].trim()
  }
  for (const t of tokens) {
    const h = t.match(/^<([a-z]+)>$/)
    if (h) {
      section = h[1]
      if (section === 'region') {
        cur = {}
        regions.push(cur)
      } else if (section === 'group') group = {}
      else if (section === 'global') global = {}
      continue
    }
    if (!section) continue
    const target = section === 'control' ? control : section === 'global' ? global : section === 'group' ? group : section === 'region' ? cur : null
    if (target) assign(target, t)
    if (section === 'region') Object.assign(cur, { ...global, ...group, ...cur })
  }
  // region opcodes win over group/global ones: re-merge in the right order
  const out = []
  let g = {}, gl = {}
  section = null
  for (const t of tokens) {
    const h = t.match(/^<([a-z]+)>$/)
    if (h) {
      section = h[1]
      if (section === 'group') g = {}
      else if (section === 'global') gl = {}
      else if (section === 'region') out.push({ __g: g, __gl: gl, __r: {} })
      continue
    }
    if (section === 'group') assign(g, t)
    else if (section === 'global') assign(gl, t)
    else if (section === 'region') assign(out[out.length - 1].__r, t)
  }
  const base = (control.default_path ?? '').replace(/\\/g, '/')
  return out.map(({ __g, __gl, __r }) => {
    const r = { ...__gl, ...__g, ...__r }
    r.path = base + (r.sample ?? '').replace(/\\/g, '/')
    return r
  })
}
