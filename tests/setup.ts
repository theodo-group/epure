// Vitest setup: point libavoid at the real wasm on disk so `route()` does
// actual orthogonal routing in tests (matching production) instead of falling
// back to stub routes — which also silences the wasm-load unhandled rejections
// the fallback path emits under jsdom.

import { resolve } from 'node:path'

import { setLibavoidWasmPath } from '@/layout/elk'

setLibavoidWasmPath(resolve(process.cwd(), 'public/libavoid.wasm'))
