import { afterEach, describe, expect, it, vi } from 'vitest'
import { basename } from './platform'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('basename', () => {
  it('returns the file name of a POSIX path', () => {
    expect(basename('/home/me/projects/Song.arkane')).toBe('Song.arkane')
  })

  it('returns the file name of a Windows path', () => {
    expect(basename('C:\\Users\\me\\projects\\Song.arkane')).toBe('Song.arkane')
  })

  it('returns the input when it contains no separator', () => {
    expect(basename('Song.arkane')).toBe('Song.arkane')
  })

  it('uses the host path helper when the desktop host is present', async () => {
    vi.stubGlobal('arkaneHost', { path: { basename: () => 'host-result' } })
    const platform = await import('./platform')
    expect(platform.basename('C:\\Users\\me\\projects\\Song.arkane')).toBe('host-result')
  })
})
