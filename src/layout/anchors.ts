// Where on its face each edge end attaches (its anchor), once faces are known.
//
// Input: edge ends with settled faces, pixel node rects, area obstacles. Output:
// one `EdgeRoutingHints` per edge — pixel anchors on the two node borders plus,
// for fan members, the coordinate of the Z-jog leg. Hidden here: fan ordering
// (ports laid out in the rotational order the edges leave in, so their legs
// nest instead of cross), keeping aligned members straight, and pushing jog
// legs out of foreign nodes. libavoid gets a port at each anchor; the synthetic
// fallback draws from them directly.

import { type AreaObstacle, areaBlocksEdge } from './areaGeometry'
import type { EdgeMeta } from './faces'
import {
  faceCoord,
  faceRange,
  isHorizontalSide,
  OPPOSITE_SIDE,
  type Pt,
  type Rect,
} from './geometry'
import type { Side } from './types'

export interface EdgeRoutingHints {
  sourceAnchor: Pt
  targetAnchor: Pt
  // Perpendicular coordinate for the Z-jog leg, set when this edge is in a
  // multi-edge fan and needs to be staggered to avoid overlapping its peers.
  bendCoord?: number
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

// Smallest distance between two ports on one face. A crowded face whose even
// spread is already tighter than this keeps that spread.
const MIN_PORT_GAP = 8

// Ports of a multi-edge face, in fan order. `straight[i]` is the coordinate at
// which member i would be one straight segment (undefined when it cannot be).
// Those members get their coordinate; the others share the gaps between them,
// in order, a face end counting half a gap as in the even spread. A member
// that cannot keep its coordinate (too close to a neighbour, out of order)
// loses it, the one furthest from its even slot first; with none left the
// face is spread evenly. Exported for tests.
export const placePorts = (lo: number, hi: number, straight: (number | undefined)[]): number[] => {
  const n = straight.length
  const step = (hi - lo) / n
  const even = straight.map((_, i) => lo + step * (i + 0.5))
  const gap = Math.min(MIN_PORT_GAP, step / 2)
  const pins = [...straight]

  const around = (): number[] | null => {
    const out: number[] = new Array(n)
    let from = lo
    let fromEnd = true
    let start = 0
    const fill = (end: number, to: number, toEnd: boolean) => {
      const k = end - start
      if (k === 0) return
      const left = fromEnd ? 0.5 : 1
      const total = left + (k - 1) + (toEnd ? 0.5 : 1)
      for (let j = 0; j < k; j++) out[start + j] = from + ((to - from) * (left + j)) / total
    }
    for (let i = 0; i < n; i++) {
      const pin = pins[i]
      if (pin === undefined) continue
      fill(i, pin, false)
      out[i] = pin
      from = pin
      fromEnd = false
      start = i + 1
    }
    fill(n, hi, true)
    for (let i = 1; i < n; i++) if (out[i]! - out[i - 1]! < gap) return null
    return out
  }

  for (;;) {
    if (pins.every((pin) => pin === undefined)) return even
    const placed = around()
    if (placed) return placed
    let worst = -1
    let worstOff = -1
    pins.forEach((pin, i) => {
      if (pin === undefined) return
      const off = Math.abs(pin - even[i]!)
      if (off >= worstOff) {
        worst = i
        worstOff = off
      }
    })
    pins[worst] = undefined
  }
}

// Pre-compute anchor positions for all edges. Multi-edge faces (fan-out /
// fan-in) give an aligned member the port that draws it straight and spread
// the others around it (placePorts). Single-edge faces match the
// distributed position on the other end of the edge, or fall back to the
// smaller-node-midpoint heuristic for straight lines. Edges in a fan also
// get a staggered bend coordinate so their vertical legs don't overlap —
// inside arrows turn earlier, outside arrows turn later.
export const computeEdgeAnchors = (
  edgeIds: string[],
  edgeMeta: Map<string, EdgeMeta>,
  nodes: Record<string, Rect>,
  areaObstacles: AreaObstacle[] = [],
): Map<string, EdgeRoutingHints> => {
  // Group edges by face (nodeId:side). `connectedPt` is where the edge heads
  // from this face: the other node's centre, or — for an edge with `via`
  // waypoints — the nearest waypoint, which is what its leg actually aims at.
  const faceGroups = new Map<
    string,
    Array<{ edgeId: string; connectedId: string; connectedPt: Pt }>
  >()
  const centreOf = (id: string): Pt => {
    const c = nodes[id]!
    return { x: c.x + c.w / 2, y: c.y + c.h / 2 }
  }

  for (const eid of edgeIds) {
    const m = edgeMeta.get(eid)!
    const firstVia = m.via[0]
    const lastVia = m.via[m.via.length - 1]
    for (const [nodeId, side, connId, connPt] of [
      [m.source, m.sourceSide, m.target, firstVia ?? centreOf(m.target)],
      [m.target, m.targetSide, m.source, lastVia ?? centreOf(m.source)],
    ] as [string, Side, string, Pt][]) {
      const key = `${nodeId}:${side}`
      let arr = faceGroups.get(key)
      if (!arr) {
        arr = []
        faceGroups.set(key, arr)
      }
      arr.push({ edgeId: eid, connectedId: connId, connectedPt: connPt })
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
    const sorted = [...group].sort(
      (a, b) =>
        fanOrderKey(fanCenter, a.connectedPt, fanSide) -
        fanOrderKey(fanCenter, b.connectedPt, fanSide),
    )

    // A member can be one straight segment when its other end faces this side
    // from the outside, carries no other edge (so it attaches at its centre)
    // and that centre falls inside this face's port range.
    const fanFC = faceCoord(fanNode, fanSide)
    const outward = fanSide === 'E' || fanSide === 'S' ? 1 : -1
    const straight = sorted.map(({ edgeId, connectedId }) => {
      const m = edgeMeta.get(edgeId)!
      if (m.source === m.target) return undefined
      if (m.via.length > 0) return undefined // heads for its waypoint, not the other node
      const otherSide = m.source === nodeId ? m.targetSide : m.sourceSide
      if (otherSide !== OPPOSITE_SIDE[fanSide]) return undefined
      if ((faceGroups.get(`${connectedId}:${otherSide}`)?.length ?? 0) !== 1) return undefined
      const other = nodes[connectedId]!
      if ((faceCoord(other, otherSide) - fanFC) * outward < 0) return undefined
      const centre = horiz ? other.y + other.h / 2 : other.x + other.w / 2
      return centre >= lo && centre <= hi ? centre : undefined
    })
    const ports = placePorts(lo, hi, straight)
    for (let i = 0; i < n; i++) {
      distributed.set(`${sorted[i]!.edgeId}:${nodeId}`, ports[i]!)
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
    const fanCenterPerp = horiz ? fanNode.y + fanNode.h / 2 : fanNode.x + fanNode.w / 2
    const distOf = new Map<string, number>()
    for (const item of sorted) {
      const otherPerp = horiz ? item.connectedPt.y : item.connectedPt.x
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

  for (const eid of edgeIds) {
    const m = edgeMeta.get(eid)!
    const src = nodes[m.source]!
    const tgt = nodes[m.target]!
    const srcMulti = multiFaces.has(`${eid}:${m.source}`)
    const tgtMulti = multiFaces.has(`${eid}:${m.target}`)
    const srcHoriz = isHorizontalSide(m.sourceSide)
    const tgtHoriz = isHorizontalSide(m.targetSide)
    const srcFC = faceCoord(src, m.sourceSide)
    const tgtFC = faceCoord(tgt, m.targetSide)

    let srcPerp: number
    let tgtPerp: number

    if (srcMulti && tgtMulti) {
      srcPerp = distributed.get(`${eid}:${m.source}`)!
      tgtPerp = distributed.get(`${eid}:${m.target}`)!
    } else if (srcMulti) {
      srcPerp = distributed.get(`${eid}:${m.source}`)!
      tgtPerp = tgtHoriz ? tgt.y + tgt.h / 2 : tgt.x + tgt.w / 2
    } else if (tgtMulti) {
      tgtPerp = distributed.get(`${eid}:${m.target}`)!
      srcPerp = srcHoriz ? src.y + src.h / 2 : src.x + src.w / 2
    } else {
      // Both single-edge: always exit/enter at face centers. If centers
      // happen to be equal it's a straight line; otherwise buildOrthogonalPath
      // inserts a Z-bend.
      srcPerp = srcHoriz ? src.y + src.h / 2 : src.x + src.w / 2
      tgtPerp = tgtHoriz ? tgt.y + tgt.h / 2 : tgt.x + tgt.w / 2
    }

    // A multi-edge face already placed an aligned member's port on the other
    // end's centre (placePorts, which keeps ports apart), so that member is
    // one straight segment here.

    const sourceAnchor: Pt = srcHoriz ? { x: srcFC, y: srcPerp } : { x: srcPerp, y: srcFC }
    const targetAnchor: Pt = tgtHoriz ? { x: tgtFC, y: tgtPerp } : { x: tgtPerp, y: tgtFC }
    let bendCoord = bendCoords.get(eid)

    // Obstacle avoidance. If the Z-bend's perpendicular leg would pass
    // through another node, shift it just past the obstacle. Only applies
    // when both sides are parallel and the anchors aren't already aligned.
    if (
      srcHoriz === tgtHoriz &&
      sourceAnchor.x !== targetAnchor.x &&
      sourceAnchor.y !== targetAnchor.y
    ) {
      const candidate =
        bendCoord ??
        (srcHoriz ? (sourceAnchor.x + targetAnchor.x) / 2 : (sourceAnchor.y + targetAnchor.y) / 2)
      const adjusted = avoidObstacles(
        candidate,
        srcHoriz,
        sourceAnchor,
        targetAnchor,
        nodes,
        m.source,
        m.target,
        areaObstacles,
      )
      if (adjusted !== candidate) bendCoord = adjusted
    }

    result.set(eid, { sourceAnchor, targetAnchor, bendCoord })
  }

  return result
}

const OBSTACLE_PAD = 8

// Push the Z-bend perpendicular leg out of any node — or blocking area — it
// would cross.
const avoidObstacles = (
  candidate: number,
  horizontalSides: boolean,
  src: Pt,
  tgt: Pt,
  nodes: Record<string, Rect>,
  srcId: string,
  tgtId: string,
  areaObstacles: AreaObstacle[] = [],
): number => {
  // The vertical leg spans y in [yLo, yHi] at x=candidate (for horizontal
  // sides). For vertical sides, the horizontal leg spans x in [xLo, xHi]
  // at y=candidate.
  const aLo = horizontalSides ? Math.min(src.y, tgt.y) : Math.min(src.x, tgt.x)
  const aHi = horizontalSides ? Math.max(src.y, tgt.y) : Math.max(src.x, tgt.x)
  // The legal range for the perpendicular coord is between source and target
  // face (exclusive), so the entry/exit segments still exist.
  const pLo = horizontalSides ? Math.min(src.x, tgt.x) : Math.min(src.y, tgt.y)
  const pHi = horizontalSides ? Math.max(src.x, tgt.x) : Math.max(src.y, tgt.y)
  if (pHi - pLo <= 0) return candidate

  // Foreign node rects plus any area that blocks this edge — both are just rects
  // the perpendicular leg must clear.
  const rects: Rect[] = []
  for (const [id, n] of Object.entries(nodes)) {
    if (id === srcId || id === tgtId) continue
    rects.push(n)
  }
  for (const a of areaObstacles) {
    if (areaBlocksEdge(a, srcId, tgtId)) rects.push(a.rect)
  }

  const obstacles: Array<[number, number]> = []
  for (const n of rects) {
    const nALo = horizontalSides ? n.y : n.x
    const nAHi = horizontalSides ? n.y + n.h : n.x + n.w
    const nPLo = horizontalSides ? n.x : n.y
    const nPHi = horizontalSides ? n.x + n.w : n.y + n.h
    // Does this rect block the leg's a-range?
    if (nAHi <= aLo || nALo >= aHi) continue
    // Is this rect in the legal perpendicular range?
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
  const leftOk =
    leftCandidate > pLo && !obstacles.some(([lo, hi]) => leftCandidate > lo && leftCandidate < hi)
  const rightOk =
    rightCandidate < pHi &&
    !obstacles.some(([lo, hi]) => rightCandidate > lo && rightCandidate < hi)
  if (leftOk && rightOk) {
    return Math.abs(leftCandidate - candidate) <= Math.abs(rightCandidate - candidate)
      ? leftCandidate
      : rightCandidate
  }
  if (leftOk) return leftCandidate
  if (rightOk) return rightCandidate
  return candidate
}
