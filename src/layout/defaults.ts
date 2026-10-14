// The defaults every producer of a layout agrees on: the editor, the CLI, the
// headless render, Open and the bridge all start from these, and the docs/skill
// describe the same numbers.

import type { LayoutSidecar } from './types'

/** Grid pitch, in pixels, of a layout that doesn't say otherwise. */
export const DEFAULT_GRID_SIZE = 40

/** Size, in grid units, of a node the layout doesn't hold yet — both when it is
 *  auto-placed and when a first drag materialises its entry. */
export const DEFAULT_NODE_W = 4
export const DEFAULT_NODE_H = 2

/** The layout of a diagram nobody has placed: every node gets auto-placed. */
export const emptyLayout = (): LayoutSidecar => ({
  gridSize: DEFAULT_GRID_SIZE,
  nodes: {},
  edges: {},
})
