// Side-effect module imported once from main.tsx: wires note recording (count-in, wait for input),
// audio recording from armed mixer tracks, MIDI input and the saved output device.
import { initNoteRecording } from '@/audio/recording'
import { initAudioRecording } from '@/audio/audio-recording'
import { initMidi } from '@/audio/midi'
import { host } from '@/platform'
import { applyOutputDevice } from './devices'
import { getAudioSettings, useAudioSettings } from './settings-store'
import { initAudio } from '@/audio/transport'

function boot(): void {
  try {
    initNoteRecording()
    initAudioRecording()
  } catch (e) {
    console.warn('recording boot failed', e)
  }
  // Electron grants MIDI silently; in a plain browser only connect when already permitted
  // (otherwise the MIDI tab of the settings window asks).
  if (host) void initMidi().catch((e) => console.warn('MIDI init failed', e))
  else
    void navigator.permissions
      ?.query({ name: 'midi' as PermissionName })
      .then((st) => {
        if (st.state === 'granted') void initMidi()
      })
      .catch(() => undefined)

  // Output device: apply when audio is up (Electron boots audio immediately, browsers on first gesture).
  const apply = () => {
    const id = getAudioSettings().outputDeviceId
    if (id) void initAudio().then(() => applyOutputDevice(id))
  }
  if (host) apply()
  else {
    window.addEventListener('pointerdown', apply, { once: true })
    window.addEventListener('keydown', apply, { once: true })
  }
  useAudioSettings.subscribe((s, prev) => {
    if (s.outputDeviceId !== prev.outputDeviceId) void initAudio().then(() => applyOutputDevice(s.outputDeviceId))
  })
}

boot()
