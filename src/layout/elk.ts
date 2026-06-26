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

// Where libavoid loads its wasm from. In the browser it's served at the app
// root (`/libavoid.wasm`); the headless Node export (`epure export`) overrides
// this with an absolute filesystem path so real routing runs server-side
// instead of the degraded fallback. Without a real wasm, route() still works
// via the stub-route fallback below.
let wasmLocator = '/libavoid.wasm'
export const setLibavoidWasmPath = (path: string): void => {
  wasmLocator = path
}

const portId = (nodeId: string, side: Side) => `${nodeId}.${side}`

export const edgeKey = (sourceId: string, targetId: string) =>
  `${sourceId}->${targetId}`

const snap = (v: number, gridSize: number) =>
  Math.round(v / gridSize) * gridSize

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

// Distance from a point to a rect (0 when inside). Used to keep edge labels
// off the node bodies.
const distToRect = (p: Pt, r: Rect): number => {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h))
  return Math.hypot(dx, dy)
}

const clearanceAt = (p: Pt, nodes: Record<string, Rect>): number => {
  let min = Infinity
  for (const id in nodes) min = Math.min(min, distToRect(p, nodes[id]!))
  return min
}

// Pick where an edge's label sits. The preferred spot is the midpoint of the
// longest horizontal run (or the path midpoint), but a mostly-vertical edge
// that hugs the nodes it passes can leave that spot buried under one of them —
// so when the preferred point is too close to a node, walk the polyline and
// take the sampled point with the most clearance instead.
const LABEL_MIN_CLEARANCE = 12
const chooseLabelAnchor = (
  points: Pt[],
  nodes: Record<string, Rect>,
): Pt | undefined => {
  const preferred = longestHorizontalMidpoint(points) ?? pathMidpoint(points)
  if (clearanceAt(preferred, nodes) >= LABEL_MIN_CLEARANCE) return preferred
  let best = preferred
  let bestClear = clearanceAt(preferred, nodes)
  const STEP = 16
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.round(len / STEP))
    for (let s = 1; s < steps; s += 1) {
      const t = s / steps
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      const c = clearanceAt(p, nodes)
      if (c > bestClear) {
        bestClear = c
        best = p
      }
    }
  }
  return best
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

  // Defensive fallback: a node may exist in the diagram (or be referenced by an
  // edge) with no layout entry — most commonly when CC appends a node to the
  // `.d2` without touching the layout. `normalizeForRoute` normally fills these
  // in upstream; completing the map here too guarantees every downstream
  // `pixelNodes[id]` lookup resolves, so `route()` can never throw and blank the
  // canvas. The fallback rect lands in the same coordinate space as the rest.
  const ensureRect = (id: string) => {
    if (!pixelNodes[id]) {
      pixelNodes[id] = toPixelRect({ cx: 0, cy: 0, w: 4, h: 2 }, gridSize)
    }
  }
  for (const n of diagram.nodes) ensureRect(n.id)
  for (const e of diagram.edges) {
    ensureRect(e.source)
    ensureRect(e.target)
  }

  const elkNodes: ElkNode[] = diagram.nodes.map((n) => {
    const pos = pixelNodes[n.id]!
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
    {
      source: string
      target: string
      sourceSide: Side
      targetSide: Side
      // Whether each side was pinned in the layout sidecar (vs. auto-derived).
      // An explicit side is authoritative: geometry won't change it and the
      // libavoid face-adoption step below leaves it alone.
      explicitSource: boolean
      explicitTarget: boolean
    }
  >()

  const elkEdges: ElkEdge[] = diagram.edges.map((e, i) => {
    // Default sides from relative position: whichever axis (x or y) separates
    // the two nodes more dictates the side; the target gets the opposite side.
    // A `sourceSide`/`targetSide` pinned in the layout sidecar overrides this
    // guess and is honored end-to-end.
    const src = pixelNodes[e.source]!
    const tgt = pixelNodes[e.target]!
    const srcCx = src.x + src.w / 2
    const srcCy = src.y + src.h / 2
    const tgtCx = tgt.x + tgt.w / 2
    const tgtCy = tgt.y + tgt.h / 2
    const dx = tgtCx - srcCx
    const dy = tgtCy - srcCy
    let sourceSide: Side
    let targetSide: Side
    if (Math.abs(dx) >= Math.abs(dy)) {
      sourceSide = dx >= 0 ? 'E' : 'W'
      targetSide = dx >= 0 ? 'W' : 'E'
    } else {
      sourceSide = dy >= 0 ? 'S' : 'N'
      targetSide = dy >= 0 ? 'N' : 'S'
    }
    const stored = layout.edges[edgeKey(e.source, e.target)]
    const explicitSource = stored?.sourceSide !== undefined
    const explicitTarget = stored?.targetSide !== undefined
    if (explicitSource) sourceSide = stored!.sourceSide!
    if (explicitTarget) targetSide = stored!.targetSide!
    const id = makeEdgeId(e.source, e.target, i)
    edgeMeta.set(id, {
      source: e.source,
      target: e.target,
      sourceSide,
      targetSide,
      explicitSource,
      explicitTarget,
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
  // Whether libavoid actually ran. When it did, its routed polyline already
  // avoids every obstacle, so we use it directly; only the no-wasm fallback
  // falls back to the synthetic anchor-to-anchor path (which can't detour).
  let libavoidOk = false
  try {
    await init(wasmLocator)
    routes = await routeEdges(graph, {
      routingType: 'orthogonal',
      shapeBufferDistance: 8,
      idealNudgingDistance: 8,
    })
    libavoidOk = true
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

  // Some edges can't take their geometric side without crossing another node;
  // for those libavoid supplies an obstacle-avoiding polyline and the edge
  // really leaves/enters via a DIFFERENT face than geometry implied (e.g. a
  // node sitting directly below forces the edge out to the side). Detect them
  // up front — using the un-distributed centre path as a stable predictor —
  // and adopt the face libavoid actually uses. Everything downstream (port
  // distribution, overlap resolution, the rendered side) then reasons about
  // the faces edges occupy in the *final* drawing, not the ones geometry
  // guessed. `libRoutes` holds the polyline to draw for each such edge.
  const libRoutes = new Map<string, Pt[]>()
  if (libavoidOk) {
    for (const e of elkEdges) {
      const meta = edgeMeta.get(e.id)!
      const src = pixelNodes[meta.source]!
      const tgt = pixelNodes[meta.target]!
      const centerPath = buildOrthogonalPath(
        anchorPoint(src, meta.sourceSide),
        anchorPoint(tgt, meta.targetSide),
        meta.sourceSide,
        meta.targetSide,
        gridSize,
      )
      if (!pathCrossesForeignNode(centerPath, pixelNodes, meta.source, meta.target)) {
        continue
      }
      const result = routes.get(e.id)
      if (!result) continue
      const poly = cleanPolyline([
        result.sourcePoint,
        ...result.bendPoints,
        result.targetPoint,
      ])
      if (poly.length < 2) continue
      const libSourceSide = sideFromSegment(poly[0]!, poly[1]!)
      const libTargetSide = sideFromSegment(
        poly[poly.length - 1]!,
        poly[poly.length - 2]!,
      )
      // A pinned side is authoritative. libavoid ignores the ports we supply and
      // attaches wherever is cheapest, so when its face disagrees with the pin it
      // can't honor it — fall back to the synthetic path, which leaves/enters
      // perpendicular to the pinned face (accepting any crossing the pin implies)
      // rather than silently re-routing onto a different face. When libavoid's
      // face already AGREES with the pin (the common case — sensible pins), keep
      // its obstacle-avoiding detour: same face, no overlap with its neighbours.
      if (
        (meta.explicitSource && libSourceSide !== meta.sourceSide) ||
        (meta.explicitTarget && libTargetSide !== meta.targetSide)
      ) {
        continue
      }
      if (!meta.explicitSource) meta.sourceSide = libSourceSide
      if (!meta.explicitTarget) meta.targetSide = libTargetSide
      libRoutes.set(e.id, poly)
    }
  }

  const edgeAnchors = computeEdgeAnchors(elkEdges, edgeMeta, pixelNodes)
  resolveSegmentOverlaps(edgeAnchors, edgeMeta, pixelNodes, gridSize, libRoutes)

  const routedEdges: EdgeRoute[] = []
  for (const e of elkEdges) {
    const meta = edgeMeta.get(e.id)!
    const lib = libRoutes.get(e.id)

    let points: Pt[]
    if (lib) {
      // Edge already known to need libavoid's obstacle-avoiding polyline. Pull
      // its endpoints from the centre pins onto the distributed face ports so
      // it spaces apart from any fan peers and its arrowhead lands on the
      // border, then drop any degenerate points the shift introduced.
      // Only snap when the two ends touch distinct legs (≥3 points). A 2-point
      // route shares both points between the ends, so snapping each would
      // clobber the other — leave it on its centre pins.
      const hints = lib.length >= 3 ? edgeAnchors.get(e.id) : undefined
      if (hints) {
        snapLibEnd(lib, hints.sourceAnchor, meta.sourceSide, 'source')
        snapLibEnd(lib, hints.targetAnchor, meta.targetSide, 'target')
      }
      points = cleanPolyline(lib)
    } else {
      const { sourceAnchor, targetAnchor, bendCoord } = edgeAnchors.get(e.id)!
      // The clean synthetic orthogonal path. Tidy everywhere a detour isn't
      // needed.
      points = buildOrthogonalPath(
        sourceAnchor,
        targetAnchor,
        meta.sourceSide,
        meta.targetSide,
        gridSize,
        bendCoord,
      )
      // Safety net: port distribution may have nudged a synthetic path into a
      // node the centre path cleared. Swap in libavoid's route if so — unless a
      // side was pinned, in which case the chosen face wins over avoidance.
      if (
        libavoidOk &&
        !meta.explicitSource &&
        !meta.explicitTarget &&
        pathCrossesForeignNode(points, pixelNodes, meta.source, meta.target)
      ) {
        const result = routes.get(e.id)
        if (result) {
          const avoided = cleanPolyline([
            result.sourcePoint,
            ...result.bendPoints,
            result.targetPoint,
          ])
          if (avoided.length >= 2) points = avoided
        }
      }
    }

    const labelAnchor = chooseLabelAnchor(points, pixelNodes)

    const styleSpec = layout.edges[edgeKey(meta.source, meta.target)]
    routedEdges.push({
      id: e.id,
      source: { nodeId: meta.source, side: meta.sourceSide },
      target: { nodeId: meta.target, side: meta.targetSide },
      points,
      labelAnchor,
      color: styleSpec?.color,
      lineStyle: styleSpec?.lineStyle,
      width: styleSpec?.width,
      startCap: styleSpec?.startCap,
      endCap: styleSpec?.endCap,
    })
  }

  const nodes = diagram.nodes.map((n) => {
    const pos = pixelNodes[n.id]!
    const layoutNode = layout.nodes[n.id]
    return {
      id: n.id,
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      textSize: layoutNode?.textSize,
      textColor: layoutNode?.textColor,
      borderColor: layoutNode?.borderColor,
      borderStyle: layoutNode?.borderStyle,
      fillColor: layoutNode?.fillColor,
      shape: layoutNode?.shape,
      icon: layoutNode?.icon,
      iconPosition: layoutNode?.iconPosition,
    }
  })

  const AREA_PAD = 24
  const areas = diagram.areas.map((a) => {
    const style = layout.areas?.[a.id]
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
      return { id: a.id, label: a.label, members: a.members, x: 0, y: 0, w: 0, h: 0, ...style }
    }
    return {
      id: a.id,
      label: a.label,
      members: a.members,
      x: minX - AREA_PAD,
      y: minY - AREA_PAD,
      w: maxX - minX + AREA_PAD * 2,
      h: maxY - minY + AREA_PAD * 2,
      borderColor: style?.borderColor,
      borderStyle: style?.borderStyle,
      fillColor: style?.fillColor,
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

// Which face of a node a polyline touches, inferred from the step it takes
// leaving that node's centre (pass centre→next for a source) or arriving at it
// (pass centre→previous for a target). Used to learn the real side an
// obstacle-avoiding libavoid route uses, which geometry alone can't predict.
const sideFromSegment = (from: Pt, to: Pt): Side => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W'
  return dy >= 0 ? 'S' : 'N'
}

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

// Outward normal and the tangent that points along a face in the direction of
// increasing port coordinate (E/W ports run top→bottom = +y; N/S run
// left→right = +x).
const FACE_FRAME: Record<Side, { n: Pt; t: Pt }> = {
  N: { n: { x: 0, y: -1 }, t: { x: 1, y: 0 } },
  S: { n: { x: 0, y: 1 }, t: { x: 1, y: 0 } },
  E: { n: { x: 1, y: 0 }, t: { x: 0, y: 1 } },
  W: { n: { x: -1, y: 0 }, t: { x: 0, y: 1 } },
}

// Where along a face an edge should attach to avoid crossing its peers: the
// angle of the direction toward the connected node, measured in the face's
// local frame (outward normal → port-increasing tangent). Sorting a fan by
// this lays the ports out in the same rotational order the edges leave in, so
// their legs nest instead of cross — including edges that wrap onto a face
// from a node sitting off to its side (which a plain face-axis sort
// mis-orders).
const fanOrderKey = (fanCenter: Pt, connectedCenter: Pt, side: Side): number => {
  const dx = connectedCenter.x - fanCenter.x
  const dy = connectedCenter.y - fanCenter.y
  const { n, t } = FACE_FRAME[side]
  return Math.atan2(dx * t.x + dy * t.y, dx * n.x + dy * n.y)
}

interface EdgeRoutingHints {
  sourceAnchor: Pt
  targetAnchor: Pt
  // Perpendicular coordinate for the Z-jog leg, set when this edge is in a
  // multi-edge fan and needs to be staggered to avoid overlapping its peers.
  bendCoord?: number
}

// Pre-compute anchor positions for all edges. Multi-edge faces (fan-out /
// fan-in) get evenly distributed ports. Single-edge faces match the
// distributed position on the other end of the edge, or fall back to the
// smaller-node-midpoint heuristic for straight lines. Edges in a fan also
// get a staggered bend coordinate so their vertical legs don't overlap —
// inside arrows turn earlier, outside arrows turn later.
const computeEdgeAnchors = (
  elkEdges: ElkEdge[],
  edgeMeta: Map<string, { source: string; target: string; sourceSide: Side; targetSide: Side }>,
  nodes: Record<string, Rect>,
): Map<string, EdgeRoutingHints> => {
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
  const bendCoords = new Map<string, number>()

  for (const [key, group] of faceGroups) {
    if (group.length < 2) continue
    const [nodeId, sideStr] = key.split(':') as [string, string]
    const fanSide = sideStr as Side
    const fanNode = nodes[nodeId!]!
    const horiz = isHorizontalSide(fanSide)
    const [lo, hi] = faceRange(fanNode, fanSide)
    const n = group.length

    const fanCenter: Pt = {
      x: fanNode.x + fanNode.w / 2,
      y: fanNode.y + fanNode.h / 2,
    }
    const connectedCenter = (id: string): Pt => {
      const c = nodes[id]!
      return { x: c.x + c.w / 2, y: c.y + c.h / 2 }
    }
    const sorted = [...group].sort(
      (a, b) =>
        fanOrderKey(fanCenter, connectedCenter(a.connectedId), fanSide) -
        fanOrderKey(fanCenter, connectedCenter(b.connectedId), fanSide),
    )

    const step = (hi - lo) / n
    for (let i = 0; i < n; i++) {
      distributed.set(`${sorted[i]!.edgeId}:${nodeId}`, lo + step * (i + 0.5))
    }
    for (const g of group) multiFaces.add(`${g.edgeId}:${nodeId!}`)

    // Stagger bend coordinates so vertical legs don't cross horizontal
    // exit/entry segments. Group arrows by perpendicular distance from the
    // fan center — arrows at the same distance share the same depth and
    // therefore the same bend coordinate (so top and bottom symmetric pairs
    // bend at the same x and look symmetric). Outer depths (largest dist)
    // bend closest to the fan face; inner depths bend closer to the other
    // end. Their vertical legs are in disjoint y ranges (one above, one
    // below the fan center) so sharing a bend column doesn't cause overlap.
    const fanFC = faceCoord(fanNode, fanSide)
    const fanCenterPerp = horiz
      ? fanNode.y + fanNode.h / 2
      : fanNode.x + fanNode.w / 2
    const distOf = new Map<string, number>()
    for (const item of sorted) {
      const otherNode = nodes[item.connectedId]!
      const otherPerp = horiz
        ? otherNode.y + otherNode.h / 2
        : otherNode.x + otherNode.w / 2
      distOf.set(item.edgeId, Math.abs(otherPerp - fanCenterPerp))
    }
    const uniqueDists = [...new Set(distOf.values())].sort((a, b) => b - a)
    const numDepths = uniqueDists.length
    for (const item of sorted) {
      const m = edgeMeta.get(item.edgeId)!
      const isSource = m.source === nodeId
      const otherSide = isSource ? m.targetSide : m.sourceSide
      const otherNode = nodes[item.connectedId]
      if (!otherNode) continue
      const otherFC = faceCoord(otherNode, otherSide)
      const depth = uniqueDists.indexOf(distOf.get(item.edgeId)!)
      // depth 0 (most distant) → smallest offset → bend near fan face.
      // depth numDepths-1 (least distant, often a straight line) → largest
      // offset → bend near the other end (rarely used since centered).
      const offset = ((otherFC - fanFC) * (depth + 1)) / (numDepths + 1)
      if (!bendCoords.has(item.edgeId)) {
        bendCoords.set(item.edgeId, fanFC + offset)
      }
    }
  }

  // Build final anchors per edge
  const result = new Map<string, EdgeRoutingHints>()

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
      // Both single-edge: always exit/enter at face centers. If centers
      // happen to be equal it's a straight line; otherwise buildOrthogonalPath
      // inserts a Z-bend.
      srcPerp = srcHoriz ? src.y + src.h / 2 : src.x + src.w / 2
      tgtPerp = tgtHoriz ? tgt.y + tgt.h / 2 : tgt.x + tgt.w / 2
    }

    // Note: we don't try to "snap to straight line" by forcing one end's
    // anchor to match the other's center. Doing so can collide with another
    // fan member whose distributed port happens to land at the same y. The
    // distribution itself naturally produces a straight line when the
    // source y matches the assigned port y.

    const sourceAnchor: Pt = srcHoriz ? { x: srcFC, y: srcPerp } : { x: srcPerp, y: srcFC }
    const targetAnchor: Pt = tgtHoriz ? { x: tgtFC, y: tgtPerp } : { x: tgtPerp, y: tgtFC }
    let bendCoord = bendCoords.get(e.id)

    // Obstacle avoidance. If the Z-bend's perpendicular leg would pass
    // through another node, shift it just past the obstacle. Only applies
    // when both sides are parallel and the anchors aren't already aligned.
    if (srcHoriz === tgtHoriz && sourceAnchor.x !== targetAnchor.x && sourceAnchor.y !== targetAnchor.y) {
      const candidate = bendCoord ?? (srcHoriz ? (sourceAnchor.x + targetAnchor.x) / 2 : (sourceAnchor.y + targetAnchor.y) / 2)
      const adjusted = avoidObstacles(
        candidate,
        srcHoriz,
        sourceAnchor,
        targetAnchor,
        nodes,
        m.source,
        m.target,
      )
      if (adjusted !== candidate) bendCoord = adjusted
    }

    result.set(e.id, { sourceAnchor, targetAnchor, bendCoord })
  }

  return result
}

const OBSTACLE_PAD = 8

// Push the Z-bend perpendicular leg out of any node it would cross.
const avoidObstacles = (
  candidate: number,
  horizontalSides: boolean,
  src: Pt,
  tgt: Pt,
  nodes: Record<string, Rect>,
  srcId: string,
  tgtId: string,
): number => {
  // The vertical leg spans y in [yLo, yHi] at x=candidate (for horizontal
  // sides). For vertical sides, the horizontal leg spans x in [xLo, xHi]
  // at y=candidate.
  const aLo = horizontalSides ? Math.min(src.y, tgt.y) : Math.min(src.x, tgt.x)
  const aHi = horizontalSides ? Math.max(src.y, tgt.y) : Math.max(src.x, tgt.x)
  // The legal range for the perpendicular coord is between source and target
  // face (exclusive), so the entry/exit segments still exist.
  const pLo = horizontalSides
    ? Math.min(src.x, tgt.x)
    : Math.min(src.y, tgt.y)
  const pHi = horizontalSides
    ? Math.max(src.x, tgt.x)
    : Math.max(src.y, tgt.y)
  if (pHi - pLo <= 0) return candidate

  const obstacles: Array<[number, number]> = []
  for (const [id, n] of Object.entries(nodes)) {
    if (id === srcId || id === tgtId) continue
    const nALo = horizontalSides ? n.y : n.x
    const nAHi = horizontalSides ? n.y + n.h : n.x + n.w
    const nPLo = horizontalSides ? n.x : n.y
    const nPHi = horizontalSides ? n.x + n.w : n.y + n.h
    // Does this node block the leg's a-range?
    if (nAHi <= aLo || nALo >= aHi) continue
    // Is this node in the legal perpendicular range?
    if (nPHi <= pLo || nPLo >= pHi) continue
    obstacles.push([nPLo, nPHi])
  }
  if (obstacles.length === 0) return candidate

  // Does the candidate fall inside any obstacle?
  const blocking = obstacles.find(([lo, hi]) => candidate > lo && candidate < hi)
  if (!blocking) return candidate

  // Try shifting left of the obstacle, then right. Pick whichever stays in
  // the legal range.
  const leftCandidate = blocking[0] - OBSTACLE_PAD
  const rightCandidate = blocking[1] + OBSTACLE_PAD
  const leftOk = leftCandidate > pLo && !obstacles.some(([lo, hi]) => leftCandidate > lo && leftCandidate < hi)
  const rightOk = rightCandidate < pHi && !obstacles.some(([lo, hi]) => rightCandidate > lo && rightCandidate < hi)
  if (leftOk && rightOk) {
    return Math.abs(leftCandidate - candidate) <= Math.abs(rightCandidate - candidate)
      ? leftCandidate
      : rightCandidate
  }
  if (leftOk) return leftCandidate
  if (rightOk) return rightCandidate
  return candidate
}

// Pick the coordinate for the perpendicular leg of a Z-bend. Prefer a
// snapped grid value, but if it would coincide with either endpoint
// (and therefore eliminate the entry or exit segment), fall back to the
// unsnapped midpoint.
const zJogCoord = (a: number, c: number, gridSize: number): number => {
  const snapped = snap((a + c) / 2, gridSize)
  if (snapped !== a && snapped !== c) return snapped
  return (a + c) / 2
}

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

// True when any segment of the path passes through a node other than the
// edge's own endpoints.
const pathCrossesForeignNode = (
  pts: Pt[],
  nodes: Record<string, Rect>,
  srcId: string,
  tgtId: string,
): boolean => {
  for (let i = 1; i < pts.length; i += 1) {
    for (const [id, r] of Object.entries(nodes)) {
      if (id === srcId || id === tgtId) continue
      if (segCrossesRect(pts[i - 1]!, pts[i]!, r)) return true
    }
  }
  return false
}

// Normalize a polyline: drop duplicate points and collinear midpoints so the
// rendered path is minimal (libavoid can emit redundant waypoints).
const cleanPolyline = (pts: Pt[]): Pt[] => {
  const dedup: Pt[] = []
  for (const p of pts) {
    const tail = dedup[dedup.length - 1]
    if (tail && tail.x === p.x && tail.y === p.y) continue
    dedup.push({ x: p.x, y: p.y })
  }
  const out: Pt[] = []
  for (let i = 0; i < dedup.length; i += 1) {
    const prev = out[out.length - 1]
    const cur = dedup[i]!
    const next = dedup[i + 1]
    if (
      prev &&
      next &&
      ((prev.x === cur.x && cur.x === next.x) ||
        (prev.y === cur.y && cur.y === next.y))
    ) {
      continue // cur lies on the straight segment prev→next
    }
    out.push(cur)
  }
  return out
}

// Slide the first (source) or last (target) leg of a libavoid polyline so it
// meets the node face at `anchor` — the distributed port — instead of
// libavoid's centre pin. The touching leg is perpendicular to the face, so we
// move it along the face by rewriting the shared coordinate of its two end
// points, which keeps the polyline orthogonal. This both spaces libavoid edges
// apart from their fan peers and lands their arrowheads on the node border
// (where synthetic edges put them) rather than hidden under the node centre.
const snapLibEnd = (
  poly: Pt[],
  anchor: Pt,
  side: Side,
  end: 'source' | 'target',
): void => {
  if (poly.length < 2) return
  const horiz = isHorizontalSide(side) // W/E face → the touching leg is horizontal
  const i = end === 'source' ? 0 : poly.length - 1
  const j = end === 'source' ? 1 : poly.length - 2
  poly[i] = { x: anchor.x, y: anchor.y }
  poly[j] = horiz
    ? { x: poly[j]!.x, y: anchor.y }
    : { x: anchor.x, y: poly[j]!.y }
}

// Synthesize a fully-orthogonal polyline from the two anchors. The first
// segment always leaves perpendicular to the source side and the last
// segment always arrives perpendicular to the target side. Z-jogs use the
// midpoint between the two anchors.
const buildOrthogonalPath = (
  A: Pt,
  C: Pt,
  sourceSide: Side,
  targetSide: Side,
  gridSize: number,
  bendCoord?: number,
): Pt[] => {
  const srcHoriz = isHorizontalSide(sourceSide)
  const tgtHoriz = isHorizontalSide(targetSide)
  const out: Pt[] = [{ x: A.x, y: A.y }]

  if (srcHoriz === tgtHoriz) {
    if (srcHoriz) {
      if (A.y !== C.y) {
        const midX = bendCoord ?? zJogCoord(A.x, C.x, gridSize)
        out.push({ x: midX, y: A.y }, { x: midX, y: C.y })
      }
    } else if (A.x !== C.x) {
      const midY = bendCoord ?? zJogCoord(A.y, C.y, gridSize)
      out.push({ x: A.x, y: midY }, { x: C.x, y: midY })
    }
  } else {
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

// After per-edge anchors are computed, look across edges for axis-aligned
// segments that share a coordinate and intersect. Two unrelated edges whose
// endpoints happen to land at the same face-center coordinate (common when
// nodes share a center axis — e.g. a vertical column of nodes all at the
// same center x) will draw vertical or horizontal legs that overlap. Shift
// one of the endpoints along its node face so the leg moves off the shared
// coordinate. Iterates a few times in case a nudge creates a new collision.
interface AxisSegment {
  axis: 'V' | 'H'
  coord: number
  lo: number
  hi: number
  endpoint: 'source' | 'target' | null
}

const segmentsFor = (
  hints: EdgeRoutingHints,
  m: { sourceSide: Side; targetSide: Side },
  gridSize: number,
): AxisSegment[] => {
  const path = buildOrthogonalPath(
    hints.sourceAnchor,
    hints.targetAnchor,
    m.sourceSide,
    m.targetSide,
    gridSize,
    hints.bendCoord,
  )
  const segs: AxisSegment[] = []
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!
    const b = path[i]!
    const isFirst = i === 1
    const isLast = i === path.length - 1
    const endpoint: 'source' | 'target' | null = isFirst
      ? 'source'
      : isLast
        ? 'target'
        : null
    if (a.x === b.x && a.y !== b.y) {
      segs.push({
        axis: 'V',
        coord: a.x,
        lo: Math.min(a.y, b.y),
        hi: Math.max(a.y, b.y),
        endpoint,
      })
    } else if (a.y === b.y && a.x !== b.x) {
      segs.push({
        axis: 'H',
        coord: a.y,
        lo: Math.min(a.x, b.x),
        hi: Math.max(a.x, b.x),
        endpoint,
      })
    }
  }
  return segs
}

// Axis-aligned segments of an already-rendered polyline (e.g. a libavoid route).
// These edges aren't moved by the resolver, but other edges must still avoid
// running on top of them, so we expose their legs as fixed obstacles.
const segmentsFromPolyline = (poly: Pt[]): AxisSegment[] => {
  const segs: AxisSegment[] = []
  for (let i = 1; i < poly.length; i += 1) {
    const a = poly[i - 1]!
    const b = poly[i]!
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5) {
      segs.push({ axis: 'V', coord: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), endpoint: null })
    } else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) {
      segs.push({ axis: 'H', coord: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), endpoint: null })
    }
  }
  return segs
}

const nudgeAnchorAlongFace = (
  node: Rect,
  side: Side,
  current: Pt,
  attempts: number[],
): Pt => {
  const horiz = isHorizontalSide(side)
  const [lo, hi] = faceRange(node, side)
  const cur = horiz ? current.y : current.x
  for (const delta of attempts) {
    const next = cur + delta
    if (next >= lo && next <= hi) {
      return horiz ? { x: current.x, y: next } : { x: next, y: current.y }
    }
  }
  return current
}

const resolveSegmentOverlaps = (
  edgeAnchors: Map<string, EdgeRoutingHints>,
  edgeMeta: Map<string, { source: string; target: string; sourceSide: Side; targetSide: Side }>,
  nodes: Record<string, Rect>,
  gridSize: number,
  // Edges drawn from libavoid's polyline rather than their synthetic anchors;
  // their `hints` describe a path that won't be rendered, so excluding them
  // keeps the overlap check from chasing phantom segments.
  skip: Map<string, Pt[]>,
): void => {
  const OVERLAP_TOLERANCE = 4 // segments closer than this are considered identical
  const nudgeAmount = Math.max(gridSize / 2, 16)
  const NUDGE_ATTEMPTS = [nudgeAmount, -nudgeAmount, nudgeAmount * 2, -nudgeAmount * 2]
  // Two parallel BEND legs that merely run close (e.g. a counter-directional
  // A→B / B→A pair) still read as one overlapping line, so we don't just break
  // the 4px tie — we open a full grid cell between them.
  const BEND_MIN_GAP = gridSize
  // One conflict is resolved per pass; the diagram has enough edges that a few
  // relocations can cascade, so allow a generous (still bounded) budget.
  const MAX_ITERATIONS = 16
  // Endpoint nudges move a fixed step (not to a guaranteed-clear slot), so two
  // legs on one face can ping-pong forever. Cap each so the loop can't spin on
  // an unsolvable face and starve the bend relocations.
  const MAX_ENDPOINT_NUDGES = 3
  const endpointNudges = new Map<string, number>()

  const bendCoordOf = (h: EdgeRoutingHints, axis: 'H' | 'V'): number =>
    h.bendCoord ??
    (axis === 'V'
      ? (h.sourceAnchor.x + h.targetAnchor.x) / 2
      : (h.sourceAnchor.y + h.targetAnchor.y) / 2)

  // libavoid-routed edges aren't moved here, but their rendered legs are fixed
  // obstacles every relocation must avoid — otherwise a nudge can shove a
  // synthetic edge straight onto a route the resolver can't see.
  const fixedSegments: AxisSegment[] = []
  for (const poly of skip.values()) fixedSegments.push(...segmentsFromPolyline(poly))

  const spanOverlap = (a: AxisSegment, b: AxisSegment): number =>
    Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)

  // Two orthogonal legs cross when a vertical's x falls strictly inside a
  // horizontal's x-range and that horizontal's y falls strictly inside the
  // vertical's y-range. Strict bounds so a shared corner/T-junction isn't a
  // crossing.
  const segmentsCross = (a: AxisSegment, b: AxisSegment): boolean => {
    if (a.axis === b.axis) return false
    const v = a.axis === 'V' ? a : b
    const h = a.axis === 'V' ? b : a
    return v.coord > h.lo && v.coord < h.hi && h.coord > v.lo && h.coord < v.hi
  }

  // Slide a bend leg to a coordinate that (a) clears every other leg by a full
  // gap and (b) introduces no edge crossing. Picking the nearest clear slot
  // alone isn't enough: separating a counter-directional A→B / B→A pair to the
  // wrong side makes the two links cross instead of nest. So among clear slots
  // we prefer the nearest *crossing-free* one, falling back to fewest crossings.
  const relocateBendLeg = (
    edgeId: string,
    leg: AxisSegment,
    segs: Map<string, AxisSegment[]>,
  ): boolean => {
    const hints = edgeAnchors.get(edgeId)
    const meta = edgeMeta.get(edgeId)
    if (!hints || !meta) return false
    const axis = leg.axis
    const span = axis === 'V'
      ? [hints.sourceAnchor.x, hints.targetAnchor.x]
      : [hints.sourceAnchor.y, hints.targetAnchor.y]
    const margin = Math.min(nudgeAmount, (Math.max(...span) - Math.min(...span)) / 3)
    const lo = Math.min(...span) + margin
    const hi = Math.max(...span) - margin
    if (hi <= lo) return false
    const otherSegs: AxisSegment[] = [...fixedSegments]
    for (const [oid, osegs] of segs) if (oid !== edgeId) otherSegs.push(...osegs)
    const blockers = otherSegs
      .filter((os) => os.axis === axis && spanOverlap(os, leg) > OVERLAP_TOLERANCE)
      .map((os) => os.coord)
    const clear = (c: number): boolean =>
      c >= lo && c <= hi && blockers.every((b) => Math.abs(c - b) >= BEND_MIN_GAP - 1)
    const crossingsAt = (c: number): number => {
      let n = 0
      for (const ms of segmentsFor({ ...hints, bendCoord: c }, meta, gridSize)) {
        for (const os of otherSegs) if (segmentsCross(ms, os)) n += 1
      }
      return n
    }
    const cur = bendCoordOf(hints, axis)
    const step = Math.max(8, gridSize / 4)
    let best: { c: number; cross: number } | null = null
    for (let d = step; d <= hi - lo; d += step) {
      for (const c of [cur + d, cur - d]) {
        if (!clear(c)) continue
        const cross = crossingsAt(c)
        if (cross === 0) {
          edgeAnchors.set(edgeId, { ...hints, bendCoord: c })
          return true
        }
        if (!best || cross < best.cross) best = { c, cross }
      }
    }
    if (best) {
      edgeAnchors.set(edgeId, { ...hints, bendCoord: best.c })
      return true
    }
    return false
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
    const segs = new Map<string, AxisSegment[]>()
    for (const [edgeId, hints] of edgeAnchors) {
      if (skip.has(edgeId)) continue
      const m = edgeMeta.get(edgeId)!
      segs.set(edgeId, segmentsFor(hints, m, gridSize))
    }

    // Every leg this movable edge could collide with: other movable edges' legs
    // plus the fixed libavoid routes.
    const others = (selfId: string): AxisSegment[] => {
      const out: AxisSegment[] = [...fixedSegments]
      for (const [oid, osegs] of segs) if (oid !== selfId) out.push(...osegs)
      return out
    }

    // Collect ALL conflicts this pass (endpoint legs preferred — nudging along a
    // node face is the cheapest move). We then try them in order and act on the
    // first that actually makes progress: skipping an unsolvable one instead of
    // aborting is what lets a later, solvable conflict still get fixed.
    const endpointConflicts: { edgeId: string; endpoint: 'source' | 'target' }[] = []
    const bendConflicts: { edgeId: string; leg: AxisSegment }[] = []
    for (const [e1, segs1] of segs) {
      const rest = others(e1)
      for (const s1 of segs1) {
        for (const s2 of rest) {
          if (s1.axis !== s2.axis) continue
          if (spanOverlap(s1, s2) <= OVERLAP_TOLERANCE) continue // no shared span
          const coordGap = Math.abs(s1.coord - s2.coord)
          // Only (near-)coincident legs count as overlapping — legs that merely
          // run close are left alone so existing tight bundles aren't spread
          // apart. A flagged bend leg is then relocated to a clear GAP, not just
          // off the shared coordinate, so the fix is unambiguously visible.
          if (coordGap > OVERLAP_TOLERANCE) continue
          // s2 may be a fixed (immovable) leg, so only s1 — always movable — is a
          // candidate; the other edge's conflicts surface when it is scanned.
          if (s1.endpoint) {
            endpointConflicts.push({ edgeId: e1, endpoint: s1.endpoint })
          } else {
            bendConflicts.push({ edgeId: e1, leg: s1 })
          }
          break // one conflict per leg is enough to drive a fix
        }
      }
    }

    // Resolve one endpoint AND one bend per pass — independently — so an
    // oscillating face can never starve the bend relocations.
    let progressed = false
    for (const c of endpointConflicts) {
      const key = `${c.edgeId}:${c.endpoint}`
      if ((endpointNudges.get(key) ?? 0) >= MAX_ENDPOINT_NUDGES) continue
      const m = edgeMeta.get(c.edgeId)!
      const hints = edgeAnchors.get(c.edgeId)!
      const isSource = c.endpoint === 'source'
      const node = nodes[isSource ? m.source : m.target]
      if (!node) continue
      const side = isSource ? m.sourceSide : m.targetSide
      const currentAnchor = isSource ? hints.sourceAnchor : hints.targetAnchor
      const nudged = nudgeAnchorAlongFace(node, side, currentAnchor, NUDGE_ATTEMPTS)
      if (nudged === currentAnchor) continue // can't move this one — try the next
      endpointNudges.set(key, (endpointNudges.get(key) ?? 0) + 1)
      edgeAnchors.set(c.edgeId, {
        ...hints,
        sourceAnchor: isSource ? nudged : hints.sourceAnchor,
        targetAnchor: isSource ? hints.targetAnchor : nudged,
      })
      progressed = true
      break
    }
    for (const c of bendConflicts) {
      if (relocateBendLeg(c.edgeId, c.leg, segs)) {
        progressed = true
        break
      }
    }
    if (!progressed) return // nothing left we can improve
  }
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
