import type { FC } from 'react'

import type { ShapeProps } from './rectangle'

export const Cylinder: FC<ShapeProps> = ({
  x,
  y,
  w,
  h,
  fill = '#ffffff',
  stroke = '#3b4252',
  strokeWidth = 1.5,
  strokeDasharray,
}) => {
  const rx = w / 2
  const ry = Math.min(h * 0.12, 12)
  const topCy = y + ry
  const bottomCy = y + h - ry
  const bodyH = h - ry * 2

  const path = [
    `M ${x} ${topCy}`,
    `a ${rx} ${ry} 0 0 0 ${w} 0`,
    `v ${bodyH}`,
    `a ${rx} ${ry} 0 0 1 ${-w} 0`,
    'Z',
  ].join(' ')

  return (
    <g>
      <path
        d={path}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
      <ellipse
        cx={x + rx}
        cy={topCy}
        rx={rx}
        ry={ry}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
      <ellipse
        cx={x + rx}
        cy={bottomCy}
        rx={rx}
        ry={ry}
        fill='none'
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray='3 3'
      />
    </g>
  )
}
