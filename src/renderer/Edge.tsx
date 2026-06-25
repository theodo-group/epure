import type { FC } from 'react'

import type { EdgeDirection, EdgeStyle } from '@/parser/ast'
import type { EdgeRoute } from '@/layout/types'
import type { EndCap, LineStyle, Size } from '@/style/palette'
import { dashArrayFor, solidOf, STROKE_WIDTH } from '@/style/palette'

interface EdgeProps {
  edge: EdgeRoute
  label?: string
  style?: EdgeStyle
  marker?: EdgeDirection
  selected?: boolean
  onSelect?: (id: string, additive: boolean) => void
  textScale?: number
  fontFamily?: string
}

// Shared SVG defs for the canvas: the soft-blur used by node icon badges and
// a diffuse drop shadow applied to every node body.
export const EdgeDefs: FC = () => (
  <defs>
    <filter id='ep-badge-shadow' x='-60%' y='-60%' width='220%' height='220%'>
      <feGaussianBlur stdDeviation='1.6' />
    </filter>
    <filter id='ep-node-shadow' x='-20%' y='-20%' width='140%' height='160%'>
      <feDropShadow
        dx='0'
        dy='2'
        stdDeviation='4'
        floodColor='#0f172a'
        floodOpacity='0.14'
      />
    </filter>
    <filter id='ep-icon-halo' x='-50%' y='-50%' width='200%' height='200%'>
      <feGaussianBlur stdDeviation='5' />
    </filter>
  </defs>
)

const pointsToPath = (points: { x: number; y: number }[]) =>
  points.length === 0
    ? ''
    : points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
        .join(' ')

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
    <path
      d={`M ${at.x} ${at.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`}
      fill={color}
    />
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
}) => {
  const color = solidOf(edge.color)
  const width = STROKE_WIDTH[(edge.width ?? 'M') as Size]
  const lineStyle: LineStyle = edge.lineStyle ?? STYLE_FROM_PARSER[parserStyle]
  const dash = dashArrayFor(lineStyle, width)

  // Defaults from parser direction; layout startCap/endCap override.
  const defaultStart: EndCap =
    marker === 'backward' || marker === 'bidirectional' ? 'arrow' : 'none'
  const defaultEnd: EndCap =
    marker === 'forward' || marker === 'bidirectional' ? 'arrow' : 'none'
  const startCap: EndCap = edge.startCap ?? defaultStart
  const endCap: EndCap = edge.endCap ?? defaultEnd

  const startDir = directionAt(edge.points, 'start')
  const endDir = directionAt(edge.points, 'end')
  const startPt = edge.points[0] ?? { x: 0, y: 0 }
  const endPt = edge.points[edge.points.length - 1] ?? { x: 0, y: 0 }
  const path = pointsToPath(edge.points)

  return (
    <g data-edge-id={edge.id}>
      {selected ? (
        <path
          d={path}
          fill='none'
          stroke='#3b82f6'
          strokeOpacity={0.28}
          strokeWidth={width + 6}
          strokeLinecap='round'
          strokeLinejoin='round'
          pointerEvents='none'
        />
      ) : null}
      <path
        d={path}
        fill='none'
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap='round'
        strokeLinejoin='round'
        pointerEvents='none'
      />
      {renderCap(startCap, startPt, startDir, color, width)}
      {renderCap(endCap, endPt, endDir, color, width)}
      {onSelect ? (
        <path
          d={path}
          fill='none'
          stroke='transparent'
          strokeWidth={Math.max(16, width * 3)}
          strokeLinecap='round'
          strokeLinejoin='round'
          pointerEvents='stroke'
          style={{ cursor: 'pointer' }}
          onMouseDown={(event) => {
            event.stopPropagation()
            onSelect(edge.id, event.shiftKey)
          }}
        />
      ) : null}
      {label && edge.labelAnchor ? (
        (() => {
          const fontSize = 11 * textScale
          const pillH = 16 * textScale
          const pillW = Math.max(20 * textScale, label.length * 6 * textScale + 12 * textScale)
          return (
            <g transform={`translate(${edge.labelAnchor.x}, ${edge.labelAnchor.y})`}>
              <rect
                x={-pillW / 2}
                y={-pillH / 2}
                width={pillW}
                height={pillH}
                rx={4}
                ry={4}
                fill='#ffffff'
                pointerEvents='none'
              />
              <text
                textAnchor='middle'
                dominantBaseline='middle'
                fontFamily={fontFamily}
                fontSize={fontSize}
                fill='#1f2430'
                pointerEvents='none'
              >
                {label}
              </text>
            </g>
          )
        })()
      ) : null}
    </g>
  )
}
