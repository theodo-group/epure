// Bundle the CLI + standalone server into a single runnable ESM file under
// dist-server/. esbuild resolves the `@/` alias and inlines the first-party
// TypeScript we reuse (parser, layout schema, canonical serializer) while
// keeping node deps (chokidar, ws, sirv) external — they're installed
// alongside. The SPA bundle is built separately by `vite build`, so these
// server-only deps never enter dist/.

import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

await build({
  entryPoints: [resolve(root, 'bin/epure.ts')],
  outfile: resolve(root, 'dist-server/epure.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // The PNG export SSR-renders the React renderer; compile its JSX.
  jsx: 'automatic',
  // Keep all installed packages external; bundle only our own source.
  packages: 'external',
  alias: { '@': resolve(root, 'src') },
  define: {
    __EPURE_VERSION__: JSON.stringify(pkg.version),
    // The reused `@/icons` module reads Vite's `import.meta.env.BASE_URL` at
    // load to build browser asset URLs — irrelevant server-side, but it would
    // be `undefined` under esbuild and throw at import. Stub it to `{}`.
    'import.meta.env': '{}',
  },
  banner: {
    // Shebang so npm marks the bin executable; createRequire enables any CJS
    // interop the external node deps need under ESM.
    js:
      "#!/usr/bin/env node\n" +
      "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
})

// Ship libavoid's wasm alongside the CLI so `epure export` does real
// server-side routing (the headless render points init() at this file).
mkdirSync(resolve(root, 'dist-server'), { recursive: true })
copyFileSync(
  resolve(root, 'public/libavoid.wasm'),
  resolve(root, 'dist-server/libavoid.wasm'),
)
