// Adopting libavoid's routes. libavoid is authoritative: an edge takes its
// routed polyline, which already avoids every node and blocking area, with the
// crossing penalty minimizing edge-edge crossings globally — none of which the
// synthetic builder reasons about. This module decides WHETHER a route is
// adopted (it must be orthogonal and honor pinned faces) and puts an adopted
// one back on the grid without sliding it into an obstacle or onto a route
// adopted before it.
//
// Pixel space; `gridSize` is the pixel pitch of the grid. A rejected route
// (undefined) falls through to the synthetic path, which is always orthogonal
// and perpendicular to its faces.

import type { RouteResult } from '@mr_mint/elkjs-libavoid'

import { type AreaObstacle, areaBlocksEdge } from './areaGeometry'
import type { EdgeMeta } from './faces'
import {
  cleanPolyline,
  inflateRect,
  isOrthogonalPath,
  type Pt,
  type Rect,
  sideFromSegment,
} from './geometry'
import { type Leg, legOf, legRules, legsOf } from './legs'
import { polyOf, shapeBuffer } from './libavoidGraph'

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
// kept — grid tidiness never trumps obstacle avoidance.
//
// Rounding must also never merge two routes: libavoid often packs parallel
// legs closer than a grid cell, and rounding both to the nearest line would
// stack them. When an already-adopted route (`taken`) runs along a leg's
// nearest grid line, the leg takes the nearest free neighbour line instead.
// A neighbour line is up to 1.5 cells from libavoid's coordinate, so it must
// also keep libavoid's clearance (`shapeBuffer`) from every node (the edge's
// own end nodes included) and blocking shape; when neither neighbour line
// does, the leg keeps libavoid's coordinate. Routes that fall back to the
// synthetic path are not in `taken`: they dodge the adopted routes later
// (resolveSegmentOverlaps).

/** What the grid snap of one edge's route needs to know. */
export interface SnapContext {
  gridSize: number
  nodes: Record<string, Rect>
  /** Area rects and title chips the snap must not slide the route onto. */
  obstacles: AreaObstacle[]
  source: string
  target: string
  /** Routes adopted so far, which this one must not be rounded onto. */
  taken?: Pt[][]
}

/**
 * The polyline `poly` with its interior legs on grid lines. Exported for tests.
 * Returns `poly` unchanged (cleaned) when it has no interior leg, or when the
 * snapped route would cross a foreign node or blocking shape.
 */
export const snapPolylineToGrid = (poly: Pt[], ctx: SnapContext): Pt[] => {
  const { gridSize, nodes, obstacles, source, target } = ctx
  if (poly.length < 4) return cleanPolyline(poly) // straight or single-corner: nothing interior to move
  const rules = legRules(gridSize)
  const takenLegs = (ctx.taken ?? []).flatMap(legsOf)
  const isTaken = (leg: Leg): boolean => takenLegs.some((t) => rules.shareRun(leg, t))
  const clearance = shapeBuffer(gridSize)
  const blocking = obstacles.filter((o) => areaBlocksEdge(o, source, target))
  // Only interior legs move, so the edge's own end nodes count too: a leg
  // moved toward them must not run along or through them.
  const shapes = [...Object.values(nodes), ...blocking.map((o) => o.rect)].map((r) =>
    inflateRect(r, clearance),
  )
  const keepsClearance = (leg: Leg): boolean => {
    const [a, b] =
      leg.axis === 'V'
        ? [
            { x: leg.coord, y: leg.lo },
            { x: leg.coord, y: leg.hi },
          ]
        : [
            { x: leg.lo, y: leg.coord },
            { x: leg.hi, y: leg.coord },
          ]
    return !shapes.some((r) => segCrossesRect(a, b, r))
  }
  // The grid line `leg` moves to: its nearest line, or, only when that line is
  // taken, the nearest free neighbour line that keeps libavoid's clearance.
  // The line must stay strictly between the far ends of the leg's neighbour
  // legs (`bounds`), or a neighbour leg would collapse or flip; otherwise the
  // leg keeps its coordinate.
  const gridLine = (leg: Leg, bounds: { min: number; max: number }): number => {
    const fits = (c: number) => c > bounds.min && c < bounds.max
    const at = (coord: number): Leg => ({ ...leg, coord })
    const nearest = snap(leg.coord, gridSize)
    if (!fits(nearest)) return leg.coord
    if (!isTaken(at(nearest))) return nearest
    const neighbours = [nearest - gridSize, nearest + gridSize].sort(
      (u, v) => Math.abs(u - leg.coord) - Math.abs(v - leg.coord),
    )
    const free = neighbours.find((c) => fits(c) && !isTaken(at(c)) && keepsClearance(at(c)))
    return free ?? leg.coord
  }
  const out = poly.map((p) => ({ x: p.x, y: p.y }))
  for (let i = 1; i < out.length - 2; i += 1) {
    const a = out[i]!
    const b = out[i + 1]!
    const leg = legOf(a, b)
    if (!leg) continue
    // Snap a segment's shared coordinate ONLY when the snapped value stays
    // strictly between its two neighbour legs' far ends. Otherwise the snap would
    // collapse (or flip) an adjacent leg — e.g. pulling the middle leg of a Z
    // onto the target face turns a perpendicular arrival into a sideways one.
    const before = out[i - 1]!
    const after = out[i + 2]!
    const [u, v] = leg.axis === 'V' ? [before.x, after.x] : [before.y, after.y]
    const coord = gridLine(leg, { min: Math.min(u, v), max: Math.max(u, v) })
    if (leg.axis === 'V') {
      a.x = coord
      b.x = coord
    } else {
      a.y = coord
      b.y = coord
    }
  }
  const snapped = cleanPolyline(out)
  if (pathCrossesForeignNode(snapped, nodes, source, target, obstacles)) {
    return cleanPolyline(poly)
  }
  return snapped
}

/** What adopting one edge's libavoid route needs to know. */
export interface AdoptContext {
  meta: EdgeMeta
  gridSize: number
  nodes: Record<string, Rect>
  /** Area rects AND title chips: a half-cell snap could otherwise nudge a
   *  segment off its buffer clearance into a title. */
  obstacles: AreaObstacle[]
  /** Routes adopted so far, which the snap must not round this one onto. */
  taken?: Pt[][]
}

/**
 * The polyline to draw for an edge libavoid routed, or undefined to fall back
 * to the synthetic path.
 */
export const adoptLibavoidRoute = (
  result: RouteResult | undefined,
  ctx: AdoptContext,
): Pt[] | undefined => {
  const { meta } = ctx
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
  return snapPolylineToGrid(poly, {
    gridSize: ctx.gridSize,
    nodes: ctx.nodes,
    obstacles: ctx.obstacles,
    source: meta.source,
    target: meta.target,
    taken: ctx.taken,
  })
}
