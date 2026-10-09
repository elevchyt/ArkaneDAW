import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { useProject } from './store/project'
import { useUI } from './store/ui'
import { defaultTemplate } from './store/templates'
import './windows/settings/boot' // recording, MIDI input, output device

// Start from the default template (FL opens "Basic with limiter").
const initial = defaultTemplate()
useProject.getState().load(initial, null)
useUI.getState().set({ currentPattern: initial.patterns[0].id, pianoRollChannel: initial.channels[0]?.id ?? null, selectedChannels: initial.channels[0] ? [initial.channels[0].id] : [] })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
