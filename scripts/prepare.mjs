// Runs on `npm install` from a git checkout (including `npm i -g
// github:theodo-group/epure` and `npx github:...`). Builds the SPA + CLI so the
// `epure` bin works straight from the public repo, without waiting on a release.
// Published npm tarballs already ship the artifacts (built by `prepack`), so
// this is a no-op there. Skips when the artifact is already present (repeat local-dev installs stay fast) and when the build
// toolchain isn't available (e.g. a production `--omit=dev` install).

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// CI builds explicitly as its own step → skip the install-time build there.
if (process.env.EPURE_SKIP_PREPARE) process.exit(0)

// Already built — nothing to do (keeps `pnpm install` snappy in local dev).
if (existsSync(resolve(root, 'dist-server/epure.mjs'))) process.exit(0)

// No build toolchain (devDeps absent) → can't build; leave it to `prepack` /
// an explicit `npm run build:all`. Don't fail the install.
if (!existsSync(resolve(root, 'node_modules/vite'))) {
  console.warn('epure: skipping build in prepare (dev toolchain not installed)')
  process.exit(0)
}

console.log('epure: building SPA + CLI (one-time)…')
execSync('npm run build:all', { cwd: root, stdio: 'inherit' })
