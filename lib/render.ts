// `@theodo-group/epure/render` — headless (DOM-free) diagram rendering for
// Node. Re-exports the same render pipeline the CLI's `epure export` uses:
// pair text in → fit-to-content SVG string (or PNG bytes) out.
//
// On import, the orthogonal router is pointed at the libavoid wasm shipped
// with the package (dist-lib/libavoid.wasm) so consumers get real routing
// without any setup; `setLibavoidWasmPath` is re-exported for overrides.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { setLibavoidWasmPath } from '../src/layout/elk'

const HERE = dirname(fileURLToPath(import.meta.url))

// Published: dist-lib/libavoid.wasm (copied by tsup). From source: public/.
const WASM_CANDIDATES = [join(HERE, 'libavoid.wasm'), join(HERE, '..', 'public', 'libavoid.wasm')]
const wasm = WASM_CANDIDATES.find(existsSync)
if (wasm) setLibavoidWasmPath(wasm)

/**
 * Absolute path to the icon images shipped with the package, for use as
 * `RenderOptions.iconsDir` (icons are then base64-inlined into the SVG).
 */
export const packagedIconsDir = (): string => {
  // Published: dist/icons (the SPA build ships the catalog). From source: public/.
  const candidates = [join(HERE, '..', 'dist', 'icons'), join(HERE, '..', 'public', 'icons')]
  return candidates.find(existsSync) ?? candidates[0]!
}

export { setLibavoidWasmPath }
export * from '../server/render'
