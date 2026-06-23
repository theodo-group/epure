import type { FC } from 'react'

import type { ShapeProps } from './rectangle'

export const Document: FC<ShapeProps> = ({ x, y, w, h }) => {
  // Classic "document" shape: top edge straight, bottom edge wavy.
  const waveDepth = Math.min(h * 0.12, 10)
  const midY = y + h - waveDepth
  const q1x = x + w * 0.25
  const q2x = x + w * 0.5
  const q3x = x + w * 0.75

  const d = [
    `M ${x} ${y}`,
    `H ${x + w}`,
    `V ${midY}`,
    `Q ${q3x} ${midY + waveDepth * 1.6} ${q2x} ${midY}`,
    `Q ${q1x} ${midY - waveDepth * 1.6} ${x} ${midY}`,
    'Z',
  ].join(' ')

  return (
    <path
      d={d}
      fill='#ffffff'
      stroke='#3b4252'
      strokeWidth={1.5}
      strokeLinejoin='round'
    />
  )
}
