// Builds the app-level VST scenario with the renderer's own module graph (aliases, ?worker&url worklets).
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname, '../../../..')
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src/renderer/src') } },
  worker: { format: 'es' },
  logLevel: 'warn',
  build: { outDir: process.env.ARK_OUT, emptyOutDir: true, minify: false, target: 'esnext' }
})
