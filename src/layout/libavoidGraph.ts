// Everything that talks to libavoid: where its wasm loads from, the routing
// options, and how a diagram plus per-edge anchors becomes libavoid calls.
//
// Hidden here: libavoid's graph format (one port per edge end, SIMPLE edge
// format), and the per-call obstacle sets that make areas work — libavoid has
// no notion of an obstacle that blocks only some edges, so edges are grouped by
// which areas block them and routed one call per group. Callers hand in pixel
// anchors and get back libavoid's raw `RouteResult` per edge id; everything is
// in canvas pixels. Any libavoid call may throw when the wasm can't load —
// callers own the fallback.

import {
  init,
  routeEdges,
  type ElkEdge,
  type ElkNode,
  type ElkPort,
  type LibavoidRoutingOptions,
  type RouteResult,
} from '@mr_mint/elkjs-libavoid'

import type { Diagram } from '@/parser/ast'

import type { EdgeRoutingHints } from './anchors'
import { type AreaObstacle, areaBlocksEdge } from './areaGeometry'
import type { AreaTree } from './areaTree'
import { checkpointProperties, type EdgeMeta } from './faces'
import { cleanPolyline, type Pt, type Rect, rectContains } from './geometry'

// Where libavoid loads its wasm from. In the browser it's served at the app
// base path — honour a non-root base (e.g. deployed under a GitHub Pages
// subpath), same idiom as src/icons. The headless Node export (`epure export`)
// overrides this with an absolute filesystem path so real routing runs
// server-side instead of the degraded fallback. Without a real wasm, route()
// still works via the stub-route fallback (synthetic.ts).
let wasmLocator = `${import.meta.env?.BASE_URL || '/'}libavoid.wasm`
export const setLibavoidWasmPath = (path: string): void => {
  wasmLocator = path
}

/** Load libavoid's wasm (idempotent). Rejects when it can't be loaded. */
export const initLibavoid = () => init(wasmLocator)

// Shared libavoid options. `crossingPenalty` is the single biggest global lever
// for edge-edge crossings and was previously left at libavoid's default of 0 —
// i.e. the router was told not to care about crossings at all. `segmentPenalty`
// (default 10) discourages extra bends. `idealNudgingDistance` is set to a full
// grid cell so parallel runs sit a cell apart (matching Épure's hand-tuned
// look), and `shapeBufferDistance` to half a cell so detours clear obstacles.
export const routeOptions = (gridSize: number): LibavoidRoutingOptions => ({
  routingType: 'orthogonal',
  shapeBufferDistance: Math.max(8, gridSize / 2),
  idealNudgingDistance: gridSize,
  segmentPenalty: 10,
  // A crossing costs ~10 extra segments (segmentPenalty 10) — enough to detour
  // around an avoidable crossing without over-bending simple diagrams.
  crossingPenalty: 100,
  nudgeOrthogonalSegmentsConnectedToShapes: true,
  nudgeSharedPathsWithCommonEndPoint: true,
})

/** A libavoid result as a minimal polyline (redundant waypoints dropped). */
export const polyOf = (r: RouteResult): Pt[] =>
  cleanPolyline([r.sourcePoint, ...r.bendPoints, r.targetPoint])

/** What stays fixed across every libavoid call of one route(): the nodes, the
 *  edges' endpoints, and the area/title obstacles. Only anchors vary. */
export interface LibavoidScene {
  diagram: Diagram
  nodes: Record<string, Rect>
  edgeIds: string[]
  edgeMeta: Map<string, EdgeMeta>
  areaTree: AreaTree
  areaObstacles: AreaObstacle[]
  titleObstacles: AreaObstacle[]
  options: LibavoidRoutingOptions
  /** The libavoid obstacle children for the titles, built once and reused
   *  across every routing sub-call. */
  titleChildren: ElkNode[]
}

export const libavoidScene = (
  base: Omit<LibavoidScene, 'titleChildren' | 'options'>,
  gridSize: number,
): LibavoidScene => ({
  ...base,
  options: routeOptions(gridSize),
  titleChildren: base.titleObstacles.map((t) => ({
    id: `__title__${t.id}`,
    x: t.rect.x,
    y: t.rect.y,
    width: t.rect.w,
    height: t.rect.h,
  })),
})

// The libavoid graph with a dedicated port per edge end, placed at that edge's
// distributed anchor, in libavoid's SIMPLE edge format (`source`/`sourcePort`).
// The extended `sources:[…]` format the old code used silently DROPS the port
// (the wrapper returns a center pin), which is the real reason libavoid seemed
// to "ignore our ports" and had to pick faces itself. With a real port,
// libavoid attaches exactly at the anchor and — from the anchor's position on
// the node border — leaves via the right face, so its obstacle-avoiding
// polyline already lands on our fan-ordered ports. No post-hoc endpoint
// snapping (which used to drag legs through nodes) needed.
const srcPortId = (id: string) => `${id}::s`
const tgtPortId = (id: string) => `${id}::t`

const buildGraph = (scene: LibavoidScene, anchors: Map<string, EdgeRoutingHints>) => {
  const { nodes, edgeIds, edgeMeta } = scene
  const portsByNode = new Map<string, ElkPort[]>()
  const addPort = (nodeId: string, pid: string, abs: Pt) => {
    const node = nodes[nodeId]!
    const arr = portsByNode.get(nodeId) ?? []
    arr.push({ id: pid, x: abs.x - node.x, y: abs.y - node.y, width: 0, height: 0 })
    portsByNode.set(nodeId, arr)
  }
  for (const id of edgeIds) {
    const m = edgeMeta.get(id)!
    const h = anchors.get(id)!
    addPort(m.source, srcPortId(id), h.sourceAnchor)
    addPort(m.target, tgtPortId(id), h.targetAnchor)
  }
  // Every rect, not just the declared nodes: an edge whose end is not declared
  // gets a placeholder rect (see `nodeRects`), and libavoid must know it too,
  // or it rejects the whole graph and every edge falls back to the straight
  // synthetic path.
  const elkNodes: ElkNode[] = Object.entries(nodes).map(([id, pos]) => ({
    id,
    x: pos.x,
    y: pos.y,
    width: pos.w,
    height: pos.h,
    ports: portsByNode.get(id) ?? [],
  }))
  const elkEdges: ElkEdge[] = edgeIds.map((id) => {
    const m = edgeMeta.get(id)!
    return {
      id,
      source: m.source,
      target: m.target,
      sourcePort: srcPortId(id),
      targetPort: tgtPortId(id),
      properties: checkpointProperties(m),
    }
  })
  return { elkNodes, elkEdges }
}

// Group edges by the TOPMOST areas that block them (see `routeWithAnchors`).
// Groups come out in first-seen edge order, each keyed by its sorted area ids.
// Exported for tests.
export const groupByBlockingAreas = (
  elkEdges: ElkEdge[],
  edgeMeta: Map<string, EdgeMeta>,
  areaObstacles: AreaObstacle[],
  areaTree: AreaTree,
): Map<string, { areas: AreaObstacle[]; edges: ElkEdge[] }> => {
  const groups = new Map<string, { areas: AreaObstacle[]; edges: ElkEdge[] }>()
  for (const e of elkEdges) {
    const m = edgeMeta.get(e.id)!
    const blocking = areaObstacles.filter((a) => areaBlocksEdge(a, m.source, m.target))
    const blockingIds = new Set(blocking.map((a) => a.id))
    const topmost = blocking.filter((a) => {
      const ancs = areaTree.ancestorsOf.get(a.id)
      if (!ancs) return true
      for (const anc of ancs) if (blockingIds.has(anc)) return false
      return true
    })
    const sig = topmost
      .map((a) => a.id)
      .sort()
      .join('|')
    let g = groups.get(sig)
    if (!g) {
      g = { areas: topmost, edges: [] }
      groups.set(sig, g)
    }
    g.edges.push(e)
  }
  return groups
}

// Run libavoid with areas injected as obstacle shapes. libavoid has no
// per-edge obstacle set (and handles OVERLAPPING obstacles permissively — a
// solid area rect laid over its own members lets routes thread the gaps
// between them), so edges are grouped by WHICH areas block them (an area
// blocks an edge when neither endpoint is a transitive member — see
// `areaBlocksEdge`) and one call runs per distinct blocking set:
//   • the group's blocking areas are SOLID obstacles, and the nodes they
//     (transitively) contain are omitted entirely — each rect stands in for
//     its nodes, so there's no overlap and the cluster is genuinely
//     impassable;
//   • areas that contain an endpoint are simply absent from the group's
//     obstacle set, so an edge crosses its own containers' borders freely.
// A blocking set is first reduced to its TOPMOST areas: a nested blocking
// area's rect lies inside its blocking ancestor's rect by construction, so
// the ancestor alone suffices. With flat areas this reproduces the old
// outside/inside 2-call split; with nested areas it yields hierarchy-aware
// routing — an edge between cousins detours around unrelated clusters while
// passing into its own ancestors. With no areas this is a single call.
//
// `skipAreas` (quick/mid-drag path) routes everything in ONE libavoid call
// instead of the per-group area split — a fraction of the WASM work per frame.
// Areas are re-avoided by the full route once the interaction settles.
export const routeWithAnchors = async (
  scene: LibavoidScene,
  anchors: Map<string, EdgeRoutingHints>,
  skipAreas = false,
): Promise<Map<string, RouteResult>> => {
  const { elkNodes, elkEdges } = buildGraph(scene, anchors)
  const { areaObstacles, titleObstacles, titleChildren, options } = scene
  await initLibavoid()
  // Title chips block every edge, so they go into every call below.
  if (skipAreas || areaObstacles.length === 0) {
    return routeEdges(
      { id: 'root', children: [...elkNodes, ...titleChildren], edges: elkEdges },
      options,
    )
  }
  const groups = groupByBlockingAreas(elkEdges, scene.edgeMeta, areaObstacles, scene.areaTree)
  const merged = new Map<string, RouteResult>()
  for (const g of groups.values()) {
    // Nodes covered by a solid blocking rect are omitted for this group; the
    // group's edges never end on one (blocking ⇒ neither endpoint inside).
    const covered = new Set<string>()
    for (const a of g.areas) for (const nid of a.members) covered.add(nid)
    const areaChildren: ElkNode[] = g.areas.map((a) => ({
      id: `__area__${a.id}`,
      x: a.rect.x,
      y: a.rect.y,
      width: a.rect.w,
      height: a.rect.h,
    }))
    // Title chips FULLY contained in one of this group's solid rects are
    // dropped from the call: they're redundant there (the rect already
    // blocks the whole region) and libavoid handles a fully-overlapping
    // obstacle pair permissively — a contained chip opens a phantom channel
    // straight through the solid rect (routes squeezed between a nested
    // area's chip and its parent's border). A chip merely STRADDLING its own
    // border is kept — that partial overlap is the long-standing, safe case.
    const groupTitles: ElkNode[] = []
    for (const t of titleObstacles) {
      if (g.areas.some((a) => rectContains(a.rect, t.rect))) continue
      groupTitles.push({
        id: `__title__${t.id}`,
        x: t.rect.x,
        y: t.rect.y,
        width: t.rect.w,
        height: t.rect.h,
      })
    }
    const r = await routeEdges(
      {
        id: 'root',
        children: [...elkNodes.filter((n) => !covered.has(n.id)), ...areaChildren, ...groupTitles],
        edges: g.edges,
      },
      options,
    )
    for (const [k, v] of r) merged.set(k, v)
  }
  return merged
}
