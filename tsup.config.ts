// Library build (`pnpm build:lib`) — bundles the three public entry points
// under dist-lib/ with their .d.ts, first-party code inlined (the `@/` alias
// resolved away) and every npm dependency left external. The CLI bundle
// (scripts/build-server.mjs) and the SPA (vite) are separate, unchanged builds.

import { copyFile } from 'node:fs/promises'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    render: 'lib/render.ts',
    react: 'lib/react.ts',
    icons: 'lib/icons.ts',
    bridge: 'lib/bridge.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  outDir: 'dist-lib',
  // Share chunks so the ~1.3 MB icon catalog isn't inlined three times.
  splitting: true,
  dts: true,
  clean: true,
  // Same stub as scripts/build-server.mjs: `@/icons` reads Vite's BASE_URL at
  // load; outside the editor SPA the base is always the root.
  define: { 'import.meta.env': '{}' },
  onSuccess: async () => {
    // Ship libavoid's wasm next to render.js so the router works out of the box
    // (lib/render.ts looks for it beside itself).
    await copyFile('public/libavoid.wasm', 'dist-lib/libavoid.wasm')
  },
})
