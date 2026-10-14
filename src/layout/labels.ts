// Where an edge's label sits: an automatic pixel anchor on the final polyline,
// kept clear of node bodies, plus the user's persisted nudge. The nudge is
// stored in GRID units (so it survives a grid-size change as "N cells") and is
// converted to pixels here — the one place grid units re-enter the router.

import type { Pt, Rect } from './geometry'
import type { EdgeStyleSpec } from './types'

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
const chooseLabelAnchor = (points: Pt[], nodes: Record<string, Rect>): Pt | undefined => {
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

/**
 * The label anchor for an edge, in pixels: the auto anchor on `points`, then
 * the user's persisted nudge (`labelDx`/`labelDy`, grid units → × gridSize).
 * Doing it here means the editor and the headless PNG export — which both route
 * through `route()` and render the same Edge component — agree on the final
 * position with no duplicated offset logic.
 */
export const labelAnchorFor = (
  points: Pt[],
  nodes: Record<string, Rect>,
  style: Pick<EdgeStyleSpec, 'labelDx' | 'labelDy'> | undefined,
  gridSize: number,
): Pt | undefined => {
  const baseAnchor = chooseLabelAnchor(points, nodes)
  const labelDx = style?.labelDx ?? 0
  const labelDy = style?.labelDy ?? 0
  return baseAnchor
    ? { x: baseAnchor.x + labelDx * gridSize, y: baseAnchor.y + labelDy * gridSize }
    : undefined
}
