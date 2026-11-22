// The axis-aligned legs of an orthogonal polyline, and the relation between
// two legs that the post-routing stages judge routes by: sharing a run (two
// legs drawn as one line).
//
// Pixel space; `gridSize` is the grid pitch in px.

import { AXIS_TOLERANCE, laneWidth, OVERLAP_MIN } from './constants'
import type { Pt } from './geometry'

export type Axis = 'H' | 'V'

/** One axis-aligned segment: `coord` is its fixed x (V) or y (H), and
 *  [`lo`, `hi`] the span it covers on the other axis. */
export interface Leg {
  axis: Axis
  coord: number
  lo: number
  hi: number
}

/** The leg from `a` to `b`, or null when the segment is a point or diagonal. */
export const legOf = (a: Pt, b: Pt): Leg | null => {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  if (dx < AXIS_TOLERANCE && dy >= AXIS_TOLERANCE)
    return { axis: 'V', coord: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) }
  if (dy < AXIS_TOLERANCE && dx >= AXIS_TOLERANCE)
    return { axis: 'H', coord: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) }
  return null
}

/** The legs of a polyline, in order. Points and diagonal segments are skipped. */
export const legsOf = (pts: Pt[]): Leg[] => {
  const out: Leg[] = []
  for (let i = 1; i < pts.length; i += 1) {
    const leg = legOf(pts[i - 1]!, pts[i]!)
    if (leg) out.push(leg)
  }
  return out
}

/** The length (px) of the stretch two parallel legs cover side by side. */
export const sideBySideLength = (a: Leg, b: Leg): number =>
  Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)

/** How legs relate on a grid of a given pitch. */
export interface LegRules {
  /** True when the two legs draw as one line: same axis, closer than half a
   *  cell, side by side over more than OVERLAP_MIN px. */
  shareRun: (a: Leg, b: Leg) => boolean
}

/** The leg relations for a grid of pitch `gridSize`. */
export const legRules = (gridSize: number): LegRules => {
  const lane = laneWidth(gridSize)
  const shareRun = (a: Leg, b: Leg): boolean =>
    a.axis === b.axis &&
    Math.abs(a.coord - b.coord) < lane - AXIS_TOLERANCE &&
    sideBySideLength(a, b) > OVERLAP_MIN
  return { shareRun }
}
