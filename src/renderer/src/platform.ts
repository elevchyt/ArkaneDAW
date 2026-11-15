// Access to the Electron host API exposed by the preload script. `host` is null when the
// renderer runs in a plain browser (vite.web.config.ts) so UI work can happen without Electron.
import type { ArkaneHost } from '../../preload/index'

export const host: ArkaneHost | null = (globalThis as unknown as { arkaneHost?: ArkaneHost }).arkaneHost ?? null

export const isElectron = host !== null

/**
 * Last segment of a path, for menu labels. Electron's host helper follows the OS separator
 * convention (backslashes on Windows); the browser fallback covers both separators.
 */
export function basename(path: string): string {
  return host ? host.path.basename(path) : (path.split(/[\\/]/).pop() ?? path)
}
