// Title chips vs. edge ports.
//
// libavoid only detours around an obstacle a route starts clear of. Every
// shape is grown by `shapeBufferDistance`, and when a node's grown outline
// overlaps a title chip's, a route leaving that node's facing border is let
// straight through the chip. That is the normal case for an area's top row: a
// member's top border sits 13px under its own area's chip, well inside two
// buffers (2 × 20px at the default 40px grid). Ports placed beside the chip,
// or on a side face, route around it correctly.
//
// So a chip close enough to a face casts a "shadow" on it — the span of that
// face it overhangs, widened by a margin. Ports stay out of the shadow, and a
// face that is entirely in shadow isn't used at all (`unshadowFaces` moves the
// edge end to a side face). A face with no chip nearby is untouched, so
// diagrams without the problem route exactly as before. All pixels.

import type { EdgeMeta } from './faces'
import { faceRange, isHorizontalSide, type Rect } from './geometry'
import type { Side } from './types'

/** Clear space kept between a port and the side of a chip it would sit under. */
const CHIP_PORT_MARGIN = 10

/** How far from a face a chip still breaks routing: both buffers, plus slack. */
export const chipReach = (shapeBufferDistance: number): number => 2 * shapeBufferDistance + 8

/** The spans of `side` (along the face) that chips within `reach` overhang. */
export const shadowsOn = (
  node: Rect,
  side: Side,
  chips: Rect[],
  reach: number,
): [number, number][] => {
  const out: [number, number][] = []
  for (const c of chips) {
    // Gap between the face and the chip, measured outward; negative = behind it.
    const gap =
      side === 'N'
        ? node.y - (c.y + c.h)
        : side === 'S'
          ? c.y - (node.y + node.h)
          : side === 'W'
            ? node.x - (c.x + c.w)
            : c.x - (node.x + node.w)
    if (gap < -1 || gap >= reach) continue
    const [lo, hi] = isHorizontalSide(side) ? [c.y, c.y + c.h] : [c.x, c.x + c.w]
    out.push([lo - CHIP_PORT_MARGIN, hi + CHIP_PORT_MARGIN])
  }
  return out
}

/**
 * The longest stretch of the port range `[lo, hi]` outside every shadow, or
 * null when none is left. Returns `[lo, hi]` itself when nothing overlaps it.
 */
export const usableRange = (
  lo: number,
  hi: number,
  shadows: [number, number][],
): [number, number] | null => {
  const cuts = shadows.filter(([a, b]) => b > lo && a < hi).sort((p, q) => p[0] - q[0])
  if (cuts.length === 0) return [lo, hi]
  let best: [number, number] | null = null
  let cursor = lo
  for (const [a, b] of [...cuts, [hi, hi] as [number, number]]) {
    if (a > cursor && (!best || a - cursor > best[1] - best[0])) best = [cursor, Math.min(a, hi)]
    cursor = Math.max(cursor, b)
  }
  return best
}

/** The usable port range of a node's face, or null when it is all in shadow. */
export const faceUsableRange = (
  node: Rect,
  side: Side,
  chips: Rect[],
  reach: number,
): [number, number] | null => {
  const [lo, hi] = faceRange(node, side)
  return usableRange(lo, hi, shadowsOn(node, side, chips, reach))
}

// A side face to use instead of a shadowed `side`: towards the other end on the
// cross axis; dead ahead, the one farther from the shadow.
const sideAround = (node: Rect, side: Side, other: Rect, shadows: [number, number][]): Side => {
  const horizFace = isHorizontalSide(side)
  const centre = (r: Rect) => (horizFace ? r.y + r.h / 2 : r.x + r.w / 2)
  const d = centre(other) - centre(node)
  const shadowMid = shadows.reduce((s, [a, b]) => s + (a + b) / 2, 0) / shadows.length
  const towardsLow = d !== 0 ? d < 0 : shadowMid > centre(node)
  if (horizFace) return towardsLow ? 'N' : 'S'
  return towardsLow ? 'W' : 'E'
}

/**
 * Move every non-pinned edge end off a face that is entirely in a chip's
 * shadow. Returns `edgeMeta` itself when nothing moves.
 */
export const unshadowFaces = (
  edgeMeta: Map<string, EdgeMeta>,
  nodes: Record<string, Rect>,
  chips: Rect[],
  reach: number,
): Map<string, EdgeMeta> => {
  if (chips.length === 0) return edgeMeta
  let out: Map<string, EdgeMeta> | null = null
  for (const [id, m] of edgeMeta) {
    let next = m
    for (const end of ['source', 'target'] as const) {
      if (end === 'source' ? m.explicitSource : m.explicitTarget) continue
      const nodeId = m[end]
      const side = end === 'source' ? m.sourceSide : m.targetSide
      const node = nodes[nodeId]!
      if (faceUsableRange(node, side, chips, reach)) continue
      const other = nodes[end === 'source' ? m.target : m.source]!
      const moved = sideAround(node, side, other, shadowsOn(node, side, chips, reach))
      next = end === 'source' ? { ...next, sourceSide: moved } : { ...next, targetSide: moved }
    }
    if (next !== m) {
      out ??= new Map(edgeMeta)
      out.set(id, next)
    }
  }
  return out ?? edgeMeta
}
