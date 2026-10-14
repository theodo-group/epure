// Adopting libavoid's routes. libavoid is authoritative: an edge takes its
// routed polyline, which already avoids every node and blocking area, with the
// crossing penalty minimizing edge-edge crossings globally — none of which the
// synthetic builder reasons about. This module decides WHETHER a route is
// adopted (it must be orthogonal and honor pinned faces) and puts an adopted
// one back on the grid without sliding it into an obstacle.
//
// Pixel space; `gridSize` is the pixel pitch of the grid. A rejected route
// (undefined) falls through to the synthetic path, which is always orthogonal
// and perpendicular to its faces.

import type { RouteResult } from '@mr_mint/elkjs-libavoid'

import { type AreaObstacle, areaBlocksEdge } from './areaGeometry'
import type { EdgeMeta } from './faces'
import { cleanPolyline, isOrthogonalPath, type Pt, type Rect, sideFromSegment } from './geometry'
import { polyOf } from './libavoidGraph'

export const snap = (v: number, gridSize: number) => Math.round(v / gridSize) * gridSize

// Does an axis-aligned segment pass through a rect's interior? (A small inset
// means an edge merely grazing a node's border doesn't count as a crossing.)
const CROSS_INSET = 1.5
const segCrossesRect = (a: Pt, b: Pt, r: Rect): boolean => {
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
const pathCrossesForeignNode = (
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

// Snap a libavoid polyline back onto the grid while preserving its shape. Only
// INTERIOR segments are snapped — the first and last legs touch a node face at
// the distributed anchor, which must stay put (so the arrowhead lands where the
// port is). For each interior segment we round its single shared (perpendicular)
// coordinate to the grid; because adjacent segments alternate H/V and share a
// corner, this keeps the whole polyline orthogonal. If snapping pushes the route
// into an obstacle it didn't touch before, the original (unsnapped) route is
// kept — grid tidiness never trumps obstacle avoidance. Exported for tests.
export const snapPolylineToGrid = (
  poly: Pt[],
  gridSize: number,
  nodes: Record<string, Rect>,
  areaObstacles: AreaObstacle[],
  srcId: string,
  tgtId: string,
): Pt[] => {
  if (poly.length < 4) return cleanPolyline(poly) // straight or single-corner: nothing interior to move
  const out = poly.map((p) => ({ x: p.x, y: p.y }))
  for (let i = 1; i < out.length - 2; i += 1) {
    const a = out[i]!
    const b = out[i + 1]!
    // Snap a segment's shared coordinate ONLY when the snapped value stays
    // strictly between its two neighbour legs' far ends. Otherwise the snap would
    // collapse (or flip) an adjacent leg — e.g. pulling the middle leg of a Z
    // onto the target face turns a perpendicular arrival into a sideways one.
    const before = out[i - 1]!
    const after = out[i + 2]!
    if (Math.abs(a.x - b.x) < 0.5) {
      const sx = snap(a.x, gridSize) // vertical leg → snap shared x
      const lo = Math.min(before.x, after.x)
      const hi = Math.max(before.x, after.x)
      if (sx > lo && sx < hi) {
        a.x = sx
        b.x = sx
      }
    } else if (Math.abs(a.y - b.y) < 0.5) {
      const sy = snap(a.y, gridSize) // horizontal leg → snap shared y
      const lo = Math.min(before.y, after.y)
      const hi = Math.max(before.y, after.y)
      if (sy > lo && sy < hi) {
        a.y = sy
        b.y = sy
      }
    }
  }
  const snapped = cleanPolyline(out)
  if (pathCrossesForeignNode(snapped, nodes, srcId, tgtId, areaObstacles)) {
    return cleanPolyline(poly)
  }
  return snapped
}

/**
 * The polyline to draw for an edge libavoid routed, or undefined to fall back
 * to the synthetic path. `obstacles` are the rects the grid snap must not slide
 * the route onto — area rects AND title chips (a half-cell snap could otherwise
 * nudge a segment off its buffer clearance into a title).
 */
export const adoptLibavoidRoute = (
  result: RouteResult | undefined,
  meta: EdgeMeta,
  gridSize: number,
  nodes: Record<string, Rect>,
  obstacles: AreaObstacle[],
): Pt[] | undefined => {
  if (!result) return undefined
  const poly = polyOf(result)
  if (poly.length < 2) return undefined
  // Never adopt a non-orthogonal route. libavoid can emit a degenerate 2-point
  // diagonal when it fails to route a connector (e.g. a port pinned to a face
  // it can't leave — which a stale, mismatched face guess can cause). Reject
  // it and fall through to the synthetic builder, which is always orthogonal.
  if (!isOrthogonalPath(poly)) return undefined
  // Pin safety: the port is a directional pin, so libavoid normally leaves via
  // the pinned face. If it couldn't, its face disagrees — skip adoption and
  // let the synthetic path honor the pin (perpendicular to that face).
  const libSourceSide = sideFromSegment(poly[0]!, poly[1]!)
  const libTargetSide = sideFromSegment(poly[poly.length - 1]!, poly[poly.length - 2]!)
  if (
    (meta.explicitSource && libSourceSide !== meta.sourceSide) ||
    (meta.explicitTarget && libTargetSide !== meta.targetSide)
  ) {
    return undefined
  }
  return snapPolylineToGrid(poly, gridSize, nodes, obstacles, meta.source, meta.target)
}
