import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { epureBridge } from './server/vite-plugin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // `epureBridge` is inert unless EPURE_FILE is set, so this is a no-op for a
  // plain `pnpm dev`; with `EPURE_FILE=fixtures/system.epr.d2 pnpm dev` it
  // serves the live bridge against that pair.
  plugins: [react(), epureBridge()],
  // Pin the dev port. Without this, Vite silently moves to 5174, 5175, … when
  // 5173 is busy — which orphans an already-open editor tab on the old port
  // (its bridge socket points nowhere, so a reload looks like lost work).
  // strictPort makes a busy port a loud startup error instead.
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: false,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.{test,spec}.{ts,tsx}',
      'server/**/*.{test,spec}.{ts,tsx}',
    ],
  },
})
