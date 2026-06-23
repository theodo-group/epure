import type { FC } from 'react'

import type { ShapeProps } from './rectangle'

export const Page: FC<ShapeProps> = ({ x, y, w, h }) => {
  // Rectangle with a folded top-right corner.
  const fold = Math.min(w, h) * 0.18
  const right = x + w
  const bottom = y + h

  const body = [
    `M ${x} ${y}`,
    `H ${right - fold}`,
    `L ${right} ${y + fold}`,
    `V ${bottom}`,
    `H ${x}`,
    'Z',
  ].join(' ')

  const corner = [
    `M ${right - fold} ${y}`,
    `V ${y + fold}`,
    `H ${right}`,
  ].join(' ')

  return (
    <g>
      <path
        d={body}
        fill='#ffffff'
        stroke='#3b4252'
        strokeWidth={1.5}
        strokeLinejoin='round'
      />
      <path
        d={corner}
        fill='none'
        stroke='#3b4252'
        strokeWidth={1.5}
        strokeLinejoin='round'
      />
    </g>
  )
}
