// CROSS-GROUP SEPARATION — libavoid nudges parallel runs apart only among the
// edges of ONE call, and routeWithAnchors makes one call per blocking-area
// group (libavoidGraph.ts). Two edges from different groups therefore never
// see each other: when both take the same free channel (the gap between two
// areas, typically), libavoid drops them on the same coordinate and they draw
// as one line. This pass finds such shared runs on the adopted polylines and
// slides one leg sideways to a clear lane. It also pulls crossings off
// corners, since a run turned into a crossing often lands right next to one.
//
// A move is kept only when it strictly lowers the moved edge's cost and adds
// no shared run: with each other edge, the moved one shares at most as many
// runs after the move as before. A shared run costs RUN_COST, a
// crossing CROSS_COST, a crossing within a grid cell of a corner
// TIGHT_CROSS_COST (its gap reads as a broken stub): a run may turn into a
// crossing (two edges that must cross read far better crossing than merged),
// preferably away from corners. Runs and crossings are pairwise, so the
// diagram's total cost drops with every move and the pass converges;
// MAX_SEPARATION_ROUNDS stops it early on a dense diagram and leaves the
// remaining defects.
//
// A slid leg keeps its neighbour legs pointing the same way. Every segment the
// slide changes keeps libavoid's clearance (`clearance`) from every foreign
// node, blocking area and title chip, and from the edge's own end nodes: an
// end leg is exempt only from the node its port is on. A slide never shortens
// an end leg below that clearance (or below its own length when it was
// already shorter), so arrowheads keep room.
//
// A first or last leg slides by moving its port along the node face (two
// nodes with aligned centres put their ports on one line); at equal cost an
// interior leg is moved instead. One slide moves a leg by up to three cells
// (the largest of SLIDE_STEPS_IN_CELLS). When no single slide lowers the cost
// of an edge that shares a run, pairs of slides on it are tried, in the first
// round only: later rounds repeated the same failed searches and took most of
// the pass's time on dense diagrams. A pair, or a later round, can move a leg
// further than three cells.
//
// Edges that fall back to the synthetic path are not in `polys`, so this pass
// does not see them; they dodge the adopted routes later
// (resolveSegmentOverlaps).
//
// Pixel space; `gridSize` is the grid pitch in px.

import type { AreaObstacle } from './areaGeometry'
import {
  CROSS_COST,
  CROSSING_MARGIN,
  MAX_SEPARATION_ROUNDS,
  PORT_SLIDE_PENALTY_IN_CELLS,
  RUN_COST,
  SLIDE_STEPS_IN_CELLS,
  TIGHT_CROSS_COST,
} from './constants'
import type { EdgeMeta } from './faces'
import { cleanPolyline, faceRange, inflateRect, type Pt, type Rect } from './geometry'
import { type Leg, type LegRules, legOf, legRules, legsOf } from './legs'
import { pathCrossesForeignNode, segCrossesRect } from './obstacles'
import type { Side } from './types'

/** What the separation pass works on. `polys` is updated IN PLACE. */
export interface SeparationScene {
  /** Edge id → adopted polyline. */
  polys: Map<string, Pt[]>
  edgeMeta: Map<string, EdgeMeta>
  nodes: Record<string, Rect>
  /** Area rects and title chips. */
  obstacles: AreaObstacle[]
  gridSize: number
  /** Distance (px) a slid leg keeps from nodes, areas and title chips. */
  clearance: number
}

/** A slide: leg `index` of a polyline moved to the fixed coordinate `coord`. */
interface Slide {
  index: number
  coord: number
}

/**
 * The polyline with the slide applied, or null when a neighbour leg would
 * collapse or flip direction. An end leg has no neighbour on its node side:
 * sliding it moves the port along the face instead.
 */
const applySlide = (pts: Pt[], slide: Slide): Pt[] | null => {
  const { index, coord } = slide
  const a = pts[index]!
  const b = pts[index + 1]!
  const vertical = legOf(a, b)?.axis === 'V'
  const along = (p: Pt) => (vertical ? p.x : p.y)
  const keepsDirection = (neighbour: Pt | undefined, old: number) =>
    !neighbour ||
    (Math.sign(coord - along(neighbour)) === Math.sign(old - along(neighbour)) &&
      Math.abs(coord - along(neighbour)) > CROSSING_MARGIN)
  if (!keepsDirection(pts[index - 1], along(a)) || !keepsDirection(pts[index + 2], along(b)))
    return null
  const out = pts.map((p) => ({ ...p }))
  if (vertical) {
    out[index]!.x = coord
    out[index + 1]!.x = coord
  } else {
    out[index]!.y = coord
    out[index + 1]!.y = coord
  }
  return out
}

/** True when a port on `side` of `node` can sit at `coord` along that face:
 *  inside the face's usable range, clear of the node's corners. */
const portFits = (node: Rect | undefined, port: { side: Side; coord: number }): boolean => {
  if (!node) return false
  const [lo, hi] = faceRange(node, port.side)
  return port.coord >= lo && port.coord <= hi
}

/** The length (px) of the segment from `a` to `b` (orthogonal or not). */
const segmentLength = (a: Pt, b: Pt): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** What every step of the pass reads: the scene's shapes grown by the
 *  clearance, the leg rules and the lane offsets to try. */
interface PassContext {
  nodes: Record<string, Rect>
  obstacles: AreaObstacle[]
  paddedNodes: Record<string, Rect>
  paddedObstacles: AreaObstacle[]
  rules: LegRules
  steps: number[]
  gridSize: number
  clearance: number
  /** Whether pairs of slides are tried (first round only). */
  tryPairs: boolean
}

/** A leg of another edge, with the id of that edge. */
interface OtherLeg {
  edge: string
  leg: Leg
}

/** The edge being improved: its route, its metadata and the legs of every
 *  other edge. */
interface EdgeUnderRepair {
  pts: Pt[]
  meta: EdgeMeta
  others: OtherLeg[]
}

/** The cost of a route against the other edges: `total`, the number of
 *  shared runs with each edge it shares one with (`runsWith`), and the number
 *  of runs and crossings next to a corner (`defects`). */
interface RouteCost {
  total: number
  runsWith: Map<string, number>
  defects: number
}

type Move = { pts: Pt[]; cost: RouteCost; distance: number }

/** The cost of the legs `mine` against the legs of the other edges. */
const defectCost = (rules: LegRules, legs: { mine: Leg[]; others: OtherLeg[] }): RouteCost => {
  const runsWith = new Map<string, number>()
  let defects = 0
  let total = 0
  for (const m of legs.mine) {
    for (const { edge, leg } of legs.others) {
      if (rules.shareRun(m, leg)) {
        runsWith.set(edge, (runsWith.get(edge) ?? 0) + 1)
        defects += 1
        total += RUN_COST
      } else if (rules.crossNearCorner(m, leg)) {
        defects += 1
        total += TIGHT_CROSS_COST
      } else if (rules.cross(m, leg)) total += CROSS_COST
    }
  }
  return { total, runsWith, defects }
}

/** The indices `i` of the segments (points i-1 to i) that differ between two
 *  routes with the same number of points. */
const changedSegments = (route: { before: Pt[]; after: Pt[] }): number[] => {
  const { before, after } = route
  const same = (p: Pt, q: Pt) => p.x === q.x && p.y === q.y
  const out: number[] = []
  for (let i = 1; i < after.length; i += 1) {
    if (!same(after[i - 1]!, before[i - 1]!) || !same(after[i]!, before[i]!)) out.push(i)
  }
  return out
}

/** True when the slid route keeps its end legs at least as long as the
 *  clearance (or as long as they were, when shorter), so arrowheads keep room. */
const keepsEndLegs = (ctx: PassContext, route: { before: Pt[]; after: Pt[] }): boolean => {
  const { before, after } = route
  const last = after.length - 1
  return [
    [0, 1],
    [last - 1, last],
  ].every(([i, j]) => {
    const was = segmentLength(before[i!]!, before[j!]!)
    return segmentLength(after[i!]!, after[j!]!) >= Math.min(was, ctx.clearance)
  })
}

/** True when no leg the slide moved runs within the clearance of the edge's
 *  own end nodes. An end leg is exempt only from the node its port is on; a
 *  route of one leg touches both and is not checked. */
const clearsOwnNodes = (
  ctx: PassContext,
  route: { before: Pt[]; after: Pt[]; meta: EdgeMeta },
): boolean => {
  const { before, after, meta } = route
  const last = after.length - 1
  if (last < 2) return true
  const source = ctx.paddedNodes[meta.source]
  const target = ctx.paddedNodes[meta.target]
  for (const i of changedSegments({ before, after })) {
    const checked = i === 1 ? [target] : i === last ? [source] : [source, target]
    if (checked.some((r) => r && segCrossesRect(after[i - 1]!, after[i]!, r))) return false
  }
  return true
}

/** The route after sliding leg `slide.index` to `slide.coord`, or null when
 *  the slide is not allowed: a port off its face, a neighbour leg collapsed or
 *  flipped, a foreign shape or own node within the clearance, or an end leg
 *  made too short. */
const allowedSlide = (ctx: PassContext, edge: EdgeUnderRepair & { slide: Slide }): Pt[] | null => {
  const { pts, meta, slide } = edge
  const lastLeg = pts.length - 2
  // An end leg drags its port along the face: the port must still fit.
  if (
    slide.index === 0 &&
    !portFits(ctx.nodes[meta.source], { side: meta.sourceSide, coord: slide.coord })
  )
    return null
  if (
    slide.index === lastLeg &&
    !portFits(ctx.nodes[meta.target], { side: meta.targetSide, coord: slide.coord })
  )
    return null
  const moved = applySlide(pts, slide)
  if (!moved) return null
  // The whole route stays off foreign shapes; the segments the slide changed
  // also keep the clearance. (A leg the snap left within the clearance blocks
  // only the slides that change it: the leg itself and its two neighbours.)
  if (pathCrossesForeignNode(moved, ctx.nodes, meta.source, meta.target, ctx.obstacles)) return null
  const route = { before: pts, after: moved, meta }
  const changedKeepClearance = changedSegments(route).every(
    (i) =>
      !pathCrossesForeignNode(
        [moved[i - 1]!, moved[i]!],
        ctx.paddedNodes,
        meta.source,
        meta.target,
        ctx.paddedObstacles,
      ),
  )
  if (!changedKeepClearance) return null
  if (!keepsEndLegs(ctx, route) || !clearsOwnNodes(ctx, route)) return null
  return cleanPolyline(moved)
}

/** Every allowed single-leg slide of a leg of the edge that has a defect,
 *  with its cost against the other edges. */
const candidateSlides = (ctx: PassContext, edge: EdgeUnderRepair): Move[] => {
  const { rules, steps, gridSize } = ctx
  const out: Move[] = []
  const lastLeg = edge.pts.length - 2
  for (let index = 0; index <= lastLeg; index += 1) {
    const leg = legOf(edge.pts[index]!, edge.pts[index + 1]!)
    const hasDefect =
      leg &&
      edge.others.some(({ leg: o }) => rules.shareRun(leg, o) || rules.crossNearCorner(leg, o))
    if (!leg || !hasDefect) continue
    for (const step of steps) {
      const slid = allowedSlide(ctx, { ...edge, slide: { index, coord: leg.coord + step } })
      if (!slid) continue
      const cost = defectCost(rules, { mine: legsOf(slid), others: edge.others })
      // At equal cost, moving a port loses to moving an interior leg.
      const isPortSlide = index === 0 || index === lastLeg
      const distance = Math.abs(step) + (isPortSlide ? PORT_SLIDE_PENALTY_IN_CELLS * gridSize : 0)
      out.push({ pts: slid, cost, distance })
    }
  }
  return out
}

const isBetterMove = (a: Move, b: Move | null) =>
  !b || a.cost.total < b.cost.total || (a.cost.total === b.cost.total && a.distance < b.distance)

/**
 * The best route for the edge that lowers its cost and adds no shared run, or
 * null when no slide does. One slide is tried first. When none helps, the
 * edge shares a run and `ctx.tryPairs` is set, pairs of slides are: a run
 * often just moves to the next leg (two ports on one line, say), and only
 * sliding both legs clears it.
 */
const improvedRoute = (ctx: PassContext, edge: EdgeUnderRepair): Pt[] | null => {
  const base = defectCost(ctx.rules, { mine: legsOf(edge.pts), others: edge.others })
  if (base.defects === 0) return null
  const singles = candidateSlides(ctx, edge)
  // A move must lower the cost and never add a shared run, with this edge or
  // any other: two crossings next to corners still read better than one
  // merged line.
  const beatsBase = (m: Move) =>
    m.cost.total < base.total &&
    [...m.cost.runsWith].every(([other, runs]) => runs <= (base.runsWith.get(other) ?? 0))
  let best: Move | null = null
  for (const m of singles) if (beatsBase(m) && isBetterMove(m, best)) best = m
  if (!best && ctx.tryPairs && base.runsWith.size > 0) {
    for (const first of singles) {
      // The first slide may cost a run's worth more; the pair must still win.
      if (first.cost.total > base.total + RUN_COST) continue
      for (const second of candidateSlides(ctx, { ...edge, pts: first.pts })) {
        const pair = { ...second, distance: first.distance + second.distance }
        if (beatsBase(pair) && isBetterMove(pair, best)) best = pair
      }
    }
  }
  return best?.pts ?? null
}

/**
 * Pull apart parallel runs that edges from different routing calls share, and
 * pull crossings off corners. Updates `scene.polys` in place.
 */
export const separateSharedRuns = (scene: SeparationScene): void => {
  const { polys, edgeMeta, nodes, obstacles, gridSize, clearance } = scene
  const shared = {
    nodes,
    obstacles,
    paddedNodes: Object.fromEntries(
      Object.entries(nodes).map(([id, r]) => [id, inflateRect(r, clearance)]),
    ),
    paddedObstacles: obstacles.map((o) => ({ ...o, rect: inflateRect(o.rect, clearance) })),
    rules: legRules(gridSize),
    steps: SLIDE_STEPS_IN_CELLS.flatMap((f) => [f * gridSize, -f * gridSize]),
    gridSize,
    clearance,
  }
  const ids = [...polys.keys()]
  const legsById = new Map(ids.map((id) => [id, legsOf(polys.get(id)!)]))
  for (let round = 0; round < MAX_SEPARATION_ROUNDS; round += 1) {
    let moved = false
    const ctx: PassContext = { ...shared, tryPairs: round === 0 }
    // Later edges move first, so the earlier routes stay put.
    for (const id of [...ids].reverse()) {
      const others = ids.flatMap((edge) =>
        edge === id ? [] : legsById.get(edge)!.map((leg) => ({ edge, leg })),
      )
      const better = improvedRoute(ctx, { pts: polys.get(id)!, meta: edgeMeta.get(id)!, others })
      if (!better) continue
      polys.set(id, better)
      legsById.set(id, legsOf(better))
      moved = true
    }
    if (!moved) return
  }
}
