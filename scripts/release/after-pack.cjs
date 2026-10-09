// electron-builder afterPack hook: on Windows targets, embed the app icon and version info into the
// exe with resedit (pure JS), so we don't need Wine/rcedit when building the installer on Linux.
const { join } = require('node:path')
const fs = require('node:fs')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const ResEdit = await import('resedit')
  const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit.default ?? ResEdit
  const name = context.packager.appInfo.productFilename
  const exePath = join(context.appOutDir, `${name}.exe`)
  const version = context.packager.appInfo.version
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const res = NtExecutableResource.from(exe)

  const ico = Data.IconFile.from(fs.readFileSync(join(context.packager.projectDir, 'build', 'icon.ico')))
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, ico.icons.map((i) => i.data))

  const [vi] = Resource.VersionInfo.fromEntries(res.entries)
  const [maj, min, pat] = version.split('.').map((x) => parseInt(x, 10) || 0)
  vi.setFileVersion(maj, min, pat, 0, 1033)
  vi.setProductVersion(maj, min, pat, 0, 1033)
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: 'ArkaneDAW',
    FileDescription: 'ArkaneDAW',
    CompanyName: 'elevchyt',
    LegalCopyright: `© ${new Date().getFullYear()} elevchyt`,
    OriginalFilename: `${name}.exe`,
    InternalName: name
  })
  vi.outputToResourceEntries(res.entries)
  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`  • embedded icon + version ${version} into ${name}.exe`)
}
