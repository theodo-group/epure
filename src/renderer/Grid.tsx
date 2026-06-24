import type { FC } from 'react'

interface GridProps {
  x: number
  y: number
  width: number
  height: number
  gridSize: number
  patternId?: string
}

export const Grid: FC<GridProps> = ({
  x,
  y,
  width,
  height,
  gridSize,
  patternId = 'archgrid-grid',
}) => (
  <g aria-hidden='true'>
    <defs>
      <pattern
        id={patternId}
        width={gridSize}
        height={gridSize}
        patternUnits='userSpaceOnUse'
      >
        <circle cx={0} cy={0} r={2} fill='#bfc5d0' />
      </pattern>
    </defs>
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={`url(#${patternId})`}
    />
  </g>
)
