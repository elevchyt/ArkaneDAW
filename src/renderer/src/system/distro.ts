// Linux distribution detection from /etc/os-release (pure; shared by the dependency prompts and the
// main-process updater, which uses it to pick a .deb/.rpm asset).

export type DistroFamily = 'apt' | 'dnf' | 'pacman' | 'zypper' | 'generic'

export interface DistroInfo {
  family: DistroFamily
  id: string
  /** PRETTY_NAME (or NAME / ID) for display */
  name: string
}

/** Parse os-release KEY=value lines (values optionally quoted, with shell escapes). */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).replace(/\\(["'$`\\])/g, '$1')
    out[m[1]] = v
  }
  return out
}

function familyOf(token: string): DistroFamily | null {
  const t = token.toLowerCase()
  if (['debian', 'ubuntu', 'linuxmint', 'pop', 'elementary', 'raspbian', 'kali', 'zorin', 'neon', 'devuan', 'mx'].includes(t)) return 'apt'
  if (['fedora', 'rhel', 'centos', 'rocky', 'almalinux', 'nobara', 'ol', 'amzn'].includes(t)) return 'dnf'
  if (['arch', 'archlinux', 'manjaro', 'endeavouros', 'garuda', 'cachyos', 'artix'].includes(t)) return 'pacman'
  if (t === 'suse' || t === 'sles' || t.startsWith('opensuse')) return 'zypper'
  return null
}

/** Family from ID first, then each ID_LIKE entry (e.g. Linux Mint: ID=linuxmint ID_LIKE="ubuntu debian" → apt). */
export function detectDistro(osRelease: string | Record<string, string> | null | undefined): DistroInfo {
  const r = typeof osRelease === 'string' ? parseOsRelease(osRelease) : osRelease ?? {}
  const id = (r.ID ?? '').toLowerCase()
  const tokens = [id, ...(r.ID_LIKE ?? '').toLowerCase().split(/\s+/)].filter(Boolean)
  let family: DistroFamily = 'generic'
  for (const t of tokens) {
    const f = familyOf(t)
    if (f) {
      family = f
      break
    }
  }
  return { family, id: id || 'linux', name: r.PRETTY_NAME || r.NAME || id || 'Linux' }
}

/** The package-install command for a family (null for generic). */
export function installCommand(family: DistroFamily, packages: string[]): string | null {
  const p = packages.join(' ')
  switch (family) {
    case 'apt':
      return `sudo apt install ${p}`
    case 'dnf':
      return `sudo dnf install ${p}`
    case 'pacman':
      return `sudo pacman -S ${p}`
    case 'zypper':
      return `sudo zypper install ${p}`
    default:
      return null
  }
}
