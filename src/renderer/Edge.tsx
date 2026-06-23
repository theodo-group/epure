import type { FC } from 'react'

import type { EdgeDirection, EdgeStyle } from '@/parser/ast'
import type { EdgeRoute } from '@/layout/types'

interface EdgeProps {
  edge: EdgeRoute
  label?: string
  style?: EdgeStyle
  marker?: EdgeDirection
}

const DASH: Record<EdgeStyle, string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '2 4',
}

export const ARROW_MARKER_IDS = {
  forward: 'archgrid-arrow-forward',
  backward: 'archgrid-arrow-backward',
} as const

export const EdgeDefs: FC = () => (
  <defs>
    <marker
      id={ARROW_MARKER_IDS.forward}
      viewBox='0 0 10 10'
      refX={9}
      refY={5}
      markerUnits='strokeWidth'
      markerWidth={8}
      markerHeight={8}
      orient='auto-start-reverse'
    >
      <path d='M 0 0 L 10 5 L 0 10 Z' fill='#3b4252' />
    </marker>
    <marker
      id={ARROW_MARKER_IDS.backward}
      viewBox='0 0 10 10'
      refX={1}
      refY={5}
      markerUnits='strokeWidth'
      markerWidth={8}
      markerHeight={8}
      orient='auto-start-reverse'
    >
      <path d='M 10 0 L 0 5 L 10 10 Z' fill='#3b4252' />
    </marker>
  </defs>
)

const pointsToPath = (points: { x: number; y: number }[]) =>
  points.length === 0
    ? ''
    : points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
        .join(' ')

export const Edge: FC<EdgeProps> = ({
  edge,
  label,
  style = 'solid',
  marker = 'forward',
}) => {
  const dash = DASH[style]
  const markerStart =
    marker === 'backward' || marker === 'bidirectional'
      ? `url(#${ARROW_MARKER_IDS.backward})`
      : undefined
  const markerEnd =
    marker === 'forward' || marker === 'bidirectional'
      ? `url(#${ARROW_MARKER_IDS.forward})`
      : undefined

  return (
    <g data-edge-id={edge.id}>
      <path
        d={pointsToPath(edge.points)}
        fill='none'
        stroke='#3b4252'
        strokeWidth={1.5}
        strokeDasharray={dash}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />
      {label && edge.labelAnchor ? (
        <g
          transform={`translate(${edge.labelAnchor.x}, ${edge.labelAnchor.y})`}
        >
          <text
            textAnchor='middle'
            dominantBaseline='middle'
            fontFamily='Inter, system-ui, sans-serif'
            fontSize={11}
            stroke='#ffffff'
            strokeWidth={3}
            paintOrder='stroke'
            fill='#1f2430'
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  )
}
