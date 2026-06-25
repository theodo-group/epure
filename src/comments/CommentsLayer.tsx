// SVG overlay rendered inside the canvas: numbered comment pins (anchored to
// their target, or to the stored point with a target-missing ring) plus a
// click-capture rect that turns canvas clicks into new pins while in comment
// mode. Everything is in diagram coordinates, so it pans/zooms with the canvas.

import type { FC, MouseEvent } from 'react'

import type { RoutedDiagram } from '@/layout/types'

import { resolvePin } from './pins'
import type { EprComment } from './types'

interface CommentsLayerProps {
  comments: EprComment[]
  routed: RoutedDiagram
  selectedId: string | null
  onSelect: (id: string) => void
  commentMode: boolean
  /** viewBox in diagram coords, for the full-canvas capture rect. */
  viewBox: { x: number; y: number; w: number; h: number }
  /** Screen-pixel click → place a pin (Canvas resolves coords + ref). */
  onPlace: (clientX: number, clientY: number) => void
  /** Pin radius in diagram units (kept readable by dividing by zoom). */
  zoom: number
}

const COLOR = {
  open: '#f59e0b',
  resolved: '#22c55e',
  missing: '#ef4444',
}

export const CommentsLayer: FC<CommentsLayerProps> = ({
  comments,
  routed,
  selectedId,
  onSelect,
  commentMode,
  viewBox,
  onPlace,
  zoom,
}) => {
  const r = 11 / zoom // keep pins a constant on-screen size

  return (
    <g data-comments-layer="">
      {commentMode ? (
        <rect
          x={viewBox.x}
          y={viewBox.y}
          width={viewBox.w}
          height={viewBox.h}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onMouseDown={(e: MouseEvent<SVGRectElement>) => {
            e.stopPropagation()
            e.preventDefault()
            onPlace(e.clientX, e.clientY)
          }}
        />
      ) : null}
      {comments.map((c, i) => {
        const anchor = resolvePin(c, routed)
        const fill =
          c.status === 'resolved'
            ? COLOR.resolved
            : anchor.resolved
              ? COLOR.open
              : COLOR.missing
        const selected = c.id === selectedId
        return (
          <g
            key={c.id}
            transform={`translate(${anchor.px}, ${anchor.py})`}
            style={{ cursor: 'pointer' }}
            onMouseDown={(e) => {
              e.stopPropagation()
              onSelect(c.id)
            }}
          >
            {selected ? (
              <circle r={r + 3 / zoom} fill="none" stroke="#3b82f6" strokeWidth={2 / zoom} />
            ) : null}
            <circle
              r={r}
              fill={fill}
              stroke="#ffffff"
              strokeWidth={1.5 / zoom}
              opacity={c.status === 'resolved' ? 0.6 : 1}
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12 / zoom}
              fontWeight={700}
              fill="#ffffff"
              pointerEvents="none"
            >
              {i + 1}
            </text>
          </g>
        )
      })}
    </g>
  )
}
