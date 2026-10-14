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
  /** Waypoint editing. On the selected edge each waypoint is a handle: drag
   *  it (`onMoveVia`), double-click it to remove it (`onRemoveVia`). Dragging
   *  the edge's stroke itself inserts a waypoint where it was grabbed and
   *  drags it (`onInsertVia`, then `onMoveVia`); a plain click only selects.
   *  All in integer grid units. Absent → no handles (the headless export). */
  onMoveVia?: (id: string, index: number, x: number, y: number) => void
  onInsertVia?: (id: string, index: number, x: number, y: number) => void
  onRemoveVia?: (id: string, index: number) => void
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
// A mousedown on the stroke becomes an insert-and-drag once the pointer has
// travelled this far (screen px); under it, it is a click that only selects.
const INSERT_DRAG_THRESHOLD = 4

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
  onMoveVia,
  onInsertVia,
  onRemoveVia,
  crossings,
}) => {
  // Waypoint drag: every pointer move snaps to the grid and commits the
  // waypoint when its cell changes; the store re-routes and the handle follows
  // the new route. Shared by "move an existing waypoint" and "drag a midpoint
  // handle into a new one" (the insert happens first, then this drags it).
  const startViaDrag = useCallback(
    (event: MouseEvent<SVGElement>, index: number, start: Pt) => {
      if (!onMoveVia) return
      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return
      const grid = gridSize || 40
      let last = { x: start.x, y: start.y }
      beginDrag()
      const onPointerMove = (e: globalThis.MouseEvent) => {
        const cur = svgPointOf(svg, e.clientX, e.clientY)
        if (!cur) return
        const gx = Math.round(cur.x / grid)
        const gy = Math.round(cur.y / grid)
        if (gx === last.x && gy === last.y) return
        last = { x: gx, y: gy }
        onMoveVia(edge.id, index, gx, gy)
      }
      const onPointerUp = () => {
        endDrag()
        window.removeEventListener('mousemove', onPointerMove)
        window.removeEventListener('mouseup', onPointerUp)
      }
      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('mouseup', onPointerUp)
    },
    [edge.id, gridSize, onMoveVia],
  )

  const handleViaDown = useCallback(
    (event: MouseEvent<SVGElement>, index: number) => {
      event.stopPropagation()
      onSelect?.(edge.id, false)
      const grid = gridSize || 40
      const p = edge.via?.[index]
      if (!p) return
      startViaDrag(event, index, { x: Math.round(p.x / grid), y: Math.round(p.y / grid) })
    },
    [edge.id, edge.via, gridSize, onSelect, startViaDrag],
  )

  // Mousedown on the stroke: select, and if the pointer then moves, insert a
  // waypoint at the grab point (after every waypoint the route reaches first)
  // and drag it. The insert waits for real movement so a click stays a click.
  const handleStrokeDown = useCallback(
    (event: MouseEvent<SVGElement>) => {
      event.stopPropagation()
      onSelect?.(edge.id, event.shiftKey)
      if (!onInsertVia || !onMoveVia || event.shiftKey) return
      const svg = (event.target as SVGElement).ownerSVGElement
      if (!svg) return
      const grab = svgPointOf(svg, event.clientX, event.clientY)
      if (!grab) return
      const origin = { x: event.clientX, y: event.clientY }
      const grid = gridSize || 40
      const onPointerMove = (e: globalThis.MouseEvent) => {
        if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < INSERT_DRAG_THRESHOLD) return
        window.removeEventListener('mousemove', onPointerMove)
        window.removeEventListener('mouseup', onPointerUp)
        const gx = Math.round(grab.x / grid)
        const gy = Math.round(grab.y / grid)
        const t = arcParamOf(edge.points, grab)
        const index = (edge.via ?? []).filter((v) => arcParamOf(edge.points, v) < t).length
        onInsertVia(edge.id, index, gx, gy)
        startViaDrag(event, index, { x: gx, y: gy })
        // Replay this move so the new waypoint follows the pointer at once.
        window.dispatchEvent(new globalThis.MouseEvent('mousemove', e))
      }
      const onPointerUp = () => {
        window.removeEventListener('mousemove', onPointerMove)
        window.removeEventListener('mouseup', onPointerUp)
      }
      window.addEventListener('mousemove', onPointerMove)
      window.addEventListener('mouseup', onPointerUp)
    },
    [edge.id, edge.points, edge.via, gridSize, onInsertVia, onMoveVia, onSelect, startViaDrag],
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
          style={{ cursor: selected && onInsertVia ? 'move' : 'pointer' }}
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
      {selected && onMoveVia ? (
        <g data-edge-handles={edge.id}>
          {(edge.via ?? []).map((v, i) => (
            <circle
              key={`via-${i}`}
              className="ep-handle ep-handle-via"
              cx={v.x}
              cy={v.y}
              r={HANDLE_R}
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth={2}
              onMouseDown={(e) => handleViaDown(e, i)}
              onDoubleClick={(e) => {
                e.stopPropagation()
                onRemoveVia?.(edge.id, i)
              }}
            >
              <title>Waypoint — drag to move, double-click to remove</title>
            </circle>
          ))}
        </g>
      ) : null}
    </g>
  )
}
