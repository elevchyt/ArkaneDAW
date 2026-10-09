// Opening the export wizard. The dialog lives in its own small React root (created on first use) so no
// shared layout file needs to mount it.
import { createRoot } from 'react-dom/client'
import type { ExportFormat } from './core'
import { useExportWizard } from './store'
import { ExportWizard } from './ExportWizard'

let mounted = false
function ensureMounted(): void {
  if (mounted) return
  mounted = true
  const el = document.createElement('div')
  el.id = 'arkane-export-wizard'
  document.body.appendChild(el)
  createRoot(el).render(<ExportWizard />)
}

/** FILE › Export / Ctrl+R. `format` preselects the output format. */
export function openExportWizard(format?: ExportFormat): void {
  ensureMounted()
  const s = useExportWizard.getState()
  if (s.open && !format) return
  useExportWizard.setState({ open: true, preset: format ?? null, session: s.session + 1 })
}

export { closeExportWizard } from './store'
