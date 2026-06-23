import ELK from '@mr_mint/elkjs-libavoid'
import type {
  ElkExtendedEdge,
  ElkNode,
  ElkPort,
  LayoutOptions,
} from 'elkjs'

import type { Diagram } from '@/parser/ast'

import type {
  EdgeRoute,
  LayoutSidecar,
  RoutedDiagram,
  Side,
} from './types'

const elk = new ELK()

const SIDE_TO_ELK: Record<Side, string> = {
  N: 'NORTH',
  S: 'SOUTH',
  E: 'EAST',
  W: 'WEST',
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

const buildPorts = (w: number, h: number): ElkPort[] =>
  (['N', 'S', 'E', 'W'] as Side[]).map((side) => {
    const { x, y } = portOffset(side, w, h)
    return {
      id: portId('PLACEHOLDER', side),
      x,
      y,
      width: 0,
      height: 0,
      layoutOptions: {
        'org.eclipse.elk.port.side': SIDE_TO_ELK[side],
      },
    }
  })

const portsForNode = (nodeId: string, w: number, h: number): ElkPort[] =>
  buildPorts(w, h).map((port) => {
    const side = port.id?.split('.').pop() as Side
    return { ...port, id: portId(nodeId, side) }
  })

const polylineLength = (points: { x: number; y: number }[]) => {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    )
  }
  return total
}

const longestHorizontalMidpoint = (
  points: { x: number; y: number }[],
): { x: number; y: number } | undefined => {
  let bestLen = 0
  let best: { x: number; y: number } | undefined
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
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
    const a = points[i - 1]
    const b = points[i]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (acc + seg >= half) {
      const t = seg === 0 ? 0 : (half - acc) / seg
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    acc += seg
  }
  return points[points.length - 1]
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

  const layoutOptions: LayoutOptions = {
    'org.eclipse.elk.algorithm': 'org.eclipse.elk.alg.libavoid',
    'org.eclipse.elk.edgeRouting': 'ORTHOGONAL',
    'org.eclipse.elk.portConstraints': 'FIXED_POS',
    'org.eclipse.elk.alg.libavoid.shapeBufferDistance': String(gridSize),
    'org.eclipse.elk.alg.libavoid.idealNudgingDistance': String(gridSize),
  }

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
      layoutOptions: {
        'org.eclipse.elk.portConstraints': 'FIXED_POS',
      },
      ports: portsForNode(n.id, pos.w, pos.h),
    }
  })

  const edgeById = new Map<
    string,
    { source: string; target: string; sourceSide: Side; targetSide: Side }
  >()

  const elkEdges: ElkExtendedEdge[] = diagram.edges.map((e, i) => {
    const sides = layout.edges[edgeKey(e.source, e.target)]
    const sourceSide: Side = sides?.sourceSide ?? 'E'
    const targetSide: Side = sides?.targetSide ?? 'W'
    const id = makeEdgeId(e.source, e.target, i)
    edgeById.set(id, { source: e.source, target: e.target, sourceSide, targetSide })
    return {
      id,
      sources: [portId(e.source, sourceSide)],
      targets: [portId(e.target, targetSide)],
    }
  })

  const graph: ElkNode = {
    id: 'root',
    layoutOptions,
    children: elkNodes,
    edges: elkEdges,
  }

  const routed = await elk.layout(graph)

  const routedEdges: EdgeRoute[] = (routed.edges ?? []).map((re) => {
    const meta = edgeById.get(re.id)
    const sourceSide: Side = meta?.sourceSide ?? 'E'
    const targetSide: Side = meta?.targetSide ?? 'W'

    const sections = re.sections ?? []
    const raw: { x: number; y: number }[] = []
    sections.forEach((s, idx) => {
      if (idx === 0) raw.push({ x: s.startPoint.x, y: s.startPoint.y })
      for (const bp of s.bendPoints ?? []) raw.push({ x: bp.x, y: bp.y })
      raw.push({ x: s.endPoint.x, y: s.endPoint.y })
    })

    const points = raw.map((p) => ({
      x: snap(p.x, gridSize),
      y: snap(p.y, gridSize),
    }))

    const labelAnchor =
      longestHorizontalMidpoint(points) ?? pathMidpoint(points)

    return {
      id: re.id,
      source: { nodeId: meta?.source ?? '', side: sourceSide },
      target: { nodeId: meta?.target ?? '', side: targetSide },
      points,
      labelAnchor,
    }
  })

  const nodes = (routed.children ?? []).map((rn) => ({
    id: rn.id,
    x: rn.x ?? 0,
    y: rn.y ?? 0,
    w: rn.width ?? 0,
    h: rn.height ?? 0,
  }))

  return {
    gridSize,
    nodes,
    areas: layout.areas,
    edges: routedEdges,
  }
}
