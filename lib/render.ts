// `@theodo-group/epure/render`: headless (DOM-free) diagram rendering for
// Node, the editor's exact look.
//
//   const image = await svg(d2, layoutJson)   // icons inlined by default
//   const bytes = await png(d2, layoutJson)   // carries its own source
//   const pair  = source(bytes)               // { d2, layout } back out
//   const m     = await model(d2, layoutJson) // parse + route, no drawing
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

export { setLibavoidWasmPath }
export {
  svg,
  png,
  model,
  source,
  packagedIconsDir,
  type RenderOptions,
  type DiagramModel,
  type DiagramOptions,
} from '../server/render'
