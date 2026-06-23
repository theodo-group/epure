import {
  routeEdges,
  type ConnectionSide,
  type ElkEdge,
  type ElkGraph,
  type ElkNode,
  type ElkPort,
  type RouteResult,
} from '@mr_mint/elkjs-libavoid'

import type { Diagram } from '@/parser/ast'

import type {
  EdgeRoute,
  LayoutSidecar,
  RoutedDiagram,
  Side,
} from './types'

const portId = (nodeId: string, side: Side) => `${nodeId}.${side}`

export const edgeKey = (sourceId: string, targetId: string) =>
  `${sourceId}->${targetId}`

const snap = (v: number, gridSize: number) =>
  Math.round(v / gridSize) * gridSize

const SIDE_FROM_CONNECTION: Record<ConnectionSide, Side> = {
  north: 'N',
  south: 'S',
  east: 'E',
  west: 'W',
}

const portOffset = (
  side: Side,
  w: number,
  h: number,
): { x: number; y: number } => {
  switch (side) {
    case 'N':
      return { x: w / 2, y: 0 }
    case 'S':
      return { x: w / 2, y: h }
    case 'E':
      return { x: w, y: h / 2 }
    case 'W':
      return { x: 0, y: h / 2 }
  }
}

const portsForNode = (nodeId: string, w: number, h: number): ElkPort[] =>
  (['N', 'S', 'E', 'W'] as Side[]).map((side) => {
    const { x, y } = portOffset(side, w, h)
    return {
      id: portId(nodeId, side),
      x,
      y,
      width: 0,
      height: 0,
    }
  })

const polylineLength = (points: { x: number; y: number }[]) => {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total
}

const longestHorizontalMidpoint = (
  points: { x: number; y: number }[],
): { x: number; y: number } | undefined => {
  let bestLen = 0
  let best: { x: number; y: number } | undefined
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    if (a.y === b.y) {
      const len = Math.abs(b.x - a.x)
      if (len > bestLen) {
        bestLen = len
        best = { x: (a.x + b.x) / 2, y: a.y }
      }
    }
  }
  return best
}

const pathMidpoint = (points: { x: number; y: number }[]) => {
  if (points.length === 0) return { x: 0, y: 0 }
  const total = polylineLength(points)
  const half = total / 2
  let acc = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (acc + seg >= half) {
      const t = seg === 0 ? 0 : (half - acc) / seg
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    acc += seg
  }
  return points[points.length - 1]!
}

// The parser AST doesn't give edges a stable id (multiple edges may share the
// same source/target pair), so we derive one from the pair plus the ordinal.
export const makeEdgeId = (source: string, target: string, index: number) =>
  `${source}->${target}#${index}`

export const route = async (
  diagram: Diagram,
  layout: LayoutSidecar,
): Promise<RoutedDiagram> => {
  const { gridSize } = layout

  const elkNodes: ElkNode[] = diagram.nodes.map((n) => {
    const pos = layout.nodes[n.id]
    if (!pos) {
      throw new Error(`Missing layout for node "${n.id}"`)
    }
    return {
      id: n.id,
      x: pos.x,
      y: pos.y,
      width: pos.w,
      height: pos.h,
      ports: portsForNode(n.id, pos.w, pos.h),
    }
  })

  const edgeMeta = new Map<
    string,
    { source: string; target: string; sourceSide: Side; targetSide: Side }
  >()

  const elkEdges: ElkEdge[] = diagram.edges.map((e, i) => {
    const sides = layout.edges[edgeKey(e.source, e.target)]
    const sourceSide: Side = sides?.sourceSide ?? 'E'
    const targetSide: Side = sides?.targetSide ?? 'W'
    const id = makeEdgeId(e.source, e.target, i)
    edgeMeta.set(id, {
      source: e.source,
      target: e.target,
      sourceSide,
      targetSide,
    })
    return {
      id,
      sources: [e.source],
      targets: [e.target],
      sourcePort: portId(e.source, sourceSide),
      targetPort: portId(e.target, targetSide),
    }
  })

  const graph: ElkGraph = {
    id: 'root',
    children: elkNodes,
    edges: elkEdges,
  }

  let routes: Map<string, RouteResult>
  try {
    routes = await routeEdges(graph, {
      routingType: 'orthogonal',
      shapeBufferDistance: gridSize,
      idealNudgingDistance: gridSize,
    })
  } catch {
    // Fallback when libavoid wasm cannot initialize (test environments,
    // headless runs without fetch): synthesize a simple L-shaped route per
    // edge using the configured side anchors.
    routes = new Map()
    for (const e of elkEdges) {
      const meta = edgeMeta.get(e.id)!
      const src = layout.nodes[meta.source]!
      const tgt = layout.nodes[meta.target]!
      const a = anchorPoint(src, meta.sourceSide)
      const b = anchorPoint(tgt, meta.targetSide)
      routes.set(e.id, {
        sourcePoint: a,
        targetPoint: b,
        bendPoints: [{ x: b.x, y: a.y }],
        sourceSide: connectionSideFromSide(meta.sourceSide),
        targetSide: connectionSideFromSide(meta.targetSide),
      })
    }
  }

  const routedEdges: EdgeRoute[] = []
  for (const e of elkEdges) {
    const result = routes.get(e.id)
    if (!result) continue
    const meta = edgeMeta.get(e.id)!

    const srcNode = layout.nodes[meta.source]!
    const tgtNode = layout.nodes[meta.target]!
    const { sourceAnchor, targetAnchor } = alignAnchors(
      srcNode,
      meta.sourceSide,
      tgtNode,
      meta.targetSide,
      gridSize,
    )

    const bends = result.bendPoints.map((p) => ({
      x: snap(p.x, gridSize),
      y: snap(p.y, gridSize),
    }))

    const points = buildOrthogonalPath(
      sourceAnchor,
      targetAnchor,
      meta.sourceSide,
      meta.targetSide,
      bends,
    )

    const labelAnchor =
      longestHorizontalMidpoint(points) ?? pathMidpoint(points)

    routedEdges.push({
      id: e.id,
      source: { nodeId: meta.source, side: SIDE_FROM_CONNECTION[result.sourceSide] ?? meta.sourceSide },
      target: { nodeId: meta.target, side: SIDE_FROM_CONNECTION[result.targetSide] ?? meta.targetSide },
      points,
      labelAnchor,
    })
  }

  const nodes = diagram.nodes.map((n) => {
    const pos = layout.nodes[n.id]!
    return { id: n.id, x: pos.x, y: pos.y, w: pos.w, h: pos.h }
  })

  return {
    gridSize,
    nodes,
    areas: layout.areas,
    edges: routedEdges,
  }
}

const anchorPoint = (
  rect: { x: number; y: number; w: number; h: number },
  side: Side,
): { x: number; y: number } => {
  const { x, y } = portOffset(side, rect.w, rect.h)
  return { x: rect.x + x, y: rect.y + y }
}

const isHorizontalSide = (side: Side) => side === 'E' || side === 'W'

type Pt = { x: number; y: number }
type Rect = { x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))

// When two nodes are connected via parallel sides (both E/W or both N/S) and
// their faces overlap on the perpendicular axis, slide both anchors to a
// common coordinate inside the overlap so the resulting edge can be a single
// straight line instead of an L/Z. Nothing changes when the sides are
// perpendicular or the faces don't overlap.
const alignAnchors = (
  src: Rect,
  srcSide: Side,
  tgt: Rect,
  tgtSide: Side,
  gridSize: number,
): { sourceAnchor: Pt; targetAnchor: Pt } => {
  const defaultSrc = anchorPoint(src, srcSide)
  const defaultTgt = anchorPoint(tgt, tgtSide)

  const srcHoriz = isHorizontalSide(srcSide)
  const tgtHoriz = isHorizontalSide(tgtSide)
  if (srcHoriz !== tgtHoriz) {
    return { sourceAnchor: defaultSrc, targetAnchor: defaultTgt }
  }

  if (srcHoriz) {
    const lo = Math.max(src.y, tgt.y)
    const hi = Math.min(src.y + src.h, tgt.y + tgt.h)
    if (hi <= lo) return { sourceAnchor: defaultSrc, targetAnchor: defaultTgt }
    const preferred = (defaultSrc.y + defaultTgt.y) / 2
    const y = clamp(Math.round(preferred / gridSize) * gridSize, lo, hi)
    return {
      sourceAnchor: { x: defaultSrc.x, y },
      targetAnchor: { x: defaultTgt.x, y },
    }
  }
  const lo = Math.max(src.x, tgt.x)
  const hi = Math.min(src.x + src.w, tgt.x + tgt.w)
  if (hi <= lo) return { sourceAnchor: defaultSrc, targetAnchor: defaultTgt }
  const preferred = (defaultSrc.x + defaultTgt.x) / 2
  const x = clamp(Math.round(preferred / gridSize) * gridSize, lo, hi)
  return {
    sourceAnchor: { x, y: defaultSrc.y },
    targetAnchor: { x, y: defaultTgt.y },
  }
}

// Synthesize a fully-orthogonal polyline from the two anchors and the bend
// points libavoid produced. Cases that libavoid handled well (4+ points with
// already-orthogonal middle segments) only need their first/last bends
// projected onto the side's axis. Cases where libavoid returned 0 or 1
// bend points but the sides are parallel and non-collinear get a Z elbow.
// Mixed-axis sides get a single L corner.
const buildOrthogonalPath = (
  A: Pt,
  C: Pt,
  sourceSide: Side,
  targetSide: Side,
  bends: Pt[],
): Pt[] => {
  const srcHoriz = isHorizontalSide(sourceSide)
  const tgtHoriz = isHorizontalSide(targetSide)
  const out: Pt[] = [{ x: A.x, y: A.y }]

  if (bends.length >= 2) {
    // Trust libavoid's interior routing; only force the first and last bend
    // onto the side's perpendicular axis so the entry/exit segments are
    // strictly orthogonal.
    const first = { ...bends[0]! }
    const last = { ...bends[bends.length - 1]! }
    if (srcHoriz) first.y = A.y
    else first.x = A.x
    if (tgtHoriz) last.y = C.y
    else last.x = C.x
    out.push(first)
    for (let i = 1; i < bends.length - 1; i += 1) {
      out.push({ ...bends[i]! })
    }
    out.push(last)
  } else if (srcHoriz === tgtHoriz) {
    // Parallel sides. Direct line works iff anchors are collinear on the
    // perpendicular axis; otherwise insert a Z elbow.
    if (srcHoriz) {
      if (A.y !== C.y) {
        const hintX = bends[0]?.x ?? (A.x + C.x) / 2
        out.push({ x: hintX, y: A.y }, { x: hintX, y: C.y })
      }
    } else if (A.x !== C.x) {
      const hintY = bends[0]?.y ?? (A.y + C.y) / 2
      out.push({ x: A.x, y: hintY }, { x: C.x, y: hintY })
    }
  } else {
    // Mixed-axis sides: one corner.
    const corner: Pt = srcHoriz
      ? { x: C.x, y: A.y }
      : { x: A.x, y: C.y }
    out.push(corner)
  }

  out.push({ x: C.x, y: C.y })

  // Drop consecutive duplicates so the SVG marker always has a non-zero
  // final segment to orient against.
  const deduped: Pt[] = []
  for (const p of out) {
    const tail = deduped[deduped.length - 1]
    if (tail && tail.x === p.x && tail.y === p.y) continue
    deduped.push(p)
  }
  return deduped
}

const connectionSideFromSide = (side: Side): ConnectionSide => {
  switch (side) {
    case 'N':
      return 'north'
    case 'S':
      return 'south'
    case 'E':
      return 'east'
    case 'W':
      return 'west'
  }
}
