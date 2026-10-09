import { describe, expect, it } from 'vitest'
import { formatPluginId, parsePluginId, formatFromPath, isExternalPluginId } from './ids'
import { candidateFormat, defaultSearchPaths } from './catalog'

describe('plugin ids', () => {
  it('round-trips format, path and uid', () => {
    const refs = [
      { format: 'clap' as const, path: '/home/me/.clap/Surge XT.clap', uid: 'org.surge-synth-team.surge-xt' },
      { format: 'vst3' as const, path: '/usr/lib/vst3/Dexed.vst3', uid: '2046504473616C636565624B6562614B' },
      { format: 'vst2' as const, path: '/home/me/.vst/Kabee-vst.so', uid: '1264739685' },
      { format: 'vst2' as const, path: '/home/me/.vst/odd:name.so', uid: '' },
      { format: 'clap' as const, path: '/weird:dir/x.clap', uid: 'a.b' }
    ]
    for (const r of refs) {
      const id = formatPluginId(r)
      expect(isExternalPluginId(id)).toBe(true)
      expect(parsePluginId(id)).toEqual(r)
    }
  })
  it('rejects non-vst ids', () => {
    expect(parsePluginId('reverb')).toBeNull()
    expect(parsePluginId('vst:lv2:/x.lv2')).toBeNull()
    expect(isExternalPluginId('workstation')).toBe(false)
  })
  it('detects formats from paths', () => {
    expect(formatFromPath('/a/b.CLAP')).toBe('clap')
    expect(formatFromPath('/a/b.vst3/')).toBe('vst3')
    expect(formatFromPath('/a/b.so')).toBe('vst2')
    expect(formatFromPath('/a/b.dll')).toBeNull()
    expect(candidateFormat('/a/x.lv2', true)).toBe('lv2')
    expect(candidateFormat('/a/x.vst3', true)).toBe('vst3')
    expect(candidateFormat('/a/dir', true)).toBeNull()
  })
  it('default search paths cover the Linux conventions and env vars', () => {
    const p = defaultSearchPaths('/home/u', { CLAP_PATH: '/opt/clap:/home/u/.clap', VST3_PATH: '/opt/vst3' })
    for (const x of ['/home/u/.vst', '/home/u/.vst3', '/home/u/.clap', '/usr/lib/vst3', '/usr/local/lib/clap', '/opt/clap', '/opt/vst3']) expect(p).toContain(x)
    expect(p.filter((x) => x === '/home/u/.clap')).toHaveLength(1)
  })
})
