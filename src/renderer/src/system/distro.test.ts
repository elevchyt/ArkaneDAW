import { describe, expect, it } from 'vitest'
import { detectDistro, installCommand, parseOsRelease } from './distro'

const MINT = `NAME="Linux Mint"
VERSION="22.3 (Zena)"
ID=linuxmint
ID_LIKE="ubuntu debian"
PRETTY_NAME="Linux Mint 22.3"
UBUNTU_CODENAME=noble`
const FEDORA = `NAME="Fedora Linux"
ID=fedora
VERSION_ID=41
PRETTY_NAME="Fedora Linux 41 (Workstation Edition)"`
const ARCH = `NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling`
const MANJARO = `NAME="Manjaro Linux"
ID=manjaro
ID_LIKE=arch
PRETTY_NAME="Manjaro Linux"`
const TUMBLEWEED = `NAME="openSUSE Tumbleweed"
ID="opensuse-tumbleweed"
ID_LIKE="opensuse suse"
PRETTY_NAME="openSUSE Tumbleweed"`
const ROCKY = `NAME="Rocky Linux"
ID="rocky"
ID_LIKE="rhel centos fedora"
PRETTY_NAME="Rocky Linux 9.4 (Blue Onyx)"`
const VOID = `NAME="Void"
ID="void"
PRETTY_NAME="Void Linux"`

describe('os-release', () => {
  it('parses quoted and unquoted values, ignores comments', () => {
    expect(parseOsRelease(`# comment\nID=debian\nNAME="Debian GNU/Linux"\nX='a \\"b\\"'\nbad line`)).toEqual({ ID: 'debian', NAME: 'Debian GNU/Linux', X: 'a "b"' })
  })

  it('maps distributions to package-manager families via ID / ID_LIKE', () => {
    expect(detectDistro(MINT)).toEqual({ family: 'apt', id: 'linuxmint', name: 'Linux Mint 22.3' })
    expect(detectDistro('ID=ubuntu\nID_LIKE=debian').family).toBe('apt')
    expect(detectDistro('ID=pop\nID_LIKE="ubuntu debian"').family).toBe('apt')
    expect(detectDistro(FEDORA).family).toBe('dnf')
    expect(detectDistro(ROCKY).family).toBe('dnf')
    expect(detectDistro(ARCH).family).toBe('pacman')
    expect(detectDistro(MANJARO).family).toBe('pacman')
    expect(detectDistro('ID=endeavouros\nID_LIKE=arch').family).toBe('pacman')
    expect(detectDistro(TUMBLEWEED).family).toBe('zypper')
    expect(detectDistro('ID="opensuse-leap"').family).toBe('zypper')
    expect(detectDistro(VOID)).toEqual({ family: 'generic', id: 'void', name: 'Void Linux' })
    expect(detectDistro(null)).toEqual({ family: 'generic', id: 'linux', name: 'Linux' })
  })

  it('formats install commands per family', () => {
    expect(installCommand('apt', ['ffmpeg'])).toBe('sudo apt install ffmpeg')
    expect(installCommand('dnf', ['ffmpeg-free'])).toBe('sudo dnf install ffmpeg-free')
    expect(installCommand('pacman', ['ffmpeg'])).toBe('sudo pacman -S ffmpeg')
    expect(installCommand('zypper', ['a', 'b'])).toBe('sudo zypper install a b')
    expect(installCommand('generic', ['ffmpeg'])).toBeNull()
  })
})
