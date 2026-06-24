import {
  init,
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
  LayoutNode,
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

const toPixelRect = (node: LayoutNode, gridSize: number): Rect => ({
  x: (node.cx - node.w / 2) * gridSize,
  y: (node.cy - node.h / 2) * gridSize,
  w: node.w * gridSize,
  h: node.h * gridSize,
})

export const route = async (
  diagram: Diagram,
  layout: LayoutSidecar,
): Promise<RoutedDiagram> => {
  const { gridSize } = layout

  const pixelNodes: Record<string, Rect> = {}
  for (const [id, node] of Object.entries(layout.nodes)) {
    pixelNodes[id] = toPixelRect(node, gridSize)
  }

  const elkNodes: ElkNode[] = diagram.nodes.map((n) => {
    const pos = pixelNodes[n.id]
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
    await init('/libavoid.wasm')
    routes = await routeEdges(graph, {
      routingType: 'orthogonal',
      shapeBufferDistance: 8,
      idealNudgingDistance: 8,
    })
  } catch {
    // Fallback when libavoid wasm cannot initialize (test environments,
    // headless runs without fetch): synthesize stub routes — the real
    // geometry is built by buildOrthogonalPath from the aligned anchors.
    routes = new Map()
    for (const e of elkEdges) {
      const meta = edgeMeta.get(e.id)!
      const src = pixelNodes[meta.source]!
      const tgt = pixelNodes[meta.target]!
      const a = anchorPoint(src, meta.sourceSide)
      const b = anchorPoint(tgt, meta.targetSide)
      routes.set(e.id, {
        sourcePoint: a,
        targetPoint: b,
        bendPoints: [],
        sourceSide: connectionSideFromSide(meta.sourceSide),
        targetSide: connectionSideFromSide(meta.targetSide),
      })
    }
  }

  const edgeAnchors = computeEdgeAnchors(elkEdges, edgeMeta, pixelNodes)

  const routedEdges: EdgeRoute[] = []
  for (const e of elkEdges) {
    const result = routes.get(e.id)
    if (!result) continue
    const meta = edgeMeta.get(e.id)!

    const { sourceAnchor, targetAnchor } = edgeAnchors.get(e.id)!

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
      gridSize,
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
    const pos = pixelNodes[n.id]!
    return { id: n.id, x: pos.x, y: pos.y, w: pos.w, h: pos.h }
  })

  const AREA_PAD = 16
  const AREA_TITLE_H = 28
  const areas = diagram.areas.map((a) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const mid of a.members) {
      const r = pixelNodes[mid]
      if (!r) continue
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.w)
      maxY = Math.max(maxY, r.y + r.h)
    }
    if (!isFinite(minX)) {
      return { id: a.id, label: a.label, members: a.members, x: 0, y: 0, w: 0, h: 0 }
    }
    return {
      id: a.id,
      label: a.label,
      members: a.members,
      x: minX - AREA_PAD,
      y: minY - AREA_PAD - AREA_TITLE_H,
      w: maxX - minX + AREA_PAD * 2,
      h: maxY - minY + AREA_PAD * 2 + AREA_TITLE_H,
    }
  })

  return {
    gridSize,
    nodes,
    areas,
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

const FACE_MARGIN = 12

const faceCoord = (node: Rect, side: Side): number =>
  side === 'E' ? node.x + node.w : side === 'W' ? node.x
    : side === 'S' ? node.y + node.h : node.y

const faceRange = (node: Rect, side: Side): [number, number] => {
  const horiz = isHorizontalSide(side)
  const origin = horiz ? node.y : node.x
  const size = horiz ? node.h : node.w
  const margin = Math.min(FACE_MARGIN, size / 4)
  return [origin + margin, origin + size - margin]
}

// Pre-compute anchor positions for all edges. Multi-edge faces (fan-out /
// fan-in) get evenly distributed ports. Single-edge faces match the
// distributed position on the other end of the edge, or fall back to the
// smaller-node-midpoint heuristic for straight lines.
const computeEdgeAnchors = (
  elkEdges: ElkEdge[],
  edgeMeta: Map<string, { source: string; target: string; sourceSide: Side; targetSide: Side }>,
  nodes: Record<string, Rect>,
): Map<string, { sourceAnchor: Pt; targetAnchor: Pt }> => {
  // Group edges by face (nodeId:side)
  const faceGroups = new Map<string, Array<{ edgeId: string; connectedId: string }>>()

  for (const e of elkEdges) {
    const m = edgeMeta.get(e.id)!
    for (const [nodeId, side, connId] of [
      [m.source, m.sourceSide, m.target],
      [m.target, m.targetSide, m.source],
    ] as [string, Side, string][]) {
      const key = `${nodeId}:${side}`
      let arr = faceGroups.get(key)
      if (!arr) { arr = []; faceGroups.set(key, arr) }
      arr.push({ edgeId: e.id, connectedId: connId })
    }
  }

  // Distribute ports on multi-edge faces. Key: "edgeId:nodeId" → position.
  const distributed = new Map<string, number>()
  const multiFaces = new Set<string>()

  for (const [key, group] of faceGroups) {
    if (group.length < 2) continue
    const [nodeId, sideStr] = key.split(':') as [string, string]
    const side = sideStr as Side
    const node = nodes[nodeId!]!
    const horiz = isHorizontalSide(side)
    const [lo, hi] = faceRange(node, side)
    const n = group.length

    const sorted = [...group].sort((a, b) => {
      const aN = nodes[a.connectedId]!
      const bN = nodes[b.connectedId]!
      return (horiz ? aN.y + aN.h / 2 : aN.x + aN.w / 2) -
             (horiz ? bN.y + bN.h / 2 : bN.x + bN.w / 2)
    })

    const step = (hi - lo) / n
    for (let i = 0; i < n; i++) {
      distributed.set(`${sorted[i]!.edgeId}:${nodeId}`, lo + step * (i + 0.5))
    }
    for (const g of group) multiFaces.add(`${g.edgeId}:${nodeId}`)
  }

  // Build final anchors per edge
  const result = new Map<string, { sourceAnchor: Pt; targetAnchor: Pt }>()

  for (const e of elkEdges) {
    const m = edgeMeta.get(e.id)!
    const src = nodes[m.source]!
    const tgt = nodes[m.target]!
    const srcMulti = multiFaces.has(`${e.id}:${m.source}`)
    const tgtMulti = multiFaces.has(`${e.id}:${m.target}`)
    const srcHoriz = isHorizontalSide(m.sourceSide)
    const tgtHoriz = isHorizontalSide(m.targetSide)
    const srcFC = faceCoord(src, m.sourceSide)
    const tgtFC = faceCoord(tgt, m.targetSide)

    let srcPerp: number
    let tgtPerp: number

    if (srcMulti && tgtMulti) {
      srcPerp = distributed.get(`${e.id}:${m.source}`)!
      tgtPerp = distributed.get(`${e.id}:${m.target}`)!
    } else if (srcMulti) {
      srcPerp = distributed.get(`${e.id}:${m.source}`)!
      tgtPerp = tgtHoriz ? tgt.y + tgt.h / 2 : tgt.x + tgt.w / 2
    } else if (tgtMulti) {
      tgtPerp = distributed.get(`${e.id}:${m.target}`)!
      srcPerp = srcHoriz ? src.y + src.h / 2 : src.x + src.w / 2
    } else {
      // Both single-edge: prefer smaller node's midpoint for straight lines
      if (srcHoriz !== tgtHoriz) {
        srcPerp = srcHoriz ? src.y + src.h / 2 : src.x + src.w / 2
        tgtPerp = tgtHoriz ? tgt.y + tgt.h / 2 : tgt.x + tgt.w / 2
      } else if (srcHoriz) {
        const [sLo, sHi] = faceRange(src, m.sourceSide)
        const [tLo, tHi] = faceRange(tgt, m.targetSide)
        const lo = Math.max(sLo, tLo)
        const hi = Math.min(sHi, tHi)
        if (lo <= hi) {
          const preferred = src.h <= tgt.h ? src.y + src.h / 2 : tgt.y + tgt.h / 2
          const y = clamp(preferred, lo, hi)
          srcPerp = y; tgtPerp = y
        } else {
          srcPerp = clamp(tgt.y + tgt.h / 2, sLo, sHi)
          tgtPerp = clamp(src.y + src.h / 2, tLo, tHi)
        }
      } else {
        const [sLo, sHi] = faceRange(src, m.sourceSide)
        const [tLo, tHi] = faceRange(tgt, m.targetSide)
        const lo = Math.max(sLo, tLo)
        const hi = Math.min(sHi, tHi)
        if (lo <= hi) {
          const preferred = src.w <= tgt.w ? src.x + src.w / 2 : tgt.x + tgt.w / 2
          const x = clamp(preferred, lo, hi)
          srcPerp = x; tgtPerp = x
        } else {
          srcPerp = clamp(tgt.x + tgt.w / 2, sLo, sHi)
          tgtPerp = clamp(src.x + src.w / 2, tLo, tHi)
        }
      }
    }

    // If the two faces overlap, force a straight line by picking a shared
    // coordinate. Prefer the single-edge node's midpoint (face center).
    if (srcHoriz === tgtHoriz && srcPerp !== tgtPerp) {
      const [sLo, sHi] = faceRange(src, m.sourceSide)
      const [tLo, tHi] = faceRange(tgt, m.targetSide)
      const lo = Math.max(sLo, tLo)
      const hi = Math.min(sHi, tHi)
      if (lo <= hi) {
        const preferred = srcMulti ? tgtPerp : tgtMulti ? srcPerp : (srcPerp + tgtPerp) / 2
        const shared = clamp(preferred, lo, hi)
        srcPerp = shared
        tgtPerp = shared
      }
    }

    const sourceAnchor: Pt = srcHoriz ? { x: srcFC, y: srcPerp } : { x: srcPerp, y: srcFC }
    const targetAnchor: Pt = tgtHoriz ? { x: tgtFC, y: tgtPerp } : { x: tgtPerp, y: tgtFC }
    result.set(e.id, { sourceAnchor, targetAnchor })
  }

  return result
}

// Synthesize a fully-orthogonal polyline from the two anchors and the bend
// points libavoid produced. The first segment always leaves perpendicular to
// the source side and the last segment always arrives perpendicular to the
// target side (matching diagram-v3 style). Z-jogs use the midpoint between
// the two anchors so the route never degenerates into an L where the arrow
// enters the target from the wrong direction.
const buildOrthogonalPath = (
  A: Pt,
  C: Pt,
  sourceSide: Side,
  targetSide: Side,
  bends: Pt[],
  gridSize: number,
): Pt[] => {
  const srcHoriz = isHorizontalSide(sourceSide)
  const tgtHoriz = isHorizontalSide(targetSide)
  const out: Pt[] = [{ x: A.x, y: A.y }]

  if (bends.length >= 2) {
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
    if (srcHoriz) {
      if (A.y !== C.y) {
        const midX = snap((A.x + C.x) / 2, gridSize)
        out.push({ x: midX, y: A.y }, { x: midX, y: C.y })
      }
    } else if (A.x !== C.x) {
      const midY = snap((A.y + C.y) / 2, gridSize)
      out.push({ x: A.x, y: midY }, { x: C.x, y: midY })
    }
  } else {
    // Mixed-axis sides: L-corner oriented so first segment matches source
    // direction and last segment matches target direction.
    const corner: Pt = srcHoriz
      ? { x: C.x, y: A.y }
      : { x: A.x, y: C.y }
    out.push(corner)
  }

  out.push({ x: C.x, y: C.y })

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
