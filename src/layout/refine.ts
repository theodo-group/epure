// PORT-SWAP REFINEMENT (the §5 port-ORDERING lever) — even with good face
// choice, two edges sharing a node face can cross simply because they're
// ordered wrong along that face; swapping which junction each uses uncrosses
// them. Find crossing pairs that share a face, swap their port positions, and
// re-route; keep the swap only if it strictly lowers the crossing count (so a
// swap can never make things worse). A few rounds converge.
//
// Settle-time quality step (the quick path skips it). Pixel space throughout;
// the re-route is injected so the loop doesn't know about libavoid.

import type { RouteResult } from '@mr_mint/elkjs-libavoid'

import type { EdgeRoutingHints } from './anchors'
import type { EdgeMeta } from './faces'
import type { Pt } from './geometry'
import { polyOf } from './libavoidGraph'
import type { Side } from './types'

const MAX_ROUNDS = 4

// Do two orthogonal polylines cross at an interior point (one's horizontal leg
// through the other's vertical leg, away from shared endpoints)?
const polysCross = (a: Pt[], b: Pt[]): boolean => {
  for (let i = 1; i < a.length; i += 1) {
    for (let j = 1; j < b.length; j += 1) {
      const a1 = a[i - 1]!,
        a2 = a[i]!,
        b1 = b[j - 1]!,
        b2 = b[j]!
      const aH = Math.abs(a1.y - a2.y) < 0.5 && Math.abs(a1.x - a2.x) > 0.5
      const aV = Math.abs(a1.x - a2.x) < 0.5 && Math.abs(a1.y - a2.y) > 0.5
      const bH = Math.abs(b1.y - b2.y) < 0.5 && Math.abs(b1.x - b2.x) > 0.5
      const bV = Math.abs(b1.x - b2.x) < 0.5 && Math.abs(b1.y - b2.y) > 0.5
      let h: [Pt, Pt] | null = null
      let v: [Pt, Pt] | null = null
      if (aH && bV) {
        h = [a1, a2]
        v = [b1, b2]
      } else if (aV && bH) {
        h = [b1, b2]
        v = [a1, a2]
      }
      if (!h || !v) continue
      const hy = h[0].y,
        vx = v[0].x,
        e = 1
      if (
        vx > Math.min(h[0].x, h[1].x) + e &&
        vx < Math.max(h[0].x, h[1].x) - e &&
        hy > Math.min(v[0].y, v[1].y) + e &&
        hy < Math.max(v[0].y, v[1].y) - e
      )
        return true
    }
  }
  return false
}

// Pairs of edge ids whose routes cross, in edge-id order. Exported for tests.
export const crossingPairs = (polys: Map<string, Pt[]>, ids: string[]): Array<[string, string]> => {
  const out: Array<[string, string]> = []
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const A = polys.get(ids[i]!),
        B = polys.get(ids[j]!)
      if (A && B && polysCross(A, B)) out.push([ids[i]!, ids[j]!])
    }
  }
  return out
}

// If edges a and b attach to the SAME node face, which end of each does so. Two
// edges sharing a face can sometimes be un-crossed simply by swapping which
// junction (port position) each uses on that face — without changing the face
// itself. Returns null when they share no face.
type EndRef = 'source' | 'target'
const sharedFace = (
  a: string,
  b: string,
  meta: Map<string, EdgeMeta>,
): { endA: EndRef; endB: EndRef } | null => {
  const ma = meta.get(a)!,
    mb = meta.get(b)!
  const endsA: Array<[EndRef, string, Side]> = [
    ['source', ma.source, ma.sourceSide],
    ['target', ma.target, ma.targetSide],
  ]
  const endsB: Array<[EndRef, string, Side]> = [
    ['source', mb.source, mb.sourceSide],
    ['target', mb.target, mb.targetSide],
  ]
  for (const [ea, na, sa] of endsA) {
    for (const [eb, nb, sb] of endsB) {
      if (na === nb && sa === sb) return { endA: ea, endB: eb }
    }
  }
  return null
}

export type PortSwap = { a: string; b: string; endA: EndRef; endB: EndRef }

// The swaps one round tries: a maximal set of disjoint swaps among crossing
// pairs that share a face (each edge swapped at most once this round), in
// crossing-pair order. Empty when no crossing can be fixed by reordering ports.
// Exported for tests.
export const pickPortSwaps = (
  polys: Map<string, Pt[]>,
  edgeIds: string[],
  edgeMeta: Map<string, EdgeMeta>,
): PortSwap[] => {
  const used = new Set<string>()
  const swaps: PortSwap[] = []
  for (const [a, b] of crossingPairs(polys, edgeIds)) {
    if (used.has(a) || used.has(b)) continue
    // An edge with waypoints keeps its ports: they were placed to line up
    // with its first and last waypoint, and a swap would undo that lane.
    if (edgeMeta.get(a)!.via.length > 0 || edgeMeta.get(b)!.via.length > 0) continue
    const f = sharedFace(a, b, edgeMeta)
    if (!f) continue
    used.add(a)
    used.add(b)
    swaps.push({ a, b, endA: f.endA, endB: f.endB })
  }
  return swaps
}

const anchorEnd = (h: EdgeRoutingHints, end: EndRef): Pt =>
  end === 'source' ? h.sourceAnchor : h.targetAnchor
const withAnchorEnd = (h: EdgeRoutingHints, end: EndRef, pt: Pt): EdgeRoutingHints =>
  end === 'source' ? { ...h, sourceAnchor: pt } : { ...h, targetAnchor: pt }

// Exchange the two anchors of each swap, in place.
const applySwaps = (anchors: Map<string, EdgeRoutingHints>, swaps: PortSwap[]): void => {
  for (const s of swaps) {
    const pa = anchorEnd(anchors.get(s.a)!, s.endA)
    const pb = anchorEnd(anchors.get(s.b)!, s.endB)
    anchors.set(s.a, withAnchorEnd(anchors.get(s.a)!, s.endA, pb))
    anchors.set(s.b, withAnchorEnd(anchors.get(s.b)!, s.endB, pa))
  }
}

/**
 * Run the refinement rounds. `reroute` routes the whole diagram for a given
 * anchor set. Returns the best routes found; `anchors` is updated IN PLACE to
 * the anchors those routes were made with (later passes draw from them).
 */
export const refinePortSwaps = async (
  edgeIds: string[],
  edgeMeta: Map<string, EdgeMeta>,
  anchors: Map<string, EdgeRoutingHints>,
  routes: Map<string, RouteResult>,
  reroute: (anchors: Map<string, EdgeRoutingHints>) => Promise<Map<string, RouteResult>>,
): Promise<Map<string, RouteResult>> => {
  const polysOf = (rs: Map<string, RouteResult>) => {
    const m = new Map<string, Pt[]>()
    for (const id of edgeIds) {
      const r = rs.get(id)
      if (r) m.set(id, polyOf(r))
    }
    return m
  }
  let best = routes
  let bestPolys = polysOf(routes)
  let bestCount = crossingPairs(bestPolys, edgeIds).length
  for (let round = 0; round < MAX_ROUNDS && bestCount > 0; round += 1) {
    const swaps = pickPortSwaps(bestPolys, edgeIds, edgeMeta)
    if (swaps.length === 0) break
    const trial = new Map(anchors)
    applySwaps(trial, swaps)
    const trialRoutes = await reroute(trial)
    const trialPolys = polysOf(trialRoutes)
    const trialCount = crossingPairs(trialPolys, edgeIds).length
    if (trialCount < bestCount) {
      applySwaps(anchors, swaps)
      best = trialRoutes
      bestPolys = trialPolys
      bestCount = trialCount
    } else {
      break
    }
  }
  return best
}
