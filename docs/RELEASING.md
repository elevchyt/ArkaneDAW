# Releasing ArkaneDAW

Releases live at <https://github.com/elevchyt/ArkaneDAW/releases>. The in-app updater checks
`releases/latest` on startup (and every 6 h), prompts the user, shows an "Update available" pill,
and for AppImage installs downloads the new `.AppImage`, verifies it against `SHA256SUMS`, swaps it
in place and restarts. Windows users are sent to the release page.

## App release (every update)

```bash
scripts/release/release.sh 0.2.0 notes.md   # notes optional (otherwise GitHub generates them)
```

The script: bumps `package.json` version → typecheck + tests → `npm run build:native` →
`npm run dist` (AppImage + NSIS `.exe`, Wine needed for the uninstaller; a portable Wine in
`.tools/wine` is used if system Wine is missing) → `dist/SHA256SUMS` → commit "Release vX.Y.Z",
annotated tag `vX.Y.Z`, push → `gh release create vX.Y.Z` with the AppImage, the exe and SHA256SUMS.

Rules:
- Tags are `vMAJOR.MINOR.PATCH` (semver; pre-releases like `v0.3.0-beta.1` are published with
  `--prerelease` and are only offered to users already on a pre-release).
- Asset names must stay `ArkaneDAW-<version>-x86_64.AppImage`, `ArkaneDAW-<version>-x64.exe` and
  `SHA256SUMS` — the updater matches on them.
- Never re-use or move a published tag; ship a new patch version instead.

## Content packs (only when sample libraries change)

Concerto and Studio Drums samples are not in the app. They're tar archives attached to the
`packs-v1` release and downloaded on demand from inside the app.

```bash
npm run packs                                   # builds dist-packs/<pack>-<version>.tar + .json manifests
gh release upload packs-v1 dist-packs/* --repo elevchyt/ArkaneDAW --clobber
```

Bump the pack version in the packs registry when its contents change so installed copies update.
