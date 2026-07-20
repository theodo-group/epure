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
  // The figure is drawn inside the largest square that fits the bounding box and
  // is centred within it, so a person never stretches — a non-square box just
  // pads the figure rather than distorting it (resizing keeps a 1:1 ratio, so in
  // practice the box is square and the figure fills it edge to edge).
  const size = Math.min(w, h)
  const fx = x + (w - size) / 2
  const fy = y + (h - size) / 2
  const cx = fx + size / 2
  const headR = size * 0.16
  const headCy = fy + headR + 4
  const bodyTop = headCy + headR + 2
  const bodyH = fy + size - bodyTop - 2
  const bodyW = size * 0.7
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
