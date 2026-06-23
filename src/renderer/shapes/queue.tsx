import type { FC } from 'react'

import type { ShapeProps } from './rectangle'

export const Queue: FC<ShapeProps> = ({ x, y, w, h }) => {
  // A pill/capsule with two interior dividers, evoking a queue.
  const r = h / 2
  const stripeXs = [x + w * 0.55, x + w * 0.7, x + w * 0.85]

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        ry={r}
        fill='#ffffff'
        stroke='#3b4252'
        strokeWidth={1.5}
      />
      {stripeXs.map((sx) => (
        <line
          key={sx}
          x1={sx}
          x2={sx}
          y1={y + h * 0.15}
          y2={y + h * 0.85}
          stroke='#3b4252'
          strokeWidth={1}
        />
      ))}
    </g>
  )
}
