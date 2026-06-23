import type { FC } from 'react'

export interface ShapeProps {
  x: number
  y: number
  w: number
  h: number
}

export const Rectangle: FC<ShapeProps> = ({ x, y, w, h }) => (
  <rect
    x={x}
    y={y}
    width={w}
    height={h}
    rx={6}
    ry={6}
    fill='#ffffff'
    stroke='#3b4252'
    strokeWidth={1.5}
  />
)
