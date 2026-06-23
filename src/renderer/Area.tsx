import type { FC } from 'react'

import type { AreaLayout } from '@/layout/types'

interface AreaProps {
  area: AreaLayout
}

export const Area: FC<AreaProps> = ({ area }) => (
  <g data-area-id={area.id}>
    <rect
      x={area.x}
      y={area.y}
      width={area.w}
      height={area.h}
      rx={12}
      ry={12}
      fill='#f4f5f9'
      stroke='#cdd2dd'
      strokeWidth={1}
      strokeDasharray='4 4'
    />
    {area.label ? (
      <text
        x={area.x + 12}
        y={area.y + 20}
        fontFamily='Inter, system-ui, sans-serif'
        fontSize={12}
        fontWeight={600}
        fill='#5b6478'
      >
        {area.label}
      </text>
    ) : null}
  </g>
)
