// Which face (N/S/E/W) each edge end attaches to — decided before any anchor
// is placed, because anchors are distributed per face.
//
// Three sources, in priority order: a side PINNED in the layout sidecar (always
// wins), the face libavoid picked in a learning pass, and a dx-vs-dy guess from
// node centres (the fallback when there's no wasm). The learning pass is the
// priciest part of a route, so an interactive caller can hand in a `FaceCache`
// and a quick route reuses the faces of the last learning route instead.
// Inputs are pixel rects; nothing here is grid-aware.

import { routeEdges, type ElkEdge, type ElkNode } from '@mr_mint/elkjs-libavoid'

import type { Diagram } from '@/parser/ast'

import { OPPOSITE_SIDE, type Pt, type Rect, sideFromSegment } from './geometry'
import { edgeKey, makeEdgeId } from './ids'
import { initLibavoid, type LibavoidScene, polyOf } from './libavoidGraph'
import type { LayoutSidecar, Side } from './types'

/** An edge's endpoints and the face each end attaches to. Faces start as a
 *  guess and are overwritten by learned faces; the `explicit*` flags mark ends
 *  pinned in the layout sidecar, which nothing overwrites. An explicit side is
 *  authoritative and is fed to libavoid as a directional port pin, so the route
 *  honors it while still avoiding obstacles. */
export interface EdgeMeta {
  source: string
  target: string
  sourceSide: Side
  targetSide: Side
  explicitSource: boolean
  explicitTarget: boolean
  /** The sidecar's `via` waypoints in canvas pixels, in order; empty when
   *  the edge has none. Every libavoid call routes the edge through them. */
  via: Pt[]
}

/** The ELK edge `properties` that make libavoid honour an edge's waypoints
 *  (read by the patched `@mr_mint/elkjs-libavoid`, see patches/). Undefined
 *  when the edge has none, so a plain edge is sent exactly as before. */
export const checkpointProperties = (meta: EdgeMeta): { checkpoints: Pt[] } | undefined =>
  meta.via.length > 0 ? { checkpoints: meta.via } : undefined

type EdgeFaces = { s: Side; t: Side }

// The face a node presents to a point: whichever axis separates them more.
const faceToward = (from: Pt, to: Pt): Side => sideFromSegment(from, to)

// Default sides from relative position: whichever axis (x or y) separates the
// two nodes more dictates the side; the target gets the opposite side. An edge
// with `via` waypoints is guessed against its first/last waypoint instead of
// the other node, since that is where its legs actually head. A
// `sourceSide`/`targetSide` pinned in the layout sidecar overrides this guess
// and is honored end-to-end. Edge ids (`src->tgt#i`) come out in diagram order,
// which every later pass iterates in.
export const guessFaces = (
  diagram: Diagram,
  layout: LayoutSidecar,
  nodes: Record<string, Rect>,
): { edgeIds: string[]; edgeMeta: Map<string, EdgeMeta> } => {
  const edgeMeta = new Map<string, EdgeMeta>()
  const edgeIds: string[] = []
  const { gridSize } = layout
  diagram.edges.forEach((e, i) => {
    const src = nodes[e.source]!
    const tgt = nodes[e.target]!
    const srcC: Pt = { x: src.x + src.w / 2, y: src.y + src.h / 2 }
    const tgtC: Pt = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 }
    const stored = layout.edges[edgeKey(e.source, e.target)]
    // A waypoint repeated back to back is one waypoint: libavoid loses its
    // way on a doubled checkpoint, and older editor builds could write them.
    const via: Pt[] = []
    for (const p of stored?.via ?? []) {
      const last = via[via.length - 1]
      if (last && last.x === p.x * gridSize && last.y === p.y * gridSize) continue
      via.push({ x: p.x * gridSize, y: p.y * gridSize })
    }
    let sourceSide: Side
    let targetSide: Side
    if (via.length > 0) {
      sourceSide = faceToward(srcC, via[0]!)
      targetSide = faceToward(tgtC, via[via.length - 1]!)
    } else {
      sourceSide = faceToward(srcC, tgtC)
      targetSide = OPPOSITE_SIDE[sourceSide]
    }
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
      via,
    })
    edgeIds.push(id)
  })
  return { edgeIds, edgeMeta }
}

// Learned faces are only meaningful for the edge list and area membership they
// were learned on — NOT the positions: a drag keeps reusing them.
const topologySig = (diagram: Diagram): string =>
  diagram.nodes.map((n) => n.id).join(',') +
  '|' +
  diagram.edges.map((e) => `${e.source}>${e.target}`).join(',') +
  '|' +
  diagram.areas.map((a) => `${a.id}:${[...a.members].sort().join('+')}`).join(',')

// A layout counts as an in-editor edit of `prev` when it still shares `nodes` or
// `edges` with it BY REFERENCE: every editor action is an immutable update that
// rebuilds only the map it touches (a drag rebuilds `nodes`, a side pin rebuilds
// `edges`, a text-scale change neither), and undo/redo restore earlier snapshots
// of that same chain. A layout arriving from outside — open, load, a remote/CC
// write, the layout-JSON editor — is freshly parsed and shares neither.
const isEditOf = (next: LayoutSidecar, prev: LayoutSidecar): boolean =>
  next === prev || next.nodes === prev.nodes || next.edges === prev.edges

/**
 * Learned faces carried from one route to the next, for interactive callers.
 *
 * A full route always learns faces and stores them here; a quick route of the
 * same topology reuses them instead of learning (that's what makes it quick).
 * The cache invalidates itself: the owner calls `track(layout)` with the
 * layout it is about to route — as it holds it, before `normalizeForRoute` —
 * and when that layout is not an in-editor edit of the previous one (see
 * `isEditOf`) the faces are dropped. Faces learned for one set of positions are
 * fine across a drag but wrong (even degenerate) for a wholesale-replaced
 * layout of the same topology, so the next quick route relearns.
 */
export class FaceCache {
  #learned: { sig: string; faces: Map<string, EdgeFaces> } | undefined
  #lineage: LayoutSidecar | undefined

  track(layout: LayoutSidecar): void {
    const prev = this.#lineage
    this.#lineage = layout
    if (prev && !isEditOf(layout, prev)) this.#learned = undefined
  }

  /** @internal — used by `settleFaces`. */
  lookup(sig: string): Map<string, EdgeFaces> | undefined {
    return this.#learned?.sig === sig ? this.#learned.faces : undefined
  }

  /** @internal — used by `settleFaces`. */
  remember(sig: string, faces: Map<string, EdgeFaces>): void {
    this.#learned = { sig, faces }
  }
}

// FACE-LEARNING PASS — the single biggest lever for edge-edge crossings on a
// FIXED placement is which face each edge attaches to, and the dx-vs-dy guess
// gets near-ties wrong (e.g. a node directly above another forces an edge up
// into a channel another edge already uses). So route once from node CENTRE
// pins — no ports, leaving libavoid free to pick each connector's face — with
// the crossing penalty on, then ADOPT the faces it chose for every non-pinned
// end. libavoid's global crossing/obstacle optimization picks far better faces
// than local geometry can. Pinned faces are authoritative and left untouched.
//
// A `quick` route reuses the cache's faces for the same topology and skips this
// pass; otherwise (full route, or a cache miss) it runs and refreshes the
// cache. Skipped silently if wasm is unavailable (the dx/dy faces stand).
// Mutates `scene.edgeMeta` in place.
export const settleFaces = async (
  scene: LibavoidScene,
  quick: boolean,
  cache: FaceCache | undefined,
): Promise<void> => {
  const { diagram, nodes, edgeIds, edgeMeta, options } = scene
  const sig = topologySig(diagram)
  const cached = quick ? cache?.lookup(sig) : undefined
  if (cached) {
    for (const id of edgeIds) {
      const m = edgeMeta.get(id)!
      const f = cached.get(id)
      if (!f) continue
      if (!m.explicitSource) m.sourceSide = f.s
      if (!m.explicitTarget) m.targetSide = f.t
    }
    return
  }
  try {
    await initLibavoid()
    // Every rect, placeholders for undeclared edge ends included (see
    // `buildGraph` in libavoidGraph.ts).
    const plainNodes: ElkNode[] = Object.entries(nodes).map(([id, pos]) => ({
      id,
      x: pos.x,
      y: pos.y,
      width: pos.w,
      height: pos.h,
    }))
    const centerEdges: ElkEdge[] = edgeIds.map((id) => {
      const m = edgeMeta.get(id)!
      return { id, source: m.source, target: m.target, properties: checkpointProperties(m) }
    })
    const learned = await routeEdges(
      { id: 'root', children: plainNodes, edges: centerEdges },
      options,
    )
    for (const id of edgeIds) {
      const m = edgeMeta.get(id)!
      if (m.explicitSource && m.explicitTarget) continue
      const res = learned.get(id)
      if (!res) continue
      const poly = polyOf(res)
      if (poly.length < 2) continue
      if (!m.explicitSource) m.sourceSide = sideFromSegment(poly[0]!, poly[1]!)
      if (!m.explicitTarget) {
        m.targetSide = sideFromSegment(poly[poly.length - 1]!, poly[poly.length - 2]!)
      }
    }
    if (cache) {
      const faces = new Map<string, EdgeFaces>()
      for (const id of edgeIds) {
        const m = edgeMeta.get(id)!
        faces.set(id, { s: m.sourceSide, t: m.targetSide })
      }
      cache.remember(sig, faces)
    }
  } catch {
    // No wasm (tests/headless without fetch): keep the dx/dy faces.
  }
}
