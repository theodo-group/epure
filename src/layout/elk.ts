// The router: diagram + layout sidecar (grid units) → drawable geometry
// (pixels). `route()` is the pipeline; each stage lives in its own module:
//
//   geometry      grid → pixel node rects
//   areaGeometry  area boxes + title chips (obstacles AND rendered areas)
//   faces         which face each edge end uses (guess → learned / cached)
//   anchors       where on that face (fan-ordered ports, Z-jog coordinates)
//   libavoidGraph libavoid calls, one per blocking-area group
//   refine        port swaps that strictly lower the crossing count
//   snap          which libavoid routes are adopted, back on the grid
//   synthetic     the anchor-to-anchor fallback (through any `via`
//                 waypoints) and its overlap resolver
//   labels        label anchors (+ the user's grid-unit nudge)
//
// Every stage degrades rather than throws: with no wasm, faces stay guessed and
// every edge is drawn by the synthetic router.

import type { RouteResult } from '@mr_mint/elkjs-libavoid'

import type { Diagram } from '@/parser/ast'

import { computeEdgeAnchors } from './anchors'
import { computeAreaGeometry, layoutAreas } from './areaGeometry'
import { buildAreaTree } from './areaTree'
import { type EdgeMeta, type FaceCache, guessFaces, settleFaces } from './faces'
import { nodeRects, type Pt, type Rect } from './geometry'
import { edgeKey } from './ids'
import { labelAnchorFor } from './labels'
import { libavoidScene, routeWithAnchors } from './libavoidGraph'
import { refinePortSwaps } from './refine'
import { adoptLibavoidRoute } from './snap'
import { resolveSegmentOverlaps, stubRoutes, syntheticPath } from './synthetic'
import type { EdgeRoute, LayoutSidecar, NodeLayout, RoutedDiagram } from './types'

export { setLibavoidWasmPath } from './libavoidGraph'
export { FaceCache } from './faces'

export interface RouteOpts {
  /** Interactive fast path (e.g. mid-drag): reuse cached faces when the topology
   *  matches, route areas-blind in one call and skip the crossing-reduction swap
   *  pass. The editor follows every quick route with a full one once the
   *  interaction settles. Export/tests use the default (full) path so the
   *  committed geometry is always best-quality. */
  quick?: boolean
  /** Faces carried between routes (see `FaceCache`). Full routes refresh it;
   *  quick routes read it. Without one, a quick route learns faces itself. */
  faceCache?: FaceCache
}

export const route = async (
  diagram: Diagram,
  layout: LayoutSidecar,
  opts: RouteOpts = {},
): Promise<RoutedDiagram> => {
  const { gridSize } = layout
  const quick = opts.quick === true

  const nodes = nodeRects(diagram, layout)
  const areaTree = buildAreaTree(diagram.areas)
  const areas = computeAreaGeometry(diagram, areaTree, nodes)
  const { edgeIds, edgeMeta } = guessFaces(diagram, layout, nodes)
  const scene = libavoidScene(
    {
      diagram,
      nodes,
      edgeIds,
      edgeMeta,
      areaTree,
      areaObstacles: areas.areaObstacles,
      titleObstacles: areas.titleObstacles,
    },
    gridSize,
  )

  await settleFaces(scene, quick, opts.faceCache)

  // Distributed, fan-ordered anchor positions per edge. Computed BEFORE routing
  // so each edge can be given its OWN libavoid port at its anchor.
  const anchors = computeEdgeAnchors(edgeIds, edgeMeta, nodes, areas.areaObstacles)

  // Whether libavoid actually ran. When it did, its routed polyline already
  // avoids every obstacle, so we use it directly; only the no-wasm fallback
  // falls back to the synthetic anchor-to-anchor path (which can't detour).
  let routes: Map<string, RouteResult>
  let libavoidOk = false
  try {
    routes = await routeWithAnchors(scene, anchors, quick)
    libavoidOk = true
  } catch {
    routes = stubRoutes(edgeIds, edgeMeta, anchors)
  }
  if (libavoidOk && !quick) {
    routes = await refinePortSwaps(edgeIds, edgeMeta, anchors, routes, (trial) =>
      routeWithAnchors(scene, trial),
    )
  }

  // Adopt libavoid's routes; the synthetic path is kept only for edges libavoid
  // couldn't honor (a pin it couldn't satisfy, a degenerate route) and the
  // no-wasm fallback.
  const libPolys = new Map<string, Pt[]>()
  const snapObstacles = [...areas.areaObstacles, ...areas.titleObstacles]
  if (libavoidOk) {
    for (const id of edgeIds) {
      const poly = adoptLibavoidRoute(
        routes.get(id),
        edgeMeta.get(id)!,
        gridSize,
        nodes,
        snapObstacles,
      )
      if (poly) libPolys.set(id, poly)
    }
  }

  // Separate the remaining synthetic edges (pin bail-outs + no-wasm fallback) and
  // keep them clear of the adopted libavoid routes (passed as fixed obstacles).
  resolveSegmentOverlaps(anchors, edgeMeta, nodes, gridSize, libPolys)

  const edges = edgeIds.map((id) => {
    const meta = edgeMeta.get(id)!
    const points = libPolys.get(id) ?? syntheticPath(anchors.get(id)!, meta, gridSize)
    return edgeRoute(id, meta, points, nodes, layout)
  })

  return {
    gridSize,
    nodes: layoutNodes(diagram, nodes, layout),
    areas: layoutAreas(diagram, areaTree, areas.rects, layout),
    edges,
  }
}

// An edge's final polyline plus its sidecar style. The label anchor bakes in
// the user's nudge; labelDx/labelDy are surfaced too so the label drag handle
// can read the committed offset as its starting point.
const edgeRoute = (
  id: string,
  meta: EdgeMeta,
  points: Pt[],
  nodes: Record<string, Rect>,
  layout: LayoutSidecar,
): EdgeRoute => {
  const styleSpec = layout.edges[edgeKey(meta.source, meta.target)]
  return {
    id,
    source: { nodeId: meta.source, side: meta.sourceSide },
    target: { nodeId: meta.target, side: meta.targetSide },
    points,
    labelAnchor: labelAnchorFor(points, nodes, styleSpec, layout.gridSize),
    via: meta.via.length > 0 ? meta.via : undefined,
    color: styleSpec?.color,
    lineStyle: styleSpec?.lineStyle,
    width: styleSpec?.width,
    startCap: styleSpec?.startCap,
    endCap: styleSpec?.endCap,
    labelDx: styleSpec?.labelDx,
    labelDy: styleSpec?.labelDy,
  }
}

const layoutNodes = (
  diagram: Diagram,
  nodes: Record<string, Rect>,
  layout: LayoutSidecar,
): NodeLayout[] =>
  diagram.nodes.map((n) => {
    const pos = nodes[n.id]!
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
