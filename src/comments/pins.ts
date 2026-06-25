// Resolve a comment's on-canvas anchor (in pixels) from the routed diagram,
// applying the orphan policy: anchor to the referenced element if it still
// exists, else fall back to the stored {x,y} (grid units) and flag it missing.

import type { RoutedDiagram } from '@/layout/types'

import type { EprComment } from './types'

export interface PinAnchor {
  px: number
  py: number
  /** False when `target.ref` was set but no longer resolves (target-missing). */
  resolved: boolean
}

export const resolvePin = (comment: EprComment, routed: RoutedDiagram): PinAnchor => {
  const grid = routed.gridSize || 40
  const fallback = (resolved: boolean): PinAnchor => ({
    px: comment.target.x * grid,
    py: comment.target.y * grid,
    resolved,
  })

  const ref = comment.target.ref
  if (!ref) return fallback(true) // free-floating: always "resolved"

  const node = routed.nodes.find((n) => n.id === ref)
  if (node) return { px: node.x + node.w, py: node.y, resolved: true }

  const area = routed.areas.find((a) => a.id === ref)
  if (area) return { px: area.x + area.w, py: area.y, resolved: true }

  // Edge ref is the key `src->tgt`; routed edge ids are `src->tgt#i`.
  const edge = routed.edges.find((e) => e.id.split('#')[0] === ref)
  if (edge) {
    const at = edge.labelAnchor ?? edge.points[Math.floor(edge.points.length / 2)]
    if (at) return { px: at.x, py: at.y, resolved: true }
  }

  return fallback(false) // ref set but unresolved → target missing
}
