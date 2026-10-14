// The synthetic router: orthogonal paths drawn straight from the anchors, with
// no obstacle search. It covers what libavoid can't — the whole diagram when
// the wasm won't load, and single edges whose libavoid route was rejected
// (snap.ts). Its paths always leave and arrive perpendicular to their faces,
// so a pinned side is always honored. Hidden here: Z-jog placement and the
// overlap resolver that keeps synthetic legs off each other and off the
// adopted libavoid routes. Pixel space; `gridSize` is the grid pitch in px.

import type { ConnectionSide, RouteResult } from '@mr_mint/elkjs-libavoid'

import type { EdgeRoutingHints } from './anchors'
import type { EdgeMeta } from './faces'
import { cleanPolyline, faceRange, isHorizontalSide, type Pt, type Rect } from './geometry'
import { snap } from './snap'
import type { Side } from './types'

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

// Fallback when libavoid wasm cannot initialize (test environments, headless
// runs without fetch): stub routes, anchor to anchor. The real geometry is
// built by buildOrthogonalPath from the aligned anchors — no stub is adopted.
export const stubRoutes = (
  edgeIds: string[],
  edgeMeta: Map<string, EdgeMeta>,
  anchors: Map<string, EdgeRoutingHints>,
): Map<string, RouteResult> => {
  const routes = new Map<string, RouteResult>()
  for (const id of edgeIds) {
    const meta = edgeMeta.get(id)!
    const h = anchors.get(id)!
    routes.set(id, {
      sourcePoint: h.sourceAnchor,
      targetPoint: h.targetAnchor,
      bendPoints: [],
      sourceSide: connectionSideFromSide(meta.sourceSide),
      targetSide: connectionSideFromSide(meta.targetSide),
    })
  }
  return routes
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

// Synthesize a fully-orthogonal polyline from the two anchors. The first
// segment always leaves perpendicular to the source side and the last
// segment always arrives perpendicular to the target side. Z-jogs use the
// midpoint between the two anchors.
export const buildOrthogonalPath = (
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
    const corner: Pt = srcHoriz ? { x: C.x, y: A.y } : { x: A.x, y: C.y }
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

// Synthesize an orthogonal polyline from anchor A through every waypoint to
// anchor C. The first leg leaves perpendicular to the source face and the last
// arrives perpendicular to the target face; in between, each L-turn continues
// in the direction the previous leg was travelling, so the path reads as a
// single line threading the points rather than a staircase.
export const buildViaPath = (A: Pt, C: Pt, sourceSide: Side, targetSide: Side, via: Pt[]): Pt[] => {
  const stops = [...via, C]
  const out: Pt[] = [{ x: A.x, y: A.y }]
  let horizontalFirst = isHorizontalSide(sourceSide)
  stops.forEach((q, i) => {
    const p = out[out.length - 1]!
    const last = i === stops.length - 1
    if (p.x !== q.x && p.y !== q.y) {
      // Arriving on an E/W face means the final leg is horizontal, so the
      // corner of the last L sits on the target's row (vertical leg first).
      const hf = last ? !isHorizontalSide(targetSide) : horizontalFirst
      out.push(hf ? { x: q.x, y: p.y } : { x: p.x, y: q.y })
      horizontalFirst = !hf
    } else {
      horizontalFirst = p.y === q.y
    }
    out.push({ x: q.x, y: q.y })
  })
  return cleanPolyline(out)
}

// The synthetic polyline for an edge: through its waypoints when it has any,
// otherwise the plain anchor-to-anchor path (with its Z-jog).
export const syntheticPath = (
  hints: EdgeRoutingHints,
  m: { sourceSide: Side; targetSide: Side; via: Pt[] },
  gridSize: number,
): Pt[] =>
  m.via.length > 0
    ? buildViaPath(hints.sourceAnchor, hints.targetAnchor, m.sourceSide, m.targetSide, m.via)
    : buildOrthogonalPath(
        hints.sourceAnchor,
        hints.targetAnchor,
        m.sourceSide,
        m.targetSide,
        gridSize,
        hints.bendCoord,
      )

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
  m: { sourceSide: Side; targetSide: Side; via: Pt[] },
  gridSize: number,
): AxisSegment[] => {
  const path = syntheticPath(hints, m, gridSize)
  const segs: AxisSegment[] = []
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!
    const b = path[i]!
    const isFirst = i === 1
    const isLast = i === path.length - 1
    const endpoint: 'source' | 'target' | null = isFirst ? 'source' : isLast ? 'target' : null
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
      segs.push({
        axis: 'V',
        coord: a.x,
        lo: Math.min(a.y, b.y),
        hi: Math.max(a.y, b.y),
        endpoint: null,
      })
    } else if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) {
      segs.push({
        axis: 'H',
        coord: a.y,
        lo: Math.min(a.x, b.x),
        hi: Math.max(a.x, b.x),
        endpoint: null,
      })
    }
  }
  return segs
}

const nudgeAnchorAlongFace = (node: Rect, side: Side, current: Pt, attempts: number[]): Pt => {
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

// Mutates `edgeAnchors` (anchor nudges, bend relocations) for every edge NOT in
// `skip`; the skipped (adopted libavoid) routes act as fixed obstacles.
export const resolveSegmentOverlaps = (
  edgeAnchors: Map<string, EdgeRoutingHints>,
  edgeMeta: Map<string, EdgeMeta>,
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
    const span =
      axis === 'V'
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
