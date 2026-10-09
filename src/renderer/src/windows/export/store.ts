// Open/close state of the export wizard.
import { create } from 'zustand'
import type { ExportFormat } from './core'

interface WizardState {
  open: boolean
  /** Format to preselect when opened from FILE › Export › <format>. */
  preset: ExportFormat | null
  /** Bumped on every open so the dialog re-initialises. */
  session: number
}

export const useExportWizard = create<WizardState>(() => ({ open: false, preset: null, session: 0 }))

export function closeExportWizard(): void {
  useExportWizard.setState({ open: false })
}
