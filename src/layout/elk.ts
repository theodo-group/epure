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

    const raw: { x: number; y: number }[] = [
      { x: result.sourcePoint.x, y: result.sourcePoint.y },
      ...result.bendPoints.map((p) => ({ x: p.x, y: p.y })),
      { x: result.targetPoint.x, y: result.targetPoint.y },
    ]
    const points = raw.map((p) => ({
      x: snap(p.x, gridSize),
      y: snap(p.y, gridSize),
    }))

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
