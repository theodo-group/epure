// Hit tests of a route against the shapes it must avoid: nodes and the areas
// that block an edge. Shared by the grid snap and the separation pass.
//
// Pixel space.

import { type AreaObstacle, areaBlocksEdge } from './areaGeometry'
import { CROSS_INSET } from './constants'
import type { Pt, Rect } from './geometry'

// Does an axis-aligned segment pass through a rect's interior? (A small inset
// means an edge merely grazing a node's border doesn't count as a crossing.)
export const segCrossesRect = (a: Pt, b: Pt, r: Rect): boolean => {
  const x0 = r.x + CROSS_INSET
  const x1 = r.x + r.w - CROSS_INSET
  const y0 = r.y + CROSS_INSET
  const y1 = r.y + r.h - CROSS_INSET
  if (x1 <= x0 || y1 <= y0) return false
  if (a.y === b.y) {
    if (a.y <= y0 || a.y >= y1) return false
    return Math.min(a.x, b.x) < x1 && Math.max(a.x, b.x) > x0
  }
  if (a.x === b.x) {
    if (a.x <= x0 || a.x >= x1) return false
    return Math.min(a.y, b.y) < y1 && Math.max(a.y, b.y) > y0
  }
  return false // diagonal: our synthetic paths are always orthogonal
}

// True when any segment of the path passes through a node other than the edge's
// own endpoints, OR through an area that blocks this edge (an area is blocking
// only when neither endpoint is one of its members).
export const pathCrossesForeignNode = (
  pts: Pt[],
  nodes: Record<string, Rect>,
  srcId: string,
  tgtId: string,
  areaObstacles: AreaObstacle[] = [],
): boolean => {
  const blocking = areaObstacles.filter((a) => areaBlocksEdge(a, srcId, tgtId))
  for (let i = 1; i < pts.length; i += 1) {
    for (const [id, r] of Object.entries(nodes)) {
      if (id === srcId || id === tgtId) continue
      if (segCrossesRect(pts[i - 1]!, pts[i]!, r)) return true
    }
    for (const a of blocking) {
      if (segCrossesRect(pts[i - 1]!, pts[i]!, a.rect)) return true
    }
  }
  return false
}
