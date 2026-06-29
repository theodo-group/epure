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
  patternId = 'epure-grid',
}) => (
  <g aria-hidden='true' data-ep-grid=''>
    <defs>
      <pattern
        id={patternId}
        width={gridSize}
        height={gridSize}
        patternUnits='userSpaceOnUse'
      >
        <circle cx={0} cy={0} r={1.5} fill='#cbd5e1' />
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
