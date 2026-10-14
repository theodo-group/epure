import { useCallback, useRef, type FC, type MouseEvent } from 'react'

import type { EdgeDirection, EdgeStyle } from '@/parser/ast'
import type { Crossing } from '@/layout/crossings'
import type { EdgeRoute } from '@/layout/types'
import type { EndCap, LineStyle, Size } from '@/style/palette'
import { dashArrayFor, solidOf, STROKE_WIDTH } from '@/style/palette'
import { beginDrag, endDrag } from './dragState'

interface EdgeProps {
  edge: EdgeRoute
  label?: string
  style?: EdgeStyle
  marker?: EdgeDirection
  selected?: boolean
  onSelect?: (id: string, additive: boolean) => void
  textScale?: number
  fontFamily?: string
  /** Grid pitch (px); used to convert a label drag into integer grid units. */
  gridSize?: number
  /** Drag the label to a new offset (grid units). Absent → label is static
   *  (e.g. the headless export). */
  onMoveLabel?: (id: string, labelDx: number, labelDy: number) => void
  /** Waypoint editing on the selected edge, Lucidchart-style: every segment
   *  of the route carries a handle at its middle. Dragging the handle (or the
   *  segment itself) shifts the segment sideways, grid-snapped: its two ends
   *  become waypoints, or the waypoints already there move, so the route keeps
   *  that lane. Double-clicking the handle releases the segment (drops the
   *  waypoints that held it). Called with the whole `via` list in integer grid
   *  units. A plain click on the stroke only selects. Absent → no handles (the
   *  headless export). */
  onSetVia?: (id: string, via: { x: number; y: number }[]) => void
  /** Points where this edge passes UNDER another edge. A soft transparent gap
   *  is faded into the stroke at each, so crossings read clearly. Computed once
   *  per diagram by `computeCrossings` and shared by the canvas and the export
   *  so the two never diverge. */
  crossings?: Crossing[]
}

// Encode an edge id into a string safe for an SVG element id / `url(#…)` ref:
// edge ids contain `->` and `#`, which break fragment references. Injective, so
// distinct edge ids stay distinct (no mask collisions).
const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0)}_`)

// Shared SVG defs for the canvas: the soft-blur used by node icon badges and
// a diffuse drop shadow applied to every node body.
export const EdgeDefs: FC = () => (
  <defs>
    <filter id="ep-badge-shadow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="1.6" />
    </filter>
    <filter id="ep-node-shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#0f172a" floodOpacity="0.14" />
    </filter>
    <filter id="ep-icon-halo" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5" />
    </filter>
    {/* Used as a luminance mask to fade a soft transparent gap into an edge
        where it passes under another: black core (hidden) fading out to a white
        rim (visible). Object-bounding-box units, so it scales to each gap
        circle. See the `crossings` handling in <Edge>. */}
    <radialGradient id="ep-edge-fade">
      <stop offset="0" stopColor="#000" />
      <stop offset="0.55" stopColor="#000" />
      <stop offset="1" stopColor="#fff" />
    </radialGradient>
  </defs>
)

type Pt = { x: number; y: number }

// A mouse position in the SVG's user space (the canvas coordinate system).
const svgPointOf = (svg: SVGSVGElement, clientX: number, clientY: number): Pt | null => {
  const inv = svg.getScreenCTM()?.inverse()
  if (!inv) return null
  const pt = svg.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const sp = pt.matrixTransform(inv)
  return { x: sp.x, y: sp.y }
}

// Arc-length position along the polyline of the point nearest `p`. Orders
// waypoints and insertion spots along the route, whatever the route's shape.
const arcParamOf = (points: Pt[], p: Pt): number => {
  let acc = 0
  let best = { d: Infinity, t: 0 }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const vx = b.x - a.x
    const vy = b.y - a.y
    const len2 = vx * vx + vy * vy
    const len = Math.sqrt(len2)
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
    const q = { x: a.x + vx * t, y: a.y + vy * t }
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d < best.d) best = { d, t: acc + t * len }
    acc += len
  }
  return best.t
}

const HANDLE_R = 7

// The index (1-based, like `points[i-1]→points[i]`) of the segment nearest `p`.
const nearestSegment = (points: Pt[], p: Pt): number => {
  let best = 1
  let bestD = Infinity
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!
    const b = points[i]!
    const vx = b.x - a.x
    const vy = b.y - a.y
    const len2 = vx * vx + vy * vy
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
    const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

const pointsToPath = (points: { x: number; y: number }[]) =>
  points.length === 0 ? '' : points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

// Size of the white label pill, centered on the edge's labelAnchor. Exported so
// the editor's fit-to-view and the headless export frame labels with the exact
// geometry rendered here (no divergence, no duplicated magic numbers).
export const labelPillSize = (label: string, textScale = 1): { w: number; h: number } => ({
  w: Math.max(20 * textScale, label.length * 6 * textScale + 12 * textScale),
  h: 16 * textScale,
})

// Compute the unit-vector direction at one end of a polyline, using the
// last (or first) two distinct points.
const directionAt = (
  points: { x: number; y: number }[],
  end: 'start' | 'end',
): { dx: number; dy: number } => {
  if (points.length < 2) return { dx: 1, dy: 0 }
  if (end === 'end') {
    const b = points[points.length - 1]!
    const a = points[points.length - 2]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const m = Math.hypot(dx, dy) || 1
    return { dx: dx / m, dy: dy / m }
  }
  const a = points[0]!
  const b = points[1]!
  // Direction FROM the start (pointing back along the path)
  const dx = a.x - b.x
  const dy = a.y - b.y
  const m = Math.hypot(dx, dy) || 1
  return { dx: dx / m, dy: dy / m }
}

const renderCap = (
  cap: EndCap,
  at: { x: number; y: number },
  dir: { dx: number; dy: number },
  color: string,
  width: number,
): React.ReactNode => {
  if (cap === 'none') return null
  const size = Math.max(3, width * 4)
  if (cap === 'dot') {
    return <circle cx={at.x} cy={at.y} r={size / 2} fill={color} />
  }
  if (cap === 'diamond') {
    const sx = -dir.dx
    const sy = -dir.dy
    const px = -sy
    const py = sx
    const tip = { x: at.x, y: at.y }
    const back = { x: at.x + sx * size, y: at.y + sy * size }
    const mid = { x: at.x + (sx * size) / 2, y: at.y + (sy * size) / 2 }
    const left = { x: mid.x + (px * size) / 2, y: mid.y + (py * size) / 2 }
    const right = { x: mid.x - (px * size) / 2, y: mid.y - (py * size) / 2 }
    return (
      <path
        d={`M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${back.x} ${back.y} L ${right.x} ${right.y} Z`}
        fill={color}
      />
    )
  }
  // arrow (default): a filled triangle. Tip at `at`, base behind.
  const sx = -dir.dx
  const sy = -dir.dy
  const px = -sy
  const py = sx
  const base = { x: at.x + sx * size, y: at.y + sy * size }
  const left = { x: base.x + (px * size) / 2, y: base.y + (py * size) / 2 }
  const right = { x: base.x - (px * size) / 2, y: base.y - (py * size) / 2 }
  return (
    <path d={`M ${at.x} ${at.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`} fill={color} />
  )
}

const STYLE_FROM_PARSER: Record<EdgeStyle, LineStyle> = {
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
}

export const Edge: FC<EdgeProps> = ({
  edge,
  label,
  style: parserStyle = 'solid',
  marker = 'forward',
  selected = false,
  onSelect,
  textScale = 1,
  fontFamily = 'Inter, system-ui, sans-serif',
  gridSize = 40,
  onMoveLabel,
  onSetVia,
  crossings,
}) => {
  // The geometry of one segment of the route (1-based index `seg`, i.e.
  // `points[seg-1]→points[seg]`): which way it runs, and how to read the
  // route's waypoints against it.
  const segmentOf = useCallback(
    (seg: number) => {
      const grid = gridSize || 40
      const points = edge.points
      const P = points[seg - 1]!
      const Q = points[seg]!
      const horizontal = Math.abs(P.y - Q.y) <= Math.abs(P.x - Q.x)
      const perp = (pt: Pt) => (horizontal ? pt.y : pt.x)
      const along = (pt: Pt) => (horizontal ? pt.x : pt.y)
      const lo = Math.min(along(P), along(Q)) - 0.5
      const hi = Math.max(along(P), along(Q)) + 0.5
      const toGrid = (pt: Pt) => ({ x: Math.round(pt.x / grid), y: Math.round(pt.y / grid) })
      const originalVia = (edge.via ?? []).map(toGrid)
      // Waypoints off this segment are kept, split by where the segment sits
      // along the route; the ones on it (its ends included) belong to it.
      const onSegment = (v: Pt) =>
        Math.abs(perp(v) - perp(P)) < 0.5 && along(v) >= lo && along(v) <= hi
      const tP = arcParamOf(points, P)
      const kept = (edge.via ?? [])
        .map((v, i) => ({ v, g: originalVia[i]! }))
        .filter((x) => !onSegment(x.v))
      const before = kept.filter((x) => arcParamOf(points, x.v) < tP).map((x) => x.g)
      const after = kept.filter((x) => arcParamOf(points, x.v) >= tP).map((x) => x.g)
      return { grid, P, Q, horizontal, perp, toGrid, originalVia, before, after }
    },
    [edge.points, edge.via, gridSize],
  )

  // Shift segment `seg` sideways as the pointer moves across it, starting
  // from `grab`. The segment's two ends become waypoints at the new lane (an
  // end that already is a waypoint just moves; one that is the edge's own
  // anchor is left alone, the route bends to reach the lane); waypoints that
  // sat on the segment are replaced. Every move rebuilds the whole list from
  // what was there at mousedown, so a drag that comes back to the start
  // leaves the edge exactly as it was, and a drag along the segment (or a
  // click) changes nothing at all.
  const startSegmentShift = useCallback(
    (svg: SVGSVGElement, seg: number, grab: Pt) => {
      if (!onSetVia) return
      const points = edge.points
      const { grid, P, Q, horizontal, perp, toGrid, originalVia, before, after } = segmentOf(seg)
      const isFirst = seg === 1
      const isLast = seg === points.length - 1
      const laneAt = (shiftedPerp: number): Pt[] => {
        const at = (pt: Pt): Pt =>
          horizontal ? { x: pt.x, y: shiftedPerp } : { x: shiftedPerp, y: pt.y }
        const ends: Pt[] = []
        if (!isFirst) ends.push(at(P))
        if (!isLast) ends.push(at(Q))
        // A single straight edge has no free end: bend it at the grab point.
        if (ends.length === 0) ends.push(at(grab))
        return ends.map(toGrid)
      }
      const basePerp = Math.round(perp(P) / grid)
      let lastDelta = 0
      let dragging = false
      const onPointerMove = (e: globalThis.MouseEvent) => {
        const cur = svgPointOf(svg, e.clientX, e.clientY)
        if (!cur) return
        const delta = Math.round((perp(cur) - perp(grab)) / grid)
        if (delta === lastDelta) return
        lastDelta = delta
        if (!dragging) {
          dragging = true
          beginDrag()
        }
        const via =
          delta === 0 ? originalVia : [...before, ...laneAt((basePerp + delta) * grid), ...after]
        onSetVia(edge.id, via)
      }
      const onPointerUp = () => {
        if (dragging) endDrag()
        window.removeEventListener('mousemove', onPointerMove)
        window.removeEventListener('mouseup', onPointerUp)
      }
      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('mouseup', onPointerUp)
    },
    [edge.id, edge.points, onSetVia, segmentOf],
  )

  // Mousedown on the stroke: select, then shift the segment under the pointer.
  const handleStrokeDown = useCallback(
    (event: MouseEvent<SVGElement>) => {
      event.stopPropagation()
      onSelect?.(edge.id, event.shiftKey)
      if (!onSetVia || event.shiftKey) return
      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return
      const grab = svgPointOf(svg, event.clientX, event.clientY)
      if (!grab) return
      if (edge.points.length < 2) return
      startSegmentShift(svg, nearestSegment(edge.points, grab), grab)
    },
    [edge.id, edge.points, onSelect, onSetVia, startSegmentShift],
  )

  // Mousedown on a segment handle: shift that segment from its middle.
  const handleSegmentDown = useCallback(
    (event: MouseEvent<SVGElement>, seg: number) => {
      event.stopPropagation()
      onSelect?.(edge.id, false)
      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return
      const grab = svgPointOf(svg, event.clientX, event.clientY)
      if (!grab) return
      startSegmentShift(svg, seg, grab)
    },
    [edge.id, onSelect, startSegmentShift],
  )

  // Double-click on a segment handle: release the segment, i.e. drop the
  // waypoints that held it in its lane. The router picks the lane again.
  const handleSegmentRelease = useCallback(
    (event: MouseEvent<SVGElement>, seg: number) => {
      event.stopPropagation()
      if (!onSetVia) return
      const { before, after, originalVia } = segmentOf(seg)
      if (before.length + after.length === originalVia.length) return
      onSetVia(edge.id, [...before, ...after])
    },
    [edge.id, onSetVia, segmentOf],
  )

  // Cumulative-from-origin label drag: capture the committed offset and the
  // starting pointer once, then add the snapped pointer delta on every move.
  // Each move commits to the store, which re-routes and shifts labelAnchor —
  // mirrors how Node dragging works (src/renderer/Node.tsx).
  const labelDragging = useRef(false)
  const labelStart = useRef({ mx: 0, my: 0, dx: 0, dy: 0 })
  const handleLabelDown = useCallback(
    (event: MouseEvent<SVGGElement>) => {
      if (!onMoveLabel) return
      event.stopPropagation()
      onSelect?.(edge.id, false)
      const svg = (event.target as SVGElement).ownerSVGElement
      const inv = svg?.getScreenCTM()?.inverse()
      if (!svg || !inv) return
      const grid = gridSize || 40
      labelDragging.current = true
      beginDrag()
      const pt = svg.createSVGPoint()
      pt.x = event.clientX
      pt.y = event.clientY
      const sp = pt.matrixTransform(inv)
      labelStart.current = {
        mx: sp.x,
        my: sp.y,
        dx: edge.labelDx ?? 0,
        dy: edge.labelDy ?? 0,
      }
      const onPointerMove = (e: globalThis.MouseEvent) => {
        if (!labelDragging.current) return
        const curInv = svg.getScreenCTM()?.inverse()
        if (!curInv) return
        const mp = svg.createSVGPoint()
        mp.x = e.clientX
        mp.y = e.clientY
        const cur = mp.matrixTransform(curInv)
        const ndx = labelStart.current.dx + Math.round((cur.x - labelStart.current.mx) / grid)
        const ndy = labelStart.current.dy + Math.round((cur.y - labelStart.current.my) / grid)
        onMoveLabel(edge.id, ndx, ndy)
      }
      const onPointerUp = () => {
        labelDragging.current = false
        endDrag()
        window.removeEventListener('mousemove', onPointerMove)
        window.removeEventListener('mouseup', onPointerUp)
      }
      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('mouseup', onPointerUp)
    },
    [edge.id, edge.labelDx, edge.labelDy, gridSize, onMoveLabel, onSelect],
  )

  const color = solidOf(edge.color)
  const width = STROKE_WIDTH[(edge.width ?? 'M') as Size]
  const lineStyle: LineStyle = edge.lineStyle ?? STYLE_FROM_PARSER[parserStyle]
  const dash = dashArrayFor(lineStyle, width)

  // Defaults from parser direction; layout startCap/endCap override.
  const defaultStart: EndCap =
    marker === 'backward' || marker === 'bidirectional' ? 'arrow' : 'none'
  const defaultEnd: EndCap = marker === 'forward' || marker === 'bidirectional' ? 'arrow' : 'none'
  const startCap: EndCap = edge.startCap ?? defaultStart
  const endCap: EndCap = edge.endCap ?? defaultEnd

  const startDir = directionAt(edge.points, 'start')
  const endDir = directionAt(edge.points, 'end')
  const startPt = edge.points[0] ?? { x: 0, y: 0 }
  const endPt = edge.points[edge.points.length - 1] ?? { x: 0, y: 0 }
  const path = pointsToPath(edge.points)

  // Where this edge crosses under another, fade a soft transparent gap into the
  // stroke via a luminance mask: a white field (fully visible) minus a gradient
  // disc per crossing (hidden core fading out to nothing at the rim). The mask
  // region must comfortably cover the stroke — including the selection halo and
  // round caps — so it doesn't clip the line; pad by the widest gap + that.
  const fades = crossings ?? []
  const maskId = fades.length > 0 ? `ep-fade-${safeId(edge.id)}` : undefined
  let maskRegion: { x: number; y: number; w: number; h: number } | undefined
  if (maskId && edge.points.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of edge.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const pad = Math.max(...fades.map((f) => f.r)) + width + 8
    maskRegion = {
      x: minX - pad,
      y: minY - pad,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2,
    }
  }
  const maskRef = maskId ? `url(#${maskId})` : undefined

  return (
    <g data-edge-id={edge.id}>
      {maskId && maskRegion ? (
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x={maskRegion.x}
          y={maskRegion.y}
          width={maskRegion.w}
          height={maskRegion.h}
        >
          <rect
            x={maskRegion.x}
            y={maskRegion.y}
            width={maskRegion.w}
            height={maskRegion.h}
            fill="#fff"
          />
          {fades.map((f, i) => (
            <circle key={i} cx={f.x} cy={f.y} r={f.r} fill="url(#ep-edge-fade)" />
          ))}
        </mask>
      ) : null}
      {selected ? (
        <path
          d={path}
          fill="none"
          stroke="#3b82f6"
          strokeOpacity={0.28}
          strokeWidth={width + 6}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
          mask={maskRef}
        />
      ) : null}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="none"
        mask={maskRef}
      />
      {renderCap(startCap, startPt, startDir, color, width)}
      {renderCap(endCap, endPt, endDir, color, width)}
      {onSelect ? (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(16, width * 3)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
          style={{ cursor: selected && onSetVia ? 'move' : 'pointer' }}
          onMouseDown={handleStrokeDown}
        />
      ) : null}
      {label && edge.labelAnchor
        ? (() => {
            const fontSize = 11 * textScale
            const { w: pillW, h: pillH } = labelPillSize(label, textScale)
            const draggable = !!onMoveLabel
            return (
              <g
                transform={`translate(${edge.labelAnchor.x}, ${edge.labelAnchor.y})`}
                onMouseDown={draggable ? handleLabelDown : undefined}
                style={draggable ? { cursor: 'move' } : undefined}
              >
                <rect
                  x={-pillW / 2}
                  y={-pillH / 2}
                  width={pillW}
                  height={pillH}
                  rx={4}
                  ry={4}
                  fill="#ffffff"
                  pointerEvents={draggable ? 'all' : 'none'}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontFamily={fontFamily}
                  fontSize={fontSize}
                  fill="#1f2430"
                  pointerEvents="none"
                >
                  {label}
                </text>
              </g>
            )
          })()
        : null}
      {selected && onSetVia ? (
        <g data-edge-handles={edge.id}>
          {edge.points.slice(1).map((Q, i) => {
            const P = edge.points[i]!
            const horizontal = Math.abs(P.y - Q.y) <= Math.abs(P.x - Q.x)
            // Too short a segment has no room for a handle under the arrow caps.
            if (Math.hypot(Q.x - P.x, Q.y - P.y) < HANDLE_R * 3) return null
            return (
              <circle
                key={`seg-${i + 1}`}
                className="ep-handle ep-handle-seg"
                cx={(P.x + Q.x) / 2}
                cy={(P.y + Q.y) / 2}
                r={HANDLE_R - 1}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={2}
                style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize' }}
                onMouseDown={(e) => handleSegmentDown(e, i + 1)}
                onDoubleClick={(e) => handleSegmentRelease(e, i + 1)}
              >
                <title>Segment — drag to shift it, double-click to let the router place it</title>
              </circle>
            )
          })}
        </g>
      ) : null}
    </g>
  )
}
