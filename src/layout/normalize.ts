import type { Diagram } from '@/parser/ast'

import type { LayoutNode, LayoutSidecar } from './types'

// Canonical default size for a node that has no layout entry yet. The store
// uses these same numbers when a drag first materialises a node
// (`moveNode` in diagramStore.ts), so SKILL/docs and this fallback all agree.
export const DEFAULT_NODE_W = 4
export const DEFAULT_NODE_H = 2

// Auto-placement geometry, all in grid units (never pixels):
//  - unplaced nodes start two grid units below the placed bounding box,
//  - flow left-to-right at a fixed column stride, wrapping after a few columns.
const START_CX = 4
const START_CY = 2
const COL_STRIDE = 6
const ROW_STRIDE = 4
const WRAP_COLS = 6

/**
 * Return a layout sidecar in which **every** diagram node has a `nodes[id]`
 * entry, synthesizing deterministic placements (in grid units) for any node
 * that is present in the `.d2` but missing from the layout.
 *
 * The result is used purely as the input to `route()` — callers MUST NOT write
 * it back into the store. Keeping synthesized positions out of `store.layout`
 * means the outbound persist path has nothing extra to send, so auto-placed
 * nodes can never bounce back to disk; a position is persisted only when the
 * user actually drags the node (a real gesture).
 *
 * Placement is a pure function of (diagram node order, existing layout), so the
 * same `.d2` always yields the same canvas.
 */
export function normalizeForRoute(
  diagram: Diagram,
  layout: LayoutSidecar,
): LayoutSidecar {
  const missing = diagram.nodes.filter((n) => !layout.nodes[n.id])
  if (missing.length === 0) return layout

  const placed = Object.values(layout.nodes)
  // Start two grid units below the lowest placed node so synthesized nodes
  // never overlap the existing diagram. With nothing placed, start near the
  // top-left at the canonical origin.
  const startCy =
    placed.length === 0
      ? START_CY
      : Math.ceil(Math.max(...placed.map((n) => n.cy + n.h / 2))) + 2

  const nodes: Record<string, LayoutNode> = { ...layout.nodes }
  missing.forEach((node, i) => {
    const col = i % WRAP_COLS
    const row = Math.floor(i / WRAP_COLS)
    nodes[node.id] = {
      cx: START_CX + col * COL_STRIDE,
      cy: startCy + row * ROW_STRIDE,
      w: DEFAULT_NODE_W,
      h: DEFAULT_NODE_H,
    }
  })

  return { ...layout, nodes }
}
