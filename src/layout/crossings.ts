// Detect where one edge's polyline crosses another's so the renderer can fade a
// soft, transparent gap into the edge that passes UNDER. Paint order decides
// over/under: an edge earlier in the array is drawn first, so it sits under any
// edge later in the array (matches how Canvas and the headless export iterate
// `edges`). Routing is orthogonal, so every real crossing is one edge's
// horizontal segment meeting another's vertical segment at an interior point —
// shared corners and node junctions are excluded by keeping clear of segment
// endpoints.

import { STROKE_WIDTH, type Size } from '@/style/palette'

import type { EdgeRoute } from './types'

export interface Crossing {
  /** Crossing point, in the same px space as `edge.points`. */
  x: number
  y: number
  /** Radius (px) of the faded gap to punch into the under-edge here. */
  r: number
}

interface Seg {
  x1: number
  y1: number
  x2: number
  y2: number
}

const AX_EPS = 0.5 // tolerance for calling a segment axis-aligned
const END_EPS = 1 // keep gaps clear of segment endpoints (corners / junctions)
const GAP_BASE = 7 // base gap radius (px), grown by the over-edge's stroke width

const widthOf = (e: EdgeRoute): number => STROKE_WIDTH[(e.width ?? 'M') as Size]

const segmentsOf = (pts: { x: number; y: number }[]): Seg[] => {
  const out: Seg[] = []
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!
    const b = pts[i]!
    out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
  }
  return out
}

const isHorizontal = (s: Seg) =>
  Math.abs(s.y1 - s.y2) <= AX_EPS && Math.abs(s.x1 - s.x2) > AX_EPS
const isVertical = (s: Seg) =>
  Math.abs(s.x1 - s.x2) <= AX_EPS && Math.abs(s.y1 - s.y2) > AX_EPS

// Interior intersection of a horizontal segment `h` and a vertical segment `v`,
// or null when they only touch at (or near) an endpoint.
const intersect = (h: Seg, v: Seg): { x: number; y: number } | null => {
  const hy = (h.y1 + h.y2) / 2
  const vx = (v.x1 + v.x2) / 2
  const hxLo = Math.min(h.x1, h.x2)
  const hxHi = Math.max(h.x1, h.x2)
  const vyLo = Math.min(v.y1, v.y2)
  const vyHi = Math.max(v.y1, v.y2)
  if (
    vx > hxLo + END_EPS &&
    vx < hxHi - END_EPS &&
    hy > vyLo + END_EPS &&
    hy < vyHi - END_EPS
  ) {
    return { x: vx, y: hy }
  }
  return null
}

/**
 * For each edge that passes UNDER another, the points where it does. Keyed by
 * edge id; edges that are never underneath anything are absent from the map.
 */
export const computeCrossings = (edges: EdgeRoute[]): Map<string, Crossing[]> => {
  const result = new Map<string, Crossing[]>()
  const cache = edges.map((e) => segmentsOf(e.points))

  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      // j is painted after i, so i is the under-edge for this pair.
      const under = edges[i]!
      const r = GAP_BASE + widthOf(edges[j]!)
      for (const a of cache[i]!) {
        for (const b of cache[j]!) {
          let pt: { x: number; y: number } | null = null
          if (isHorizontal(a) && isVertical(b)) pt = intersect(a, b)
          else if (isVertical(a) && isHorizontal(b)) pt = intersect(b, a)
          if (!pt) continue
          const list = result.get(under.id)
          if (list) list.push({ x: pt.x, y: pt.y, r })
          else result.set(under.id, [{ x: pt.x, y: pt.y, r }])
        }
      }
    }
  }
  return result
}
