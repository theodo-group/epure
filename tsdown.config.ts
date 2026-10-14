// Node builds (`pnpm build:node`). The SPA is Vite's (`pnpm build`); these are
// the two artifacts that run outside the browser, with first-party code inlined
// (the `@/` alias resolved away) and every npm dependency left external:
//
// - dist-lib/: the four public entry points (`@theodo-group/epure/render`,
//   `/react`, `/icons`, `/bridge`) with their .d.ts, sharing chunks so the
//   ~1.3 MB icon catalog isn't inlined four times.
// - dist-server/epure.mjs: the `epure` CLI + standalone server, one file.
//
// Both ship libavoid's wasm next to them so routing works out of the box
// (lib/render.ts and the CLI look for it beside themselves).

import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

// The reused `@/icons` module reads Vite's `import.meta.env.BASE_URL` at load to
// build browser asset URLs. Outside the editor SPA the base is always the root,
// and unstubbed it would be `undefined` and throw at import.
const define = { 'import.meta.env': '{}' }

export default defineConfig([
  {
    entry: {
      render: 'lib/render.ts',
      react: 'lib/react.ts',
      icons: 'lib/icons.ts',
      bridge: 'lib/bridge.ts',
    },
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    outDir: 'dist-lib',
    // `.js` / `.d.ts`, as package.json `exports` names them.
    fixedExtension: false,
    dts: true,
    define,
    copy: { from: 'public/libavoid.wasm', to: 'dist-lib' },
  },
  {
    entry: { epure: 'bin/epure.ts' },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outDir: 'dist-server',
    dts: false,
    define: { ...define, __EPURE_VERSION__: JSON.stringify(version) },
    // Shebang so npm marks the bin executable.
    banner: { js: '#!/usr/bin/env node' },
    copy: { from: 'public/libavoid.wasm', to: 'dist-server' },
  },
])
