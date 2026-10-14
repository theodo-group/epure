// Shared pixel-space geometry for the router. Everything in src/layout below
// `route()` works in canvas PIXELS: the sidecar's grid units are converted once,
// here (`nodeRects`), and never seen again until the label offset is applied.
// Polylines are plain point arrays; "orthogonal" means every segment is
// axis-aligned to within half a pixel (libavoid emits float coordinates).

import type { Diagram } from '@/parser/ast'

import { DEFAULT_NODE_H, DEFAULT_NODE_W } from './defaults'
import type { LayoutNode, LayoutSidecar, Side } from './types'

/** A point in canvas pixels. */
export type Pt = { x: number; y: number }
/** An axis-aligned rect in canvas pixels: top-left corner plus size. */
export type Rect = { x: number; y: number; w: number; h: number }

export const isHorizontalSide = (side: Side) => side === 'E' || side === 'W'

export const OPPOSITE_SIDE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' }

const toPixelRect = (node: LayoutNode, gridSize: number): Rect => ({
  x: (node.cx - node.w / 2) * gridSize,
  y: (node.cy - node.h / 2) * gridSize,
  w: node.w * gridSize,
  h: node.h * gridSize,
})

// Every node's pixel rect, keyed by id. Key order is load-bearing: obstacle
// scans iterate this record and take the FIRST blocking rect, so it lists the
// sidecar's nodes in sidecar order, then any fallback rects.
//
// Defensive fallback: a node may exist in the diagram (or be referenced by an
// edge) with no layout entry — most commonly when CC appends a node to the
// `.d2` without touching the layout. `normalizeForRoute` normally fills these
// in upstream; completing the map here too guarantees every downstream
// `nodes[id]` lookup resolves, so `route()` can never throw and blank the
// canvas. The fallback rect lands in the same coordinate space as the rest.
export const nodeRects = (diagram: Diagram, layout: LayoutSidecar): Record<string, Rect> => {
  const { gridSize } = layout
  const pixelNodes: Record<string, Rect> = {}
  for (const [id, node] of Object.entries(layout.nodes)) {
    pixelNodes[id] = toPixelRect(node, gridSize)
  }
  const ensureRect = (id: string) => {
    if (!pixelNodes[id]) {
      pixelNodes[id] = toPixelRect({ cx: 0, cy: 0, w: DEFAULT_NODE_W, h: DEFAULT_NODE_H }, gridSize)
    }
  }
  for (const n of diagram.nodes) ensureRect(n.id)
  for (const e of diagram.edges) {
    ensureRect(e.source)
    ensureRect(e.target)
  }
  return pixelNodes
}

export const rectContains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h

// Which face of a node a polyline touches, inferred from the step it takes
// leaving that node's centre (pass centre→next for a source) or arriving at it
// (pass centre→previous for a target). Used to learn the real side an
// obstacle-avoiding libavoid route uses, which geometry alone can't predict.
export const sideFromSegment = (from: Pt, to: Pt): Side => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W'
  return dy >= 0 ? 'S' : 'N'
}

// Normalize a polyline: drop duplicate points and collinear midpoints so the
// rendered path is minimal (libavoid can emit redundant waypoints).
export const cleanPolyline = (pts: Pt[]): Pt[] => {
  const dedup: Pt[] = []
  for (const p of pts) {
    const tail = dedup[dedup.length - 1]
    if (tail && tail.x === p.x && tail.y === p.y) continue
    dedup.push({ x: p.x, y: p.y })
  }
  const out: Pt[] = []
  for (let i = 0; i < dedup.length; i += 1) {
    const prev = out[out.length - 1]
    const cur = dedup[i]!
    const next = dedup[i + 1]
    if (
      prev &&
      next &&
      ((prev.x === cur.x && cur.x === next.x) || (prev.y === cur.y && cur.y === next.y))
    ) {
      continue // cur lies on the straight segment prev→next
    }
    out.push(cur)
  }
  return out
}

// Every segment must be axis-aligned. Used to reject degenerate (diagonal)
// libavoid routes before they reach the canvas.
export const isOrthogonalPath = (pts: Pt[]): boolean => {
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!,
      b = pts[i]!
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) return false
  }
  return true
}

// Where ports may sit on a face: its span along the face axis, inset by a
// margin so an arrowhead never lands on a corner.
const FACE_MARGIN = 12

// The fixed coordinate of a face: x for E/W, y for N/S.
export const faceCoord = (node: Rect, side: Side): number =>
  side === 'E' ? node.x + node.w : side === 'W' ? node.x : side === 'S' ? node.y + node.h : node.y

export const faceRange = (node: Rect, side: Side): [number, number] => {
  const horiz = isHorizontalSide(side)
  const origin = horiz ? node.y : node.x
  const size = horiz ? node.h : node.w
  const margin = Math.min(FACE_MARGIN, size / 4)
  return [origin + margin, origin + size - margin]
}
