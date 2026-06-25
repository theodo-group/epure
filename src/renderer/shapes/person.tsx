import type { FC } from 'react'

import type { ShapeProps } from './rectangle'

export const Person: FC<ShapeProps> = ({
  x,
  y,
  w,
  h,
  fill = '#ffffff',
  stroke = '#475569',
  strokeWidth = 1.5,
  strokeDasharray,
}) => {
  // Stick-figure-in-a-card: head circle on top, rounded body underneath.
  const cx = x + w / 2
  const headR = Math.min(w, h) * 0.16
  const headCy = y + headR + 4
  const bodyTop = headCy + headR + 2
  const bodyH = y + h - bodyTop - 2
  const bodyW = w * 0.7
  const bodyX = cx - bodyW / 2

  return (
    <g>
      <circle
        cx={cx}
        cy={headCy}
        r={headR}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
      <path
        d={[
          `M ${bodyX} ${bodyTop + bodyH}`,
          `Q ${bodyX} ${bodyTop} ${cx} ${bodyTop}`,
          `Q ${bodyX + bodyW} ${bodyTop} ${bodyX + bodyW} ${bodyTop + bodyH}`,
          'Z',
        ].join(' ')}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
      />
    </g>
  )
}
